import { describe, test, expect } from "vitest";
import { H1_lossPayeeMatch, H2_namedInsuredMatch, H3_propertyAddressMatch } from "../src/services/validators/hoi/rules/identity.js";
import { H4_effectiveDateWindow, H5_term12Months } from "../src/services/validators/hoi/rules/dates.js";
import { H6_premiumPaidInFull, H7_deductibleCap, H8_windHailIncluded, H9_coverageMinimum } from "../src/services/validators/hoi/rules/coverage.js";
import { H10_dscrRentLoss, H11_condoWallsInOrHo6, H12_occupancyMatch } from "../src/services/validators/hoi/rules/conditional.js";
import { F1_floodDeductibleCap, F2_floodCoverageMinimum } from "../src/services/validators/hoi/rules/flood.js";
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000010",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000011",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000012",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000013",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000014",
      floodExtractionId: null,
      loanNumber: "X",
    };
    expect(H1_lossPayeeMatch(ctx).fired).toBe(false);
  });

  test("H1 uses hoiExtractionId in finding evidence when both HOI + Flood IDs present", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, lossPayeeClause: "Wrong Entity LLC", loanNumberOnPolicy: "X" },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d-h", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-0000000000aa",
      floodExtractionId: "00000000-0000-0000-0000-0000000000bb",
      loanNumber: "X",
    };
    const r = H1_lossPayeeMatch(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.evidence.extractionId).toBe("00000000-0000-0000-0000-0000000000aa");
  });
});

describe("H2: hoi.named-insured.match", () => {
  test("named-insured matches borrowerFullName → pass", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, namedInsured: "Chad D. Clark" },
      flood: null,
      loan: { ...baseLoan, borrowerFullName: "Chad D Clark" },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000020",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000021",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000022",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000023",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000030",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000031",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000032",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000033",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000040",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000041",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000042",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000043",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000044",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000050",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000051",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000052",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000053",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000060",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000061",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000062",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000063",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000064",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000070",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000071",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000072",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000073",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000080",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000081",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000082",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000083",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000084",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000090",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000091",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000092",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000093",
      floodExtractionId: null,
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
      hoiExtractionId: "00000000-0000-0000-0000-000000000094",
      floodExtractionId: null,
      loanNumber: "X",
    };
    expect(H9_coverageMinimum(ctx).fired).toBe(false);
  });
});

describe("H10: hoi.dscr.rent-loss-coverage", () => {
  const dscrLoan = { ...baseLoan, incomeDocType: "DSCR > 1.15%" };
  const hoiDoc = { tenantId: "t", loanId: "l", documentId: "d-h", category: "hoi-policy" as const, storageUrl: "x" };

  test("DSCR, rentLossCoverageMonths=6, rentLossActualCostSustained=null → skip (pass)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, rentLossCoverageMonths: 6, rentLossActualCostSustained: null },
      flood: null,
      loan: dscrLoan,
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000100",
      floodExtractionId: null,
      loanNumber: "X",
    };
    expect(H10_dscrRentLoss(ctx).fired).toBe(false);
  });

  test("DSCR, rentLossCoverageMonths=3 → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, rentLossCoverageMonths: 3, rentLossActualCostSustained: null },
      flood: null,
      loan: dscrLoan,
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000101",
      floodExtractionId: null,
      loanNumber: "X",
    };
    const r = H10_dscrRentLoss(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.dscr.rent-loss-coverage");
  });

  test("DSCR, rentLossActualCostSustained={detected:true, confidence:0.9}, rentLossCoverageMonths=6 → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, rentLossCoverageMonths: 6, rentLossActualCostSustained: { detected: true, confidence: 0.9 } },
      flood: null,
      loan: dscrLoan,
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000102",
      floodExtractionId: null,
      loanNumber: "X",
    };
    const r = H10_dscrRentLoss(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.dscr.rent-loss-coverage");
  });

  test("non-DSCR loan (incomeDocType='Full Doc') → skip (rule doesn't fire)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, rentLossCoverageMonths: 3, rentLossActualCostSustained: null },
      flood: null,
      loan: { ...baseLoan, incomeDocType: "Full Doc" },
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000103",
      floodExtractionId: null,
      loanNumber: "X",
    };
    expect(H10_dscrRentLoss(ctx).fired).toBe(false);
  });

  test("DSCR, rentLossActualCostSustained={detected:true, confidence:0.5}, rentLossCoverageMonths=6 → warn", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, rentLossCoverageMonths: 6, rentLossActualCostSustained: { detected: true, confidence: 0.5 } },
      flood: null,
      loan: dscrLoan,
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000104",
      floodExtractionId: null,
      loanNumber: "X",
    };
    const r = H10_dscrRentLoss(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("warn");
    expect(r.finding?.ruleId).toBe("hoi.dscr.rent-loss-coverage");
  });
});

