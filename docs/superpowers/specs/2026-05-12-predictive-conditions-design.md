# NPNQM Predictive Conditions — Design Spec

> **Goal:** When a loan is ingested, automatically derive a list of "predicted conditions" from the tenant's active doc-checklist KB version and surface them to operators and VAs for accept/dismiss action. Each accepted prediction becomes a real `Condition` row on the loan with full provenance back to the prediction. The customer-facing value: originators learn what documents they need to provide upfront, reducing VA review surprises and the doc-request round-trip count.

> **Architecture:** Two new tenant-scoped Postgres tables (`predicted_conditions`, `prediction_alerts`), a new service module (`predict-conditions-service.ts`) that calls the doc-checklist resolver from spec 2026-05-12, three new HTTP endpoint families, a new `ConditionSource` enum value (`'Predicted'`), two new web UI panels (transmittal page + VA review workspace), and one new E2E harness workflow. The auto-fire hook lands in the existing `/api/ingest/:tenantSlug/loans` endpoint; manual re-prediction is available via `POST /loans/:id/predictions/run`. Deterministic — no LLM calls in v1.

> **Tech Stack:** TypeScript (`tsx` for scripts; pino-instrumented Fastify routes), Postgres with RLS, existing `@twin/api` `withTenantTx` / `withDb` helpers, Vitest for tests, React Testing Library for component tests, the existing `superpowers:subagent-driven-development` cycle for implementation.

> **Builds on:** [`2026-05-12-doc-checklist-ingest-design.md`](2026-05-12-doc-checklist-ingest-design.md) (shipped 2026-05-12 at commit `03a1e74`). This spec is its first downstream consumer.

---

## 0. Cross-Spec Dependencies

| Spec | How this design integrates |
|---|---|
| `2026-05-12-doc-checklist-ingest-design` (just shipped) | Consumes `resolveRequiredDocs(tenantId, kbVersionId, loanContext)` and handles its three error classes (`NoActiveKbVersionError`, `KbVersionNotFoundError`, `IncomeTypeUnresolvedError`) via the new `prediction_alerts` table. **Closes reviewer note 2** from that spec — provides the formal `IncomeTypeUnresolvedError` handler story future downstream specs were owed. |
| `2026-04-29-intelligent-guideline-processing` (F2) | Inherits `kb_versions` + the two-key approval workflow shipped in commit `2371b3b`. Uses `kb_versions.status='active'` as the canonical KB pointer; `resolveRequiredDocs(null)` selects it. |
| `2026-04-25-true-tenant-isolation` | Both new tables: `tenant_id UUID` + RLS policy on `current_setting('app.current_tenant', true)::uuid` + (per the Task 2 / Task 16 code-review notes from doc-checklist) `FORCE ROW LEVEL SECURITY` on these new tables for consistency with migration 012's baseline. |
| `2026-05-10-va-review-layer` | The VA review workspace UI grows a new collapsible panel (`VAPredictedConditionsPanel`); the existing claim flow is unchanged. Spec mentioned doc-request validation against the tenant's Doc Checklist — predictions provide that surface, but the formal validation against doc-checklist is still owed to a future doc-request-automation spec. |
| `2026-05-08-e2e-validation-harness-design` | One new workflow file `scripts/e2e-harness/workflows/W10-predicted-conditions.ts` registered in `ALL_WORKFLOWS`. Deterministic — zero LLM cost — usable as a cheap regression gate across all 23 fixtures. |
| Project memory `feedback_supabase_pooler_bypassrls` | Every tenant-scoped query MUST include explicit `WHERE tenant_id = ...` in addition to RLS. RLS tests use the policy-metadata pattern; runtime-enforcement tests don't pass under the pooler. |
| Project memory `project_kb_approval_workflow_operational` | `kb_versions.status='active'` is real and at-most-one-per-tenant; this spec depends on that invariant via `resolveRequiredDocs(null)`. |

---

## 1. Source of Predictions

Predictions are derived entirely from the doc-checklist KB version active for the tenant. The flow:

```
LoanContext {
  incomeDocType, borrowerType, citizenship, isItin,
  llcOrLegalEntity, occupancy, state, county, usCredit, program
}
        │
        ▼
resolveRequiredDocs(tenantId, null, loanContext)
        │
        ▼
ResolveResult {
  resolvedIncomeType, minimum: DocItem[], income: DocItem[],
  appliedRules: string[], kbVersionId
}
        │
        ▼
For each DocItem in minimum ∪ income:
   predicted_conditions row {
     category   = categoryInference(docItem),  // PTD by default, PTF for HOI/insurance/Final-prefixed
     description = docItem.name,
     note        = docItem.note,
     source_list = 'minimum' | 'income',
     source_order = docItem.order,
     status      = 'pending',
     ...
   }
```

The order of doc-items emitted by `resolveRequiredDocs` is the **engine order** — the order NPNQM's `sync_doc_requirements_from_engine.py` produced them. We preserve it in `source_order` so operators can sort predictions in the order the engine would surface them.

