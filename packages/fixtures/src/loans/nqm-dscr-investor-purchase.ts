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

// loanAmount 340000, appraised 460000, LTV 75, FICO 740, PITI 2890.10
// DSCR: no personal income ratios; piPayment ~ PITI - 490 = 2400.10
// dscrRatio: rentalIncome 3400 / pitia 2890.10 = 1.18
export const nqmDscrInvestorPurchase: Scenario = {
  id: "nqm-dscr-investor-purchase",
  name: "NQM DSCR — Investor Purchase",
  description: "DSCR investor purchase with healthy coverage ratio of 1.18.",
  loan: {
    id: "2501000103",
    nqmProgram: "DSCR",
    qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "Nguyen, Linh", ssnMasked: "xxx-xx-6633", dob: "1985-03-07", maritalStatus: "Unmarried" },
    property: { street: "2280 Harvest Rd", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 2005 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 340000, salesPrice: 460000, appraisedValue: 460000,
      ltv: 75, cltv: 75, hcltv: 75, noteRate: 7.375, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, rentalIncome: 3400,
      piti: 2890.10, pitia: 2890.10, dscrRatio: 1.18,
    },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2400.10, qualifyingRate: 7.375 },
    qualifyingWorksheet: {
      method: "DSCRCoverage",
      dscrNumerator: 3400, dscrDenominator: 2890.10,
      derivedMonthlyIncome: 0,
    },
    income: { totalMonthlyIncome: 0, notes: "DSCR qualifying — no personal income used" },
    assets: { totalLiquid: 62000, totalRetirement: 30000, reservesMonths: 7.0 },
    credit: { repScore: 740, tradelinesOpen: 6, tradelinesTotal: 9 },
    conditions: starter,
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
