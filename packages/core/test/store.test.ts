import { describe, expect, it } from "vitest";
import { createStore } from "../src/store.js";
import type { Scenario, Loan } from "../src/types.js";

function loan(id = "2501000001"): Loan {
  return {
    id, nqmProgram: "BankStatement12", qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "B", ssnMasked: "x", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "", city: "", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: { loanPurpose: "Purchase", loanAmount: 400000, appraisedValue: 500000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3000 },
    qualifying: { housingRatio: 25, totalDti: 38, piPayment: 2660, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "BankStatementDeposits", derivedMonthlyIncome: 12000 },
    income: { totalMonthlyIncome: 12000 },
    assets: { totalLiquid: 80000, totalRetirement: 0, reservesMonths: 6 },
    credit: { repScore: 720, tradelinesOpen: 5, tradelinesTotal: 8, tradelines: [], liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 } },
    appraisal: {
      appraisalDate: "2026-04-01", appraiserName: "Test Appraiser",
      appraisalType: "Full", appraisedValue: 500000,
      marketCondition: "Stable", neighborhoodRating: "Good",
      siteArea: "0.25 acres", grossLivingArea: 1800,
      roomCount: 7, bedroomCount: 3, bathroomCount: 2, garageSpaces: 2,
      condition: "Good", comparables: [],
    },
    conditions: [], decision: "pending", milestones: [],
    compliance: {
      qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false,
      higherPricedCoveredTransaction: false, stateLicenseRequired: false,
      stateHighCostTest: "Pass", tridToleranceCure: "None",
      totalPointsAndFees: 2500, pointsAndFeesThreshold: 4000, pointsAndFeesPass: true,
      flags: [],
    },
    overlay: {
      programName: "Test Program", investorName: "Test Investor",
      maxLTV: 90, minFICO: 660, maxDTI: 50, minDSCR: null, minReserves: 6,
      checks: [],
    },
  };
}

const scs: Record<string, Scenario> = {
  happy: { id: "happy", name: "Happy", description: "", loan: loan() },
};

describe("store", () => {
  it("dispatch applies actions and exposes new state", () => {
    const store = createStore({
      scenarios: scs,
      now: () => "2026-04-11T12:00:00.000Z",
    });
    store.dispatch({ type: "LoadScenario", scenarioId: "happy" });
    expect(store.getState().loans["2501000001"]).toBeDefined();
    expect(store.listScenarios()).toHaveLength(1);
  });

  it("getLoan returns the current loan snapshot", () => {
    const store = createStore({ scenarios: scs, now: () => "t" });
    store.dispatch({ type: "LoadScenario", scenarioId: "happy" });
    expect(store.getLoan("2501000001")?.id).toBe("2501000001");
  });

  it("getAuditLog returns the action log", () => {
    const store = createStore({ scenarios: scs, now: () => "t" });
    store.dispatch({ type: "LoadScenario", scenarioId: "happy" });
    expect(store.getAuditLog()).toHaveLength(1);
  });
});