---

## 2. Data Model

> **⚠️ RLS-alone is not sufficient under the Supabase session pooler.** Every SELECT / UPDATE / DELETE against `predicted_conditions` and `prediction_alerts` MUST include an explicit `WHERE tenant_id = ...` clause in addition to RLS. The `withTenantTx` wrapper sets `SET LOCAL app.current_tenant`, but the connecting pooler role has BYPASSRLS — the policy is unenforced from the API path. See `feedback_supabase_pooler_bypassrls` in project memory.

### 2.1 New Tables (Migration 018)

```sql
-- 018-predictive-conditions.sql
--
-- NPNQM Predictive Conditions (spec 2026-05-12).
--
-- Adds two new tenant-scoped tables and an audit-log dedup constraint for the
-- new predict_conditions.* actions. The 'Predicted' ConditionSource enum
-- extension is a TypeScript change only — Loan.conditions[].source is stored
-- as text in JSONB and accepts the new value at insert time without a schema
-- change.
--
-- CROSS-MIGRATION DEPENDENCY: predicted_conditions.kb_version_id references
-- kb_versions (owned by migration 012). See migration 016 for the partial
-- unique index on kb_versions; migration 017 for superseded_at.

CREATE TABLE IF NOT EXISTS predicted_conditions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id                TEXT NOT NULL,
  prediction_run_id      UUID NOT NULL,
  source_input_hash      TEXT NOT NULL,
  predicted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  predicted_by           TEXT NOT NULL,
  kb_version_id          INT  NOT NULL REFERENCES kb_versions(id) ON DELETE CASCADE,
  resolved_income_type   TEXT NOT NULL,
  category               TEXT NOT NULL,
  description            TEXT NOT NULL,
  note                   TEXT NULL,
  source_list            TEXT NOT NULL,
  source_order           INT  NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending',
  acted_by               TEXT NULL,
  acted_at               TIMESTAMPTZ NULL,
  acted_role             TEXT NULL,
  dismissal_reason       TEXT NULL,
  accepted_condition_id  TEXT NULL,
  CHECK (category IN ('PTA','PTD','PTF','PTP')),
  CHECK (source_list IN ('minimum','income')),
  CHECK (status IN ('pending','accepted','dismissed')),
  CHECK (acted_role IS NULL OR acted_role IN ('operator','va')),
  -- Biconditional: status='accepted' iff accepted_condition_id is set.
  CHECK ((status = 'accepted') = (accepted_condition_id IS NOT NULL)),
  -- One-way: status='dismissed' implies a non-empty reason (≥10 chars).
  -- Doesn't constrain reason when status != 'dismissed'.
  CHECK (status != 'dismissed' OR (dismissal_reason IS NOT NULL AND char_length(dismissal_reason) >= 10))
);
CREATE INDEX IF NOT EXISTS idx_pc_tenant_loan       ON predicted_conditions(tenant_id, loan_id);
CREATE INDEX IF NOT EXISTS idx_pc_tenant_loan_status ON predicted_conditions(tenant_id, loan_id, status);
CREATE INDEX IF NOT EXISTS idx_pc_run_id            ON predicted_conditions(tenant_id, prediction_run_id);

ALTER TABLE predicted_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE predicted_conditions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pc ON predicted_conditions;
CREATE POLICY tenant_isolation_pc ON predicted_conditions
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);


CREATE TABLE IF NOT EXISTS prediction_alerts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id              TEXT NOT NULL,
  alerted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_class          TEXT NOT NULL,
  error_payload        JSONB NOT NULL,
  remediation_hint     TEXT NOT NULL,
  cleared_by           TEXT NULL,
  cleared_at           TIMESTAMPTZ NULL,
  CHECK (error_class IN ('NoActiveKbVersionError','KbVersionNotFoundError','IncomeTypeUnresolvedError')),
  CHECK ((cleared_at IS NULL) = (cleared_by IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_pa_tenant_loan      ON prediction_alerts(tenant_id, loan_id);
CREATE INDEX IF NOT EXISTS idx_pa_tenant_active    ON prediction_alerts(tenant_id, cleared_at)
  WHERE cleared_at IS NULL;

ALTER TABLE prediction_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pa ON prediction_alerts;
CREATE POLICY tenant_isolation_pa ON prediction_alerts
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);


-- Extend the audit-log dedup unique index (added in migration 016) to cover
-- the new predict_conditions.* actions. Migration 008's no_update_audit
-- rewrite rule still blocks ON CONFLICT DO UPDATE; the application uses
-- INSERT ... SELECT WHERE NOT EXISTS for dedup-on-replay.

CREATE UNIQUE INDEX IF NOT EXISTS tenant_audit_log_predict_dedup
  ON tenant_audit_log (
    target_tenant_id,
    action,
    (metadata->>'prediction_id'),
    actor_id
  )
  WHERE action IN ('predict_conditions.accept',
                   'predict_conditions.dismiss',
                   'predict_conditions.reopen_and_accept');
```

