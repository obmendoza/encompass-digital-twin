// Shared LoanContext builder used by both /loans/:id/predictions/run (manual)
// and /api/ingest/:tenantSlug/loans (auto-fire). Single source of truth so the
// two paths can't drift.

import type { Loan } from "@twin/core";
import type { LoanContext } from "../services/doc-requirements.js";

export function buildLoanContextFromLoan(loan: Loan): LoanContext {
  const borrowerType = loan.qualifyingMethod === "TraditionalDocs" ? "W2" : "Self-Employed";
  const citizenship = "US Citizen";
  const incomeDocType =
    loan.qualifyingMethod === "TraditionalDocs"
      ? "Full Doc"
      : loan.qualifyingMethod === "BankStatementDeposits"
        ? "Bank Stmts: 12 Mo. Personal"
        : loan.qualifyingMethod === "DSCRCoverage"
          ? "DSCR / No Ratio DSCR"
          : "Full Doc";
  const occupancy: "primary" | "second_home" | "investment" =
    loan.transaction.occupancy === "Primary"
      ? "primary"
      : loan.transaction.occupancy === "Second"
        ? "second_home"
        : "investment";
  // Map Loan.transaction.loanPurpose (Loan-domain literal) to LoanContext's
  // narrower PC v2 union. Unrecognized values fall through to undefined so
  // resolvers skip+warn rather than emit findings against a phantom purpose.
  const loanPurpose: LoanContext["loanPurpose"] =
    loan.transaction.loanPurpose === "Purchase"
      ? "Purchase"
      : loan.transaction.loanPurpose === "Refi-RT"
        ? "Rate & Term Refinance"
        : loan.transaction.loanPurpose === "Refi-CO"
          ? "Cash-Out Refinance"
          : undefined;
  return {
    // ── PC v1 fields (unchanged) ──
    incomeDocType,
    borrowerType,
    citizenship,
    isItin: false,
    llcOrLegalEntity: false,
    occupancy,
    state: loan.property.state,
    // The Loan type has no county field today; using property.city as a proxy
    // is wrong because for loans whose city differs from their county,
    // county_in predicates in doc-engine rules would evaluate against the
    // city name and quietly miss the rule. Pass an empty string so
    // county-scoped predicates fail to match — the safer "fail closed"
    // behavior until proper county data is plumbed through ingestion
    // (deferred F2; Codex P2 follow-up).
    county: "",
    usCredit: true,
    program: loan.nqmProgram,
    // ── PC v2 additions ──
    repFico: loan.credit.repScore ?? undefined,
    ltv: loan.transaction.ltv,
    loanAmount: loan.transaction.loanAmount,
    loanPurpose,
    propertyType: loan.property.propertyType,
    dti: loan.qualifying.totalDti,
    reservesMonths: loan.assets.reservesMonths,
    noteRate: loan.transaction.noteRate,
  };
}
