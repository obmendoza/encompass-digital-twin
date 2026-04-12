import type { Scenario, Condition } from "@twin/core";
import { dscrStarterConditions } from "../condition-templates.js";

const starter: Condition[] = dscrStarterConditions.map((c, i) => ({
  id: `c${i + 1}`,
  category: c.category,
  source: c.source,
  description: c.description,
  status: c.status ?? "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
}));

// loanAmount 310000, appraised 450000, LTV 70, FICO 760, PITI 2650.00
// DSCR sub-1: rentalIncome 2250 / pitia 2650 = 0.85
// piPayment ~ PITI - 450 = 2200.00
export const nqmDscrSub1: Scenario = {
  id: "nqm-dscr-sub-1",
  name: "NQM DSCR — Sub-1.0 Coverage",
  description: "DSCR investor purchase with below-1.0 coverage. Edge case for underwriter review.",
  loan: {
    id: "2501000104",
    nqmProgram: "DSCR",
    qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "Kohli, Priya", ssnMasked: "xxx-xx-7744", dob: "1982-11-18", maritalStatus: "Married" },
    property: { street: "3310 Vineyard Ct", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 1999 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 310000, salesPrice: 450000, appraisedValue: 450000,
      ltv: 70, cltv: 70, hcltv: 70, noteRate: 7.625, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, rentalIncome: 2250,
      piti: 2650.00, pitia: 2650.00, dscrRatio: 0.85,
    },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2200.00, qualifyingRate: 7.625 },
    qualifyingWorksheet: {
      method: "DSCRCoverage",
      dscrNumerator: 2250, dscrDenominator: 2650.00,
      derivedMonthlyIncome: 0,
    },
    income: { totalMonthlyIncome: 0, notes: "DSCR qualifying — no personal income used" },
    assets: { totalLiquid: 58000, totalRetirement: 40000, reservesMonths: 8.0 },
    credit: { repScore: 760, tradelinesOpen: 7, tradelinesTotal: 10 },
    conditions: starter,
    documents: [],
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