describe("H11: hoi.condo.walls-in-or-ho6", () => {
  const condoLoan = { ...baseLoan, propertyType: "Condo" };
  const hoiDoc = { tenantId: "t", loanId: "l", documentId: "d-h", category: "hoi-policy" as const, storageUrl: "x" };

  test("Condo, wallsInCoverage={included:true, confidence:0.9} → skip (pass)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, wallsInCoverage: { included: true, confidence: 0.9 }, ho6Policy: null },
      flood: null,
      loan: condoLoan,
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000110",
      floodExtractionId: null,
      loanNumber: "X",
    };
    expect(H11_condoWallsInOrHo6(ctx).fired).toBe(false);
  });

  test("Condo, wallsInCoverage={included:false, confidence:0.9}, no HO6 → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, wallsInCoverage: { included: false, confidence: 0.9 }, ho6Policy: null },
      flood: null,
      loan: condoLoan,
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000111",
      floodExtractionId: null,
      loanNumber: "X",
    };
    const r = H11_condoWallsInOrHo6(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.condo.walls-in-or-ho6");
  });

  test("Condo, wallsInCoverage=null, ho6Policy={present:true, deductiblePct:0.06, coverageAmount:100000} → fail (HO6 deductible > 5%)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, wallsInCoverage: null, ho6Policy: { present: true, deductiblePct: 0.06, coverageAmount: 100000 } },
      flood: null,
      loan: condoLoan,
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000112",
      floodExtractionId: null,
      loanNumber: "X",
    };
    const r = H11_condoWallsInOrHo6(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.condo.walls-in-or-ho6");
  });

  test("non-Condo (propertyType='Detached') → skip (rule doesn't fire)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, wallsInCoverage: null, ho6Policy: null },
      flood: null,
      loan: { ...baseLoan, propertyType: "Detached" },
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000113",
      floodExtractionId: null,
      loanNumber: "X",
    };
    expect(H11_condoWallsInOrHo6(ctx).fired).toBe(false);
  });
});

