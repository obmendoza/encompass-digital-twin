# Store–DB Consistency Pass (F1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the store-and-DB two-write hazard (`O1` / `F1`) by introducing a `withStoreSnapshot` helper that reverts the in-memory loan via `InjectLoan` when a post-dispatch DB write fails. Apply at two known call sites (PC `accept()` / `reopenAndAccept()`; `POST /loans/:loanId/recommendation`). Add a per-loan advisory lock at the PC sites so parallel handlers on the same loan serialize through the helper.

**Architecture:** One ~30-line utility module + a one-shot test hook in the PC service + two surgical call-site edits. Helper composes inside `withTenantTx` (no DB knowledge in the helper). Helper snapshots `state.loans[loanId]` before the closure and `store.dispatch({ type: "InjectLoan", loan: snapshot })` on error. Structured `console.warn` line preserves operational visibility without writing to `tenant_audit_log` (a failed-with-rollback is not an intentional state transition).

**Tech Stack:** TypeScript (Fastify routes + Vitest), Postgres via existing `withTenantTx` helper, the `@twin/core` store with its existing `InjectLoan` reducer action.

**Spec:** [`docs/superpowers/specs/2026-05-13-store-db-consistency-design.md`](../specs/2026-05-13-store-db-consistency-design.md) (signed off at commit `bafa162`).

---

## Conventions used in this plan

- **Quality gates.** Every commit must keep both `pnpm --filter @twin/api test` AND `pnpm --filter @twin/api build` clean. The strict-TS backlog stays at zero — don't regress it.
- **Tenant context.** All tenant-scoped DB access goes through `withTenantTx(tenantId, fn)`. The advisory locks added in this plan run inside the same transaction.
- **One commit per task.** Each task is reviewable in isolation.
- **No emojis.** No `npm` — use `pnpm`.

---

## File structure (locked at plan time)

| Status | Path | Responsibility |
|---|---|---|
| New | `packages/api/src/store-db-consistency.ts` | The `withStoreSnapshot` helper. Single function, ~30 LOC, no DB knowledge. |
| New | `packages/api/test/store-db-consistency.test.ts` | Helper unit tests (6 cases). Uses `createStore({ scenarios })` directly — no DB, no Fastify. |
| Modify | `packages/api/src/services/predict-conditions/service.ts` | Add `__testOnly_throwAfterDispatch` + setter. Wrap `accept()` and `reopenAndAccept()` closures with the advisory lock + helper. |
| Modify | `packages/api/test/predict-conditions-service.test.ts` | Append one rollback integration test under a new describe block. Add `afterEach` to reset the test hook. |
| Modify | `packages/api/src/routes/recommendation.ts` | Wrap the `POST /loans/:loanId/recommendation` handler body in `withStoreSnapshot`. |

Total new code: ~50 LOC helper + ~80 LOC tests + ~12 LOC of call-site edits.

---

## Task 1: `withStoreSnapshot` helper + 6 unit tests

**Files:**
- Create: `packages/api/src/store-db-consistency.ts`
- Create: `packages/api/test/store-db-consistency.test.ts`

**Rationale:** Smallest unit, fully isolated (no DB). TDD: write the 6 cases first, see them fail, implement the helper, see them pass.

- [ ] **Step 1: Write the failing tests**

Create `packages/api/test/store-db-consistency.test.ts` with EXACTLY:

