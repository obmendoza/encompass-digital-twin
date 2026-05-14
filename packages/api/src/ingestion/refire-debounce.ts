import { withDb, withTenantTx } from "../db/pool.js";

export interface DrainedRefire {
  tenantId: string;
  loanId: string;
  reason: string;
}

/**
 * Insert (or push forward) the ready_at for a tenant+loan in
 * pc_v2_refire_debounce. Each new doc arrival calls this with
 * delaySeconds=30 — debouncing collapses a burst of N events into
 * one PC v2 run 30s after the LAST event.
 */
export async function enqueueRefire(
  tenantId: string,
  loanId: string,
  reason: string,
  delaySeconds: number,
): Promise<void> {
  await withTenantTx(tenantId, async (c) => {
    await c.query(
      `INSERT INTO pc_v2_refire_debounce (tenant_id, loan_id, ready_at, reason)
       VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval, $4)
       ON CONFLICT (tenant_id, loan_id) DO UPDATE
         SET ready_at = EXCLUDED.ready_at, reason = EXCLUDED.reason`,
      [tenantId, loanId, String(delaySeconds), reason],
    );
  });
}

/**
 * Atomically drains up to `limit` rows with ready_at <= NOW(),
 * returning the drained set and DELETEing the same rows in one
 * statement.
 *
 * Cross-tenant by design: the worker is not bound to a tenant.
 * Uses withDb (admin path); not callable from request handlers.
 */
export async function drainReadyRefires(limit = 100): Promise<DrainedRefire[]> {
  return withDb(async (c) => {
    const { rows } = await c.query<{ tenant_id: string; loan_id: string; reason: string }>(
      `DELETE FROM pc_v2_refire_debounce
        WHERE (tenant_id, loan_id) IN (
          SELECT tenant_id, loan_id FROM pc_v2_refire_debounce
          WHERE ready_at <= NOW()
          ORDER BY ready_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING tenant_id, loan_id, reason`,
      [limit],
    );
    return rows.map((r) => ({ tenantId: r.tenant_id, loanId: r.loan_id, reason: r.reason }));
  });
}