describe("H12: hoi.occupancy.match", () => {
  const dscrLoan = { ...baseLoan, incomeDocType: "DSCR > 1.15%" };
  const hoiDoc = { tenantId: "t", loanId: "l", documentId: "d-h", category: "hoi-policy" as const, storageUrl: "x" };

  test("DSCR loan, occupancyOnPolicy='Investment' → skip (pass)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, occupancyOnPolicy: "Investment" },
      flood: null,
      loan: dscrLoan,
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000120",
      floodExtractionId: null,
      loanNumber: "X",
    };
    expect(H12_occupancyMatch(ctx).fired).toBe(false);
  });

  test("DSCR loan, occupancyOnPolicy='Primary' → fail (DSCR != Primary)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, occupancyOnPolicy: "Primary" },
      flood: null,
      loan: dscrLoan,
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000121",
      floodExtractionId: null,
      loanNumber: "X",
    };
    const r = H12_occupancyMatch(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.occupancy.match");
  });

  test("non-DSCR, occupancy='primary', occupancyOnPolicy='Primary Residence' → skip (pass; case-insensitive)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, occupancyOnPolicy: "Primary Residence" },
      flood: null,
      loan: { ...baseLoan, occupancy: "primary", incomeDocType: "Full Doc" },
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000122",
      floodExtractionId: null,
      loanNumber: "X",
    };
    expect(H12_occupancyMatch(ctx).fired).toBe(false);
  });

  test("non-DSCR, occupancy='primary', occupancyOnPolicy='Investment' → fail (mismatch)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, occupancyOnPolicy: "Investment" },
      flood: null,
      loan: { ...baseLoan, occupancy: "primary", incomeDocType: "Full Doc" },
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000123",
      floodExtractionId: null,
      loanNumber: "X",
    };
    const r = H12_occupancyMatch(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.occupancy.match");
  });

  test("H12 non-DSCR with capitalized 'Primary' occupancy + Investment policy → fail (case-insensitive)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, occupancyOnPolicy: "Investment" },
      flood: null,
      loan: { ...baseLoan, occupancy: "Primary" as never },
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000040",
      floodExtractionId: null,
      loanNumber: "X",
    };
    const r = H12_occupancyMatch(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
  });

  test("H12 non-DSCR with all-caps 'PRIMARY' occupancy + Investment policy → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, occupancyOnPolicy: "Investment" },
      flood: null,
      loan: { ...baseLoan, occupancy: "PRIMARY" as never },
      documents: { hoi: hoiDoc, floodCert: null },
      hoiExtractionId: "00000000-0000-0000-0000-000000000041",
      floodExtractionId: null,
      loanNumber: "X",
    };
    const r = H12_occupancyMatch(ctx);
    expect(r.fired).toBe(true);
  });
});

const baseFloodExtraction = {
  carrier: null, policyNumber: null, namedInsured: null, propertyAddress: null,
  effectiveDate: null, expirationDate: null, termMonths: null,
  floodZone: null, floodCoverage: null, floodDeductible: null,
  isNfip: null, nfipMaxApplied: null, evidence: [],
};

const baseFloodDoc = {
  tenantId: "t", loanId: "l", documentId: "df", category: "flood-cert" as const, storageUrl: "x",
};

