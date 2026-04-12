import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import { ActionError } from "../src/errors.js";
import type { Actor, Loan, Scenario, WorldState } from "../src/types.js";

const now = () => "2026-04-11T12:00:00.000Z";
const actor: Actor = { kind: "agent", id: "income-bot" };

function baseLoan(): Loan {
  return {
    id: "2501000099",
    nqmProgram: "BankStatement12", qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "B", ssnMasked: "x", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "", city: "", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: { loanPurpose: "Purchase", loanAmount: 400000, appraisedValue: 500000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3000 },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2660, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "BankStatementDeposits", derivedMonthlyIncome: 0 },
    income: { totalMonthlyIncome: 0 },
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
  };
}

function preload(): WorldState {
  const scs: Record<string, Scenario> = { s: { id: "s", name: "s", description: "", loan: baseLoan() } };
  return reduce({ scenarioId: null, loans: {}, actionLog: [], now },
    { type: "LoadScenario", scenarioId: "s" }, (k) => scs[k]);
}

describe("reduce — qualifying income", () => {
  it("RecalculateQualifyingIncome updates worksheet + ratios", () => {
    const s = preload();
    const next = reduce(s, {
      type: "RecalculateQualifyingIncome", loanId: "2501000099",
      worksheet: {
        method: "BankStatementDeposits", monthsCovered: 12,
        avgDeposits: 18000, expenseFactor: 0.5, derivedMonthlyIncome: 9000,
      }, actor,
    }, () => undefined);
    const l = next.loans["2501000099"]!;
    expect(l.qualifyingWorksheet.derivedMonthlyIncome).toBe(9000);
    expect(l.income.totalMonthlyIncome).toBe(9000);
    expect(l.qualifying.totalDti).toBeCloseTo((3000 / 9000) * 100, 5);
    expect(l.qualifying.housingRatio).toBeCloseTo((2660 / 9000) * 100, 5);
  });

  it("derivedMonthlyIncome of 0 throws INVALID_TRANSITION", () => {
    const s = preload();
    expect(() => reduce(s, {
      type: "RecalculateQualifyingIncome", loanId: "2501000099",
      worksheet: { method: "DSCRCoverage", derivedMonthlyIncome: 0 }, actor,
    }, () => undefined)).toThrowError(ActionError);
  });
});
