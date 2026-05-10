import { withTenantTx } from "../db/pool.js";

export interface ClaimResult {
  claimed: boolean;
  loanId: string;
  vaId: string | null;
  reason?: string;
}

export interface ReleaseResult {
  released: boolean;
  loanId: string;
  reason?: string;
}

interface VaLoanStateRow {
  va_state: string;
  va_id: string | null;
  assigned_pool_id: string | null;
}

/**
 * Race-safe claim of a loan in `va_review_pending` state by a VA who is a
 * member of the loan's assigned pool. Concurrent calls are serialised by
 * Postgres' single-row UPDATE: exactly one will return a row, others get zero.
 */
export async function claimLoan(
  tenantId: string,
  loanId: string,
  vaId: string,
): Promise<ClaimResult> {
  return withTenantTx(tenantId, async (client) => {
    const { rows } = await client.query<{ loan_id: string; va_id: string }>(
      `UPDATE va_loan_state
          SET va_state = 'va_in_review',
              va_id = $1,
              claimed_at = now(),
              updated_at = now()
        WHERE tenant_id = $2
          AND loan_id = $3
          AND va_state = 'va_review_pending'
          AND EXISTS (
            SELECT 1 FROM va_pool_memberships m
             WHERE m.pool_id = va_loan_state.assigned_pool_id
               AND m.member_id = $1
          )
        RETURNING loan_id, va_id`,
      [vaId, tenantId, loanId],
    );
    if (rows.length === 1) {
      return { claimed: true, loanId: rows[0].loan_id, vaId: rows[0].va_id };
    }

    // Diagnostic SELECT: distinguish not-found / wrong-state / not-a-member.
    const diag = await client.query<VaLoanStateRow>(
      `SELECT va_state, va_id, assigned_pool_id
         FROM va_loan_state
        WHERE tenant_id = $1 AND loan_id = $2`,
      [tenantId, loanId],
    );
    if (diag.rows.length === 0) {
      return { claimed: false, loanId, vaId: null, reason: "loan not found" };
    }
    const row = diag.rows[0];
    if (row.va_state !== "va_review_pending") {
      const owner = row.va_id ?? "unknown";
      return {
        claimed: false,
        loanId,
        vaId: row.va_id,
        reason: `state is ${row.va_state} (already claimed by ${owner})`,
      };
    }
    return {
      claimed: false,
      loanId,
      vaId: null,
      reason: "user is not a member of the loan's assigned pool",
    };
  });
}

/**
 * Release a loan currently held by `vaId`. State must be `va_in_review` AND
 * the row's `va_id` must equal the caller — only the current claimant can
 * release through this service. Returns released=false with a diagnostic
 * reason on mismatch.
 */
export async function releaseLoan(
  tenantId: string,
  loanId: string,
  vaId: string,
): Promise<ReleaseResult> {
  return withTenantTx(tenantId, async (client) => {
    const { rows } = await client.query<{ loan_id: string }>(
      `UPDATE va_loan_state
          SET va_state = 'va_review_pending',
              va_id = NULL,
              claimed_at = NULL,
              updated_at = now()
        WHERE tenant_id = $1
          AND loan_id = $2
          AND va_state = 'va_in_review'
          AND va_id = $3
        RETURNING loan_id`,
      [tenantId, loanId, vaId],
    );
    if (rows.length === 1) {
      return { released: true, loanId: rows[0].loan_id };
    }

    const diag = await client.query<VaLoanStateRow>(
      `SELECT va_state, va_id, assigned_pool_id
         FROM va_loan_state
        WHERE tenant_id = $1 AND loan_id = $2`,
      [tenantId, loanId],
    );
    if (diag.rows.length === 0) {
      return { released: false, loanId, reason: "loan not found" };
    }
    const row = diag.rows[0];
    if (row.va_state !== "va_in_review") {
      return {
        released: false,
        loanId,
        reason: `state is ${row.va_state}, not va_in_review`,
      };
    }
    return {
      released: false,
      loanId,
      reason: `loan is not currently claimed by this user (claimed by ${row.va_id ?? "unknown"})`,
    };
  });
}
