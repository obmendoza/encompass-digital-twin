// Doc Requirements resolver. Given a loan context, returns the required-docs
// list for the active (or specified) KB version, with engine-rule modifiers
// applied. See spec §4.
//
// Error contract (binding for downstream callers — Predictive Conditions, VA
// Doc Review specialist):
//   - NoActiveKbVersionError       : kbVersionId=null and no active row exists
//   - KbVersionNotFoundError       : explicit kbVersionId missing or wrong-tenant
//   - IncomeTypeUnresolvedError    : (incomeDocType, borrowerType, citizenship,
//                                     isItin) tuple has no resolver row

import { withTenantTx } from "../db/pool.js";

export interface DocItem {
  order: number;
  name: string;
  note: string | null;
}

export interface LoanContext {
  incomeDocType: string;
  borrowerType: "W2" | "Self-Employed";
  citizenship: "US Citizen" | "Foreign Nationals";
  isItin: boolean;
  llcOrLegalEntity: boolean;
  occupancy: "primary" | "second_home" | "investment";
  state: string;
  county: string;
  usCredit: boolean;
  program: string;
}

export interface ResolveResult {
  resolvedIncomeType: string;
  minimum: DocItem[];
  income: DocItem[];
  appliedRules: string[];
  kbVersionId: number;
}

export class NoActiveKbVersionError extends Error {
  constructor(public readonly tenantSlugOrId: string, public readonly tenantId: string) {
    super(`No active KB version for tenant ${tenantSlugOrId} (${tenantId}). An admin must run two-key approval (scripts/approve-kb.ts) before doc resolution is available.`);
    this.name = "NoActiveKbVersionError";
  }
}

export class KbVersionNotFoundError extends Error {
  constructor(public readonly kbVersionId: number, public readonly tenantId: string) {
    super(`KB version ${kbVersionId} not found for tenant ${tenantId} (does not exist, or belongs to a different tenant).`);
    this.name = "KbVersionNotFoundError";
  }
}

export class IncomeTypeUnresolvedError extends Error {
  constructor(
    public readonly inputs: {
      incomeDocType: string;
      borrowerType: string;
      citizenship: string;
      isItin: boolean;
    },
    public readonly tenantId: string,
    public readonly kbVersionId: number,
  ) {
    super(
      `No income_type_resolver row for tenant ${tenantId}, kb_version ${kbVersionId}, inputs (incomeDocType='${inputs.incomeDocType}', borrowerType='${inputs.borrowerType}', citizenship='${inputs.citizenship}', isItin=${inputs.isItin}). Either malformed loan input or an engine-coverage gap in the ingested KB.`,
    );
    this.name = "IncomeTypeUnresolvedError";
  }
}