describe("F1: flood.deductible.cap", () => {
  test("SFR, floodDeductible=8000 → skip (≤ $10K cap, pass)", () => {
    const ctx: RuleContext = {
      hoi: null,
      flood: { ...baseFloodExtraction, floodDeductible: 8_000 },
      loan: { ...baseLoan, propertyType: "SFR" },
      documents: { hoi: null, floodCert: baseFloodDoc },
      hoiExtractionId: null,
      floodExtractionId: "00000000-0000-0000-0000-000000000200",
      loanNumber: "X",
    };
    expect(F1_floodDeductibleCap(ctx).fired).toBe(false);
  });

  test("SFR, floodDeductible=12000 → fail (> $10K cap)", () => {
    const ctx: RuleContext = {
      hoi: null,
      flood: { ...baseFloodExtraction, floodDeductible: 12_000 },
      loan: { ...baseLoan, propertyType: "SFR" },
      documents: { hoi: null, floodCert: baseFloodDoc },
      hoiExtractionId: null,
      floodExtractionId: "00000000-0000-0000-0000-000000000201",
      loanNumber: "X",
    };
    const r = F1_floodDeductibleCap(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("flood.deductible.cap");
  });

  test("Condo, floodDeductible=22000 → skip (≤ $25K cap, pass)", () => {
    const ctx: RuleContext = {
      hoi: null,
      flood: { ...baseFloodExtraction, floodDeductible: 22_000 },
      loan: { ...baseLoan, propertyType: "Condo" },
      documents: { hoi: null, floodCert: baseFloodDoc },
      hoiExtractionId: null,
      floodExtractionId: "00000000-0000-0000-0000-000000000202",
      loanNumber: "X",
    };
    expect(F1_floodDeductibleCap(ctx).fired).toBe(false);
  });

  test("Condo, floodDeductible=30000 → fail (> $25K cap)", () => {
    const ctx: RuleContext = {
      hoi: null,
      flood: { ...baseFloodExtraction, floodDeductible: 30_000 },
      loan: { ...baseLoan, propertyType: "Condo" },
      documents: { hoi: null, floodCert: baseFloodDoc },
      hoiExtractionId: null,
      floodExtractionId: "00000000-0000-0000-0000-000000000203",
      loanNumber: "X",
    };
    const r = F1_floodDeductibleCap(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("flood.deductible.cap");
  });

  test("no flood-cert (ctx.flood=null) → skip", () => {
    const ctx: RuleContext = {
      hoi: null,
      flood: null,
      loan: { ...baseLoan, propertyType: "SFR" },
      documents: { hoi: null, floodCert: null },
      hoiExtractionId: null,
      floodExtractionId: "00000000-0000-0000-0000-000000000204",
      loanNumber: "X",
    };
    expect(F1_floodDeductibleCap(ctx).fired).toBe(false);
  });

  test("F1 uses floodExtractionId in finding evidence when both HOI + Flood IDs present", () => {
    const ctx: RuleContext = {
      hoi: null,
      flood: { ...baseFloodExtraction, floodDeductible: 12000 },
      loan: baseLoan,
      documents: { hoi: null, floodCert: baseFloodDoc },
      hoiExtractionId: "00000000-0000-0000-0000-0000000000aa",
      floodExtractionId: "00000000-0000-0000-0000-0000000000bb",
      loanNumber: "X",
    };
    const r = F1_floodDeductibleCap(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.evidence.extractionId).toBe("00000000-0000-0000-0000-0000000000bb");
  });
});

describe("F2: flood.coverage.minimum", () => {
  test("floodCoverage=250000, loanAmount=200000, replacementCost=300000, SFR → skip (≥ min(200K,300K,250K)=200K, pass)", () => {
    const ctx: RuleContext = {
      hoi: null,
      flood: { ...baseFloodExtraction, floodCoverage: 250_000 },
      loan: { ...baseLoan, propertyType: "SFR", loanAmount: 200_000, replacementCost: 300_000 },
      documents: { hoi: null, floodCert: baseFloodDoc },
      hoiExtractionId: null,
      floodExtractionId: "00000000-0000-0000-0000-000000000210",
      loanNumber: "X",
    };
    expect(F2_floodCoverageMinimum(ctx).fired).toBe(false);
  });

  test("floodCoverage=100000, loanAmount=200000, SFR → fail (below min)", () => {
    const ctx: RuleContext = {
      hoi: null,
      flood: { ...baseFloodExtraction, floodCoverage: 100_000 },
      loan: { ...baseLoan, propertyType: "SFR", loanAmount: 200_000 },
      documents: { hoi: null, floodCert: baseFloodDoc },
      hoiExtractionId: null,
      floodExtractionId: "00000000-0000-0000-0000-000000000211",
      loanNumber: "X",
    };
    const r = F2_floodCoverageMinimum(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("flood.coverage.minimum");
  });

  test("no flood-cert → skip", () => {
    const ctx: RuleContext = {
      hoi: null,
      flood: null,
      loan: { ...baseLoan, propertyType: "SFR", loanAmount: 200_000 },
      documents: { hoi: null, floodCert: null },
      hoiExtractionId: null,
      floodExtractionId: "00000000-0000-0000-0000-000000000212",
      loanNumber: "X",
    };
    expect(F2_floodCoverageMinimum(ctx).fired).toBe(false);
  });

  test("flood-cert present but floodCoverage=null → skip", () => {
    const ctx: RuleContext = {
      hoi: null,
      flood: { ...baseFloodExtraction, floodCoverage: null },
      loan: { ...baseLoan, propertyType: "SFR", loanAmount: 200_000 },
      documents: { hoi: null, floodCert: baseFloodDoc },
      hoiExtractionId: null,
      floodExtractionId: "00000000-0000-0000-0000-000000000213",
      loanNumber: "X",
    };
    expect(F2_floodCoverageMinimum(ctx).fired).toBe(false);
  });
});
