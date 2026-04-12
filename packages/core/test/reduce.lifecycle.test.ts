import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import { ActionError } from "../src/errors.js";
import type { Loan, Scenario, WorldState } from "../src/types.js";

const fixedNow = () => "2026-04-11T12:00:00.000Z";

function makeLoan(id: string): Loan {
  return {
    id,
    nqmProgram: "BankStatement12",
    qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "Test B", ssnMasked: "xxx-xx-0001", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "1 Test", city: "X", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: { loanPurpose: "Purchase", loanAmount: 400000, salesPrice: 500000, appraisedValue: 500000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3000 },
    qualifying: { housingRatio: 25, totalDti: 38, piPayment: 2660, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "BankStatementDeposits", derivedMonthlyIncome: 12000 },
    income: { totalMonthlyIncome: 12000 },
    assets: { totalLiquid: 80000, totalRetirement: 0, reservesMonths: 6 },
    credit: { repScore: 720, tradelinesOpen: 5, tradelinesTotal: 8, tradelines: [], liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 } },
    conditions: [],
    decision: "pending",
    milestones: [],
  };
}

function emptyState(): WorldState {
  return { scenarioId: null, loans: {}, actionLog: [], now: fixedNow };
}

function scenario(id: string): Scenario {
  return { id, name: id, description: "", loan: makeLoan("2501000001") };
}

describe("reduce — lifecycle", () => {
  const scenarios: Record<string, Scenario> = { "s1": scenario("s1") };
  const resolve = (sid: string) => scenarios[sid];

  it("LoadScenario hydrates state from a scenario", () => {
    const next = reduce(emptyState(), { type: "LoadScenario", scenarioId: "s1" }, resolve);
    expect(next.scenarioId).toBe("s1");
    expect(next.loans["2501000001"]).toBeDefined();
    expect(next.actionLog).toHaveLength(1);
    expect(next.actionLog[0]!.action.type).toBe("LoadScenario");
  });

  it("LoadScenario with unknown id throws SCENARIO_NOT_FOUND", () => {
    expect(() => reduce(emptyState(), { type: "LoadScenario", scenarioId: "nope" }, resolve))
      .toThrowError(ActionError);
  });

  it("ResetWorld clears loans + log but keeps `now`", () => {
    const loaded = reduce(emptyState(), { type: "LoadScenario", scenarioId: "s1" }, resolve);
    const reset = reduce(loaded, { type: "ResetWorld" }, resolve);
    expect(reset.scenarioId).toBeNull();
    expect(reset.loans).toEqual({});
    expect(reset.actionLog).toEqual([]);
    expect(reset.now).toBe(loaded.now);
  });
});
