// Predict-conditions service. See spec §3 (service layer) + §5 (data flow).

import { createHash, randomUUID } from "node:crypto";
import { withTenantTx } from "../../db/pool.js";
import { withStoreSnapshot } from "../../store-db-consistency.js";
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
  AcceptResult,
  DismissResult,
  ClearAlertResult,
  PredictedConditionRole,
} from "./types.js";
import type { Store } from "@twin/core";
import {
  PredictionNotFoundError,
  PredictionNotPendingError,
  PredictionNotDismissedError,
  DismissalReasonTooShortError,
  AlertNotFoundError,
  PredictionConditionCollisionError,
} from "./errors.js";

const REMEDIATION: Record<PredictionAlertErrorClass, string> = {
  NoActiveKbVersionError:
    "Tenant has no active KB version. Run pnpm tsx scripts/approve-kb.ts --tenant <slug> --version-id <int> --as compliance_officer --user-id <uuid> --activate to activate a version. Until then, predictions are unavailable for this loan.",
  KbVersionNotFoundError:
    "KB version not found or belongs to a different tenant. Verify the version id; if it was archived, re-run via /predictions/run to pick up the current active version.",
  IncomeTypeUnresolvedError:
    "No income_type_resolver row for this combination. Either the loan's income_doc_type/borrower_type/citizenship/isItin fields are malformed, or NPNQM's engine doesn't yet cover this combination. Fix the loan fields or contact NPNQM to add an engine row, then re-run /predictions/run.",
};

// EXPORTED FOR TESTS ONLY. Do not call from production code paths. When set,
// the next accept() or reopenAndAccept() call throws this error exactly once
// immediately after dispatching AddCondition, exercising the rollback path
// without requiring DB-level sabotage. Consumed on read (one-shot reset).
let __testOnly_throwAfterDispatch: Error | null = null;

export function __testOnly_setThrowAfterDispatch(e: Error | null): void {
  __testOnly_throwAfterDispatch = e;
}

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

// ── Store dependency injection ───────────────────────────────────────────
//
// The accept() and reopenAndAccept() paths need to dispatch an AddCondition
// action against the in-memory store to mint a real Condition.id. The existing
// routes import `store` from server.ts via the register*Routes pattern;
// service functions don't have that wiring today, so we accept the store as
// an explicit dependency via configurePredictConditionsService() called once
// at server boot (Task 8 wires this up).

interface PredictConditionsServiceDeps {
  store: Store;
}

let serviceDeps: PredictConditionsServiceDeps | null = null;

export function configurePredictConditionsService(deps: PredictConditionsServiceDeps): void {
  serviceDeps = deps;
}

function getStore(): Store {
  if (!serviceDeps) {
    throw new Error("predict-conditions service not configured — call configurePredictConditionsService(deps) at server boot");
  }
  return serviceDeps.store;
}

// ── accept() ─────────────────────────────────────────────────────────────

