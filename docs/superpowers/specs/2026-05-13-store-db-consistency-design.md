# Store–DB Consistency Pass (F1)

**Date:** 2026-05-13
**Status:** Spec
**Scope:** API layer — fix the "store-and-DB two-write hazard" first documented as `O1` in the Predictive Conditions spec (`2026-05-12-predictive-conditions-design.md §10`, follow-up F1 in its plan).
**Predecessor work:** Predictive Conditions PR #2 (commits `e82566b..38e85d0`).

---

## 1. Problem

Several API handlers do two writes in sequence:

1. `store.dispatch(...)` — mutates the in-memory `@twin/core` store synchronously.
2. A DB write (UPDATE / INSERT / multi-statement transaction) — persists consequences.

If step 2 fails after step 1 has already mutated the store, the in-memory loan and the DB diverge until the next full hydration of the loan. Today the only "hydration" is restarting the API. Callers see an inconsistent view: API responses derived from the store reflect the dispatched mutation; DB-side reads (audit-log queries, learning-engine ingest, RLS-scoped admin queries) reflect the rolled-back state.

## 2. Affected sites

Two live sites:

| # | File | Handler / function | Dispatch | DB write |
|---|---|---|---|---|
| A | `packages/api/src/services/predict-conditions/service.ts` | `accept()` | `AddCondition` | `UPDATE predicted_conditions … SET accepted_condition_id = …` + audit `INSERT` |
| A' | same | `reopenAndAccept()` | `AddCondition` | same shape as accept |
| B | `packages/api/src/routes/recommendation.ts` | `POST /loans/:loanId/recommendation` | `StageRecommendation` | `INSERT … ON CONFLICT … va_loan_state` |

The Predictive Conditions spec listed VA `submitReview` as a third site, but `va-review-writer.ts` is already DB-only — production VA submit bypasses the reducer per project memory `feedback_va_loan_fields_vestigial`. Not in scope.

A broader audit across the API for unidentified store-dispatch-then-DB patterns is **deferred** to a future ticket. This spec fixes the two known sites and lands a reusable helper that future code can adopt.

## 3. Design

### 3.1 Helper

New module: `packages/api/src/store-db-consistency.ts`

```typescript
import type { Store } from "@twin/core";

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
      store.dispatch({ type: "InjectLoan", loan: before });
    }
    throw e;
  }
}
```

**Semantics:**

- The snapshot is captured **before** the closure runs, so it reflects pre-mutation state regardless of how many dispatches the closure performs.
- The reducer's `InjectLoan` handler already does `structuredClone(loan)` on insert (`packages/core/src/reduce.ts:344`), so the snapshot stays effectively immutable until rollback time, then is re-cloned in.
- If the loan didn't exist in the store before the closure (`before === undefined`), the helper skips the rollback dispatch. There is no `RemoveLoan` reducer action, and the current call sites do not create new loans inside the closure. This is the only edge case that intentionally does NOT roll back.
- The original exception is re-thrown unchanged after the rollback dispatch. Callers continue to surface the error to the HTTP layer.

**What the helper does NOT do:**

- It does NOT open a DB transaction. The closure is expected to manage its own DB transaction (typically `withTenantTx`). The helper composes inside or outside `withTenantTx` — both are acceptable.
- It does NOT prevent concurrent dispatches on the same loan. The server is single-threaded for store operations (no parallel handler invocations on the same loan due to advisory locks on the DB side), so the snapshot is a consistent view at function entry.
- It does NOT attempt nesting safety. If a caller wraps another `withStoreSnapshot` for the same `loanId` inside its closure, the inner snapshot will capture intermediate state. No call site does this today.

### 3.2 Call-site changes

**A. PC `accept()` and `reopenAndAccept()`** — wrap the post-SELECT body. The `loan_id` comes from the SELECT result, so the snapshot is captured after `SELECT … FOR UPDATE` validates the prediction but before `AddCondition` is dispatched:

```typescript
return withTenantTx(tenantId, async (c) => {
  const { rows } = await c.query(`SELECT … FROM predicted_conditions WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [predictionId, tenantId]);
  if (rows.length === 0) throw new PredictionNotFoundError(...);
  const p = rows[0]!;
  if (p.status !== "pending") throw new PredictionNotPendingError(...);

  return withStoreSnapshot(store, p.loan_id, async () => {
    // dispatch AddCondition
    // throw-after-dispatch test hook check
    // collision detection
    // UPDATE predicted_conditions
    // INSERT audit row
    return { conditionId, predictionId };
  });
});
```

The existing `PredictionConditionCollisionError` throw (introduced in commit `7695bad`) is now also safely revertible — if it fires after the dispatch, the helper reverts the spurious link to the wrong condition.

**B. `POST /loans/:loanId/recommendation`** — wrap the dispatch and the entire DB write block in a single closure:

```typescript
app.post("/loans/:loanId/recommendation", async (req, reply) => {
  const body = StageRecommendationSchema.parse(req.body);
  const loanId = req.params.loanId;

  await withStoreSnapshot(store, loanId, async () => {
    store.dispatch({ type: "StageRecommendation", loanId, recommendation: body.recommendation, actor: body.actor });
    if (isDbEnabled()) {
      // existing settings read + routeLoan + va_loan_state INSERT
    }
  });

  reply.send(requireLoanForTenant(store, loanId));
});
```

If `routeLoan` throws or the `va_loan_state` INSERT fails, the snapshot reverts the staged recommendation. The 500 reaches the client as today; the store is now consistent with the DB (both at prior state). The legacy "DB disabled" branch is wrapped trivially — the closure never throws there, so the helper is a no-op.

`AcceptRecommendation` and `ClearRecommendation` routes (also in `recommendation.ts`) do NOT need wrapping — they have no DB write after the dispatch.

### 3.3 Test hook for rollback verification

To exercise the rollback path in tests deterministically, add a module-scoped test hook to `service.ts`:

```typescript
let __testOnly_throwAfterDispatch: Error | null = null;

