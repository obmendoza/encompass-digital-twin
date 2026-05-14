import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { withTenantTx } from "../db/pool.js";
import { apiKeyAuthHook } from "../middleware/api-key-auth.js";
import { runInTenantContext } from "../tenant-context.js";
import { getAdapter } from "../ingestion/adapter-registry.js";
import { AdapterConfigSchema } from "@twin/core";
import type { Store } from "@twin/core";
import { writeExtrasFirstWriteWins } from "../ingestion/loan-context-extras.js";
import { MissingExternalIdError } from "../ingestion/lender-adapter.js";
import { buildLoanFromPartial } from "./ingestion.js";

const BodySchema = z.object({
  source: z.string().min(1),
  externalId: z.string().min(1),
  borrowerName: z.string().optional(),
  analysisOutput: z.unknown(),
});

export const portalMetrics = {
  eligibility_disagreements_total: new Map<string, number>(),
};

function incrementEligibilityDisagreement(program: string, portalStatus: string, pcV2Status: string): void {
  const key = `${program}|${portalStatus}|${pcV2Status}`;
  portalMetrics.eligibility_disagreements_total.set(
    key,
    (portalMetrics.eligibility_disagreements_total.get(key) ?? 0) + 1,
  );
}

export function registerAnalysisOutputIngestRoutes(app: FastifyInstance, store: Store): void {
  app.post<{ Params: { tenantSlug: string } }>(
    "/api/ingest/:tenantSlug/analysis-output",
    { preHandler: apiKeyAuthHook },
    async (req, reply) => {
      const tenantId = (req as unknown as { tenantId?: string }).tenantId;
      if (!tenantId) return reply.code(401).send({ error_class: "missing_tenant_context" });

      const parsed = BodySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error_class: "validation_failed", details: parsed.error.flatten() });

      const { source, externalId, analysisOutput } = parsed.data;
      const errorId = randomUUID();
      const analysisHash = createHash("sha256").update(JSON.stringify(analysisOutput)).digest("hex");

      return runInTenantContext(
        { tenantId, userId: "api-ingest", isSuperAdmin: false, role: "operator" },
        async () => {
          // Three-branch idempotency.
          const existing = await withTenantTx(tenantId, async (c) => {
            const { rows } = await c.query<{ loan_id: string; status: string; analysis_hash: string | null }>(
              `SELECT loan_id, status, analysis_hash FROM ingested_loans
                WHERE tenant_id = $1 AND external_id = $2 LIMIT 1`,
              [tenantId, externalId],
            );
            return rows[0] ?? null;
          });

          let replayed = false;
          if (existing && existing.analysis_hash === analysisHash) {
            return reply.code(200).send({ loanId: existing.loan_id, tenantId, status: existing.status, duplicate: true });
          }
          if (existing && existing.analysis_hash !== analysisHash) {
            await withTenantTx(tenantId, async (c) => {
              await c.query(
                `UPDATE predicted_conditions SET superseded_at = NOW()
                  WHERE tenant_id=$1 AND loan_id=$2 AND source_list='portal-llm' AND superseded_at IS NULL`,
                [tenantId, existing.loan_id],
              );
              await c.query(
                `UPDATE portal_eligibility_verdicts SET superseded_at = NOW()
                  WHERE tenant_id=$1 AND loan_id=$2 AND superseded_at IS NULL`,
                [tenantId, existing.loan_id],
              );
            });
            replayed = true;
          }

          // Resolve mapping + adapter.
          const mapping = await withTenantTx(tenantId, async (c) => {
            const { rows } = await c.query<{ adapter_type: string; adapter_config: unknown }>(
              `SELECT adapter_type, adapter_config FROM ingestion_mappings
                WHERE tenant_id = $1 AND source_name = $2 AND active = true LIMIT 1`,
              [tenantId, source],
            );
            return rows[0] ?? null;
          });
          const adapterType = mapping?.adapter_type;
          if (!adapterType) return reply.code(400).send({ error_id: errorId, error_class: "no_active_mapping" });
          const adapter = getAdapter(adapterType);
          if (!adapter) return reply.code(400).send({ error_id: errorId, error_class: "unknown_adapter_type" });
          const config = AdapterConfigSchema.parse(mapping?.adapter_config ?? {});

          // Adapter dispatch.
          let result;
          try {
            result = adapter.transformAnalysisOutput(analysisOutput, config);
          } catch (e) {
            if (e instanceof MissingExternalIdError) {
              return reply.code(400).send({ error_id: errorId, error_class: "missing_external_id", adapter_type: adapterType });
            }
            req.log?.error?.({ err: e, tenantId, adapterType, errorId }, "[analysis-output] transform failed");
            return reply.code(500).send({ error_id: errorId, error_class: "transform_failed", adapter_type: adapterType });
          }

          const loanId = existing?.loan_id ?? `${config.identityPrefix}${externalId}`;
          const loan = buildLoanFromPartial(loanId, result.loan, tenantId);
          store.dispatch({ type: "InjectLoan", loan });

          // Write extras (first-write-wins on initial, no-op on supersede).
          const cleanedExtras = Object.fromEntries(
            Object.entries(result.extras).filter(([, v]) => v !== undefined),
          );
          if (Object.keys(cleanedExtras).length > 0) {
            await writeExtrasFirstWriteWins(tenantId, loanId, cleanedExtras as never);
          }

          // Insert portal predictions.
          for (const p of result.portalPredictions) {
            await withTenantTx(tenantId, async (c) => {
              await c.query(
                `INSERT INTO predicted_conditions
                   (id, tenant_id, loan_id, prediction_run_id, source_list, description, category, status,
                    source_input_hash, kb_version_id, source_rule_table, source_rule_id, emission_kind,
                    portal_metadata, analysis_hash)
                 VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), 'portal-llm', $3, 'PTA', 'pending',
                         $4, NULL, NULL, NULL, 'deterministic',
                         $5::jsonb, $6)`,
                [
                  tenantId, loanId, p.documentType, analysisHash,
                  JSON.stringify({
                    priority: p.priority, severity: p.severity, document_category: p.documentCategory,
                    document_type: p.documentType, specifications: p.specifications,
                    reasons_needed: p.reasonsNeeded, source_references: p.sourceReferences,
                    tags: p.tags, source_module: p.sourceModule, applies_to: p.appliesTo,
                    portal_status: p.portalStatus,
                  }),
                  analysisHash,
                ],
              );
            });
          }

          // Insert portal eligibility verdicts.
          for (const ev of result.eligibilityVerdict.perProgram) {
            await withTenantTx(tenantId, async (c) => {
              await c.query(
                `INSERT INTO portal_eligibility_verdicts
                   (tenant_id, loan_id, program, status, passed_count, failed_count, failed_rules, analysis_hash)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
                [tenantId, loanId, ev.program, ev.status, ev.passedCount, ev.failedCount,
                 JSON.stringify(ev.failedRules), analysisHash],
              );
            });
          }

          // Upsert ingested_loans with analysis_hash.
          await withTenantTx(tenantId, async (c) => {
            await c.query(
              `INSERT INTO ingested_loans (tenant_id, external_id, loan_id, status, analysis_hash)
               VALUES ($1, $2, $3, 'queued', $4)
               ON CONFLICT (tenant_id, external_id)
                 DO UPDATE SET analysis_hash = EXCLUDED.analysis_hash`,
              [tenantId, externalId, loanId, analysisHash],
            );
          });

          // Audit row.
          await withTenantTx(tenantId, async (c) => {
            await c.query(
              `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
               VALUES ($1, 'api-ingest', $2, $3, $4::jsonb)`,
              [
                tenantId,
                replayed ? "ingest.analysis_output.replayed" : "ingest.analysis_output",
                `analysis output ingested for loan ${loanId}`,
                JSON.stringify({
                  adapter_type: adapterType, source_name: source, external_id: externalId,
                  hard_stops: result.stats.hardStopDocuments,
                  total_docs: result.stats.totalDocumentRequests,
                  elapsed_seconds: result.stats.elapsedSeconds,
                  tool_calls: result.stats.toolCalls,
                  eligible_count: result.eligibilityVerdict.eligiblePrograms.length,
                  ineligible_count: result.eligibilityVerdict.ineligiblePrograms.length,
                  analysis_hash: analysisHash, replayed,
                }),
              ],
            );
          });

          // PC v2 second-opinion auto-fire (best-effort).
          let pcV2Triggered = false;
          try {
            const { run: runPredictions } = await import("../services/predict-conditions/index.js");
            const { buildLoanContextFromLoan } = await import("./predict-conditions-context-builder.js");
            const ctx = await buildLoanContextFromLoan(loan);
            await runPredictions(tenantId, loanId, ctx, "system:loan-ingest");
            pcV2Triggered = true;
          } catch (err) {
            req.log?.error?.({ err, tenantId, loanId, errorId }, "[predict-conditions] auto-fire after analysis-output failed");
          }

          // Eligibility-disagreement detection (Spec 1.5 §7.1).
          // For each program in the portal verdict, check whether PC v2's
          // matrix-resolver emitted a row mentioning that program. A row
          // means PC v2 thinks the program FAILS; absence means PC v2 thinks
          // it PASSES. Disagreement → audit + metric.
          if (pcV2Triggered) {
            try {
              const pcMatrixFindings = await withTenantTx(tenantId, async (c) => {
                const { rows } = await c.query<{ description: string }>(
                  `SELECT description FROM predicted_conditions
                    WHERE tenant_id=$1 AND loan_id=$2 AND source_list='matrix'
                      AND status='pending' AND superseded_at IS NULL`,
                  [tenantId, loanId],
                );
                return rows;
              });
              for (const portalProgram of result.eligibilityVerdict.perProgram) {
                const pcSaidFail = pcMatrixFindings.some((f) =>
                  f.description.includes(portalProgram.program),
                );
                const pcStatus: "PASS" | "FAIL" = pcSaidFail ? "FAIL" : "PASS";
                if (pcStatus !== portalProgram.status) {
                  await withTenantTx(tenantId, async (c) => {
                    await c.query(
                      `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
                       VALUES ($1, 'system:eligibility-comparator', 'eligibility.disagreement', $2, $3::jsonb)`,
                      [
                        tenantId,
                        `portal ${portalProgram.status} vs pc_v2 ${pcStatus} on ${portalProgram.program}`,
                        JSON.stringify({
                          program: portalProgram.program,
                          portal_status: portalProgram.status,
                          pc_v2_status: pcStatus,
                          loan_id: loanId,
                          analysis_hash: analysisHash,
                        }),
                      ],
                    );
                  });
                  incrementEligibilityDisagreement(portalProgram.program, portalProgram.status, pcStatus);
                }
              }
            } catch (err) {
              req.log?.error?.({ err, tenantId, loanId }, "[eligibility-disagreement] failed to compute");
            }
          }

          return reply.code(201).send({
            loanId, tenantId, status: "queued",
            portalPredictionCount: result.portalPredictions.length,
            eligibilityPrograms: {
              eligible: result.eligibilityVerdict.eligiblePrograms,
              ineligible: result.eligibilityVerdict.ineligiblePrograms,
            },
            pcV2Triggered, replayed,
          });
        },
      );
    },
  );
}
