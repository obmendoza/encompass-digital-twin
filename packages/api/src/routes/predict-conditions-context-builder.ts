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
  return {
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
  };
}