```typescript
import { describe, it, expect } from "vitest";
import { createStore, type Store, type Loan } from "@twin/core";
import { scenarios } from "@twin/fixtures";
import { withStoreSnapshot } from "../src/store-db-consistency.js";

function stubLoan(loanId: string): Loan {
  return {
    id: loanId,
    tenantId: "00000000-0000-0000-0000-000000000000",
    nqmProgram: "Flex Select",
    qualifyingMethod: "TraditionalDocs",
    borrower: { fullName: "Test", ssnMasked: "xxx-xx-0000", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "1", city: "LA", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 100000, salesPrice: 100000, appraisedValue: 100000,
      ltv: 100, cltv: 100, hcltv: 100, noteRate: 7, term: 360, amortType: "Fixed",
      lienPosition: 1, occupancy: "Primary", isInvestmentProperty: false, piti: 600,
    },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 600, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "TraditionalDocs", derivedMonthlyIncome: 10000 },
    income: { totalMonthlyIncome: 10000 },
    assets: { totalLiquid: 0, totalRetirement: 0, reservesMonths: 0 },
    credit: { repScore: 720, tradelinesOpen: 1, tradelinesTotal: 1, tradelines: [], liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 } },
    appraisal: { appraisalDate: "2026-01-01", appraiserName: "T", appraisalType: "Full", appraisedValue: 100000, marketCondition: "Stable", neighborhoodRating: "Average", siteArea: "N/A", grossLivingArea: 1000, roomCount: 4, bedroomCount: 2, bathroomCount: 1, garageSpaces: 1, condition: "Average", comparables: [] },
    conditions: [], documents: [], decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "test", at: "2026-01-01T00:00:00.000Z" }],
    compliance: { qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false, higherPricedCoveredTransaction: false, stateLicenseRequired: false, stateHighCostTest: "Pass", tridToleranceCure: "None", totalPointsAndFees: 0, pointsAndFeesThreshold: 0, pointsAndFeesPass: true, flags: [] },
    overlay: { programName: "Flex Select", investorName: "T", maxLTV: 100, minFICO: 600, maxDTI: 50, minDSCR: null, minReserves: 0, checks: [] },
  };
}

function makeStore(): Store {
  return createStore({ scenarios });
}

describe("withStoreSnapshot", () => {
  it("returns the closure's result on success and does NOT dispatch InjectLoan", async () => {
    const store = makeStore();
    store.dispatch({ type: "InjectLoan", loan: stubLoan("L-1") });
    const logBefore = store.getState().actionLog.length;

    const result = await withStoreSnapshot(store, "L-1", async () => {
      store.dispatch({
        type: "AddCondition",
        loanId: "L-1",
        condition: { category: "PTD", source: "UW", description: "Marker test condition" },
        actor: { kind: "human", id: "tester" },
      });
      return 42;
    });

    expect(result).toBe(42);
    // One new entry (the AddCondition). No rollback InjectLoan.
    expect(store.getState().actionLog.length).toBe(logBefore + 1);
    expect(store.getState().loans["L-1"]!.conditions.length).toBe(1);
  });

  it("reverts the loan when the closure throws after a mutating dispatch", async () => {
    const store = makeStore();
    store.dispatch({ type: "InjectLoan", loan: stubLoan("L-2") });
    const before = store.getState().loans["L-2"]!;
    expect(before.conditions.length).toBe(0);

    await expect(
      withStoreSnapshot(store, "L-2", async () => {
        store.dispatch({
          type: "AddCondition",
          loanId: "L-2",
          condition: { category: "PTD", source: "UW", description: "Marker should be reverted" },
          actor: { kind: "human", id: "tester" },
        });
        throw new Error("sabotaged");
      }),
    ).rejects.toThrow("sabotaged");

    expect(store.getState().loans["L-2"]!.conditions.length).toBe(0);
  });

  it("re-throws the original error after reverting", async () => {
    const store = makeStore();
    store.dispatch({ type: "InjectLoan", loan: stubLoan("L-3") });
    const sentinel = new Error("specific message");

    await expect(
      withStoreSnapshot(store, "L-3", async () => {
        throw sentinel;
      }),
    ).rejects.toBe(sentinel);
  });

  it("skips rollback when the loan didn't exist in the store before the closure", async () => {
    const store = makeStore();
    const logBefore = store.getState().actionLog.length;

    await expect(
      withStoreSnapshot(store, "L-MISSING", async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");

    // No InjectLoan was dispatched.
    expect(store.getState().loans["L-MISSING"]).toBeUndefined();
    expect(store.getState().actionLog.length).toBe(logBefore);
  });

  it("retains both the failed dispatch and the rollback InjectLoan in actionLog (C2)", async () => {
    const store = makeStore();
    store.dispatch({ type: "InjectLoan", loan: stubLoan("L-5") });
    const logBefore = store.getState().actionLog.length;

    await expect(
      withStoreSnapshot(store, "L-5", async () => {
        store.dispatch({
          type: "AddCondition",
          loanId: "L-5",
          condition: { category: "PTD", source: "UW", description: "Logged dispatch under sabotage" },
          actor: { kind: "human", id: "tester" },
        });
        throw new Error("sabotaged");
      }),
    ).rejects.toThrow("sabotaged");

    const log = store.getState().actionLog;
    // Two new entries: the AddCondition, then the rollback InjectLoan.
    expect(log.length).toBe(logBefore + 2);
    expect(log[log.length - 2]!.action.type).toBe("AddCondition");
    expect(log[log.length - 1]!.action.type).toBe("InjectLoan");
  });

  it("appends exactly one rollback InjectLoan when the closure throws before any dispatch (C3)", async () => {
    const store = makeStore();
    store.dispatch({ type: "InjectLoan", loan: stubLoan("L-6") });
    const logBefore = store.getState().actionLog.length;
    const conditionsBefore = store.getState().loans["L-6"]!.conditions.length;

    await expect(
      withStoreSnapshot(store, "L-6", async () => {
        throw new Error("early");
      }),
    ).rejects.toThrow("early");

    // Loan state unchanged.
    expect(store.getState().loans["L-6"]!.conditions.length).toBe(conditionsBefore);
    // One spurious rollback InjectLoan was appended.
    expect(store.getState().actionLog.length).toBe(logBefore + 1);
    expect(store.getState().actionLog[store.getState().actionLog.length - 1]!.action.type).toBe("InjectLoan");
  });
});
```

