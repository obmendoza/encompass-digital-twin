import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import { ActionError } from "../src/errors.js";
import type { Actor, Loan, Scenario, WorldState } from "../src/types.js";

const now = () => "2026-04-22T12:00:00.000Z";
const actor: Actor = { kind: "human", id: "admin" };

function loan(): Loan {
  return {
    id: "A1", nqmProgram: "BankStatement12", qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "B", ssnMasked: "x", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "", city: "", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: { loanPurpose: "Purchase", loanAmount: 400000, appraisedValue: 500000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3000 },
    qualifying: { housingRatio: 25, totalDti: 38, piPayment: 2660, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "BankStatementDeposits", derivedMonthlyIncome: 12000 },
    income: { totalMonthlyIncome: 12000 },
    assets: { totalLiquid: 80000, totalRetirement: 0, reservesMonths: 26.7 },
    credit: { repScore: 720, tradelinesOpen: 5, tradelinesTotal: 8,
      tradelines: [], liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 } },
    conditions: [], documents: [], decision: "pending", milestones: [],
    appraisal: { appraisalDate: "2026-04-01", appraiserName: "T", appraisalType: "Full",
      appraisedValue: 500000, marketCondition: "Stable", neighborhoodRating: "Good",
      siteArea: "0.25", grossLivingArea: 1800, roomCount: 7, bedroomCount: 3,
      bathroomCount: 2, garageSpaces: 2, condition: "Good", comparables: [] },
    compliance: { qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false,
      higherPricedCoveredTransaction: false, stateLicenseRequired: false,
      stateHighCostTest: "Pass", tridToleranceCure: "None",
      totalPointsAndFees: 2500, pointsAndFeesThreshold: 4000, pointsAndFeesPass: true, flags: [] },
    overlay: { programName: "Test", investorName: "Test", maxLTV: 90, minFICO: 660,
      maxDTI: 50, minDSCR: null, minReserves: 6, checks: [] },
  };
}

function preload(): WorldState {
  const sc: Record<string, Scenario> = { s: { id: "s", name: "s", description: "", loan: loan() } };
  return reduce({ scenarioId: null, loans: {}, actionLog: [], now },
    { type: "LoadScenario", scenarioId: "s" }, (k) => sc[k]);
}

describe("reduce — loan assignment", () => {
  it("AssignLoan sets assignment with queued status", () => {
    const s = preload();
    const next = reduce(s, { type: "AssignLoan", loanId: "A1", assignedTo: "va@test.com", priority: "normal", actor }, () => undefined);
    expect(next.loans.A1!.assignment).toBeDefined();
    expect(next.loans.A1!.assignment!.assignedTo).toBe("va@test.com");
    expect(next.loans.A1!.assignment!.status).toBe("queued");
    expect(next.loans.A1!.assignment!.priority).toBe("normal");
  });

  it("UpdateAssignmentStatus changes status", () => {
    let s = preload();
    s = reduce(s, { type: "AssignLoan", loanId: "A1", assignedTo: "va@test.com", priority: "high", actor }, () => undefined);
    const next = reduce(s, { type: "UpdateAssignmentStatus", loanId: "A1", status: "in_progress", actor }, () => undefined);
    expect(next.loans.A1!.assignment!.status).toBe("in_progress");
  });

  it("UpdateAssignmentStatus on unassigned loan throws", () => {
    const s = preload();
    expect(() => reduce(s, { type: "UpdateAssignmentStatus", loanId: "A1", status: "in_progress", actor }, () => undefined))
      .toThrowError(ActionError);
  });

  it("UnassignLoan clears assignment", () => {
    let s = preload();
    s = reduce(s, { type: "AssignLoan", loanId: "A1", assignedTo: "va@test.com", priority: "normal", actor }, () => undefined);
    const next = reduce(s, { type: "UnassignLoan", loanId: "A1", actor }, () => undefined);
    expect(next.loans.A1!.assignment).toBeUndefined();
  });
});
