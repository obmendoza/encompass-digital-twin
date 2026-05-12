// Predict-conditions service. See spec §3 (service layer) + §5 (data flow).

import { createHash, randomUUID } from "node:crypto";
import { withTenantTx } from "../../db/pool.js";
import {
  resolveRequiredDocs,
  NoActiveKbVersionError,
  KbVersionNotFoundError,
  IncomeTypeUnresolvedError,
  type LoanContext,
  type DocItem,
} from "../doc-requirements.js";
import { categoryInference } from "./category-inference.js";
import type {
  RunResult,
  RunSource,
  PredictionAlertErrorClass,
} from "./types.js";

const REMEDIATION: Record<PredictionAlertErrorClass, string> = {
  NoActiveKbVersionError:
    "Tenant has no active KB version. Run pnpm tsx scripts/approve-kb.ts --tenant <slug> --version-id <int> --as compliance_officer --user-id <uuid> --activate to activate a version. Until then, predictions are unavailable for this loan.",
  KbVersionNotFoundError:
    "KB version not found or belongs to a different tenant. Verify the version id; if it was archived, re-run via /predictions/run to pick up the current active version.",
  IncomeTypeUnresolvedError:
    "No income_type_resolver row for this combination. Either the loan's income_doc_type/borrower_type/citizenship/isItin fields are malformed, or NPNQM's engine doesn't yet cover this combination. Fix the loan fields or contact NPNQM to add an engine row, then re-run /predictions/run.",
};

function canonicalizeContext(loan: LoanContext): string {
  // Canonical JSON for hashing: sort top-level keys deterministically.
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(loan).sort()) {
    sorted[k] = (loan as unknown as Record<string, unknown>)[k];
  }
  return JSON.stringify(sorted);
}

function hashInput(loan: LoanContext): string {
  return createHash("sha256").update(canonicalizeContext(loan)).digest("hex");
}

interface PendingMatch {
  prediction_run_id: string;
  count: number;
}

