import type { Scenario, Condition, NewCondition } from "@twin/core";
import { bankStatementStarterConditions } from "../condition-templates.js";

// Replace the bank statement line with 1099 equivalent
const templates: NewCondition[] = bankStatementStarterConditions.map((c) => {
  if (c.description === "12 months personal bank statements (all pages)") {
    return { category: "PTD", source: "UW", description: "Two years of 1099 forms (all pages)" };
  }
  return c;
});

const starter: Condition[] = templates.map((c, i) => ({
  id: `c${i + 1}`,
  category: c.category,
  source: c.source,
  description: c.description,
  status: c.status ?? "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
}));

// loanAmount 395000, appraised 495000, LTV 80, FICO 710, PITI 3180.50
// gross1099 156000, expenseFactor 0.7, derivedMonthlyIncome 9100 (156000 * 0.3 / 12 = 3900... actually 156000/12*0.7 = 9100 gross side)
// Actually: 1099 gross method = gross1099 * (1 - expenseFactor) / 12 OR gross / 12 * factor depending on interpretation
// Per spec: expenseFactor 0.7, derivedMonthlyIncome 9100 => 156000 / 12 * 0.7 = 9100
// piPayment ~ PITI - 480 = 2700.50; housingRatio = 2700.50 / 9100 * 100 = 29.7; totalDti = 3180.50 / 9100 * 100 = 34.9
export const nqm1099Only: Scenario = {
  id: "nqm-1099-only",
  name: "NQM 1099 Only — Gig/Contractor",
  description: "Independent contractor qualifying on 1099 gross income with 70% income factor.",
  loan: {
    id: "2501000106",
    nqmProgram: "1099Only",
    qualifyingMethod: "1099Gross",
    borrower: { fullName: "Ramirez, Jose", ssnMasked: "xxx-xx-9966", dob: "1983-07-30", maritalStatus: "Unmarried" },
    property: { street: "777 Palm Tree Blvd", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 2001 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 395000, salesPrice: 495000, appraisedValue: 495000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7.25, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3180.50,
    },
    qualifying: { housingRatio: 29.7, totalDti: 34.9, piPayment: 2700.50, qualifyingRate: 7.25 },
    qualifyingWorksheet: {
      method: "1099Gross",
      gross1099: 156000, expenseFactor: 0.7,
      derivedMonthlyIncome: 9100,
    },
    income: { totalMonthlyIncome: 9100, notes: "1099 gross $156,000 × 70% income factor / 12" },
    assets: { totalLiquid: 55000, totalRetirement: 20000, reservesMonths: 6.0 },
    credit: { repScore: 710, tradelinesOpen: 5, tradelinesTotal: 8 },
    conditions: starter,
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
