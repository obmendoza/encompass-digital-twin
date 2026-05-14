import { describe, it, expect } from "vitest";
import { buildLoanContextFromLoan } from "../src/routes/predict-conditions-context-builder.js";
import type { Loan } from "@twin/core";

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: "L-CTX-1",
    tenantId: "00000000-0000-0000-0000-000000000000",
    nqmProgram: "Flex Select",
    qualifyingMethod: "TraditionalDocs",
    borrower: { fullName: "Test", ssnMasked: "x", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "1", city: "LA", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: {
      loanPurpose: "Purchase" as const, loanAmount: 500000, salesPrice: 500000, appraisedValue: 500000,
      ltv: 75, cltv: 75, hcltv: 75, noteRate: 7.5, term: 360, amortType: "Fixed",
      lienPosition: 1, occupancy: "Primary", isInvestmentProperty: false, piti: 3500,
    },
    qualifying: { housingRatio: 25, totalDti: 42, piPayment: 3000, qualifyingRate: 7.5 },
    qualifyingWorksheet: { method: "TraditionalDocs", derivedMonthlyIncome: 10000 },
    income: { totalMonthlyIncome: 10000 },
    assets: { totalLiquid: 50000, totalRetirement: 100000, reservesMonths: 6 },
    credit: {
      repScore: 720, tradelinesOpen: 3, tradelinesTotal: 5, tradelines: [],
      liabilities: { totalMonthlyPayments: 1000, revolvingBalance: 5000, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 5000 },
    },
    appraisal: {
      appraisalDate: "2026-01-01", appraiserName: "T", appraisalType: "Full", appraisedValue: 500000,
      marketCondition: "Stable", neighborhoodRating: "Average", siteArea: "N/A", grossLivingArea: 2000,
      roomCount: 6, bedroomCount: 3, bathroomCount: 2, garageSpaces: 2, condition: "Average", comparables: [],
    },
    conditions: [], documents: [], decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "t", at: "2026-01-01T00:00:00.000Z" }],
    compliance: { qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false, higherPricedCoveredTransaction: false, stateLicenseRequired: false, stateHighCostTest: "Pass", tridToleranceCure: "None", totalPointsAndFees: 0, pointsAndFeesThreshold: 0, pointsAndFeesPass: true, flags: [] },
    overlay: { programName: "Flex Select", investorName: "T", maxLTV: 100, minFICO: 600, maxDTI: 50, minDSCR: null, minReserves: 0, checks: [] },
    ...overrides,
  };
}

describe("buildLoanContextFromLoan — PC v2 field population", () => {
  it("populates the v2 numeric fields from loan.transaction / credit / qualifying / assets", () => {
    const ctx = buildLoanContextFromLoan(makeLoan());
    expect(ctx.repFico).toBe(720);
    expect(ctx.ltv).toBe(75);
    expect(ctx.loanAmount).toBe(500000);
    expect(ctx.loanPurpose).toBe("Purchase");
    expect(ctx.propertyType).toBe("SFR Det.");
    expect(ctx.dti).toBe(42);
    expect(ctx.reservesMonths).toBe(6);
    expect(ctx.noteRate).toBe(7.5);
  });

  it("preserves PC v1 fields unchanged", () => {
    const ctx = buildLoanContextFromLoan(makeLoan());
    expect(ctx.program).toBe("Flex Select");
    expect(ctx.occupancy).toBe("primary");
    expect(ctx.state).toBe("CA");
    expect(ctx.borrowerType).toBe("W2");
    expect(ctx.citizenship).toBe("US Citizen");
  });

  it("leaves repFico undefined when loan.credit.repScore is null", () => {
    const loan = makeLoan();
    loan.credit = { ...loan.credit, repScore: null };
    const ctx = buildLoanContextFromLoan(loan);
    expect(ctx.repFico).toBeUndefined();
  });
});
