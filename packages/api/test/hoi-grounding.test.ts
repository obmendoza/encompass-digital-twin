import { describe, test, expect } from "vitest";
import { groundingPass } from "../src/services/validators/hoi/grounding.js";
import type { HoiPolicyFields } from "@twin/core";

function baseHoi(): HoiPolicyFields {
  return {
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
}

describe("groundingPass", () => {
  test("windHailHurricane.included=true with wording 'All perils included' → no override", () => {
    const fields = baseHoi();
    fields.windHailHurricane = { included: true, wording: "All perils included", separatePolicy: false, confidence: 0.9 };
    const r = groundingPass(fields);
    expect(r.fields.windHailHurricane?.confidence).toBe(0.9);
    expect(r.groundingErrors.length).toBe(0);
  });

  test("windHailHurricane.included=true with wording 'Wind and hail excluded' → confidence override to 0.3", () => {
    const fields = baseHoi();
    fields.windHailHurricane = { included: true, wording: "Wind and hail excluded from coverage", separatePolicy: false, confidence: 0.9 };
    const r = groundingPass(fields);
    expect(r.fields.windHailHurricane?.confidence).toBe(0.3);
    expect(r.groundingErrors.length).toBe(1);
    expect(r.groundingErrors[0].field).toBe("windHailHurricane");
  });

  test("windHailHurricane.included=false with wording 'excluded' → no override (correct)", () => {
    const fields = baseHoi();
    fields.windHailHurricane = { included: false, wording: "Wind, hail, and hurricane excluded", separatePolicy: false, confidence: 0.85 };
    const r = groundingPass(fields);
    expect(r.fields.windHailHurricane?.confidence).toBe(0.85);
    expect(r.groundingErrors.length).toBe(0);
  });

  test("rentLossActualCostSustained.detected=true with wording lacking 'actual cost sustained' → override to 0.3", () => {
    const fields = baseHoi();
    fields.rentLossWording = "6 months PITIA rent loss coverage included";
    fields.rentLossActualCostSustained = { detected: true, confidence: 0.85 };
    const r = groundingPass(fields);
    expect(r.fields.rentLossActualCostSustained?.confidence).toBe(0.3);
    expect(r.groundingErrors.length).toBe(1);
    expect(r.groundingErrors[0].field).toBe("rentLossActualCostSustained");
  });

  test("rentLossActualCostSustained.detected=true with wording containing phrase → no override", () => {
    const fields = baseHoi();
    fields.rentLossWording = "Coverage limited to actual cost sustained";
    fields.rentLossActualCostSustained = { detected: true, confidence: 0.9 };
    const r = groundingPass(fields);
    expect(r.fields.rentLossActualCostSustained?.confidence).toBe(0.9);
    expect(r.groundingErrors.length).toBe(0);
  });

  test("returns deep copy — original fields not mutated", () => {
    const fields = baseHoi();
    fields.windHailHurricane = { included: true, wording: "excluded", separatePolicy: false, confidence: 0.9 };
    const r = groundingPass(fields);
    expect(fields.windHailHurricane.confidence).toBe(0.9); // original untouched
    expect(r.fields.windHailHurricane?.confidence).toBe(0.3); // result overridden
  });
});