### 2.2 Column semantics

| Column | Type | Notes |
|---|---|---|
| `prediction_run_id` | UUID | Groups all predictions from one `run()` call; survives accept/dismiss; used for re-run idempotency. |
| `source_input_hash` | TEXT | sha256 of canonicalized LoanContext (all 10 fields, sorted keys). If a re-run produces the same hash as the existing pending batch's hash AND the existing pending batch is non-empty, no new INSERT. |
| `predicted_by` | TEXT | `'system:loan-ingest'` for auto-fire; `'system:manual-rerun:<userId>'` for manual re-runs. |
| `category` | enum-text | Inferred deterministically by `categoryInference(docItem)`. See §3.4. |
| `source_list` | enum-text | `'minimum'` for items from `resolveRequiredDocs.minimum[]`; `'income'` for items from `.income[]`. |
| `source_order` | INT | Position within the engine-emitted list (1-indexed). |
| `acted_role` | enum-text | `'operator'` when the actor was the operator at intake; `'va'` when the actor was the claiming VA. Inferred from `x-user-role` request header set by the existing middleware. |
| `dismissal_reason` | TEXT, ≥10 chars when set | CHECK constraint enforces; operator/VA must provide a real reason, not blank. |
| `accepted_condition_id` | TEXT | The `Condition.id` produced by the AddCondition reducer dispatch. Not an FK (Loan.conditions live in JSONB), but the value is verifiable by reading the loan. |

### 2.3 `ConditionSource` enum extension

In `packages/core/src/types.ts`:

```typescript
// Before:
export type ConditionSource = "UW" | "AUS" | "Compliance" | "Investor";

// After:
export type ConditionSource = "UW" | "AUS" | "Compliance" | "Investor" | "Predicted";
```

No DB migration. `Loan.conditions[].source` is stored as text inside the `world_state.loans` JSONB column; the new enum value is accepted at insert time.

The web UI's existing rendering of `source` (color-chip in the conditions table) needs a new chip variant for `'Predicted'` — yellow/amber to distinguish from `UW` (blue) and `Compliance` (red). See §6.1.

---

## 3. Service Layer

A new module: `packages/api/src/services/predict-conditions/`.

```
predict-conditions/
├── index.ts                  — public exports
├── service.ts                — run(), accept(), dismiss(), reopenAndAccept(), clearAlert()
├── category-inference.ts     — categoryInference(docItem): 'PTD' | 'PTF' | 'PTA' | 'PTP'
├── errors.ts                 — PredictionNotPendingError, PredictionAlreadyAccepted, etc.
└── types.ts                  — PredictedCondition, PredictionAlert, ServiceResult shapes
```

### 3.1 Public service API

```typescript
export interface PredictedCondition {
  id: string;
  tenantId: string;
  loanId: string;
  predictionRunId: string;
  predictedAt: string;
  predictedBy: string;
  kbVersionId: number;
  resolvedIncomeType: string;
  category: 'PTA' | 'PTD' | 'PTF' | 'PTP';
  description: string;
  note: string | null;
  sourceList: 'minimum' | 'income';
  sourceOrder: number;
  status: 'pending' | 'accepted' | 'dismissed';
  actedBy: string | null;
  actedAt: string | null;
  actedRole: 'operator' | 'va' | null;
  dismissalReason: string | null;
  acceptedConditionId: string | null;
}

export interface PredictionAlert {
  id: string;
  tenantId: string;
  loanId: string;
  alertedAt: string;
  errorClass: 'NoActiveKbVersionError' | 'KbVersionNotFoundError' | 'IncomeTypeUnresolvedError';
  errorPayload: Record<string, unknown>;
  remediationHint: string;
  clearedBy: string | null;
  clearedAt: string | null;
}

export interface RunResult {
  runId: string;                  // UUID; matches every prediction's predicted_run_id
  predictionCount: number;
  alertCount: 0 | 1;              // an alert is mutually exclusive with predictions
  reused: boolean;                // true when idempotent re-run found matching hash + non-empty batch
}

export async function run(
  tenantId: string,
  loanId: string,
  source: 'system:loan-ingest' | `system:manual-rerun:${string}`,
): Promise<RunResult>;

export interface AcceptResult { conditionId: string; predictionId: string; }
export async function accept(
  tenantId: string,
  predictionId: string,
  actorId: string,
  role: 'operator' | 'va',
): Promise<AcceptResult>;

export interface DismissResult { predictionId: string; }
export async function dismiss(
  tenantId: string,
  predictionId: string,
  actorId: string,
  role: 'operator' | 'va',
  reason: string,
): Promise<DismissResult>;

export async function reopenAndAccept(
  tenantId: string,
  predictionId: string,
  actorId: string,
  role: 'operator' | 'va',
): Promise<AcceptResult>;

export async function clearAlert(
  tenantId: string,
  alertId: string,
  actorId: string,
): Promise<{ alertId: string }>;
```

