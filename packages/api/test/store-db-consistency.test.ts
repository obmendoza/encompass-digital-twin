import { describe, it, expect } from "vitest";
import { createStore, type Store, type Loan } from "@twin/core";
import { scenarios } from "@twin/fixtures";
import { withStoreSnapshot } from "../src/store-db-consistency.js";

function stubLoan(loanId: string): Loan {
  return {
    id: loanId,
    tenantId: "00000000-0000-0000-0000-000000000000",
    nqmProgram: "Flex Select",
    qualifyingMethod: "TraditionalDocs",
    borrower: { fullName: "Test", ssnMasked: "xxx-xx-0000", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "1", city: "LA", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 100000, salesPrice: 100000, appraisedValue: 100000,
      ltv: 100, cltv: 100, hcltv: 100, noteRate: 7, term: 360, amortType: "Fixed",
      lienPosition: 1, occupancy: "Primary", isInvestmentProperty: false, piti: 600,
    },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 600, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "TraditionalDocs", derivedMonthlyIncome: 10000 },
    income: { totalMonthlyIncome: 10000 },
    assets: { totalLiquid: 0, totalRetirement: 0, reservesMonths: 0 },
    credit: { repScore: 720, tradelinesOpen: 1, tradelinesTotal: 1, tradelines: [], liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 } },
    appraisal: { appraisalDate: "2026-01-01", appraiserName: "T", appraisalType: "Full", appraisedValue: 100000, marketCondition: "Stable", neighborhoodRating: "Average", siteArea: "N/A", grossLivingArea: 1000, roomCount: 4, bedroomCount: 2, bathroomCount: 1, garageSpaces: 1, condition: "Average", comparables: [] },
    conditions: [], documents: [], decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "test", at: "2026-01-01T00:00:00.000Z" }],
    compliance: { qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false, higherPricedCoveredTransaction: false, stateLicenseRequired: false, stateHighCostTest: "Pass", tridToleranceCure: "None", totalPointsAndFees: 0, pointsAndFeesThreshold: 0, pointsAndFeesPass: true, flags: [] },
    overlay: { programName: "Flex Select", investorName: "T", maxLTV: 100, minFICO: 600, maxDTI: 50, minDSCR: null, minReserves: 0, checks: [] },
  };
}

function makeStore(): Store {
  return createStore({ scenarios });
}

describe("withStoreSnapshot", () => {
  it("returns the closure's result on success and does NOT dispatch InjectLoan", async () => {
    const store = makeStore();
    store.dispatch({ type: "InjectLoan", loan: stubLoan("L-1") });
    const logBefore = store.getState().actionLog.length;

    const result = await withStoreSnapshot(store, "L-1", async () => {
      store.dispatch({
        type: "AddCondition",
        loanId: "L-1",
        condition: { category: "PTD", source: "UW", description: "Marker test condition" },
        actor: { kind: "human", id: "tester" },
      });
      return 42;
    });

    expect(result).toBe(42);
    // One new entry (the AddCondition). No rollback InjectLoan.
    expect(store.getState().actionLog.length).toBe(logBefore + 1);
    expect(store.getState().loans["L-1"]!.conditions.length).toBe(1);
  });

  it("reverts the loan when the closure throws after a mutating dispatch", async () => {
    const store = makeStore();
    store.dispatch({ type: "InjectLoan", loan: stubLoan("L-2") });
    const before = store.getState().loans["L-2"]!;
    expect(before.conditions.length).toBe(0);

    await expect(
      withStoreSnapshot(store, "L-2", async () => {
        store.dispatch({
          type: "AddCondition",
          loanId: "L-2",
          condition: { category: "PTD", source: "UW", description: "Marker should be reverted" },
          actor: { kind: "human", id: "tester" },
        });
        throw new Error("sabotaged");
      }),
    ).rejects.toThrow("sabotaged");

    expect(store.getState().loans["L-2"]!.conditions.length).toBe(0);
  });

  it("re-throws the original error after reverting", async () => {
    const store = makeStore();
    store.dispatch({ type: "InjectLoan", loan: stubLoan("L-3") });
    const sentinel = new Error("specific message");

    await expect(
      withStoreSnapshot(store, "L-3", async () => {
        throw sentinel;
      }),
    ).rejects.toBe(sentinel);
  });

  it("skips rollback when the loan didn't exist in the store before the closure", async () => {
    const store = makeStore();
    const logBefore = store.getState().actionLog.length;

    await expect(
      withStoreSnapshot(store, "L-MISSING", async () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");

    // No InjectLoan was dispatched.
    expect(store.getState().loans["L-MISSING"]).toBeUndefined();
    expect(store.getState().actionLog.length).toBe(logBefore);
  });

  it("retains both the failed dispatch and the rollback InjectLoan in actionLog (C2)", async () => {
    const store = makeStore();
    store.dispatch({ type: "InjectLoan", loan: stubLoan("L-5") });
    const logBefore = store.getState().actionLog.length;

    await expect(
      withStoreSnapshot(store, "L-5", async () => {
        store.dispatch({
          type: "AddCondition",
          loanId: "L-5",
          condition: { category: "PTD", source: "UW", description: "Logged dispatch under sabotage" },
          actor: { kind: "human", id: "tester" },
        });
        throw new Error("sabotaged");
      }),
    ).rejects.toThrow("sabotaged");

    const log = store.getState().actionLog;
    // Two new entries: the AddCondition, then the rollback InjectLoan.
    expect(log.length).toBe(logBefore + 2);
    expect(log[log.length - 2]!.action.type).toBe("AddCondition");
    expect(log[log.length - 1]!.action.type).toBe("InjectLoan");
  });

  it("appends exactly one rollback InjectLoan when the closure throws before any dispatch (C3)", async () => {
    const store = makeStore();
    store.dispatch({ type: "InjectLoan", loan: stubLoan("L-6") });
    const logBefore = store.getState().actionLog.length;
    const conditionsBefore = store.getState().loans["L-6"]!.conditions.length;

    await expect(
      withStoreSnapshot(store, "L-6", async () => {
        throw new Error("early");
      }),
    ).rejects.toThrow("early");

    // Loan state unchanged.
    expect(store.getState().loans["L-6"]!.conditions.length).toBe(conditionsBefore);
    // One spurious rollback InjectLoan was appended.
    expect(store.getState().actionLog.length).toBe(logBefore + 1);
    expect(store.getState().actionLog[store.getState().actionLog.length - 1]!.action.type).toBe("InjectLoan");
  });
});