- [ ] **Step 2: Run tests, see 6 failures (module not found)**

```bash
pnpm --filter @twin/api exec vitest run test/store-db-consistency.test.ts
```

Expected: 6 failures because `store-db-consistency.ts` doesn't exist yet.

- [ ] **Step 3: Implement `withStoreSnapshot`**

Create `packages/api/src/store-db-consistency.ts` with EXACTLY:

```typescript
import type { Store } from "@twin/core";

/**
 * Wrap a store-dispatch-then-DB-write closure so that, if the closure throws
 * after a store dispatch has already mutated the loan, the loan is restored
 * to its pre-closure snapshot via InjectLoan. Single source of truth for the
 * "store-and-DB two-write hazard" (F1, see spec
 * docs/superpowers/specs/2026-05-13-store-db-consistency-design.md).
 *
 * Scope: snapshots ONLY state.loans[loanId]. Dispatches inside the closure
 * that mutate other store state (action_log, agent state, pipeline cost,
 * other loans) are NOT reverted. Verify each new caller's dispatches stay
 * loan-scoped.
 *
 * Concurrency: the helper itself does no locking. Callers that race against
 * other handlers mutating the same loan must serialize externally (per-loan
 * advisory lock or equivalent). See §8 Risks in the spec.
 */
export async function withStoreSnapshot<T>(
  store: Store,
  loanId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const before = store.getState().loans[loanId];
  try {
    return await fn();
  } catch (e) {
    if (before !== undefined) {
      // Structured warn so SRE can correlate API errors with store rollbacks.
      // Not an audit-log row — audit log records intentional state transitions;
      // a failed-with-rollback is not one. Operational visibility, not compliance.
      console.warn("[store-db-consistency] rolling back store dispatch due to closure failure", {
        loanId,
        error: e instanceof Error ? { name: e.name, message: e.message } : String(e),
      });
      store.dispatch({ type: "InjectLoan", loan: before });
    }
    throw e;
  }
}
```

- [ ] **Step 4: Run tests, see 6 passes**

```bash
pnpm --filter @twin/api exec vitest run test/store-db-consistency.test.ts
pnpm --filter @twin/api build
```

Expected: 6 tests pass, build clean.

- [ ] **Step 5: Verify no regressions in other API tests**

```bash
pnpm --filter @twin/api exec vitest run test/predict-conditions-service.test.ts test/predict-conditions-types.test.ts test/category-inference.test.ts
```

Expected: all existing service/type tests still pass (20 + 3 + 6 = 29).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/store-db-consistency.ts packages/api/test/store-db-consistency.test.ts
git commit -m "feat(api): withStoreSnapshot helper for store-DB consistency

Snapshots state.loans[loanId] before a dispatch-then-DB-write closure runs
and dispatches InjectLoan with the snapshot if the closure throws. Resolves
the F1 / O1 follow-up tracked across three prior specs.

Scope restricted to state.loans[loanId] — dispatches mutating action_log,
agent state, or other parts of the store are NOT reverted. Future callers
must verify their dispatches stay loan-scoped (documented in JSDoc).

Concurrency: helper does no locking. Callers that race on the same loan
must serialize externally (advisory lock or equivalent) per spec §3.1 /
§8. Site A in Task 2 adds this; Site B in Task 3 documents the absence.