export async function accept(
  tenantId: string,
  loanId: string,
  predictionId: string,
  actorId: string,
  role: PredictedConditionRole,
): Promise<AcceptResult> {
  return withTenantTx(tenantId, async (c) => {
    const { rows } = await c.query<{
      id: string;
      loan_id: string;
      category: string;
      description: string;
      note: string | null;
      status: string;
    }>(
      `SELECT id, loan_id, category, description, note, status
         FROM predicted_conditions
        WHERE id = $1 AND tenant_id = $2 AND loan_id = $3
        FOR UPDATE`,
      [predictionId, tenantId, loanId],
    );
    // Empty result = prediction doesn't exist, belongs to a different tenant,
    // OR belongs to a different loan in the same tenant. All three collapse to
    // PredictionNotFoundError so callers can't probe cross-loan existence.
    if (rows.length === 0) throw new PredictionNotFoundError(predictionId, tenantId);
    const p = rows[0]!;
    if (p.status !== "pending") throw new PredictionNotPendingError(predictionId, p.status);

    // Per-loan serialization. Prevents the rollback-clobbers-concurrent-work
    // scenario where two parallel accept() calls on different predictions of
    // the same loan interleave at every await and one closure's rollback
    // wipes the other's dispatch. Distinct namespace from run()'s 'predict:'
    // lock so accept and run don't contend on the same loan.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`predict-accept:${p.loan_id}`]);

    const store = getStore();
    return withStoreSnapshot(store, p.loan_id, async () => {
      const beforeLoan = store.getState().loans[p.loan_id];
      if (!beforeLoan) throw new Error(`loan ${p.loan_id} not in store — cannot dispatch AddCondition`);
      const beforeCount = beforeLoan.conditions.length;
      const description = p.note ? `${p.description} (${p.note})` : p.description;
      store.dispatch({
        type: "AddCondition",
        loanId: p.loan_id,
        condition: {
          category: p.category as "PTA" | "PTD" | "PTF" | "PTP",
          source: "Predicted",
          description,
        },
        actor: { kind: "human", id: actorId },
      });
      // Test hook: throw immediately after dispatch to exercise rollback.
      if (__testOnly_throwAfterDispatch) {
        const e = __testOnly_throwAfterDispatch;
        __testOnly_throwAfterDispatch = null;
        throw e;
      }
      const after = store.getState().loans[p.loan_id]!;
      if (after.conditions.length !== beforeCount + 1) {
        throw new PredictionConditionCollisionError(predictionId, p.loan_id, description);
      }
      const newCondition = after.conditions[after.conditions.length - 1]!;
      const conditionId = newCondition.id;

      await c.query(
        `UPDATE predicted_conditions
            SET status = 'accepted',
                acted_by = $1, acted_at = now(), acted_role = $2,
                accepted_condition_id = $3
          WHERE id = $4 AND tenant_id = $5 AND loan_id = $6`,
        [actorId, role, conditionId, predictionId, tenantId, loanId],
      );
      await c.query(
        `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
         SELECT $1, $2, 'predict_conditions.accept', $3, $4::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM tenant_audit_log
            WHERE target_tenant_id = $1 AND actor_id = $2
              AND action = 'predict_conditions.accept' AND (metadata->>'prediction_id') = $5
         )`,
        [
          tenantId,
          actorId,
          `accepted prediction ${predictionId} → condition ${conditionId}`,
          JSON.stringify({ prediction_id: predictionId, condition_id: conditionId, role }),
          predictionId,
        ],
      );
      return { conditionId, predictionId };
    });
  });
}

// ── dismiss() ────────────────────────────────────────────────────────────

export async function dismiss(
  tenantId: string,
  loanId: string,
  predictionId: string,
  actorId: string,
  role: PredictedConditionRole,
  reason: string,
): Promise<DismissResult> {
  if (reason.length < 10) throw new DismissalReasonTooShortError(reason.length);
  return withTenantTx(tenantId, async (c) => {
    const r = await c.query<{ id: string; status: string }>(
      `SELECT id, status FROM predicted_conditions WHERE id = $1 AND tenant_id = $2 AND loan_id = $3 FOR UPDATE`,
      [predictionId, tenantId, loanId],
    );
    // Empty = doesn't exist / different tenant / different loan (all collapse).
    if (r.rows.length === 0) throw new PredictionNotFoundError(predictionId, tenantId);
    if (r.rows[0]!.status !== "pending") throw new PredictionNotPendingError(predictionId, r.rows[0]!.status);
    await c.query(
      `UPDATE predicted_conditions
          SET status = 'dismissed',
              acted_by = $1, acted_at = now(), acted_role = $2,
              dismissal_reason = $3
        WHERE id = $4 AND tenant_id = $5 AND loan_id = $6`,
      [actorId, role, reason, predictionId, tenantId, loanId],
    );
    await c.query(
      `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
       SELECT $1, $2, 'predict_conditions.dismiss', $3, $4::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM tenant_audit_log
          WHERE target_tenant_id = $1 AND actor_id = $2
            AND action = 'predict_conditions.dismiss' AND (metadata->>'prediction_id') = $5
       )`,
      [
        tenantId,
        actorId,
        `dismissed prediction ${predictionId}: ${reason}`,
        JSON.stringify({ prediction_id: predictionId, role, dismissal_reason: reason }),
        predictionId,
      ],
    );
    return { predictionId };
  });
}

// ── reopenAndAccept() ────────────────────────────────────────────────────

