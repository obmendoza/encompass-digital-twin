import type { Scenario, Condition, NewCondition } from "@twin/core";
import { bankStatementStarterConditions } from "../condition-templates.js";

const extraConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "CPA license verification (state board)" },
];

const allTemplates: NewCondition[] = [...bankStatementStarterConditions, ...extraConditions];

const starter: Condition[] = allTemplates.map((c, i) => ({
  id: `c${i + 1}`,
  category: c.category,
  source: c.source,
  description: c.description,
  status: c.status ?? "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
}));

// loanAmount 500000, appraised 670000, LTV 75, FICO 720, PITI 3950.75
// cpaCertifiedNetIncome 14200, derivedMonthlyIncome 14200
// piPayment ~ PITI - 550 = 3400.75; housingRatio = 3400.75 / 14200 * 100 = 23.9; totalDti = 3950.75 / 14200 * 100 = 27.8
export const nqmPnlOnlyCpa: Scenario = {
  id: "nqm-pnl-only-cpa",
  name: "NQM P&L Only — CPA Certified",
  description: "Business owner qualifying on CPA-certified P&L with strong net income.",
  loan: {
    id: "2501000107",
    nqmProgram: "PnL",
    qualifyingMethod: "PnLCPACertified",
    borrower: { fullName: "Patel, Anjali", ssnMasked: "xxx-xx-1100", dob: "1980-02-14", maritalStatus: "Married" },
    property: { street: "2100 Cypress Hill Dr", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 2006 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 500000, salesPrice: 670000, appraisedValue: 670000,
      ltv: 75, cltv: 75, hcltv: 75, noteRate: 7.125, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3950.75,
    },
    qualifying: { housingRatio: 23.9, totalDti: 27.8, piPayment: 3400.75, qualifyingRate: 7.125 },
    qualifyingWorksheet: {
      method: "PnLCPACertified",
      cpaCertifiedNetIncome: 14200,
      derivedMonthlyIncome: 14200,
    },
    income: { totalMonthlyIncome: 14200, notes: "CPA-certified P&L net income $14,200/mo" },
    assets: { totalLiquid: 88000, totalRetirement: 55000, reservesMonths: 8.5 },
    credit: { repScore: 720, tradelinesOpen: 6, tradelinesTotal: 9 },
    conditions: starter,
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