### 3.2 Error contract (binding for downstream callers)

```typescript
export class PredictionNotPendingError extends Error {}
export class PredictionNotFoundError extends Error {}
export class PredictionNotDismissedError extends Error {}      // raised by reopenAndAccept on non-dismissed predictions
export class DismissalReasonTooShortError extends Error {}     // <10 chars
export class AlertNotFoundError extends Error {}
```

The three doc-checklist resolver errors (`NoActiveKbVersionError`, `KbVersionNotFoundError`, `IncomeTypeUnresolvedError`) are caught **inside** `run()` and translated into `prediction_alerts` rows. They never propagate to callers of `run()`. The other prediction-service errors above propagate.

---

## 4. HTTP Endpoints

All endpoints under `/loans/:loanId/predictions/*`. Auth via the existing tenant-context middleware (`x-user-id` + `x-tenant-id` + `x-user-role`). All writes go through `withTenantTx`.

| Method | Path | Body | Returns | Notes |
|---|---|---|---|---|
| GET | `/loans/:loanId/predictions` | — | `{ predictions: PredictedCondition[]; alerts: PredictionAlert[] }` | All predictions for the loan (pending + accepted + dismissed); all alerts (active + cleared). Caller filters. |
| POST | `/loans/:loanId/predictions/run` | — | `RunResult` | Manual re-run. Body is empty. `source` is constructed server-side as `system:manual-rerun:<userId>`. |
| POST | `/loans/:loanId/predictions/:predictionId/accept` | — | `{ conditionId, predictionId }` | Promote to Condition. 409 if not pending. 404 if not found / wrong tenant. |
| POST | `/loans/:loanId/predictions/:predictionId/dismiss` | `{ reason: string }` | `{ predictionId }` | Dismiss with reason. 422 if reason <10 chars. 409 if not pending. |
| POST | `/loans/:loanId/predictions/:predictionId/reopen-and-accept` | — | `{ conditionId, predictionId }` | VA-only flow on operator-dismissed predictions. 409 if not dismissed. |
| POST | `/loans/:loanId/predictions/alerts/:alertId/clear` | — | `{ alertId }` | Mark alert cleared. 404 if missing. Re-clearing a cleared alert is a no-op (200). |

### 4.1 Auto-fire integration

The hook lands in `packages/api/src/routes/ingestion.ts`, immediately after the successful `runInTenantContext` block that writes `ingested_loans`. New code:

```typescript
// AFTER existing flow:
//   store.dispatch({ type: "InjectLoan", loan });
//   await client.query("INSERT INTO ingested_loans ...");
//   return reply.code(201).send({ loanId, tenantId, status: "queued", ... });

// NEW: best-effort predict-conditions auto-fire.
try {
  await predictConditionsService.run(tenantId, loanId, 'system:loan-ingest');
} catch (e) {
  // The three resolver errors are caught inside .run() and produce alerts.
  // Anything else here is truly unexpected (DB outage, etc.) and is swallowed.
  console.error('[predict-conditions] unexpected auto-fire error', { tenantId, loanId, error: e });
}
```

**Ingest never blocks on prediction failure.** The HTTP response shape is unchanged. Predictions are side-effect enrichment.

---

## 5. Data Flow

### 5.1 Auto-fire at loan-ingest

```
POST /api/ingest/demo/loans
  └─ existing: transformer → buildLoanFromPartial → InjectLoan dispatch → INSERT ingested_loans
  └─ NEW: predictConditionsService.run(tenantId, loanId, 'system:loan-ingest')
        ├─ acquire pg_advisory_xact_lock(hashtext('predict:' || loanId))  -- per-loan serialization
        ├─ build LoanContext from the just-injected Loan
        ├─ compute source_input_hash = sha256(canonical LoanContext)
        ├─ check for existing pending batch with matching hash:
        │     SELECT prediction_run_id FROM predicted_conditions
        │       WHERE tenant_id=$1 AND loan_id=$2 AND status='pending'
        │             AND source_input_hash=$3
        │     LIMIT 1
        │   If found: return { runId: <existing>, reused: true, predictionCount: <existing count>, alertCount: 0 }
        ├─ DELETE existing pending rows with non-matching hash (re-prediction with new facts)
        ├─ try: resolveRequiredDocs(tenantId, null, ctx)
        │    └─ on success: INSERT N rows, write audit row, return { reused: false, ... }
        │    └─ on resolver error: catch + INSERT 1 alert row + write audit row, return { predictionCount: 0, alertCount: 1, ... }
        └─ release advisory lock at commit
```

### 5.2 Manual re-run

