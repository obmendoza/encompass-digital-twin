import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import { ActionError } from "../src/errors.js";
import type { Actor, Loan, Scenario, WorldState } from "../src/types.js";

const now = () => "2026-04-14T12:00:00.000Z";
const agent: Actor = { kind: "agent", id: "mlb-uw-agent" };
const human: Actor = { kind: "human", id: "uw1" };

function loan(id = "R1"): Loan {
  return {
    id,
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

describe("reduce — agent recommendation", () => {
  it("RecordAgentStep logs without mutating loan", () => {
    const s = preload();
    const next = reduce(s, { type: "RecordAgentStep", loanId: "R1",
      step: { phase: "thinking", content: "Evaluating DTI", at: now() }, actor: agent }, () => undefined);
    expect(next.loans.R1).toEqual(s.loans.R1);
    expect(next.actionLog.length).toBe(s.actionLog.length + 1);
  });

  it("StageRecommendation sets pendingRecommendation", () => {
    const s = preload();
    const next = reduce(s, { type: "StageRecommendation", loanId: "R1",
      recommendation: { recommendation: "approved", rationale: "Clean file", confidence: 0.92,
        conditions: ["Verify paystubs"], trace: [] }, actor: agent }, () => undefined);
    const rec = next.loans.R1!.pendingRecommendation!;
    expect(rec.recommendation).toBe("approved");
    expect(rec.confidence).toBe(0.92);
    expect(rec.stagedBy).toBe("mlb-uw-agent");
  });

  it("AcceptRecommendation converts pending rec to decision + clears rec", () => {
    let s = preload();
    s = reduce(s, { type: "StageRecommendation", loanId: "R1",
      recommendation: { recommendation: "approved", rationale: "ok", confidence: 0.9, conditions: [], trace: [] },
      actor: agent }, () => undefined);
    const next = reduce(s, { type: "AcceptRecommendation", loanId: "R1", actor: human }, () => undefined);
    expect(next.loans.R1!.decision).toBe("approved");
    expect(next.loans.R1!.pendingRecommendation).toBeUndefined();
    expect(next.loans.R1!.milestones.at(-1)!.name).toContain("agent-accepted");
  });

  it("AcceptRecommendation with no pending rec throws", () => {
    const s = preload();
    expect(() => reduce(s, { type: "AcceptRecommendation", loanId: "R1", actor: human }, () => undefined))
      .toThrowError(ActionError);
  });

  it("ClearRecommendation removes pending rec without changing decision", () => {
    let s = preload();
    s = reduce(s, { type: "StageRecommendation", loanId: "R1",
      recommendation: { recommendation: "denied", rationale: "x", confidence: 0.8, conditions: [], trace: [] },
      actor: agent }, () => undefined);
    const next = reduce(s, { type: "ClearRecommendation", loanId: "R1", actor: human }, () => undefined);
    expect(next.loans.R1!.pendingRecommendation).toBeUndefined();
    expect(next.loans.R1!.decision).toBe("pending");
  });

  it("ClearRecommendation with no pending rec throws", () => {
    const s = preload();
    expect(() => reduce(s, { type: "ClearRecommendation", loanId: "R1", actor: human }, () => undefined))
      .toThrowError(ActionError);
  });
});
