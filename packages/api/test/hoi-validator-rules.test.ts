import { describe, test, expect } from "vitest";
import { H1_lossPayeeMatch, H2_namedInsuredMatch, H3_propertyAddressMatch } from "../src/services/validators/hoi/rules/identity.js";
import { H4_effectiveDateWindow, H5_term12Months } from "../src/services/validators/hoi/rules/dates.js";
import { H6_premiumPaidInFull, H7_deductibleCap, H8_windHailIncluded, H9_coverageMinimum } from "../src/services/validators/hoi/rules/coverage.js";
import type { RuleContext } from "../src/services/validators/hoi/rules/types.js";

const DAY = 24 * 60 * 60 * 1000;

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

describe("H2: hoi.named-insured.match", () => {
  test("named-insured matches borrowerFullName → pass", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, namedInsured: "Chad D. Clark" },
      flood: null,
      loan: { ...baseLoan, borrowerFullName: "Chad D Clark" },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000020",
      loanNumber: "X",
    };
    expect(H2_namedInsuredMatch(ctx).fired).toBe(false);
  });

  test("named-insured does not match borrowerFullName → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, namedInsured: "Jane Smith" },
      flood: null,
      loan: { ...baseLoan, borrowerFullName: "Chad D Clark" },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000021",
      loanNumber: "X",
    };
    const r = H2_namedInsuredMatch(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.named-insured.match");
  });

  test("named-insured matches entityName (vested entity) → pass", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, namedInsured: "Sunrise Realty LLC" },
      flood: null,
      loan: { ...baseLoan, llcOrLegalEntity: true, entityName: "Sunrise Realty LLC" },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000022",
      loanNumber: "X",
    };
    expect(H2_namedInsuredMatch(ctx).fired).toBe(false);
  });

  test("missing namedInsured → skip", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, namedInsured: null },
      flood: null,
      loan: { ...baseLoan, borrowerFullName: "Chad D Clark" },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000023",
      loanNumber: "X",
    };
    expect(H2_namedInsuredMatch(ctx).fired).toBe(false);
  });
});

describe("H3: hoi.property-address.match", () => {
  test("all address fields match → pass", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, propertyAddress: { line1: "123 Main St", city: "Austin", state: "TX", zip: "78701" } },
      flood: null,
      loan: { ...baseLoan, subjectPropertyAddress: { line1: "123 Main St", city: "Austin", state: "TX", zip: "78701" } },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000030",
      loanNumber: "X",
    };
    expect(H3_propertyAddressMatch(ctx).fired).toBe(false);
  });

  test("line1 mismatch → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, propertyAddress: { line1: "456 Oak Ave", city: "Austin", state: "TX", zip: "78701" } },
      flood: null,
      loan: { ...baseLoan, subjectPropertyAddress: { line1: "123 Main St", city: "Austin", state: "TX", zip: "78701" } },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000031",
      loanNumber: "X",
    };
    const r = H3_propertyAddressMatch(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.property-address.match");
  });

  test("zip+4 format matches zip-5 only → pass", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, propertyAddress: { line1: "789 Elm Rd", city: "Rockport", state: "TX", zip: "78382-1234" } },
      flood: null,
      loan: { ...baseLoan, subjectPropertyAddress: { line1: "789 Elm Rd", city: "Rockport", state: "TX", zip: "78382" } },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000032",
      loanNumber: "X",
    };
    expect(H3_propertyAddressMatch(ctx).fired).toBe(false);
  });

  test("missing propertyAddress on hoi → skip", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, propertyAddress: null },
      flood: null,
      loan: { ...baseLoan, subjectPropertyAddress: { line1: "123 Main St", city: "Austin", state: "TX", zip: "78701" } },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000033",
      loanNumber: "X",
    };
    expect(H3_propertyAddressMatch(ctx).fired).toBe(false);
  });
});

