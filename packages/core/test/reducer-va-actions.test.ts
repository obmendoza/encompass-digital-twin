import { describe, it, expect } from "vitest";
import { reduce } from "../src/reduce.js";
import type { Action, Loan, WorldState } from "../src/types.js";

function minimalLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: "L1",
    nqmProgram: "BankStatement12",
    qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "X", ssnMasked: "xxx-xx-1234", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "1 Main", city: "C", state: "CA", zip: "90000", propertyType: "SFR Det.", units: 1, yearBuilt: 1990 },
    transaction: { loanPurpose: "Purchase", loanAmount: 100000, appraisedValue: 120000, ltv: 80, cltv: 80, hcltv: 80, noteRate: 7, term: 360, amortType: "Fixed", lienPosition: 1, occupancy: "Primary", isInvestmentProperty: false, piti: 700 },
    qualifying: { housingRatio: 25, totalDti: 35, piPayment: 700, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "BankStatementDeposits", derivedMonthlyIncome: 5000 },
    income: { totalMonthlyIncome: 5000 },
    assets: { totalLiquid: 50000, totalRetirement: 0, reservesMonths: 12 },
    credit: { repScore: 720, tradelinesOpen: 4, tradelinesTotal: 4, tradelines: [], liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 } },
    conditions: [], documents: [],
    appraisal: { appraisalDate: "2026-05-01", appraiserName: "X", appraisalType: "Full", appraisedValue: 120000, marketCondition: "Stable", neighborhoodRating: "Good", siteArea: "0.1", grossLivingArea: 1000, roomCount: 5, bedroomCount: 3, bathroomCount: 2, garageSpaces: 1, condition: "Good", comparables: [] },
    decision: "pending",
    milestones: [],
    compliance: { qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false, higherPricedCoveredTransaction: false, stateLicenseRequired: false, stateHighCostTest: "Pass", tridToleranceCure: "None", totalPointsAndFees: 0, pointsAndFeesThreshold: 0, pointsAndFeesPass: true, flags: [] },
    overlay: { programName: "Flex Select", investorName: "x", maxLTV: 80, minFICO: 680, maxDTI: 50, minDSCR: null, minReserves: 6, checks: [] },
    ...overrides,
  } as Loan;
}

function baseState(loan: Loan): WorldState {
  return { scenarioId: "_test", loans: { [loan.id]: loan }, actionLog: [], now: () => "2026-05-10T10:00:00Z" } as WorldState;
}

const actor = { kind: "internal", id: "u1", email: "u1@test" } as any;
const noResolver = (() => undefined) as any;

