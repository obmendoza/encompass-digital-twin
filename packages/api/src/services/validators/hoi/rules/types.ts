import type { HoiPolicyFields, FloodCertFields, ValidationFinding } from "@twin/core";
import type { LoanContext } from "../../../doc-requirements.js";

export interface DocumentRef {
  tenantId: string;
  loanId: string;
  documentId: string;
  category: "hoi-policy" | "flood-cert";
  storageUrl: string;
}

export interface RuleContext {
  hoi: HoiPolicyFields | null;
  flood: FloodCertFields | null;
  loan: LoanContext;
  documents: { hoi: DocumentRef | null; floodCert: DocumentRef | null };
  /** The active extraction's UUID — embedded in finding evidence + portal_metadata. */
  extractionId: string;
  /** Loan's external number (NQMF / Lender) for H1 channel-specific matching. */
  loanNumber: string;
}

export interface RuleResult {
  ruleId: string;
  fired: boolean;
  finding: ValidationFinding | null;
}

export type Rule = (ctx: RuleContext) => RuleResult;
