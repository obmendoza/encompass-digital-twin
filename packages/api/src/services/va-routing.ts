import type { Loan } from "@twin/core";
import { withTenantTx } from "../db/pool.js";

interface RoutingMatch {
  program?: string[];
  loanAmountMin?: number;
  loanAmountMax?: number;
  occupancy?: ("Primary" | "Second" | "Investment")[];
}

interface RoutingRuleRow {
  id: string;
  priority: number;
  match: RoutingMatch;
  target_pool_id: string;
}

export interface RouteLoanOptions {
  fallbackPoolId: string;
}

export interface RouteLoanResult {
  poolId: string;
  matchedRule: RoutingRuleRow | null;
}

function ruleMatches(rule: RoutingRuleRow, loan: Loan): boolean {
  const m = rule.match;
  if (m.program && !m.program.includes(loan.nqmProgram as string)) return false;
  if (m.loanAmountMin !== undefined && loan.transaction.loanAmount < m.loanAmountMin) return false;
  if (m.loanAmountMax !== undefined && loan.transaction.loanAmount > m.loanAmountMax) return false;
  if (m.occupancy && !m.occupancy.includes(loan.transaction.occupancy as "Primary" | "Second" | "Investment")) return false;
  return true;
}

/**
 * Evaluate va_routing_rules in priority ASC order; first match wins.
 * If no rule matches, returns the fallback pool.
 *
 * The caller (StageRecommendation handler in Task 12) is responsible for
 * passing the tenant's `tenant.settings.va.fallbackPoolId` as the fallback.
 */
export async function routeLoan(
  tenantId: string,
  loan: Loan,
  opts: RouteLoanOptions,
): Promise<RouteLoanResult> {
  return withTenantTx(tenantId, async (client) => {
    const { rows } = await client.query<RoutingRuleRow>(
      `SELECT id, priority, match, target_pool_id
         FROM va_routing_rules
        WHERE tenant_id = $1
        ORDER BY priority ASC`,
      [tenantId],
    );
    for (const rule of rows) {
      if (ruleMatches(rule, loan)) {
        return { poolId: rule.target_pool_id, matchedRule: rule };
      }
    }
    return { poolId: opts.fallbackPoolId, matchedRule: null };
  });
}