Rollback emits a structured console.warn so SREs can correlate API 5xx
with store rollbacks. Not an audit-log row — tenant_audit_log records
intentional state transitions, a failed-with-rollback is not one.

Six unit tests cover: success path, dispatch-then-throw revert, original
exception re-thrown, loan-absent no-op, action_log retains both entries
(C2), and spurious rollback on early-throw closure (C3)."
```

No Co-Authored-By trailers.

---

## Task 2: Wrap PC `accept()` and `reopenAndAccept()` + per-loan advisory lock + test hook

**Files:**
- Modify: `packages/api/src/services/predict-conditions/service.ts`
- Modify: `packages/api/test/predict-conditions-service.test.ts`

**Rationale:** Apply the helper to Site A (per spec §3.2). Add `pg_advisory_xact_lock` so parallel accept calls on the same loan serialize, preventing the rollback-clobbers-concurrent-work scenario (per spec R1). Add `__testOnly_throwAfterDispatch` hook + one rollback integration test.

- [ ] **Step 1: Add the test hook and helper import to service.ts**

In `packages/api/src/services/predict-conditions/service.ts`, find the existing imports block near the top. Add the helper import alongside the other `../../` imports:

```typescript
import { withStoreSnapshot } from "../../store-db-consistency.js";
```

Then, at the bottom of the existing imports block (but before any function declarations), add the test hook:

```typescript
// EXPORTED FOR TESTS ONLY. Do not call from production code paths. When set,
// the next accept() or reopenAndAccept() call throws this error exactly once
// immediately after dispatching AddCondition, exercising the rollback path
// without requiring DB-level sabotage. Consumed on read (one-shot reset).
let __testOnly_throwAfterDispatch: Error | null = null;