describe("reducer — VA actions", () => {
  it("RouteToVA transitions agent_review_pending → va_review_pending and sets pool", () => {
    const s = baseState(minimalLoan({ state: "agent_review_pending" }));
    const next = reduce(s, { type: "RouteToVA", loanId: "L1", assignedPoolId: "P1", actor } as Action, noResolver);
    expect(next.loans.L1!.state).toBe("va_review_pending");
    expect(next.loans.L1!.assignedPoolId).toBe("P1");
  });

  it("ClaimForVAReview transitions va_review_pending → va_in_review and stamps vaId/claimedAt", () => {
    const s = baseState(minimalLoan({ state: "va_review_pending", assignedPoolId: "P1" }));
    const next = reduce(s, { type: "ClaimForVAReview", loanId: "L1", vaId: "u1", poolId: "P1", poolKind: "internal", actor } as Action, noResolver);
    expect(next.loans.L1!.state).toBe("va_in_review");
    expect(next.loans.L1!.vaId).toBe("u1");
    expect(typeof next.loans.L1!.claimedAt).toBe("string");
  });

  it("ClaimForVAReview throws when state is not va_review_pending", () => {
    const s = baseState(minimalLoan({ state: "agent_review_pending" }));
    let caught: any = null;
    try {
      reduce(s, { type: "ClaimForVAReview", loanId: "L1", vaId: "u1", poolId: "P1", poolKind: "internal", actor } as Action, noResolver);
    } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe("VA_CLAIM_INVALID_STATE");
  });

  it("ReleaseVAClaim transitions va_in_review → va_review_pending and clears vaId/claimedAt", () => {
    const s = baseState(minimalLoan({ state: "va_in_review", vaId: "u1", claimedAt: "2026-05-10T09:00:00Z" }));
    const next = reduce(s, { type: "ReleaseVAClaim", loanId: "L1", vaId: "u1", actor } as Action, noResolver);
    expect(next.loans.L1!.state).toBe("va_review_pending");
    expect(next.loans.L1!.vaId).toBeNull();
    expect(next.loans.L1!.claimedAt).toBeNull();
  });

  it("SubmitVAReview verdict=concur → uw_review_pending, stamps currentVaReviewId, clears vaId", () => {
    const s = baseState(minimalLoan({ state: "va_in_review", vaId: "u1" }));
    const review = { id: "R1", verdict: "concur", docRequest: null } as any;
    const next = reduce(s, { type: "SubmitVAReview", loanId: "L1", review, actor } as Action, noResolver);
    expect(next.loans.L1!.state).toBe("uw_review_pending");
    expect(next.loans.L1!.currentVaReviewId).toBe("R1");
    expect(next.loans.L1!.vaId).toBeNull();
  });

  it("SubmitVAReview verdict=request_docs → va_doc_request_pending", () => {
    const s = baseState(minimalLoan({ state: "va_in_review", vaId: "u1" }));
    const review = { id: "R2", verdict: "request_docs", docRequest: { docs: [{}], deadline: "2026-05-20", messageToOriginator: "z" } } as any;
    const next = reduce(s, { type: "SubmitVAReview", loanId: "L1", review, actor } as Action, noResolver);
    expect(next.loans.L1!.state).toBe("va_doc_request_pending");
    expect(next.loans.L1!.currentVaReviewId).toBe("R2");
  });

  it("ReceiveVADocResponse transitions va_doc_request_pending → agent_review_pending and appends docs", () => {
    const s = baseState(minimalLoan({ state: "va_doc_request_pending" }));
    const docs = [{ id: "D1", name: "Bank Stmt", docType: "BankStatement", uploadedAt: "2026-05-15T10:00:00Z", uploadedBy: "broker", status: "Received" } as any];
    const next = reduce(s, { type: "ReceiveVADocResponse", loanId: "L1", documents: docs, actor } as Action, noResolver);
    expect(next.loans.L1!.state).toBe("agent_review_pending");
    expect(next.loans.L1!.documents.length).toBe(1);
  });

  it("VA gate: AcceptRecommendation throws VA_REVIEW_REQUIRED when state=va_review_pending", () => {
    const s = baseState(minimalLoan({
      state: "va_review_pending",
      pendingRecommendation: { recommendation: "Approve", rationale: "x", confidence: 0.9, conditions: [], trace: [] } as any,
    }));
    let caught: any = null;
    try {
      reduce(s, { type: "AcceptRecommendation", loanId: "L1", actor } as Action, noResolver);
    } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(caught.code).toBe("VA_REVIEW_REQUIRED");
  });

  it("VA gate: AcceptRecommendation succeeds when state=uw_review_pending", () => {
    const s = baseState(minimalLoan({
      state: "uw_review_pending",
      pendingRecommendation: { recommendation: "Approve", rationale: "x", confidence: 0.9, conditions: [], trace: [] } as any,
    }));
    expect(() => reduce(s, { type: "AcceptRecommendation", loanId: "L1", actor } as Action, noResolver)).not.toThrow();
  });

  it("VA gate: AcceptRecommendation succeeds when state=agent_review_pending (back-compat for va.required=false tenants)", () => {
    const s = baseState(minimalLoan({
      state: "agent_review_pending",
      pendingRecommendation: { recommendation: "Approve", rationale: "x", confidence: 0.9, conditions: [], trace: [] } as any,
    }));
    expect(() => reduce(s, { type: "AcceptRecommendation", loanId: "L1", actor } as Action, noResolver)).not.toThrow();
  });
});
