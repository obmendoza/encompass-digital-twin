import type { Scenario, Condition } from "@twin/core";
import { itinStarterConditions, bankStatementStarterConditions } from "../condition-templates.js";

const allTemplates = [...itinStarterConditions, ...bankStatementStarterConditions];

const starter: Condition[] = allTemplates.map((c, i) => ({
  id: `c${i + 1}`,
  category: c.category,
  source: c.source,
  description: c.description,
  status: c.status ?? "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
}));

// loanAmount 275000, appraised 345000, LTV 80, FICO 690, PITI 2295.50
// monthsCovered 12, avgDeposits 9500, expenseFactor 0.5, derivedMonthlyIncome 4750
// piPayment ~ PITI - 470 = 1825.50; housingRatio = 1825.50 / 4750 * 100 = 38.4; totalDti = 2295.50 / 4750 * 100 = 48.3
export const nqmItinBankstmt: Scenario = {
  id: "nqm-itin-bankstmt",
  name: "NQM ITIN — Bank Statement Income",
  description: "ITIN borrower qualifying on 12mo bank statement deposits; alternative credit required.",
  loan: {
    id: "2501000109",
    nqmProgram: "ITIN",
    qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "Morales, Rosa", ssnMasked: "xxx-xx-3322", dob: "1990-06-17", maritalStatus: "Married" },
    property: { street: "615 Sunflower St", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 1995 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 275000, salesPrice: 345000, appraisedValue: 345000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7.5, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 2295.50,
    },
    qualifying: { housingRatio: 38.4, totalDti: 48.3, piPayment: 1825.50, qualifyingRate: 7.5 },
    qualifyingWorksheet: {
      method: "BankStatementDeposits",
      monthsCovered: 12, avgDeposits: 9500, expenseFactor: 0.5, nsfCount: 0,
      derivedMonthlyIncome: 4750,
    },
    income: { totalMonthlyIncome: 4750, notes: "12mo personal bank statement avg × 50% expense factor" },
    assets: { totalLiquid: 38000, totalRetirement: 0, reservesMonths: 6.0 },
    credit: { repScore: 690, tradelinesOpen: 4, tradelinesTotal: 7 },
    conditions: starter,
    documents: [],
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