export function __testOnly_setThrowAfterDispatch(e: Error | null): void {
  __testOnly_throwAfterDispatch = e;
}
```

(Placement: just below the imports and the `REMEDIATION` constant declaration, before `canonicalizeContext`. The exact line varies; place it where module-scoped declarations live.)

- [ ] **Step 2: Wrap `accept()` with the advisory lock + helper**

In the same file, find the existing `accept()` function. The current shape is:

```typescript
export async function accept(
  tenantId: string,
  predictionId: string,
  actorId: string,
  role: PredictedConditionRole,
): Promise<AcceptResult> {
  return withTenantTx(tenantId, async (c) => {
    const { rows } = await c.query<{ ... }>(
      `SELECT id, loan_id, category, description, note, status
         FROM predicted_conditions
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE`,
      [predictionId, tenantId],
    );
    if (rows.length === 0) throw new PredictionNotFoundError(predictionId, tenantId);
    const p = rows[0]!;
    if (p.status !== "pending") throw new PredictionNotPendingError(predictionId, p.status);

    // ── existing body: dispatch AddCondition, collision check,
    //                   UPDATE predicted_conditions, INSERT audit ──
    ...
    return { conditionId, predictionId };
  });
}
```

Refactor so the post-SELECT body is wrapped:

```typescript
export async function accept(
  tenantId: string,
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
        WHERE id = $1 AND tenant_id = $2
        FOR UPDATE`,
      [predictionId, tenantId],
    );
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
      // Mint the Condition via the existing store reducer.
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
          WHERE id = $4 AND tenant_id = $5`,
        [actorId, role, conditionId, predictionId, tenantId],
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
```

Key changes vs the prior version:
1. **Added the advisory-lock query** right after the FOR-UPDATE SELECT validations succeed.
2. **Wrapped the body in `withStoreSnapshot`** keyed on `p.loan_id`.
3. **Added the test-hook throw** immediately after `store.dispatch` and before the collision check.
4. The collision detection logic (PredictionConditionCollisionError) is unchanged in semantics — it still fires when the reducer's fuzzy dedup silently dropped the append.

- [ ] **Step 3: Apply the same shape to `reopenAndAccept()`**

In the same file, find `reopenAndAccept()`. The current shape is structurally similar to `accept()`. Apply the parallel transformation:

```typescript
export async function reopenAndAccept(
  tenantId: string,
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
        WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
      [predictionId, tenantId],
    );
    if (rows.length === 0) throw new PredictionNotFoundError(predictionId, tenantId);
    const p = rows[0]!;
    if (p.status !== "dismissed") throw new PredictionNotDismissedError(predictionId, p.status);

    // Same per-loan lock as accept() — they share the namespace so concurrent
    // accept/reopen on the same loan serialize.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`predict-accept:${p.loan_id}`]);

    // Capture prior dismissal audit row id (forward link). This SELECT is
    // outside the helper-wrapped body because it touches only the audit log,
    // not the store.
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
          WHERE id = $4 AND tenant_id = $5`,
        [actorId, role, conditionId, predictionId, tenantId],
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
```

- [ ] **Step 4: Build + run existing service tests to confirm no regression**

```bash
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/predict-conditions-service.test.ts
```

Expected: build clean. Existing service tests still pass (20/20).

If a test fails, the most likely cause is a missing `getStore()` call inside the closure or a stale capture of `beforeLoan` outside the helper. Re-read the diff carefully against the spec §3.2 code block.

- [ ] **Step 5: Add the rollback integration test**

Open `packages/api/test/predict-conditions-service.test.ts`. Find the existing import block at the top that pulls error classes from the service module. Extend it to include the new test-hook setter:

```typescript
import {
  accept,
  dismiss,
  reopenAndAccept,
  clearAlert,
  PredictionNotFoundError,
  PredictionNotPendingError,
  PredictionNotDismissedError,
  DismissalReasonTooShortError,
  AlertNotFoundError,
  PredictionConditionCollisionError,
  __testOnly_setThrowAfterDispatch,
} from "../src/services/predict-conditions/index.js";
```

Wait — the test hook is exported from `service.ts`, not `index.ts`. Decide on one of:

**Option A (preferred):** Re-export the hook from `packages/api/src/services/predict-conditions/index.ts`. Add this line near the bottom of that file alongside the other service re-exports:

```typescript
export { __testOnly_setThrowAfterDispatch } from "./service.js";
```

Then the test imports from `index.js` as shown above.

**Option B:** Import the hook directly from `service.js` in the test, leaving the public index untouched.

Use **Option A** — the hook is part of the service's public surface for tests, and re-exporting keeps the test's import block in one place.

After Option A, add this to the existing `beforeEach` block (just after the `cleanupAll()` call and the loan-injection loop) to defensively reset the hook between tests:

```typescript
beforeEach(async () => {
  await cleanupAll();
  // Re-inject stub loans for every loan_id used by the upcoming tests.
  if (sharedStore) {
    for (const loanId of ["L-ACC-1","L-ACC-2","L-ACC-COLLIDE","L-ACC-ROLLBACK","L-DIS-1","L-DIS-2","L-REOPEN-1","L-REOPEN-2","L-CLR-2"]) {
      sharedStore.dispatch({ type: "InjectLoan", loan: stubLoanForStore(loanId) });
    }
  }
  // Defensive reset — the hook is one-shot but a forgotten setter from a
  // prior failing test would otherwise leak into the next test.
  __testOnly_setThrowAfterDispatch(null);
});
```

(The L-ACC-ROLLBACK loan_id is new — added so the rollback test has its own injected stub.)

Then append a new describe block at the end of the file (before any trailing closing braces if applicable):

```typescript
describe("predict-conditions service — accept() store-DB consistency", () => {
  it("reverts the AddCondition dispatch in the store when the post-dispatch step fails", async () => {
    const { predictionIds } = await seedAndRun("L-ACC-ROLLBACK");

    // Snapshot the loan's condition count before accept().
    const conditionsBefore = sharedStore!.getState().loans["L-ACC-ROLLBACK"]!.conditions.length;

    // Arm the hook so the next accept() throws right after dispatching AddCondition.
    __testOnly_setThrowAfterDispatch(new Error("sabotaged after dispatch"));
    await expect(
      accept(T, predictionIds[0]!, "op-rb", "operator"),
    ).rejects.toThrow("sabotaged after dispatch");

    // Store reverted: condition count matches the pre-call snapshot.
    expect(sharedStore!.getState().loans["L-ACC-ROLLBACK"]!.conditions.length).toBe(conditionsBefore);

    // DB also rolled back: the prediction row is still 'pending'.
    const row = await withDb(async (c) =>
      c.query<{ status: string; accepted_condition_id: string | null }>(
        `SELECT status, accepted_condition_id FROM predicted_conditions WHERE id = $1`,
        [predictionIds[0]],
      ),
    );
    expect(row.rows[0]!.status).toBe("pending");
    expect(row.rows[0]!.accepted_condition_id).toBeNull();

    // No predict_conditions.accept audit row was written for this prediction.
    const audit = await withDb(async (c) =>
      c.query<{ count: string }>(
        `SELECT COUNT(*)::text FROM tenant_audit_log
          WHERE target_tenant_id = $1
            AND action = 'predict_conditions.accept'
            AND (metadata->>'prediction_id') = $2`,
        [T, predictionIds[0]],
      ),
    );
    expect(parseInt(audit.rows[0]!.count, 10)).toBe(0);
  });
});
```

- [ ] **Step 6: Run the full service test file**

```bash
pnpm --filter @twin/api exec vitest run test/predict-conditions-service.test.ts
```

Expected: 21/21 pass (the 20 existing tests + 1 new rollback test). Build still clean.

If the new test fails with `Cannot find module '__testOnly_setThrowAfterDispatch'`, you forgot the re-export in Step 5 Option A.

If the test passes but the existing 20 don't, re-read the Step 1-3 changes for typos in lock-key strings, missed `getStore()` calls, or a wrong placement of the test-hook check (it must be inside the helper's closure, not outside it).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/predict-conditions/service.ts \
        packages/api/src/services/predict-conditions/index.ts \
        packages/api/test/predict-conditions-service.test.ts