export async function run(
  tenantId: string,
  loanId: string,
  loan: LoanContext,
  source: RunSource,
): Promise<RunResult> {
  const sourceInputHash = hashInput(loan);

  return withTenantTx(tenantId, async (c) => {
    // Per-loan advisory lock so concurrent runs serialize.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`predict:${loanId}`]);

    // Resolve active kb_version_id up-front so the idempotency check can match on it.
    const { rows: kbRows } = await c.query<{ id: number }>(
      `SELECT id FROM kb_versions WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
      [tenantId],
    );
    const activeKbId = kbRows[0]?.id ?? null;

    // If we have an active KB, check for an existing pending batch with matching hash + kb_version_id.
    if (activeKbId !== null) {
      const { rows: existingRows } = await c.query<PendingMatch>(
        `SELECT prediction_run_id, COUNT(*)::int AS count
           FROM predicted_conditions
          WHERE tenant_id = $1 AND loan_id = $2 AND status = 'pending'
            AND source_input_hash = $3 AND kb_version_id = $4
          GROUP BY prediction_run_id LIMIT 1`,
        [tenantId, loanId, sourceInputHash, activeKbId],
      );
      const existing = existingRows[0];
      if (existing && existing.count > 0) {
        return { runId: existing.prediction_run_id, predictionCount: existing.count, alertCount: 0, reused: true };
      }
    }

    // DELETE existing pending rows that don't match (hash or kb_version_id changed).
    await c.query(
      `DELETE FROM predicted_conditions
        WHERE tenant_id = $1 AND loan_id = $2 AND status = 'pending'`,
      [tenantId, loanId],
    );

    // Call the resolver. Catches → translate to prediction_alerts.
    let docs: { minimum: DocItem[]; income: DocItem[]; resolvedIncomeType: string; kbVersionId: number };
    try {
      const result = await resolveRequiredDocs(tenantId, null, loan);
      docs = {
        minimum: result.minimum,
        income: result.income,
        resolvedIncomeType: result.resolvedIncomeType,
        kbVersionId: result.kbVersionId,
      };
    } catch (e) {
      const ec: PredictionAlertErrorClass | null =
        e instanceof NoActiveKbVersionError ? "NoActiveKbVersionError"
        : e instanceof KbVersionNotFoundError ? "KbVersionNotFoundError"
        : e instanceof IncomeTypeUnresolvedError ? "IncomeTypeUnresolvedError"
        : null;
      if (ec === null) throw e;
      const payload: Record<string, unknown> =
        e instanceof IncomeTypeUnresolvedError
          ? { inputs: e.inputs, kbVersionId: e.kbVersionId }
          : e instanceof KbVersionNotFoundError
            ? { kbVersionId: e.kbVersionId, tenantId: e.tenantId }
            : { tenantId };
      const alertInsert = await c.query<{ id: string }>(
        `INSERT INTO prediction_alerts (tenant_id, loan_id, error_class, error_payload, remediation_hint)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING id`,
        [tenantId, loanId, ec, JSON.stringify(payload), REMEDIATION[ec]],
      );
      const alertId = alertInsert.rows[0]!.id;
      const runId = randomUUID();
      // Audit-log row for the alert (dedup-on-replay).
      await c.query(
        `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
         SELECT $1, $2, 'predict_conditions.alert', $3, $4::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM tenant_audit_log
            WHERE target_tenant_id = $1 AND actor_id = $2
              AND action = 'predict_conditions.alert' AND (metadata->>'alert_id') = $5
         )`,
        [tenantId, source, `${ec} during predict-conditions run on loan ${loanId}`, JSON.stringify({ alert_id: alertId, error_class: ec }), alertId],
      );
      // Audit row for the run itself.
      await c.query(
        `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
         VALUES ($1, $2, 'predict_conditions.run', $3, $4::jsonb)`,
        [
          tenantId,
          source,
          `prediction run for loan ${loanId} produced alert`,
          JSON.stringify({ run_id: runId, source, outcome: "alert_emitted", alert_class: ec, reused: false, kb_version_id: null }),
        ],
      );
      return { runId, predictionCount: 0, alertCount: 1, reused: false };
    }

    // Happy path — insert N predictions.
    const runId = randomUUID();
    const items: Array<{ list: "minimum" | "income"; doc: DocItem }> = [
      ...docs.minimum.map((d) => ({ list: "minimum" as const, doc: d })),
      ...docs.income.map((d) => ({ list: "income" as const, doc: d })),
    ];
    for (const { list, doc } of items) {
      await c.query(
        `INSERT INTO predicted_conditions
           (tenant_id, loan_id, prediction_run_id, source_input_hash, predicted_by,
            kb_version_id, resolved_income_type, category, description, note,
            source_list, source_order, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')`,
        [
          tenantId, loanId, runId, sourceInputHash, source,
          docs.kbVersionId, docs.resolvedIncomeType,
          categoryInference(doc), doc.name, doc.note,
          list, doc.order,
        ],
      );
    }

    // Auto-clear any active alerts for this loan, with audit rows per alert.
    const { rows: alertsToClear } = await c.query<{ id: string }>(
      `UPDATE prediction_alerts
          SET cleared_by = 'system:successful-rerun', cleared_at = now()
        WHERE tenant_id = $1 AND loan_id = $2 AND cleared_at IS NULL
        RETURNING id`,
      [tenantId, loanId],
    );
    for (const a of alertsToClear) {
      await c.query(
        `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
         SELECT $1, $2, 'predict_conditions.alert_clear', $3, $4::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM tenant_audit_log
            WHERE target_tenant_id = $1 AND actor_id = $2
              AND action = 'predict_conditions.alert_clear' AND (metadata->>'alert_id') = $5
         )`,
        [
          tenantId,
          source,
          `auto-cleared alert ${a.id} on successful re-run`,
          JSON.stringify({ alert_id: a.id, cleared_by: "system:successful-rerun", triggered_by_run_id: runId }),
          a.id,
        ],
      );
    }

    // Audit row for the run itself.
    await c.query(
      `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
       VALUES ($1, $2, 'predict_conditions.run', $3, $4::jsonb)`,
      [
        tenantId,
        source,
        `predicted ${items.length} conditions for loan ${loanId}`,
        JSON.stringify({
          run_id: runId,
          source,
          kb_version_id: docs.kbVersionId,
          outcome: "predictions_emitted",
          count: items.length,
          reused: false,
        }),
      ],
    );

    return { runId, predictionCount: items.length, alertCount: 0, reused: false };
  });
}
