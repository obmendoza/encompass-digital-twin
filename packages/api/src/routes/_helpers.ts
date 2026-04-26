import type { Store, Loan } from "@twin/core";
import { getTenantId } from "../tenant-context.js";
import { ActionError } from "@twin/core";

/**
 * Return all loans visible to the current tenant.
 * Loans without a tenantId are visible to all tenants (legacy/dev mode).
 * Once Task 9 enforces tenantId on InjectLoan, the `!loan.tenantId` branch
 * will only apply during tests that load fixtures without stamping tenantId.
 */
export function getLoansForTenant(store: Store): Loan[] {
  const tenantId = getTenantId();
  return Object.values(store.getState().loans)
    .filter((loan) => !loan.tenantId || loan.tenantId === tenantId);
}

export function getLoanForTenant(store: Store, loanId: string): Loan | null {
  const tenantId = getTenantId();
  const loan = store.getLoan(loanId);
  if (!loan) return null;
  if (loan.tenantId && loan.tenantId !== tenantId) return null;
  return loan;
}

export function requireLoanForTenant(store: Store, loanId: string): Loan {
  const loan = getLoanForTenant(store, loanId);
  if (!loan) throw new ActionError("LOAN_NOT_FOUND", `loan '${loanId}' not found`, { loanId });
  return loan;
}