```
POST /loans/:loanId/predictions/run
  ├─ require x-user-id (any authenticated role: operator | va | admin)
  ├─ source = `system:manual-rerun:${actorId}`
  └─ predictConditionsService.run(tenantId, loanId, source)
        Same flow as 5.1, plus:
        On successful prediction (alertCount === 0), auto-clear active alerts:
          UPDATE prediction_alerts
             SET cleared_by = 'system:successful-rerun', cleared_at = now()
           WHERE tenant_id = $1 AND loan_id = $2 AND cleared_at IS NULL
```

### 5.3 Accept

```
POST /loans/:loanId/predictions/:predictionId/accept
  ├─ getTenantContext: { tenantId, userId, role }
  └─ withTenantTx:
       ├─ SELECT * FROM predicted_conditions
            WHERE id=$1 AND tenant_id=$2 FOR UPDATE
          (404 if missing; 409 if status != 'pending')
       ├─ dispatch AddCondition action via store with:
            condition = {
              category: prediction.category,
              source: 'Predicted',
              description: prediction.description + (note ? ` (${note})` : ''),
            }
          The reducer assigns conditionId, returns it.
       ├─ UPDATE predicted_conditions
            SET status='accepted', acted_by=$userId, acted_at=now(),
                acted_role=$role, accepted_condition_id=$conditionId
          WHERE id=$1
       ├─ INSERT audit row (predict_conditions.accept)
       └─ return { conditionId, predictionId }
```

### 5.4 Dismiss

```
POST /loans/:loanId/predictions/:predictionId/dismiss
  body: { reason: string }
  ├─ getTenantContext: { tenantId, userId, role }
  ├─ if reason.length < 10: 422 DismissalReasonTooShortError
  └─ withTenantTx:
       ├─ UPDATE predicted_conditions
            SET status='dismissed', acted_by=$userId, acted_at=now(),
                acted_role=$role, dismissal_reason=$reason
          WHERE id=$1 AND tenant_id=$2 AND status='pending'
          RETURNING id
          (rowCount === 0 → 404 or 409 depending on whether the row exists)
       ├─ INSERT audit row (predict_conditions.dismiss)
       └─ return { predictionId }
```

### 5.5 Reopen-and-accept (VA-only flow)

```
POST /loans/:loanId/predictions/:predictionId/reopen-and-accept
  ├─ require role='va' (operators cannot reopen — once they dismiss, only VA can re-promote)
  └─ withTenantTx:
       ├─ SELECT * FROM predicted_conditions
            WHERE id=$1 AND tenant_id=$2 AND status='dismissed' FOR UPDATE
       ├─ dispatch AddCondition (same as 5.3)
       ├─ UPDATE predicted_conditions
            SET status='accepted', acted_by=$userId, acted_at=now(),
                acted_role='va', accepted_condition_id=$conditionId,
                dismissal_reason=NULL  -- clear the prior reason since we're reversing
          WHERE id=$1
       ├─ INSERT audit row (predict_conditions.reopen_and_accept)
       └─ return { conditionId, predictionId }
```

### 5.6 VA-claim handoff

The VA review page (`/loan/[loanId]/va/review`) loads predictions server-side alongside the existing loan + history fetch:

```typescript
const [loan, history, predictionsResp] = await Promise.all([
  api.getLoan(loanId),
  api.vaReviewHistory(loanId),
  api.getPredictions(loanId).catch(() => ({ predictions: [], alerts: [] })),
]);

<VAReviewWorkspace
  loan={loan}
  predictions={predictionsResp.predictions}
  alerts={predictionsResp.alerts}
  // existing props ...
/>
```

The workspace passes predictions to the new `VAPredictedConditionsPanel` component which renders pending + dismissed sections.

---

## 6. Web UI

Two new React components + one extension to the existing VA workspace.

### 6.1 `PredictedConditionsPanel` (transmittal page)

**Location:** `packages/web/components/encompass/PredictedConditionsPanel.tsx`
**Mounted on:** `/loan/[loanId]/transmittal` — new section between the existing `UWReviewPanel` (or RecommendationPanel) and the existing Conditions table.

```
┌─ Predicted Conditions ─────────────────────────────────────────┐
│ ⚠ Alert: Tenant has no active KB version. [Clear alert]        │
│                                                                │
│ Pending (11)                                                   │
│ ─────────                                                      │
│ [PTD] Initial Loan Application (1003)               [✓ Accept] │
│                                                     [✗ Dismiss]│
│ [PTD] Credit Report dated within 90 days            [✓ Accept] │
│                                                     [✗ Dismiss]│
│ [PTD] Most recent paystub(s) reflecting 30 days     [✓ Accept] │
│       of pay                                        [✗ Dismiss]│
│ ... (8 more)                                                   │
│                                                                │
│ Accepted (0) | Dismissed (0)        [↻ Re-run predictions]     │
└────────────────────────────────────────────────────────────────┘
```

Dismiss opens a modal requiring a reason (≥10 chars). Accept fires the server action and updates the panel in place.

