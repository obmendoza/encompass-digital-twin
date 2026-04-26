import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import type { Loan, WorldState } from "../src/types.js";

const now = () => "2026-04-16T12:00:00.000Z";

// Minimal loan for injection test — must have ALL required fields
function customLoan(): Loan {
  return {
    id: "CUSTOM-001",
    tenantId: "test-tenant",
    nqmProgram: "DSCR",
    qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "Test, Custom", ssnMasked: "xxx-xx-9999", dob: "1990-01-01", maritalStatus: "Unmarried" },
    property: { street: "1 Custom St", city: "Test", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2005 },
    transaction: { loanPurpose: "Purchase", loanAmount: 350000, salesPrice: 450000, appraisedValue: 450000,
      ltv: 78, cltv: 78, hcltv: 78, noteRate: 7.5, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, rentalIncome: 3000, pitia: 2800, dscrRatio: 1.07, piti: 2800 },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2400, qualifyingRate: 7.5 },
    qualifyingWorksheet: { method: "DSCRCoverage", dscrNumerator: 3000, dscrDenominator: 2800, derivedMonthlyIncome: 3000 },
    income: { totalMonthlyIncome: 0 },
    assets: { totalLiquid: 60000, totalRetirement: 0, reservesMonths: 6 },
    credit: { repScore: 720, tradelinesOpen: 5, tradelinesTotal: 8,
      tradelines: [], liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 } },
    conditions: [], documents: [], decision: "pending", milestones: [],
    appraisal: { appraisalDate: "2026-04-01", appraiserName: "T", appraisalType: "Full",
      appraisedValue: 450000, marketCondition: "Stable", neighborhoodRating: "Good",
      siteArea: "0.2", grossLivingArea: 1600, roomCount: 6, bedroomCount: 3,
      bathroomCount: 2, garageSpaces: 1, condition: "Good", comparables: [] },
    compliance: { qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false,
      higherPricedCoveredTransaction: false, stateLicenseRequired: false,
      stateHighCostTest: "Pass", tridToleranceCure: "None",
      totalPointsAndFees: 2500, pointsAndFeesThreshold: 4000, pointsAndFeesPass: true, flags: [] },
    overlay: { programName: "Test", investorName: "Test", maxLTV: 80, minFICO: 660,
      maxDTI: null, minDSCR: 0.75, minReserves: 6, checks: [] },
  };
}

describe("reduce — InjectLoan", () => {
  it("adds a custom loan to the world", () => {
    const init: WorldState = { scenarioId: null, loans: {}, actionLog: [], now };
    const next = reduce(init, { type: "InjectLoan", loan: customLoan() }, () => undefined);
    expect(next.loans["CUSTOM-001"]).toBeDefined();
    expect(next.loans["CUSTOM-001"]!.nqmProgram).toBe("DSCR");
    expect(next.actionLog).toHaveLength(1);
  });

  it("adds alongside existing loans without replacing", () => {
    const init: WorldState = { scenarioId: null, loans: {
      "EXISTING-001": { ...customLoan(), id: "EXISTING-001" },
    }, actionLog: [], now };
    const next = reduce(init, { type: "InjectLoan", loan: customLoan() }, () => undefined);
    expect(Object.keys(next.loans)).toHaveLength(2);
  });

  it("rejects InjectLoan without tenantId", () => {
    const init: WorldState = { scenarioId: null, loans: {}, actionLog: [], now };
    const loanWithoutTenant = { ...customLoan(), tenantId: undefined };
    expect(() =>
      reduce(init, { type: "InjectLoan", loan: loanWithoutTenant }, () => undefined),
    ).toThrow("InjectLoan requires tenantId");
  });
});
