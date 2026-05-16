import { describe, test, expect } from "vitest";
import {
  HoiPolicyFieldsSchema,
  FloodCertFieldsSchema,
  ValidationFindingSchema,
  HOI_SCHEMA_VERSION,
} from "../src/hoi-extraction-schemas.js";

describe("HOI extraction schemas", () => {
  test("HoiPolicyFieldsSchema accepts a minimal valid extraction with nulls", () => {
    const minimal = {
      carrier: null, policyNumber: null, namedInsured: null,
      propertyAddress: null, effectiveDate: null, expirationDate: null,
      termMonths: null, lossPayeeClause: null, loanNumberOnPolicy: null,
      coverageAmount: null, replacementCost: null,
      deductiblePct: null, deductibleAmount: null,
      windHailHurricane: null, rentLossCoverageMonths: null,
      rentLossWording: null, rentLossActualCostSustained: null,
      occupancyOnPolicy: null, premiumPaidInFull: null, premiumDueDays: null,
      wallsInCoverage: null, ho6Policy: null, evidence: [],
    };
    expect(HoiPolicyFieldsSchema.parse(minimal)).toEqual(minimal);
  });

  test("HoiPolicyFieldsSchema enforces per-field confidence on prose-derived booleans", () => {
    const wh = { included: true, wording: "all perils included", separatePolicy: false, confidence: 0.9 };
    expect(HoiPolicyFieldsSchema.shape.windHailHurricane.parse(wh)).toEqual(wh);
    expect(() => HoiPolicyFieldsSchema.shape.windHailHurricane.parse({ ...wh, confidence: 1.5 })).toThrow();
  });

  test("ValidationFindingSchema requires evidence with documentId + extractionId", () => {
    const finding = {
      ruleId: "hoi.loss-payee.match",
      severity: "fail" as const,
      currentValue: "Foo LLC",
      expectedValue: "NQM Funding, LLC",
      evidence: { documentId: "00000000-0000-0000-0000-000000000001", extractionId: "00000000-0000-0000-0000-000000000002", fieldPath: "lossPayeeClause", documentPage: 1 },
    };
    expect(ValidationFindingSchema.parse(finding)).toEqual(finding);
  });

  test("HOI_SCHEMA_VERSION exported as positive int", () => {
    expect(HOI_SCHEMA_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(HOI_SCHEMA_VERSION)).toBe(true);
  });
});