When predictions exist on a loan, the existing conditions table renders the new `[Predicted]` source chip alongside `[UW]`, `[Compliance]`, etc. — yellow/amber to distinguish.

### 6.2 `VAPredictedConditionsPanel` (VA review workspace)

**Location:** `packages/web/components/encompass/VAPredictedConditionsPanel.tsx`
**Mounted on:** Inside the existing `VAReviewWorkspace` component, as a collapsible section above the six specialist signoff rows.

```
┌─ Predicted Conditions ─────────────────────────────────────────┐
│ Pending — operator didn't act (2)                              │
│ [PTD] 2 months most recent business bank statements [Accept]   │
│                                                     [Dismiss]  │
│ [PTD] Proof of 2 years' self-employment             [Accept]   │
│                                                     [Dismiss]  │
│                                                                │
│ Operator dismissed (1) — shown for transparency               │
│ [PTD] Anti Steering Disclosure  (grayed)         [Reopen+Accept]│
│       Reason: "LO already has signed copy in system"           │
│                                                                │
│ Operator accepted (8) — now real conditions; see conditions    │
│ table for status                                               │
└────────────────────────────────────────────────────────────────┘
```

Reopen-and-accept opens a confirmation dialog ("You are overriding the operator's dismissal. Continue?"). Auditable via the audit log.

### 6.3 Server actions

`packages/web/app/loan/[loanId]/predictions/actions.ts`:

```typescript
export async function actionListPredictions(loanId: string): Promise<...>;
export async function actionRunPredictions(loanId: string): Promise<...>;
export async function actionAcceptPrediction(loanId: string, predictionId: string): Promise<...>;
export async function actionDismissPrediction(loanId: string, predictionId: string, reason: string): Promise<...>;
export async function actionReopenAndAccept(loanId: string, predictionId: string): Promise<...>;
export async function actionClearAlert(loanId: string, alertId: string): Promise<...>;
```

Each calls the corresponding `api.*` method, revalidates `/loan/[loanId]`, and returns `{ ok, error? }`.

---

## 7. Error Handling

### 7.1 Resolver-error mapping

| Resolver error class | `error_payload` JSONB | `remediation_hint` text |
|---|---|---|
| `NoActiveKbVersionError` | `{ tenantId }` | `"Tenant has no active KB version. Run pnpm tsx scripts/approve-kb.ts --tenant <slug> --version-id <int> --as compliance_officer --user-id <uuid> --activate to activate a version. Until then, predictions are unavailable for this loan."` |
| `KbVersionNotFoundError` | `{ kbVersionId, tenantId }` | `"KB version <id> not found or belongs to a different tenant. Verify the version id; if it was archived, re-run via /predictions/run to pick up the current active version."` |
| `IncomeTypeUnresolvedError` | `{ inputs: { incomeDocType, borrowerType, citizenship, isItin }, kbVersionId }` | `"No income_type_resolver row for this combination. Either the loan's income_doc_type/borrower_type/citizenship/isItin fields are malformed, or NPNQM's engine doesn't yet cover this combination. Fix the loan fields or contact NPNQM to add an engine row, then re-run /predictions/run."` |

### 7.2 Alert lifecycle

Active → Cleared. Re-clearing a cleared alert is a no-op. Operators clear via the dedicated endpoint after addressing the root cause. Successful re-runs auto-clear all active alerts for the loan.

### 7.3 Auto-fire swallow-all posture

The ingest-side try/catch swallows **any** exception from `predictConditionsService.run` — resolver-error or otherwise. Ingest never returns non-2xx because of a prediction failure. Manual re-run is the opposite — unexpected throws propagate as HTTP 500 so operators triggering a refresh can see what broke.

### 7.4 Idempotency

