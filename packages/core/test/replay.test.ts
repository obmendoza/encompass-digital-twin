import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import type { Action, Actor, Loan, Scenario, WorldState } from "../src/types.js";

const now = () => "2026-04-11T12:00:00.000Z";
const actor: Actor = { kind: "agent", id: "replay-bot" };

function loan(): Loan {
  return {
    id: "R1",
    nqmProgram: "DSCR", qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "B", ssnMasked: "x", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "", city: "", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: { loanPurpose: "Purchase", loanAmount: 400000, appraisedValue: 500000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, piti: 3200 },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2660, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "DSCRCoverage", derivedMonthlyIncome: 0 },
    income: { totalMonthlyIncome: 0 },
    assets: { totalLiquid: 80000, totalRetirement: 0, reservesMonths: 6 },
    credit: { repScore: 740, tradelinesOpen: 5, tradelinesTotal: 8, tradelines: [], liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 } },
    appraisal: {
      appraisalDate: "2026-04-01", appraiserName: "Test Appraiser",
      appraisalType: "Full", appraisedValue: 500000,
      marketCondition: "Stable", neighborhoodRating: "Good",
      siteArea: "0.25 acres", grossLivingArea: 1800,
      roomCount: 7, bedroomCount: 3, bathroomCount: 2, garageSpaces: 2,
      condition: "Good", comparables: [],
    },
    conditions: [], decision: "pending", milestones: [],
  };
}

describe("replay invariant", () => {
  it("replaying the action log from empty state yields identical world state", () => {
    const scs: Record<string, Scenario> = { s: { id: "s", name: "s", description: "", loan: loan() } };
    const resolve = (k: string) => scs[k];

    const init: WorldState = { scenarioId: null, loans: {}, actionLog: [], now };
    const script: Action[] = [
      { type: "LoadScenario", scenarioId: "s" },
      { type: "OpenLoan", loanId: "R1", actor },
      { type: "AddCondition", loanId: "R1", condition: { category: "PTD", source: "UW", description: "Bank stmt (12mo)" }, actor },
      { type: "AddCondition", loanId: "R1", condition: { category: "PTF", source: "Compliance", description: "HOI" }, actor },
      { type: "ClearCondition", loanId: "R1", conditionId: "c1", notes: "ok", actor },
      { type: "SetDecision", loanId: "R1", decision: "approved", rationale: "DSCR ≥ 1.0", actor },
    ];

    const driven = script.reduce((s, a) => reduce(s, a, resolve), init);
    const replayed = driven.actionLog
      .map((e) => e.action)
      .reduce((s, a) => reduce(s, a, resolve), init);

    expect(replayed.loans).toEqual(driven.loans);
    expect(replayed.scenarioId).toBe(driven.scenarioId);
    expect(replayed.actionLog.length).toBe(driven.actionLog.length);
  });
});
