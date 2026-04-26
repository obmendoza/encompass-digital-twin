import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const fixed = () => "2026-04-11T12:00:00.000Z";

describe("world routes", () => {
  it("GET /scenarios lists all 20 scenarios", async () => {
    const { app } = buildServer({ now: fixed });
    const res = await app.inject({ method: "GET", url: "/scenarios" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(20);
  });

  it("POST /world/load-scenario hydrates the store", async () => {
    const { app } = buildServer({ now: fixed });
    const res = await app.inject({
      method: "POST", url: "/world/load-scenario",
      payload: { scenarioId: "nqm-bankstmt-12mo-clean" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().scenarioId).toBe("nqm-bankstmt-12mo-clean");
  });

  it("POST /world/load-scenario with unknown id returns 400", async () => {
    const { app } = buildServer({ now: fixed });
    const res = await app.inject({
      method: "POST", url: "/world/load-scenario", payload: { scenarioId: "nope" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("SCENARIO_NOT_FOUND");
  });

  it("POST /world/reset clears the loaded scenario", async () => {
    const { app } = buildServer({ now: fixed });
    await app.inject({ method: "POST", url: "/world/load-scenario",
      payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
    const res = await app.inject({ method: "POST", url: "/world/reset" });
    expect(res.statusCode).toBe(200);
    expect(res.json().scenarioId).toBeNull();
  });

  it("GET /openapi.json returns a valid spec", async () => {
    const { app } = buildServer({ now: fixed });
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths).length).toBeGreaterThan(15);
  });

  it("POST /world/inject-loan adds a custom loan", async () => {
    const { app } = buildServer({ now: fixed });
    const customLoan = {
      id: "INJECT-TEST-001", tenantId: "test-tenant", nqmProgram: "DSCR", qualifyingMethod: "DSCRCoverage",
      borrower: { fullName: "Injected, Test", ssnMasked: "xxx-xx-0000", dob: "1990-01-01", maritalStatus: "Unmarried" },
      property: { street: "1 Inject", city: "Test", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2005 },
      transaction: { loanPurpose: "Purchase", loanAmount: 300000, appraisedValue: 400000, salesPrice: 400000,
        ltv: 75, cltv: 75, hcltv: 75, noteRate: 7, term: 360, amortType: "Fixed", lienPosition: 1,
        occupancy: "Investment", isInvestmentProperty: true, piti: 2500 },
      qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2100, qualifyingRate: 7 },
      qualifyingWorksheet: { method: "DSCRCoverage", derivedMonthlyIncome: 1 },
      income: { totalMonthlyIncome: 0 },
      assets: { totalLiquid: 50000, totalRetirement: 0, reservesMonths: 6 },
      credit: { repScore: 720, tradelinesOpen: 5, tradelinesTotal: 8,
        tradelines: [], liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 } },
      conditions: [], documents: [], decision: "pending", milestones: [],
      appraisal: { appraisalDate: "2026-04-01", appraiserName: "T", appraisalType: "Full",
        appraisedValue: 400000, marketCondition: "Stable", neighborhoodRating: "Good",
        siteArea: "0.2", grossLivingArea: 1600, roomCount: 6, bedroomCount: 3,
        bathroomCount: 2, garageSpaces: 1, condition: "Good", comparables: [] },
      compliance: { qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false,
        higherPricedCoveredTransaction: false, stateLicenseRequired: false,
        stateHighCostTest: "Pass", tridToleranceCure: "None",
        totalPointsAndFees: 2500, pointsAndFeesThreshold: 4000, pointsAndFeesPass: true, flags: [] },
      overlay: { programName: "Test", investorName: "Test", maxLTV: 80, minFICO: 660,
        maxDTI: null, minDSCR: null, minReserves: 6, checks: [] },
    };
    const tenantHeaders = { "x-tenant-id": "test-tenant", "x-user-id": "test" };
    const res = await app.inject({
      method: "POST", url: "/world/inject-loan", payload: { loan: customLoan },
      headers: tenantHeaders,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().loanId).toBe("INJECT-TEST-001");
    const loan = await app.inject({ method: "GET", url: "/loans/INJECT-TEST-001", headers: tenantHeaders });
    expect(loan.statusCode).toBe(200);
    expect(loan.json().nqmProgram).toBe("DSCR");
  });
});