describe("H4: hoi.effective-date.window", () => {
  const noteDate = "2025-06-01";

  test("Purchase: effectiveDate = noteDate → pass", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, effectiveDate: "2025-06-01" },
      flood: null,
      loan: { ...baseLoan, loanPurpose: "Purchase", noteDate },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000040",
      loanNumber: "X",
    };
    expect(H4_effectiveDateWindow(ctx).fired).toBe(false);
  });

  test("Purchase: effectiveDate too early (>15 days before note) → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, effectiveDate: "2025-05-01" },
      flood: null,
      loan: { ...baseLoan, loanPurpose: "Purchase", noteDate },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000041",
      loanNumber: "X",
    };
    const r = H4_effectiveDateWindow(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.effective-date.window");
  });

  test("Refi: effectiveDate before noteDate → pass", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, effectiveDate: "2025-05-15" },
      flood: null,
      loan: { ...baseLoan, loanPurpose: "Rate & Term Refinance", noteDate },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000042",
      loanNumber: "X",
    };
    expect(H4_effectiveDateWindow(ctx).fired).toBe(false);
  });

  test("Refi: effectiveDate after noteDate → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, effectiveDate: "2025-06-15" },
      flood: null,
      loan: { ...baseLoan, loanPurpose: "Cash-Out Refinance", noteDate },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000043",
      loanNumber: "X",
    };
    const r = H4_effectiveDateWindow(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.effective-date.window");
  });

  test("missing noteDate → skip", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, effectiveDate: "2025-06-01" },
      flood: null,
      loan: { ...baseLoan, loanPurpose: "Purchase" },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000044",
      loanNumber: "X",
    };
    expect(H4_effectiveDateWindow(ctx).fired).toBe(false);
  });
});

describe("H5: hoi.term.12-months", () => {
  test("termMonths = 12 → pass", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, termMonths: 12 },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000050",
      loanNumber: "X",
    };
    expect(H5_term12Months(ctx).fired).toBe(false);
  });

  test("termMonths = 24 → pass", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, termMonths: 24 },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000051",
      loanNumber: "X",
    };
    expect(H5_term12Months(ctx).fired).toBe(false);
  });

  test("termMonths = 6 → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, termMonths: 6 },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000052",
      loanNumber: "X",
    };
    const r = H5_term12Months(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.term.12-months");
  });

  test("termMonths = null → skip", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, termMonths: null },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000053",
      loanNumber: "X",
    };
    expect(H5_term12Months(ctx).fired).toBe(false);
  });
});

describe("H6: hoi.premium.paid-in-full", () => {
  // Clock-safe relative closing date for the refi test (case 4).
  // premiumDueDays=30 means dueBy = Date.now() + 30d; closingDate is also +30d from now,
  // so dueBy ≈ close, which is always within ±60d.
  const closingDate = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);

  test("paid=true, confidence=0.9 → pass (fired: false)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, premiumPaidInFull: { paid: true, confidence: 0.9 } },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000060",
      loanNumber: "X",
    };
    expect(H6_premiumPaidInFull(ctx).fired).toBe(false);
  });

  test("paid=false, confidence=0.9, Purchase → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, premiumPaidInFull: { paid: false, confidence: 0.9 } },
      flood: null,
      loan: { ...baseLoan, loanPurpose: "Purchase" },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000061",
      loanNumber: "X",
    };
    const r = H6_premiumPaidInFull(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.premium.paid-in-full");
  });

  test("paid=true, confidence=0.5, Purchase → warn (low-confidence paid claim)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, premiumPaidInFull: { paid: true, confidence: 0.5 } },
      flood: null,
      loan: { ...baseLoan, loanPurpose: "Purchase" },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000062",
      loanNumber: "X",
    };
    const r = H6_premiumPaidInFull(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("warn");
    expect(r.finding?.ruleId).toBe("hoi.premium.paid-in-full");
  });

  test("Refi, paid=false, confidence=0.9, premium due within 60d of closing → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, premiumPaidInFull: { paid: false, confidence: 0.9 }, premiumDueDays: 30 },
      flood: null,
      loan: { ...baseLoan, loanPurpose: "Rate & Term Refinance", closingDate },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000063",
      loanNumber: "X",
    };
    const r = H6_premiumPaidInFull(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.premium.paid-in-full");
  });

  test("premiumPaidInFull=null → skip (fired: false)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, premiumPaidInFull: null },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000064",
      loanNumber: "X",
    };
    expect(H6_premiumPaidInFull(ctx).fired).toBe(false);
  });
});

