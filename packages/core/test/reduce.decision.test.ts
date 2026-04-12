import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import { ActionError } from "../src/errors.js";
import type { Scenario, WorldState, Loan, Actor } from "../src/types.js";

const now = () => "2026-04-11T12:00:00.000Z";
const actor: Actor = { kind: "agent", id: "unit" };

function loan(id: string): Loan {
  return {
    id,
    nqmProgram: "DSCR", qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "B", ssnMasked: "x", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "", city: "", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: { loanPurpose: "Purchase", loanAmount: 300000, appraisedValue: 400000,
      ltv: 75, cltv: 75, hcltv: 75, noteRate: 7.5, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, piti: 2500 },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2100, qualifyingRate: 7.5 },
    qualifyingWorksheet: { method: "DSCRCoverage", derivedMonthlyIncome: 0 },
    income: { totalMonthlyIncome: 0 },
    assets: { totalLiquid: 60000, totalRetirement: 0, reservesMonths: 6 },
    credit: { repScore: 740, tradelinesOpen: 4, tradelinesTotal: 7, tradelines: [], liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 } },
    conditions: [],
    decision: "pending",
    milestones: [],
  };
}

function preload(id: string = "2501000001"): WorldState {
  const scenarios: Record<string, Scenario> = {
    s1: { id: "s1", name: "s1", description: "", loan: loan(id) },
  };
  const resolve = (sid: string) => scenarios[sid];
  return reduce(
    { scenarioId: null, loans: {}, actionLog: [], now },
    { type: "LoadScenario", scenarioId: "s1" },
    resolve,
  );
}

const noResolve = () => undefined;

describe("reduce — decision", () => {
  it("OpenLoan records a milestone without changing decision", () => {
    const s = preload();
    const next = reduce(s, { type: "OpenLoan", loanId: "2501000001", actor }, noResolve);
    expect(next.loans["2501000001"]!.milestones.at(-1)?.name).toBe("Opened");
    expect(next.loans["2501000001"]!.decision).toBe("pending");
  });

  it("OpenLoan on unknown loan throws LOAN_NOT_FOUND", () => {
    const s = preload();
    expect(() => reduce(s, { type: "OpenLoan", loanId: "XXX", actor }, noResolve))
      .toThrowError(ActionError);
  });

  it("SetDecision updates decision and records milestone", () => {
    const s = preload();
    const next = reduce(s, { type: "SetDecision", loanId: "2501000001",
      decision: "approved", rationale: "clean file", actor }, noResolve);
    expect(next.loans["2501000001"]!.decision).toBe("approved");
    expect(next.loans["2501000001"]!.milestones.at(-1)?.name).toBe("Decision:approved");
  });

  it("SetDecision requires a non-empty rationale", () => {
    const s = preload();
    expect(() => reduce(s, { type: "SetDecision", loanId: "2501000001",
      decision: "denied", rationale: "", actor }, noResolve)).toThrowError(ActionError);
  });

  it("AdvanceMilestone appends a custom milestone", () => {
    const s = preload();
    const next = reduce(s, { type: "AdvanceMilestone", loanId: "2501000001",
      milestone: "UW Review", actor }, noResolve);
    expect(next.loans["2501000001"]!.milestones.map(m => m.name)).toContain("UW Review");
  });
});