| Scenario | Behavior |
|---|---|
| Auto-fire → re-run with identical LoanContext | `source_input_hash` matches → `reused: true` returned, no new INSERT |
| Operator edits loan fields → re-run | `source_input_hash` differs → DELETE existing pending rows → new batch with new `prediction_run_id` |
| Accept 3, dismiss 1, edit loan, re-run | The 3 accepted Conditions stay in `loan.conditions`. The 1 dismissed prediction stays as a tombstone (won't reappear). The 7 remaining pending rows get DELETEd → 11 fresh pending predictions emerge. |

### 7.5 Concurrency

Per-loan advisory lock via `pg_advisory_xact_lock(hashtext('predict:' || loanId))`. Concurrent `run()` calls on the same loan serialize at the DB. Accept/dismiss use `SELECT ... FOR UPDATE` on the prediction row.

### 7.6 Audit log

New action enum values written into `tenant_audit_log` (immutable per migration 008):

- `predict_conditions.run` — metadata: `{ run_id, count, source, kb_version_id }`
- `predict_conditions.accept` — metadata: `{ prediction_id, condition_id, role }`
- `predict_conditions.dismiss` — metadata: `{ prediction_id, role, dismissal_reason }`
- `predict_conditions.reopen_and_accept` — metadata: `{ prediction_id, condition_id, role: 'va' }`
- `predict_conditions.alert` — metadata: `{ alert_id, error_class }`
- `predict_conditions.alert_clear` — metadata: `{ alert_id, cleared_by }`

Pattern matches the kb_versions audit-log discipline shipped in commit `2371b3b`: writes use `INSERT ... SELECT WHERE NOT EXISTS` for dedup-on-replay (migration 008's `no_update_audit` rule blocks `ON CONFLICT DO UPDATE`). The dedup index from §2.1 covers it.

### 7.7 Category inference

`packages/api/src/services/predict-conditions/category-inference.ts`:

```typescript
export function categoryInference(docItem: { name: string }): 'PTD' | 'PTF' | 'PTA' | 'PTP' {
  const n = docItem.name.toLowerCase();
  // PTF (priors-to-fund) — items finalized before disbursement
  if (/insurance|hoi|recording|final|wire instructions/.test(n)) return 'PTF';
  // PTA / PTP not used by the current doc-checklist; reserved for future engine rules
  return 'PTD'; // priors-to-docs — default for intake docs
}
```

Six table-driven test cases live in `packages/api/test/category-inference.test.ts`.

---

## 8. Testing

### 8.1 Unit tests — `packages/api/test/predict-conditions-service.test.ts`

15 tests against a dedicated test tenant. Covered scenarios:

1. `run()` happy path — N predictions emitted with correct categories
2. `run()` infers PTF for insurance/HOI docs
3. `run()` writes alert on NoActiveKbVersionError
4. `run()` writes alert on IncomeTypeUnresolvedError
5. `run()` is idempotent when source_input_hash matches
6. `run()` replaces pending when source_input_hash differs
7. `run()` preserves accepted/dismissed history across re-runs
8. `accept()` creates Condition with source='Predicted', updates prediction row
9. `accept()` rejects non-pending predictions (PredictionNotPendingError)
10. `dismiss()` writes reason + acted_by/at/role
11. `dismiss()` rejects reason <10 chars
12. `reopenAndAccept()` flips dismissed → accepted with new Condition
13. Concurrent `run()` calls serialize via advisory lock
14. `clearAlert()` flips cleared_at/by
15. Successful re-run auto-clears active alerts

### 8.2 Category inference unit tests — `packages/api/test/category-inference.test.ts`

6 table-driven cases: insurance → PTF, HOI → PTF, Final HOI → PTF, "wire instructions" → PTF, "Initial Loan Application" → PTD (default), arbitrary doc name → PTD.

### 8.3 HTTP integration tests — `packages/api/test/predict-conditions.integration.test.ts`

5 integration tests using `execSync` on the live API (same pattern as `doc-checklist-ingest.integration.test.ts`):

1. Full ingest → auto-predict → accept → dismiss → re-run → reopen-and-accept
2. Ingest a loan when tenant has no active KB version → alert lands
3. Manual re-run after activating a KB version → alert auto-clears, predictions land
4. Concurrent `/predictions/run` calls serialize correctly
5. Accept response → `GET /loans/:id` reflects new Open Condition with source='Predicted'

### 8.4 RLS isolation tests

Extend `packages/api/test/tenant-isolation.test.ts` with two new `it` blocks asserting the policy-metadata for `predicted_conditions` and `prediction_alerts` matches the canonical GUC pattern. Uses the same approach Task 16 of doc-checklist established (BYPASSRLS-aware).

### 8.5 Web component tests — `packages/web/test/predicted-conditions-panel.test.tsx`

4 component tests using React Testing Library:

1. `PredictedConditionsPanel` renders pending list + alert banner
2. Accept button calls server action; row moves to Accepted section
3. Dismiss button opens reason modal; submits with valid reason; row moves to Dismissed
4. `VAPredictedConditionsPanel` renders pending + dismissed (grayed) sections

### 8.6 E2E harness — `scripts/e2e-harness/workflows/W10-predicted-conditions.ts`

One new workflow registered in `ALL_WORKFLOWS`. Steps:

1. Ingest a representative fixture loan via `/api/ingest/demo/loans`
2. Assert `GET /loans/:id/predictions` returns 11 pending predictions within 2s (auto-fire happened)
3. Accept 8, dismiss 1 (with reason ≥10 chars), leave 2 pending
4. Assert `loan.conditions.filter(c => c.status === 'Open' && c.source === 'Predicted').length === 8`
5. Manually re-run after editing one loan field; assert old pending rows replaced; accepted/dismissed history preserved

W10 is deterministic — zero LLM cost — usable as a regression gate across all 23 fixtures.

---

## 9. Non-Goals (Explicit)

| Out of scope | Why |
|---|---|
| Matrix-driven predictions (`program_matrix_tiers` FICO/LTV/DTI rules) | Future spec. Requires matrices to be populated per tenant. |
| KB-narrative LLM predictions (ChromaDB chunks + groundedness) | Future spec. Real LLM cost; needs F2 groundedness pipeline operational. |
| Originator-facing portal endpoint | Future spec. Current surface is internal-operator + VA only. |
| Auto-doc-request webhook on accept | Future "doc-request automation" spec. Accepted predictions create Open Conditions; the existing condition-driven doc-request flow handles delivery. |
| Bulk operations (accept-all, dismiss-by-pattern) | YAGNI v1. |
| Editing a prediction before accept | YAGNI v1. Dismiss + add manually. |
| Auto-rerun on loan edit | Manual re-run endpoint covers it. Auto-rerun requires a change-detection hook; out of scope. |
| Prediction history UI (viewing prior runs) | YAGNI v1. `prediction_run_id` is in the schema for future use. |
| New ConditionCategory values | The existing PTA/PTD/PTF/PTP enum is the contract. |
| Replacing agent-emitted "Suggested Conditions" | They coexist. Agent fires later; emits its own conditions via StageRecommendation. |

---

## 10. Open Items

| # | Item | Resolution path |
|---|---|---|
| O1 | **Store-and-DB two-write hazard** on `accept` — the AddCondition reducer dispatch mutates in-memory store; the prediction UPDATE is a separate SQL statement in the same transaction. If the UPDATE rolls back, the in-memory store has the new Condition but the DB rolls back; they desync until next hydration. | Documented as a known existing issue affecting StageRecommendation and VA submitReview as well. Out of scope for this spec; a future "store-DB consistency" pass should add compensating-action rollback. |
| O2 | **Auto-fire performance budget** — `run()` does 3 SELECTs (kb_versions, income_type_resolver, program_doc_checklist + engine rules) plus N INSERTs. Single-loan ingest is ~50ms today; if ingest throughput scales we may need async. | Synchronous in v1. Note in spec. |
| O3 | **Cleared alerts never deleted** | YAGNI v1; add a retention policy migration when table size justifies it. The `idx_pa_tenant_active` partial index keeps queries fast on the active set. |
| O4 | **Category inference is heuristic** — regex-based PTF detection for HOI/insurance | Operators dismiss + re-add with right category if wrong. Mapping table is plan-time mutable. Future: per-tenant override table. |
| O5 | **`predicted_by` field encoding** uses string conventions (`'system:loan-ingest'`, `'system:manual-rerun:<userId>'`) | Acceptable v1. Future: split into `predicted_by_kind` enum + `predicted_by_user_id` UUID if structured queries are needed. |

---

## 11. Implementation Order Hint (for writing-plans)

The plan should sequence ~15 tasks across 5 phases. Each task is a stand-alone commit.

**Phase 1 — Schema (1 task)**
1. Migration 018 — two tables + RLS + FORCE ROW LEVEL SECURITY + audit-log dedup unique index extension + `ConditionSource` TypeScript enum extension

**Phase 2 — Service layer (5 tasks)**
2. `category-inference.ts` — table-driven; 6 unit tests
3. `predict-conditions-service.ts` skeleton + types + error classes — stub bodies that throw
4. `service.run()` — happy path + 3 resolver-error catch paths writing to `prediction_alerts` + idempotency check + advisory lock
5. `service.accept()` — dispatch AddCondition, update prediction row, audit-log insert in one tx
6. `service.dismiss()` and `service.reopenAndAccept()` — both with audit-log writes

**Phase 3 — HTTP endpoints (3 tasks)**
7. `GET /loans/:id/predictions` — list endpoint
8. `POST /loans/:id/predictions/run` — manual re-run endpoint
9. Accept / Dismiss / Reopen-and-accept / Clear-alert endpoints (4 in one task — same shape)

**Phase 4 — Ingest hook + auto-fire (2 tasks)**
10. Wire `predictConditionsService.run()` into `/api/ingest/:tenantSlug/loans` post-injection step with the swallowing try/catch
11. Integration test: full HTTP flow (ingest → auto-fire → list → accept → dismiss → re-run → reopen-accept)

**Phase 5 — Web UI + harness (4 tasks)**
12. Server actions in `packages/web/app/loan/[loanId]/predictions/actions.ts` + extend `api-client.ts`
13. `PredictedConditionsPanel` (transmittal page) + component test
14. `VAPredictedConditionsPanel` + integration into `VAReviewWorkspace.tsx` + component test
15. RLS isolation tests + E2E harness W10 + final smoke walk against demo

That's 15 tasks. Roughly 6 hours of subagent-driven-development at the cadence established by the doc-checklist ingest implementation (~24 min per task). About 80% of that spec's scope.

---

## 12. Open Questions for the User

None at this stage — the data model, lifecycle, error handling, and implementation order are all locked. Implementation specifics (exact prompt copy, button styling) will be settled in the implementation plan and during the build, not here.
