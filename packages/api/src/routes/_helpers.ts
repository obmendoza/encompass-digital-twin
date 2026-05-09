import type { Store, Loan } from "@twin/core";
import { getTenantId } from "../tenant-context.js";
import { ActionError } from "@twin/core";

/**
 * Return all loans visible to the current tenant.
 * Task 9 close-out (RLS leak fix, 2026-05-10): untenanted loans are no longer
 * visible to anyone via the API. Production callers — InjectLoan (boot),
 * /world/load-scenario, /world/inject-loan, behavioral-test — all stamp
 * tenantId at dispatch time. A loan that lacks tenantId in the store is
 * either pre-Task-9 legacy state or a test artifact and must not leak.
 */
export function getLoansForTenant(store: Store): Loan[] {
  const tenantId = getTenantId();
  return Object.values(store.getState().loans)
    .filter((loan) => loan.tenantId === tenantId);
}

export function getLoanForTenant(store: Store, loanId: string): Loan | null {
  const tenantId = getTenantId();
  const loan = store.getLoan(loanId);
  if (!loan) return null;
  if (loan.tenantId !== tenantId) return null;
  return loan;
}

export function requireLoanForTenant(store: Store, loanId: string): Loan {
  const loan = getLoanForTenant(store, loanId);
  if (!loan) throw new ActionError("LOAN_NOT_FOUND", `loan '${loanId}' not found`, { loanId });
  return loan;
}
