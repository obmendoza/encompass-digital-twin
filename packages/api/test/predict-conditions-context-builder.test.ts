import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    for (const line of readFileSync(resolvePath(here, "../.env"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* */ }
}

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withDb, closePool } from "../src/db/pool.js";
import { buildLoanContextFromLoan } from "../src/routes/predict-conditions-context-builder.js";
import { writeExtrasFirstWriteWins } from "../src/ingestion/loan-context-extras.js";
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
  it("populates the v2 numeric fields from loan.transaction / credit / qualifying / assets", async () => {
    const ctx = await buildLoanContextFromLoan(makeLoan());
    expect(ctx.repFico).toBe(720);
    expect(ctx.ltv).toBe(75);
    expect(ctx.loanAmount).toBe(500000);
    expect(ctx.loanPurpose).toBe("Purchase");
    expect(ctx.propertyType).toBe("SFR Det.");
    expect(ctx.dti).toBe(42);
    expect(ctx.reservesMonths).toBe(6);
    expect(ctx.noteRate).toBe(7.5);
  });

  it("preserves PC v1 fields unchanged", async () => {
    const ctx = await buildLoanContextFromLoan(makeLoan());
    expect(ctx.program).toBe("Flex Select");
    expect(ctx.occupancy).toBe("primary");
    expect(ctx.state).toBe("CA");
    expect(ctx.borrowerType).toBe("W2");
    expect(ctx.citizenship).toBe("US Citizen");
  });

  it("leaves repFico undefined when loan.credit.repScore is null", async () => {
    const loan = makeLoan();
    loan.credit = { ...loan.credit, repScore: null };
    const ctx = await buildLoanContextFromLoan(loan);
    expect(ctx.repFico).toBeUndefined();
  });
});

// ── Extras-merge tests (Task 10) ─────────────────────────────────────────────

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee03";

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'CB Test', 'cb-test', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
    await c.query(`DELETE FROM loan_context_extras WHERE tenant_id = $1`, [T]);
  });
});
afterAll(async () => {
  await withDb(async (c) => {
    await c.query(`DELETE FROM loan_context_extras WHERE tenant_id = $1`, [T]);
  });
  await closePool();
});

describe("buildLoanContextFromLoan — extras merge", () => {
  const makeExtrasLoan = () =>
    makeLoan({
      id: "CB-1",
      tenantId: T,
    });

  it("extras-absent: falls back to Loan-derived defaults", async () => {
    const ctx = await buildLoanContextFromLoan(makeExtrasLoan());
    // county defaults to "" (fail-closed sentinel) when no extras present
    expect(ctx.county).toBe("");
    // repFico comes from loan.credit.repScore when extras is absent
    expect(ctx.repFico).toBe(720);
  });

  it("extras-present: extras override Loan-derived defaults", async () => {
    await writeExtrasFirstWriteWins(T, "CB-1", { repFico: 750, county: "King County", isItin: false });
    const ctx = await buildLoanContextFromLoan(makeExtrasLoan());
    expect(ctx.repFico).toBe(750);
    expect(ctx.county).toBe("King County");
    expect(ctx.isItin).toBe(false);
  });
});