export function __testOnly_setThrowAfterDispatch(e: Error | null): void {
  __testOnly_throwAfterDispatch = e;
}

// Inside accept() and reopenAndAccept(), immediately after store.dispatch:
if (__testOnly_throwAfterDispatch) {
  const e = __testOnly_throwAfterDispatch;
  __testOnly_throwAfterDispatch = null;
  throw e;
}
```

The hook is reset on consumption (one-shot) so a forgotten cleanup in a test can't leak. Naming prefix `__testOnly_` discourages production callers; the hook is exported only to permit test invocation.

This is the minimum viable mechanism to inject a failure exactly between the dispatch and the subsequent DB writes. Alternative sabotage approaches (CHECK constraint violations, pg client mocking) are more invasive and brittle.

## 4. Tests

### 4.1 Helper unit tests

`packages/api/test/store-db-consistency.test.ts` (new, 4 cases):

1. Closure succeeds → return value passes through, no rollback dispatch happens.
2. Closure throws after a mutating dispatch → loan is reverted to the pre-closure snapshot; the test asserts on a specific loan field (e.g., `conditions.length` or a marker description).
3. Closure throws → the same exception is re-thrown to the caller.
4. Loan absent before closure → on throw, no `InjectLoan` is dispatched (verify by attempting `getState().loans[loanId]` is still `undefined`).

Tests use `createStore({ scenarios })` directly (same pattern as `predict-conditions-service.test.ts`), no DB, no Fastify. Fast.

### 4.2 PC accept rollback integration test

Appended to `packages/api/test/predict-conditions-service.test.ts`. One case:

- Seed + run a prediction batch for a fresh loan id (e.g., `L-ROLLBACK-1`).
- Snapshot `conditions.length` before calling `accept()`.
- Set `__testOnly_throwAfterDispatch(new Error("sabotaged"))`.
- Call `accept(T, predictionId, "op-rb", "operator")` — expect it to reject.
- Re-read the loan from the store; assert `conditions.length` matches the pre-call snapshot.
- Verify the prediction's DB row is still `status='pending'` (the UPDATE never ran).
- Verify no `predict_conditions.accept` audit row was written for this prediction.

Total service-test count after this: 21 (was 20).

### 4.3 Recommendation route — no integration test

Helper unit tests (4.1) + existing route tests in the suite cover the success path. The recommendation handler's structure is straightforward enough that exercising the failure window with a second mock layer (Postgres connection failure) would cost more than it's worth. The helper-level proof of correctness applies.

## 5. Files affected

| Status | Path |
|---|---|
| New | `packages/api/src/store-db-consistency.ts` |
| New | `packages/api/test/store-db-consistency.test.ts` |
| Modify | `packages/api/src/services/predict-conditions/service.ts` (accept, reopenAndAccept, test hook) |
| Modify | `packages/api/test/predict-conditions-service.test.ts` (one new test under a new describe block) |
| Modify | `packages/api/src/routes/recommendation.ts` (wrap the StageRecommendation handler body) |

## 6. Commit plan

Three commits, reviewable in isolation:

1. **`feat(api): withStoreSnapshot helper for store-DB consistency`** — helper + unit tests.
2. **`feat(api/services): rollback store dispatch on DB error in predict-conditions accept/reopen`** — wrap call sites + test hook + integration test.
3. **`feat(api/routes): rollback StageRecommendation dispatch on va_loan_state write failure`** — wrap recommendation route.

Each commit must keep `pnpm --filter @twin/api build` and the API test suite green.

## 7. Non-goals

- Broader codebase audit for additional store-dispatch + DB sites. (Tracked as a separate follow-up.)
- Cross-loan transactions or transactional dispatch primitives. The reducer remains synchronous; this spec adds no new reducer actions.
- DB-first ordering refactor. The dispatch-then-DB pattern stays; the helper repairs its consistency property without restructuring callers.
- Snapshot persistence across server restarts. The store is in-memory and rebuilt from DB on boot; that hydration path is unchanged.

## 8. Risks

- **Helper composes inside `withTenantTx`, not the other way around.** If a future caller swaps the nesting, the snapshot would be captured after the DB transaction begins — still correct, but timing changes. The helper is documented to be order-agnostic; flag this in code review for future call sites.
- **`InjectLoan` clobbers the entire loan.** If a concurrent handler had modified the same loan between the snapshot read and the rollback, that work would be lost. The server is effectively single-threaded for store ops today (no per-loan locking yet); this risk materialises only if/when in-process concurrency on the store is introduced. Out of scope.
- **Test hook in production code.** The `__testOnly_*` naming and the one-shot reset minimize risk. A production caller invoking the hook would cause the next `accept()` to throw once — recoverable, and unlikely to ship by accident in code review. Stronger alternatives (compile-time conditional, separate test-build entry point) add infrastructure cost disproportionate to the benefit.
