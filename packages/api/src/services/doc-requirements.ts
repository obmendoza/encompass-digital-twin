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

// TODO(Task 9): uncomment when resolveRequiredDocs body is implemented
// import { withTenantTx } from "../db/pool.js";

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
  throw new Error("resolveRequiredDocs not yet implemented");
}