export async function resolveRequiredDocs(
  tenantId: string,
  kbVersionId: number | null,
  loan: LoanContext,
): Promise<ResolveResult> {
  return withTenantTx(tenantId, async (c) => {
    // 1. Resolve target kb_version_id
    let resolvedKbId: number;
    if (kbVersionId === null) {
      const { rows } = await c.query<{ id: number }>(
        `SELECT id FROM kb_versions WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
        [tenantId],
      );
      if (rows.length === 0) throw new NoActiveKbVersionError(tenantId, tenantId);
      resolvedKbId = rows[0]!.id;
    } else {
      const { rows } = await c.query<{ id: number }>(
        `SELECT id FROM kb_versions WHERE id = $1 AND tenant_id = $2`,
        [kbVersionId, tenantId],
      );
      if (rows.length === 0) throw new KbVersionNotFoundError(kbVersionId, tenantId);
      resolvedKbId = kbVersionId;
    }

    // 2. Resolve income type
    const { rows: resolverRows } = await c.query<{ resolved_income_type: string }>(
      `SELECT resolved_income_type FROM income_type_resolver
        WHERE tenant_id = $1 AND kb_version_id = $2
          AND income_doc_type = $3 AND borrower_type = $4
          AND citizenship = $5 AND is_itin = $6`,
      [tenantId, resolvedKbId, loan.incomeDocType, loan.borrowerType, loan.citizenship, loan.isItin],
    );
    if (resolverRows.length === 0) {
      throw new IncomeTypeUnresolvedError(
        {
          incomeDocType: loan.incomeDocType,
          borrowerType: loan.borrowerType,
          citizenship: loan.citizenship,
          isItin: loan.isItin,
        },
        tenantId,
        resolvedKbId,
      );
    }
    const resolvedIncomeType = resolverRows[0]!.resolved_income_type;

    // 3. Fetch base lists
    const { rows: checklistRows } = await c.query<{
      minimum_docs: DocItem[];
      income_docs: DocItem[];
    }>(
      `SELECT minimum_docs, income_docs FROM program_doc_checklist
        WHERE tenant_id = $1 AND kb_version_id = $2 AND resolved_income_type = $3`,
      [tenantId, resolvedKbId, resolvedIncomeType],
    );
    if (checklistRows.length === 0) {
      throw new IncomeTypeUnresolvedError(
        {
          incomeDocType: loan.incomeDocType,
          borrowerType: loan.borrowerType,
          citizenship: loan.citizenship,
          isItin: loan.isItin,
        },
        tenantId,
        resolvedKbId,
      );
    }
    const minimum = [...checklistRows[0]!.minimum_docs];
    const income = [...checklistRows[0]!.income_docs];

    // 4. Fetch + apply engine rules
    const { rows: ruleRows } = await c.query<{
      rule_name: string;
      predicate: Record<string, unknown>;
      effect: { add_docs: string[]; remove_docs: string[] };
    }>(
      `SELECT rule_name, predicate, effect FROM program_doc_engine_rules
        WHERE tenant_id = $1 AND kb_version_id = $2`,
      [tenantId, resolvedKbId],
    );
    const appliedRules: string[] = [];
    for (const rule of ruleRows) {
      if (rulePredicateMatches(rule.predicate, loan)) {
        appliedRules.push(rule.rule_name);
        // Add: append at end with auto-incremented order
        for (const docName of rule.effect.add_docs) {
          minimum.push({ order: minimum.length + 1, name: docName, note: null });
        }
        // Remove: filter by exact name match
        for (const docName of rule.effect.remove_docs) {
          const idx = minimum.findIndex((d) => d.name === docName);
          if (idx >= 0) minimum.splice(idx, 1);
        }
      }
    }

    return { resolvedIncomeType, minimum, income, appliedRules, kbVersionId: resolvedKbId };
  });
}

// Known predicate keys. New keys require explicit handling in the if-chain
// below — silently ignoring an unknown key would let a future engine rule
// fire without its intended gating (fail-open). See spec §2.2.
const KNOWN_PREDICATE_KEYS = new Set([
  "kind",                    // discriminator-only, no match logic
  "LLCOrLegalEntity",
  "USCredit",
  "state",
  "county_in",
  "occupancy_in",
  "program_not_in",
]);

function rulePredicateMatches(predicate: Record<string, unknown>, loan: LoanContext): boolean {
  for (const [key, val] of Object.entries(predicate)) {
    if (!KNOWN_PREDICATE_KEYS.has(key)) {
      throw new Error(
        `unknown predicate key '${key}' in engine rule — new keys must be added to KNOWN_PREDICATE_KEYS and rulePredicateMatches. Spec §2.2.`,
      );
    }
    if (key === "kind") continue;
    if (key === "LLCOrLegalEntity" && loan.llcOrLegalEntity !== val) return false;
    if (key === "USCredit" && loan.usCredit !== val) return false;
    if (key === "state" && loan.state !== val) return false;
    if (key === "county_in" && Array.isArray(val) && !val.includes(loan.county)) return false;
    if (key === "occupancy_in" && Array.isArray(val) && !val.includes(loan.occupancy)) return false;
    if (key === "program_not_in" && Array.isArray(val) && val.includes(loan.program)) return false;
  }
  return true;
}
