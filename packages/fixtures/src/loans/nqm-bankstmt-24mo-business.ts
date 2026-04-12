import type { Scenario, Condition, NewCondition } from "@twin/core";
import { bankStatementStarterConditions } from "../condition-templates.js";

const extraConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "Explanation of NSF count > 0 on business account" },
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

// loanAmount 525000, appraised 700000, LTV 75, FICO 700, PITI 4120.00
// piPayment ~ PITI - 520 = 3600; derivedMonthlyIncome ~ 9500 (24mo avg deposits * 0.5)
// housingRatio = 3600 / 9500 * 100 = 37.9; totalDti = 4120 / 9500 * 100 = 43.4
export const nqmBankstmt24moBusiness: Scenario = {
  id: "nqm-bankstmt-24mo-business",
  name: "NQM Bank Statement 24mo — Business Account",
  description: "Self-employed using 24mo business bank statements. NSF explanation required.",
  loan: {
    id: "2501000102",
    nqmProgram: "BankStatement24",
    qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "Okafor, Samuel", ssnMasked: "xxx-xx-5512", dob: "1979-09-22", maritalStatus: "Married" },
    property: { street: "1044 Magnolia Ave", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 2002 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 525000, salesPrice: 700000, appraisedValue: 700000,
      ltv: 75, cltv: 75, hcltv: 75, noteRate: 7.125, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 4120.00,
    },
    qualifying: { housingRatio: 37.9, totalDti: 43.4, piPayment: 3600.00, qualifyingRate: 7.125 },
    qualifyingWorksheet: {
      method: "BankStatementDeposits",
      monthsCovered: 24, avgDeposits: 19000, expenseFactor: 0.5, nsfCount: 2,
      derivedMonthlyIncome: 9500,
    },
    income: { totalMonthlyIncome: 9500, notes: "24mo business bank statement avg × 50% expense factor" },
    assets: { totalLiquid: 95000, totalRetirement: 60000, reservesMonths: 7.2 },
    credit: { repScore: 700, tradelinesOpen: 5, tradelinesTotal: 8 },
    conditions: starter,
    documents: [],
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
