import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenantTx, withDb } from "../db/pool.js";
import { apiKeyAuthHook } from "../middleware/api-key-auth.js";
import { runInTenantContext } from "../tenant-context.js";
import { getAdapter } from "../ingestion/adapter-registry.js";
import { AdapterConfigSchema } from "@twin/core";
import { validateUrlForFetch } from "../ingestion/fetch-security.js";
import { randomUUID } from "node:crypto";

const DocumentSchema = z
  .object({
    externalDocId: z.string().optional(),
    attachmentId: z.string().optional(),
    docId: z.string().optional(),
    fileName: z.string().optional(),
    attachmentName: z.string().optional(),
    sourceUrl: z.string().optional(),
    downloadUrl: z.string().optional(),
    url: z.string().optional(),
    docType: z.string().optional(),
    attachmentType: z.string().optional(),
    type: z.string().optional(),
    classification: z.string().optional(),
    sizeBytes: z.number().optional(),
    fileSize: z.number().optional(),
    mime: z.string().optional(),
    mimeType: z.string().optional(),
    contentHash: z.string().optional(),
  })
  .passthrough();

const BodySchema = z.object({
  source: z.string().min(1),
  externalLoanId: z.string().min(1),
  documents: z.array(DocumentSchema),
});

export function registerDocumentsIngestRoutes(app: FastifyInstance): void {
  app.post<{ Params: { tenantSlug: string } }>(
    "/api/ingest/:tenantSlug/documents",
    { preHandler: apiKeyAuthHook },
    async (req, reply) => {
      const tenantId = (req as unknown as { tenantId?: string }).tenantId;
      if (!tenantId) return reply.code(401).send({ error_class: "missing_tenant_context" });

      const parsed = BodySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error_class: "validation_failed", details: parsed.error.flatten() });
      }

      const { source, externalLoanId, documents } = parsed.data;
      const errorId = randomUUID();
      const ingestBatchId = randomUUID();

      return runInTenantContext(
        { tenantId, userId: "api-ingest", isSuperAdmin: false, role: "operator" },
        async () => {
          // Verify the loan exists — explicit tenant_id filter (pooler-bypass-RLS).
          const loanRow = await withTenantTx(tenantId, async (c) => {
            const { rows } = await c.query<{ loan_id: string }>(
              `SELECT loan_id FROM ingested_loans
                WHERE tenant_id = $1 AND external_id = $2 LIMIT 1`,
              [tenantId, externalLoanId],
            );
            return rows[0] ?? null;
          });
          if (!loanRow) {
            return reply.code(404).send({ error_id: errorId, error_class: "loan_not_found" });
          }
          const loanId = loanRow.loan_id;

          // Load mapping — explicit tenant filter (pooler-bypass-RLS).
          const mapping = await withTenantTx(tenantId, async (c) => {
            const { rows } = await c.query<{ adapter_type: string; adapter_config: unknown }>(
              `SELECT adapter_type, adapter_config FROM ingestion_mappings
                WHERE tenant_id = $1 AND source_name = $2 AND active = true LIMIT 1`,
              [tenantId, source],
            );
            return rows[0] ?? null;
          });

          const adapterType = mapping?.adapter_type;
          if (!adapterType) {
            return reply.code(400).send({ error_id: errorId, error_class: "no_active_mapping" });
          }
          const adapter = getAdapter(adapterType);
          if (!adapter) {
            req.log?.error?.({ tenantId, adapterType, errorId }, "[ingest/docs] unknown adapter_type");
            return reply.code(400).send({ error_id: errorId, error_class: "unknown_adapter_type" });
          }
          const config = AdapterConfigSchema.parse(mapping?.adapter_config ?? {});

          // Per-doc: transform → validate → SSRF gate (layers 1+2) → insert.
          let accepted = 0;
          let duplicates = 0;
          const jobs: string[] = [];
          const errors: Array<{ docIndex: number; code: string; detail?: string }> = [];

          for (let i = 0; i < documents.length; i++) {
            const raw = documents[i]!;

            let meta;
            try {
              meta = adapter.transformDocument(raw, config);
            } catch (e) {
              errors.push({ docIndex: i, code: "transform_failed", detail: (e as Error).message.slice(0, 200) });
              continue;
            }

            const v = adapter.validateDocument(meta);
            if (!v.valid) {
              errors.push({ docIndex: i, code: "validate_failed", detail: v.errors.join("; ") });
              continue;
            }

            const secGate = validateUrlForFetch(meta.sourceUrl, config.allowedFetchHosts ?? []);
            if (!secGate.ok) {
              errors.push({ docIndex: i, code: secGate.reason ?? "url_blocked", detail: secGate.detail });
              continue;
            }

            const documentId = `${loanId}-DOC-${meta.externalDocId}`;
            const inserted = await withTenantTx(tenantId, async (c) => {
              const r = await c.query(
                `INSERT INTO ingested_documents
                   (tenant_id, external_id, document_id, loan_id, source_url, file_name, status, ingest_batch_id)
                 VALUES ($1, $2, $3, $4, $5, $6, 'pending_fetch', $7)
                 ON CONFLICT (tenant_id, external_id) DO NOTHING`,
                [tenantId, meta.externalDocId, documentId, loanId, meta.sourceUrl, meta.fileName, ingestBatchId],
              );
              return r.rowCount ?? 0;
            });

            if (inserted > 0) {
              accepted++;
              jobs.push(meta.externalDocId);
            } else {
              duplicates++;
            }
          }

          if (accepted === 0 && errors.length > 0) {
            return reply.code(400).send({
              error_id: errorId,
              error_class: "validation_failed",
              adapter_type: adapterType,
              errors,
            });
          }

          // Per-batch audit row — tenant_audit_log has no RLS, use withDb.
          await withDb(async (c) => {
            await c.query(
              `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
               VALUES ($1, 'api-ingest', 'ingest.documents', $2, $3::jsonb)`,
              [
                tenantId,
                `docs batch for loan ${loanId} (${accepted} accepted, ${duplicates} dup)`,
                JSON.stringify({
                  adapter_type: adapterType,
                  source_name: source,
                  external_loan_id: externalLoanId,
                  count: accepted,
                  duplicates,
                  ingest_batch_id: ingestBatchId,
                }),
              ],
            );
          });

          return reply.code(202).send({
            accepted,
            duplicates,
            jobs,
            ingest_batch_id: ingestBatchId,
            ...(errors.length > 0 ? { warnings: errors } : {}),
          });
        },
      );
    },
  );
}
