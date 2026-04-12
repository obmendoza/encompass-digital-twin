import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import { ActionError } from "../src/errors.js";
import type { Actor, Loan, Scenario, WorldState } from "../src/types.js";

const now = () => "2026-04-11T12:00:00.000Z";
const actor: Actor = { kind: "human", id: "uw1" };

function loan(): Loan {
  return {
    id: "2501000001",
    nqmProgram: "BankStatement12", qualifyingMethod: "BankStatementDeposits",
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
    conditions: [],
    decision: "pending",
    milestones: [],
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

function preload(): WorldState {
  const sc: Record<string, Scenario> = { s: { id: "s", name: "s", description: "", loan: loan() } };
  return reduce({ scenarioId: null, loans: {}, actionLog: [], now },
    { type: "LoadScenario", scenarioId: "s" }, (k) => sc[k]);
}

describe("reduce — conditions", () => {
  it("AddCondition appends an Open condition with a stable id", () => {
    const s = preload();
    const next = reduce(s, { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "Paystubs" }, actor }, () => undefined);
    const cs = next.loans["2501000001"]!.conditions;
    expect(cs).toHaveLength(1);
    expect(cs[0]!.id).toMatch(/^c\d+$/);
    expect(cs[0]!.status).toBe("Open");
    expect(cs[0]!.addedBy).toBe("uw1");
  });

  it("UpdateCondition merges patch", () => {
    const s1 = reduce(preload(), { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "Paystubs" }, actor }, () => undefined);
    const cid = s1.loans["2501000001"]!.conditions[0]!.id;
    const s2 = reduce(s1, { type: "UpdateCondition", loanId: "2501000001",
      conditionId: cid, patch: { description: "Paystubs (30d)" }, actor }, () => undefined);
    expect(s2.loans["2501000001"]!.conditions[0]!.description).toBe("Paystubs (30d)");
  });

  it("ClearCondition transitions Open/Received → Cleared", () => {
    const s1 = reduce(preload(), { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "4506-C", status: "Received" }, actor }, () => undefined);
    const cid = s1.loans["2501000001"]!.conditions[0]!.id;
    const s2 = reduce(s1, { type: "ClearCondition", loanId: "2501000001",
      conditionId: cid, notes: "ok", actor }, () => undefined);
    const c = s2.loans["2501000001"]!.conditions[0]!;
    expect(c.status).toBe("Cleared");
    expect(c.clearedBy).toBe("uw1");
    expect(c.notes).toBe("ok");
  });

  it("ClearCondition from Waived is forbidden", () => {
    const s1 = reduce(preload(), { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "X" }, actor }, () => undefined);
    const cid = s1.loans["2501000001"]!.conditions[0]!.id;
    const s2 = reduce(s1, { type: "WaiveCondition", loanId: "2501000001",
      conditionId: cid, rationale: "exec override", actor }, () => undefined);
    expect(() => reduce(s2, { type: "ClearCondition", loanId: "2501000001",
      conditionId: cid, actor }, () => undefined)).toThrowError(ActionError);
  });

  it("WaiveCondition requires rationale and sets status Waived", () => {
    const s1 = reduce(preload(), { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "Z" }, actor }, () => undefined);
    const cid = s1.loans["2501000001"]!.conditions[0]!.id;
    expect(() => reduce(s1, { type: "WaiveCondition", loanId: "2501000001",
      conditionId: cid, rationale: "", actor }, () => undefined)).toThrowError(ActionError);
    const s2 = reduce(s1, { type: "WaiveCondition", loanId: "2501000001",
      conditionId: cid, rationale: "ok", actor }, () => undefined);
    expect(s2.loans["2501000001"]!.conditions[0]!.status).toBe("Waived");
  });

  it("RemoveCondition deletes it", () => {
    const s1 = reduce(preload(), { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "Q" }, actor }, () => undefined);
    const cid = s1.loans["2501000001"]!.conditions[0]!.id;
    const s2 = reduce(s1, { type: "RemoveCondition", loanId: "2501000001",
      conditionId: cid, actor }, () => undefined);
    expect(s2.loans["2501000001"]!.conditions).toHaveLength(0);
  });

  it("UpdateCondition on unknown condition throws CONDITION_NOT_FOUND", () => {
    const s = preload();
    expect(() => reduce(s, { type: "UpdateCondition", loanId: "2501000001",
      conditionId: "cX", patch: {}, actor }, () => undefined)).toThrowError(ActionError);
  });

  it("Condition actions are forbidden after loan is denied", () => {
    const s1 = reduce(preload(), { type: "SetDecision", loanId: "2501000001",
      decision: "denied", rationale: "no", actor }, () => undefined);
    expect(() => reduce(s1, { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "x" }, actor }, () => undefined))
      .toThrowError(ActionError);
  });
});