export async function reopenAndAccept(
  tenantId: string,
  loanId: string,
  predictionId: string,
  actorId: string,
  role: PredictedConditionRole,
): Promise<AcceptResult> {
  return withTenantTx(tenantId, async (c) => {
    const { rows } = await c.query<{
      id: string;
      loan_id: string;
      category: string;
      description: string;
      note: string | null;
      status: string;
    }>(
      `SELECT id, loan_id, category, description, note, status
         FROM predicted_conditions
        WHERE id = $1 AND tenant_id = $2 AND loan_id = $3 FOR UPDATE`,
      [predictionId, tenantId, loanId],
    );
    // Empty = doesn't exist / different tenant / different loan (all collapse).
    if (rows.length === 0) throw new PredictionNotFoundError(predictionId, tenantId);
    const p = rows[0]!;
    if (p.status !== "dismissed") throw new PredictionNotDismissedError(predictionId, p.status);

    // Same per-loan lock as accept() — they share the namespace so concurrent
    // accept/reopen on the same loan serialize.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`predict-accept:${p.loan_id}`]);

    // Capture prior dismissal audit row id (forward link). Outside the helper
    // closure because it touches only the audit log, not the store.
    const priorRow = await c.query<{ id: string }>(
      `SELECT id FROM tenant_audit_log
        WHERE target_tenant_id = $1
          AND action = 'predict_conditions.dismiss'
          AND (metadata->>'prediction_id') = $2
        ORDER BY created_at DESC LIMIT 1`,
      [tenantId, predictionId],
    );
    const priorDismissalAuditId = priorRow.rows[0]?.id ?? null;

    const store = getStore();
    return withStoreSnapshot(store, p.loan_id, async () => {
      const beforeLoan = store.getState().loans[p.loan_id];
      if (!beforeLoan) throw new Error(`loan ${p.loan_id} not in store — cannot dispatch AddCondition`);
      const beforeCount = beforeLoan.conditions.length;
      const description = p.note ? `${p.description} (${p.note})` : p.description;
      store.dispatch({
        type: "AddCondition",
        loanId: p.loan_id,
        condition: { category: p.category as "PTA" | "PTD" | "PTF" | "PTP", source: "Predicted", description },
        actor: { kind: "human", id: actorId },
      });
      if (__testOnly_throwAfterDispatch) {
        const e = __testOnly_throwAfterDispatch;
        __testOnly_throwAfterDispatch = null;
        throw e;
      }
      const after = store.getState().loans[p.loan_id]!;
      if (after.conditions.length !== beforeCount + 1) {
        throw new PredictionConditionCollisionError(predictionId, p.loan_id, description);
      }
      const conditionId = after.conditions[after.conditions.length - 1]!.id;

      await c.query(
        `UPDATE predicted_conditions
            SET status = 'accepted',
                acted_by = $1, acted_at = now(), acted_role = $2,
                accepted_condition_id = $3,
                dismissal_reason = NULL
          WHERE id = $4 AND tenant_id = $5 AND loan_id = $6`,
        [actorId, role, conditionId, predictionId, tenantId, loanId],
      );
      await c.query(
        `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
         SELECT $1, $2, 'predict_conditions.reopen_and_accept', $3, $4::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM tenant_audit_log
            WHERE target_tenant_id = $1 AND actor_id = $2
              AND action = 'predict_conditions.reopen_and_accept' AND (metadata->>'prediction_id') = $5
         )`,
        [
          tenantId,
          actorId,
          `reopened and accepted prediction ${predictionId} → condition ${conditionId}`,
          JSON.stringify({ prediction_id: predictionId, condition_id: conditionId, role, prior_dismissal_audit_id: priorDismissalAuditId }),
          predictionId,
        ],
      );
      return { conditionId, predictionId };
    });
  });
}

// ── clearAlert() ─────────────────────────────────────────────────────────

export async function clearAlert(
  tenantId: string,
  loanId: string,
  alertId: string,
  actorId: string,
): Promise<ClearAlertResult> {
  return withTenantTx(tenantId, async (c) => {
    const r = await c.query<{ cleared_at: string | null }>(
      `UPDATE prediction_alerts
          SET cleared_by = $1, cleared_at = now()
        WHERE id = $2 AND tenant_id = $3 AND loan_id = $4 AND cleared_at IS NULL
        RETURNING cleared_at`,
      [actorId, alertId, tenantId, loanId],
    );
    if (r.rowCount === 0) {
      // Empty UPDATE = alert doesn't exist / different tenant / different loan / already cleared.
      // Probe with the same loan-scoping so a same-tenant cross-loan alertId can't be
      // discovered via a 200-vs-404 oracle.
      const probe = await c.query<{ id: string }>(
        `SELECT id FROM prediction_alerts WHERE id = $1 AND tenant_id = $2 AND loan_id = $3`,
        [alertId, tenantId, loanId],
      );
      if (probe.rows.length === 0) throw new AlertNotFoundError(alertId, tenantId);
      // Already cleared — return idempotently.
      return { alertId };
    }
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
        actorId,
        `cleared alert ${alertId}`,
        JSON.stringify({ alert_id: alertId }),
        alertId,
      ],
    );
    return { alertId };
  });
}