describe("H7: hoi.deductible.cap", () => {
  test("deductiblePct=0.045 (4.5%) → pass (fired: false)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, deductiblePct: 0.045 },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000070",
      loanNumber: "X",
    };
    expect(H7_deductibleCap(ctx).fired).toBe(false);
  });

  test("deductiblePct=0.05 (exactly 5%) → pass (boundary, fired: false)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, deductiblePct: 0.05 },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000071",
      loanNumber: "X",
    };
    expect(H7_deductibleCap(ctx).fired).toBe(false);
  });

  test("deductiblePct=0.06 (6%) → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, deductiblePct: 0.06 },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000072",
      loanNumber: "X",
    };
    const r = H7_deductibleCap(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.deductible.cap");
    expect(r.finding?.currentValue).toBe("6.00%");
  });

  test("deductiblePct=null → skip (fired: false)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, deductiblePct: null },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000073",
      loanNumber: "X",
    };
    expect(H7_deductibleCap(ctx).fired).toBe(false);
  });
});

describe("H8: hoi.wind-hail-hurricane.included", () => {
  test("included=true, confidence=0.9 → pass (fired: false)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, windHailHurricane: { included: true, wording: null, separatePolicy: false, confidence: 0.9 } },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000080",
      loanNumber: "X",
    };
    expect(H8_windHailIncluded(ctx).fired).toBe(false);
  });

  test("included=false, confidence=0.9 → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, windHailHurricane: { included: false, wording: "excluded", separatePolicy: false, confidence: 0.9 } },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000081",
      loanNumber: "X",
    };
    const r = H8_windHailIncluded(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.wind-hail-hurricane.included");
  });

  test("included=true, confidence=0.5 (low-conf claim) → warn", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, windHailHurricane: { included: true, wording: null, separatePolicy: false, confidence: 0.5 } },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000082",
      loanNumber: "X",
    };
    const r = H8_windHailIncluded(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("warn");
    expect(r.finding?.ruleId).toBe("hoi.wind-hail-hurricane.included");
  });

  test("windHailHurricane=null → skip (fired: false)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, windHailHurricane: null },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000083",
      loanNumber: "X",
    };
    expect(H8_windHailIncluded(ctx).fired).toBe(false);
  });

  test("confidence below skip threshold (0.3) → skip even if excluded", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, windHailHurricane: { included: false, wording: null, separatePolicy: false, confidence: 0.3 } },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000084",
      loanNumber: "X",
    };
    expect(H8_windHailIncluded(ctx).fired).toBe(false);
  });
});

describe("H9: hoi.coverage.minimum", () => {
  test("coverageAmount >= loanAmount (no replacementCost) → pass", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, coverageAmount: 400_000 },
      flood: null,
      loan: { ...baseLoan, loanAmount: 350_000 },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000090",
      loanNumber: "X",
    };
    expect(H9_coverageMinimum(ctx).fired).toBe(false);
  });

  test("coverageAmount >= min(loanAmount, replacementCost) on hoi → pass", () => {
    // min(350_000, 320_000) = 320_000; coverageAmount=320_000 exactly meets required
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, coverageAmount: 320_000, replacementCost: 320_000 },
      flood: null,
      loan: { ...baseLoan, loanAmount: 350_000 },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000091",
      loanNumber: "X",
    };
    expect(H9_coverageMinimum(ctx).fired).toBe(false);
  });

  test("coverageAmount below loanAmount → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, coverageAmount: 200_000 },
      flood: null,
      loan: { ...baseLoan, loanAmount: 350_000 },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000092",
      loanNumber: "X",
    };
    const r = H9_coverageMinimum(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.coverage.minimum");
  });

  test("coverageAmount null → skip", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, coverageAmount: null },
      flood: null,
      loan: { ...baseLoan, loanAmount: 350_000 },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000093",
      loanNumber: "X",
    };
    expect(H9_coverageMinimum(ctx).fired).toBe(false);
  });

  test("loanAmount missing → skip", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, coverageAmount: 200_000 },
      flood: null,
      loan: { ...baseLoan },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000094",
      loanNumber: "X",
    };
    expect(H9_coverageMinimum(ctx).fired).toBe(false);
  });
});
