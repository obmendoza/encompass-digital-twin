import { LoanContextExtrasSchema, type LoanContextExtras } from "@twin/core";
import { withTenantTx } from "../db/pool.js";

export async function loadExtras(
  tenantId: string,
  loanId: string,
): Promise<LoanContextExtras | null> {
  return withTenantTx(tenantId, async (c) => {
    const { rows } = await c.query<{ extras: unknown }>(
      `SELECT extras FROM loan_context_extras
        WHERE tenant_id = $1 AND loan_id = $2
        LIMIT 1`,
      [tenantId, loanId],
    );
    if (rows.length === 0) return null;
    const parsed = LoanContextExtrasSchema.safeParse(rows[0]!.extras);
    if (!parsed.success) {
      console.warn(
        `[loan-context-extras] Zod parse failed for tenant=${tenantId} loan=${loanId}; treating as absent`,
        parsed.error.flatten(),
      );
      return null;
    }
    return parsed.data;
  });
}

export async function writeExtrasFirstWriteWins(
  tenantId: string,
  loanId: string,
  extras: LoanContextExtras,
): Promise<void> {
  const parsed = LoanContextExtrasSchema.parse(extras);
  await withTenantTx(tenantId, async (c) => {
    await c.query(
      `INSERT INTO loan_context_extras (tenant_id, loan_id, extras)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (tenant_id, loan_id) DO NOTHING`,
      [tenantId, loanId, JSON.stringify(parsed)],
    );
  });
}