git commit -m "feat(api/services): rollback store dispatch on DB error in predict-conditions accept/reopen

Wraps accept() and reopenAndAccept() with withStoreSnapshot so a post-dispatch
DB failure reverts the in-memory store via InjectLoan. Adds per-loan advisory
lock pg_advisory_xact_lock(hashtext('predict-accept:'||loanId)) inside the
withTenantTx closure so parallel calls on the same loan serialize through
the helper — without it, two parallel accepts on different predictions of
the same loan can interleave at every await and one closure's rollback can
wipe the other's successful dispatch. Lock namespace 'predict-accept:' is
distinct from run()'s 'predict:' lock so accept and run never contend.

Adds a one-shot test hook (__testOnly_setThrowAfterDispatch) that makes the
next accept/reopen throw immediately after dispatching AddCondition. The
hook is consumed on read (one-shot) and re-exported from the service module
index for test access. beforeEach defensively resets the hook between tests
so a forgotten setter from a failing test can't leak.

One new integration test verifies: rollback reverts loan.conditions to the
pre-call count, the prediction row remains status='pending' with
accepted_condition_id NULL, and no predict_conditions.accept audit row is
written. Service tests now 21/21."
```

No Co-Authored-By trailers.

---

## Task 3: Wrap `POST /loans/:loanId/recommendation` (StageRecommendation)

**Files:**
- Modify: `packages/api/src/routes/recommendation.ts`

**Rationale:** Apply the helper to Site B (per spec §3.2). No advisory lock here (last-writer-wins is acceptable UX, not corruption — documented in spec §8). No new test — helper unit tests + existing route tests cover correctness.

- [ ] **Step 1: Read the current handler structure**

Open `packages/api/src/routes/recommendation.ts` and locate the `POST /loans/:loanId/recommendation` handler (around lines 16-69). The current shape:

```typescript
app.post<{ Params: { loanId: string } }>("/loans/:loanId/recommendation", async (req, reply) => {
  const body = StageRecommendationSchema.parse(req.body);
  store.dispatch({ type: "StageRecommendation", loanId: req.params.loanId,
    recommendation: body.recommendation, actor: body.actor });

  // Persist VA loan state so the loan lands in the correct review queue.
  // - tenant.settings.va.required === true: route via va_routing_rules and
  //   stage as va_review_pending with the resolved pool.
  // - tenant.settings.va.required === false (or unset): promote directly to
  //   uw_review_pending so the existing UW decision flow continues to work.
  // Skipped entirely when DB is disabled (legacy in-memory test mode) so
  // tests that run without DATABASE_URL keep working.
  if (isDbEnabled()) {
    const loanId = req.params.loanId;
    const tenantId = getTenantId();

    const settings = await withTenantTx(tenantId, async (c) => {
      // ... settings lookup ...
    });
    // ... routeLoan + nextState/assignedPoolId computation ...
    await withTenantTx(tenantId, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (tenant_id, loan_id) DO UPDATE
           SET va_state = EXCLUDED.va_state,
               assigned_pool_id = EXCLUDED.assigned_pool_id,
               updated_at = now()`,
        [tenantId, loanId, nextState, assignedPoolId],
      );
    });
  }

  reply.send(requireLoanForTenant(store, req.params.loanId));
});
```

- [ ] **Step 2: Add the helper import**

At the top of the file alongside the other `../` imports, add:

```typescript
import { withStoreSnapshot } from "../store-db-consistency.js";
```

- [ ] **Step 3: Wrap the dispatch + DB-write block**

Replace the handler body with the wrapped version. Hoist `const loanId = req.params.loanId;` to the top so it's in scope for the helper call:

```typescript
app.post<{ Params: { loanId: string } }>("/loans/:loanId/recommendation", async (req, reply) => {
  const body = StageRecommendationSchema.parse(req.body);
  const loanId = req.params.loanId;

  await withStoreSnapshot(store, loanId, async () => {
    store.dispatch({ type: "StageRecommendation", loanId,
      recommendation: body.recommendation, actor: body.actor });

    // Persist VA loan state so the loan lands in the correct review queue.
    // - tenant.settings.va.required === true: route via va_routing_rules and
    //   stage as va_review_pending with the resolved pool.
    // - tenant.settings.va.required === false (or unset): promote directly to
    //   uw_review_pending so the existing UW decision flow continues to work.
    // Skipped entirely when DB is disabled (legacy in-memory test mode) so
    // tests that run without DATABASE_URL keep working.
    if (isDbEnabled()) {
      const tenantId = getTenantId();

      const settings = await withTenantTx(tenantId, async (c) => {
        const { rows } = await c.query<{ settings: { va?: { required?: boolean; fallbackPoolId?: string } } | null }>(
          "SELECT settings FROM tenants WHERE id = $1",
          [tenantId],
        );
        return rows[0]?.settings ?? {};
      });
      const vaRequired = settings?.va?.required === true;
      const fallbackPoolId = settings?.va?.fallbackPoolId;

      let nextState: "va_review_pending" | "uw_review_pending";
      let assignedPoolId: string | null = null;

      if (vaRequired && fallbackPoolId) {
        const loan = requireLoanForTenant(store, loanId);
        const route = await routeLoan(tenantId, loan, { fallbackPoolId });
        nextState = "va_review_pending";
        assignedPoolId = route.poolId;
      } else {
        // VA disabled (or misconfigured): existing UW flow.
        nextState = "uw_review_pending";
      }

      await withTenantTx(tenantId, async (c) => {
        await c.query(
          `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (tenant_id, loan_id) DO UPDATE
             SET va_state = EXCLUDED.va_state,
                 assigned_pool_id = EXCLUDED.assigned_pool_id,
                 updated_at = now()`,
          [tenantId, loanId, nextState, assignedPoolId],
        );
      });
    }
  });

  reply.send(requireLoanForTenant(store, loanId));
});
```

Key changes:
1. Hoisted `const loanId = req.params.loanId;` out of the `if (isDbEnabled())` branch so both the helper call and the final `reply.send` use the same binding.
2. Wrapped the whole dispatch + DB-write block in `withStoreSnapshot(store, loanId, ...)`.
3. The legacy "DB disabled" branch is untouched — when `isDbEnabled()` is false, the closure never throws, so the helper is a no-op.
4. No advisory lock — see Task 3 rationale and spec §8.

- [ ] **Step 4: Build clean + run regression tests**

```bash
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/predict-conditions-service.test.ts test/store-db-consistency.test.ts
```

Expected: build clean, 27 tests pass (21 PC service + 6 helper).

If there are existing recommendation-route tests in the API test directory, run those too:

```bash
ls packages/api/test/ | grep -i recommend
```

If any file matches, include it in the vitest run. If not, that's fine — the spec explicitly notes "no new test" for Site B at §4.3.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/recommendation.ts
git commit -m "feat(api/routes): rollback StageRecommendation dispatch on va_loan_state write failure

Wraps the POST /loans/:loanId/recommendation handler body with
withStoreSnapshot. If routeLoan throws or the va_loan_state INSERT fails,
the snapshot reverts the staged recommendation; the 500 reaches the client
as today, but the store is now consistent with the DB (both at prior
state).

No advisory lock here — two concurrent StageRecommendation requests on the
same loan are a UX glitch (last-writer-wins; both store and DB converge on
the same final state), not a data-corruption failure. The helper itself
takes no position on concurrency; callers decide. Spec §3.2 + §8 document
the boundary and the future-extension path (lock key: 'stage-rec:'||loanId)
if product behavior changes.

The legacy 'DB disabled' branch is wrapped trivially — when isDbEnabled()
is false the closure never throws, so the helper is a no-op."
```

No Co-Authored-By trailers.

---

## Spec coverage check (self-review)

Mapping every spec section to a task:

| Spec section | Task |
|---|---|
| §1 Problem | Implicit — every task fixes part of this |
| §2 Affected sites — Site A (PC accept/reopen) | Task 2 |
| §2 Affected sites — Site B (StageRecommendation) | Task 3 |
| §3.1 Helper definition + JSDoc + console.warn (R2) | Task 1 |
| §3.1 Semantics (snapshot scope C1, actionLog retention C2, spurious rollback C3, ID model, anti-features C4) | Task 1 (code + JSDoc); Task 1 tests cover the C2/C3 cases explicitly |
| §3.2 Site A wrap + per-loan advisory lock (R1) | Task 2 |
| §3.2 Site B wrap + no-lock rationale | Task 3 |
| §3.3 Test hook with EXPORTED FOR TESTS ONLY comment (P1) | Task 2 |
| §4.1 Six unit tests | Task 1 (Steps 1, 4) |
| §4.2 PC accept rollback integration test | Task 2 (Step 5) |
| §4.3 No Site B integration test | Task 3 (no test step) |
| §5 Files affected | All three tasks combined |
| §6 Commit plan (3 commits) | Three task commits |
| §7 Non-goals | (No implementation needed — explicit deferrals) |
| §8 Risks | Documented in spec; implementation respects each (lock at Site A, no lock at Site B, console.warn for visibility, one-shot test hook with beforeEach reset, actionLog retention as documented behavior) |

**Zero spec sections without an implementation task.** ✅

---

## Implementation-time notes (from reviewer)

These flow into ticket-level decisions, not spec edits:

1. **Existing PC concurrency test is for `run()`, not `accept()`.** Confirmed via grep at plan time: the only `Promise.all` in the service test file pairs two `run()` calls. The new `predict-accept:` lock key is distinct from `predict:` so no contention with the existing test.

2. **Test hook isolation via `beforeEach`.** Task 2 Step 5 explicitly resets `__testOnly_setThrowAfterDispatch(null)` in the existing `beforeEach`. Even though the hook is one-shot, a forgotten setter from a failing test would otherwise leak — defense in depth.

3. **`console.warn` vs injected pino logger.** `console.warn` is captured by pino's stdout redirect in the Fastify config (per spec §8); using it directly keeps the helper free of Fastify dependencies. If the team standardises on injected loggers later, the helper grows an optional `logger?` parameter — a non-breaking change.

---

## Placeholder scan (self-review)

Searched for: TBD, TODO, "implement later", "fill in details", "Add appropriate error handling", "Write tests for the above", "Similar to Task N", references to undefined types.

✅ None present. Every code block is concrete and self-contained. Type references (`Store`, `Loan`, `PredictionConditionCollisionError`, `Action`, `__testOnly_setThrowAfterDispatch`) are all defined in the same task or in the existing codebase (which earlier tasks reference by path + line).

---

## Type consistency check (self-review)

| Name | Defined in | Used in |
|---|---|---|
| `withStoreSnapshot` | Task 1 | Tasks 2, 3 |
| `__testOnly_throwAfterDispatch` (variable) | Task 2 Step 1 | Task 2 Steps 2, 3 |
| `__testOnly_setThrowAfterDispatch` (function) | Task 2 Step 1 | Task 2 Step 5 (test) |
| `PredictionConditionCollisionError` | Already in errors.js (commit `7695bad`) | Tasks 2 (rethrown by collision check) |
| `pg_advisory_xact_lock(hashtext('predict-accept:' || loanId))` | Task 2 (lock key) | Task 2 Steps 2, 3 (same key in both functions) |
| `getStore()` | Already in service.ts (commit `d0c8db4`) | Task 2 Steps 2, 3 |
| `InjectLoan` action shape | Already in core types (immutable) | Task 1 (helper body), implicit in beforeEach loan-injection loop |

✅ Consistent across tasks.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-13-store-db-consistency.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review between (spec compliance → code quality), fast iteration. Same approach that shipped the Predictive Conditions implementation cleanly.

**2. Inline Execution** — Execute tasks in this session via `executing-plans`, batch with checkpoints.

**Which approach?**
