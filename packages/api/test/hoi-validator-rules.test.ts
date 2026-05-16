import { describe, test, expect } from "vitest";
import { H1_lossPayeeMatch } from "../src/services/validators/hoi/rules/identity.js";
import type { RuleContext } from "../src/services/validators/hoi/rules/types.js";

const baseExtraction = {
  carrier: null, policyNumber: null, namedInsured: null, propertyAddress: null,
  effectiveDate: null, expirationDate: null, termMonths: null,
  lossPayeeClause: null, loanNumberOnPolicy: null,
  coverageAmount: null, replacementCost: null,
  deductiblePct: null, deductibleAmount: null,
  windHailHurricane: null, rentLossCoverageMonths: null, rentLossWording: null,
  rentLossActualCostSustained: null, occupancyOnPolicy: null,
  premiumPaidInFull: null, premiumDueDays: null,
  wallsInCoverage: null, ho6Policy: null, evidence: [],
};

const baseLoan = {
  incomeDocType: "Full Doc", borrowerType: "W2" as const, citizenship: "US Citizen" as const,
  isItin: false, llcOrLegalEntity: false, occupancy: "primary" as const,
  state: "TX", county: "Travis", usCredit: true, program: "FLEX",
  channel: "Wholesale" as const,
};

describe("H1: hoi.loss-payee.match", () => {
  test("Wholesale TX with correct NQM clause + loan number → pass", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, lossPayeeClause: "NQM Funding, LLC, 4800 N Federal Hwy, Bldg. E, Suite 200, Boca Raton, FL 33431", loanNumberOnPolicy: "92010207238" },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d-h", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000010",
      loanNumber: "92010207238",
    };
    expect(H1_lossPayeeMatch(ctx).fired).toBe(false);
  });

  test("Wholesale NY uses Great Home Mortgage clause → pass", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, lossPayeeClause: "Great Home Mortgage of New York, in lieu of true name NP, Inc. ISAOA/ATIMA", loanNumberOnPolicy: "X1" },
      flood: null,
      loan: { ...baseLoan, state: "NY" },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000011",
      loanNumber: "X1",
    };
    expect(H1_lossPayeeMatch(ctx).fired).toBe(false);
  });

  test("Wholesale TX with wrong entity name → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, lossPayeeClause: "NQM Funding Group, LLC", loanNumberOnPolicy: "X" },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000012",
      loanNumber: "X",
    };
    const r = H1_lossPayeeMatch(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.loss-payee.match");
  });

  test("NDC channel without lenderName → no-op (skip)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, lossPayeeClause: "Some Lender", loanNumberOnPolicy: "X" },
      flood: null,
      loan: { ...baseLoan, channel: "NDC" as const },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000013",
      loanNumber: "X",
    };
    expect(H1_lossPayeeMatch(ctx).fired).toBe(false);
  });

  test("missing lossPayeeClause → skip", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, lossPayeeClause: null },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000014",
      loanNumber: "X",
    };
    expect(H1_lossPayeeMatch(ctx).fired).toBe(false);
  });
});
