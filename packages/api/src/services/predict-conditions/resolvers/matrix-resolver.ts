import type pg from "pg";
import type { LoanContext } from "../../doc-requirements.js";
import type { Finding, KbVersionContext } from "../pre-underwriter.js";

interface MatrixTierRow {
  id: string;
  max_loan_amount: number | null;
  max_ltv_purchase: number | null;
  max_ltv_cashout: number | null;
  max_ltv_rate_term: number | null;
  property_types: string[] | null;
}

function ltvCapColumnFor(purpose: LoanContext["loanPurpose"]): keyof Pick<MatrixTierRow, "max_ltv_purchase" | "max_ltv_cashout" | "max_ltv_rate_term"> | null {
  if (purpose === "Purchase") return "max_ltv_purchase";
  if (purpose === "Cash-Out Refinance") return "max_ltv_cashout";
  if (purpose === "Rate & Term Refinance") return "max_ltv_rate_term";
  return null;
}

/**
 * Resolver: program_matrix_tiers — eligibility checks against the
 * program × occupancy × FICO band matrix. Emits findings as predicted
 * conditions per spec §5.1.
 *
 * Graceful degradation: any required v2 LoanContext field that is
 * undefined causes the resolver to return [] for that check (or all
 * checks if the field is needed for the tier lookup itself) and emit
 * a console.warn capturing the missing field. See spec §6.4 Risk #4.
 */
export async function resolveMatrixFindings(
  c: pg.PoolClient,
  tenantId: string,
  kbCtx: KbVersionContext,
  loan: LoanContext,
): Promise<Finding[]> {
  // The tier lookup needs repFico and occupancy and program. If repFico is
  // missing we can't even find the tier — skip with warn.
  if (loan.repFico === undefined) {
    console.warn("[matrix-resolver] skipped — missing field", { missingField: "repFico" });
    return [];
  }
  const findings: Finding[] = [];

  const { rows } = await c.query<MatrixTierRow>(
    `SELECT id, max_loan_amount, max_ltv_purchase, max_ltv_cashout, max_ltv_rate_term, property_types
       FROM program_matrix_tiers
      WHERE tenant_id = $1 AND kb_version = $2
        AND program = $3 AND occupancy = $4
        AND $5 BETWEEN min_fico AND max_fico
      LIMIT 1`,
    [tenantId, kbCtx.versionNumber, loan.program, loan.occupancy, loan.repFico],
  );

  // Check 1: no matching tier
  if (rows.length === 0) {
    findings.push({
      description: `Manual underwriter review required — FICO ${loan.repFico} outside published matrix tiers for ${loan.program} / ${loan.occupancy}`,
      note: null,
      category: "PTA",
      sourceList: "matrix",
      sourceRuleTable: "program_matrix_tiers",
      sourceRuleId: null,
      emissionKind: "deterministic",
    });
    return findings;
  }

  const tier = rows[0]!;

  // Check 2: loan amount exceeds tier max
  if (loan.loanAmount !== undefined && tier.max_loan_amount !== null && loan.loanAmount > tier.max_loan_amount) {
    findings.push({
      description: `Program-change request or exception documentation — loan amount $${loan.loanAmount.toLocaleString()} exceeds tier max $${tier.max_loan_amount.toLocaleString()}`,
      note: null,
      category: "PTA",
      sourceList: "matrix",
      sourceRuleTable: "program_matrix_tiers",
      sourceRuleId: tier.id,
      emissionKind: "deterministic",
    });
  } else if (loan.loanAmount === undefined) {
    console.warn("[matrix-resolver] skipped loan-amount check — missing field", { missingField: "loanAmount" });
  }

  // Check 3: LTV exceeds tier cap (purpose-selected column)
  const ltvColumn = ltvCapColumnFor(loan.loanPurpose);
  if (loan.ltv !== undefined && ltvColumn !== null) {
    const cap = tier[ltvColumn];
    if (cap !== null && loan.ltv > cap) {
      findings.push({
        description: `Mortgage insurance binder + MI disclosures — LTV ${loan.ltv}% exceeds tier max ${cap}% for ${loan.loanPurpose}`,
        note: null,
        category: "PTA",
        sourceList: "matrix",
        sourceRuleTable: "program_matrix_tiers",
        sourceRuleId: tier.id,
        emissionKind: "deterministic",
      });
    }
  } else if (loan.ltv === undefined) {
    console.warn("[matrix-resolver] skipped LTV check — missing field", { missingField: "ltv" });
  } else if (ltvColumn === null) {
    console.warn("[matrix-resolver] skipped LTV check — missing field", { missingField: "loanPurpose" });
  }

  // Check 4: property type not in tier's allowed list
  if (loan.propertyType !== undefined && tier.property_types !== null && tier.property_types.length > 0) {
    if (!tier.property_types.includes(loan.propertyType)) {
      findings.push({
        description: `Property-type exception documentation — ${loan.propertyType} not in tier's allowed list (${tier.property_types.join(", ")})`,
        note: null,
        category: "PTA",
        sourceList: "matrix",
        sourceRuleTable: "program_matrix_tiers",
        sourceRuleId: tier.id,
        emissionKind: "deterministic",
      });
    }
  } else if (loan.propertyType === undefined) {
    console.warn("[matrix-resolver] skipped property-type check — missing field", { missingField: "propertyType" });
  }

  return findings;
}
