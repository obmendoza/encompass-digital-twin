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
