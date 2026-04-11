import type { Scenario, Condition } from "@twin/core";
import { bankStatementStarterConditions } from "../condition-templates.js";

const starter: Condition[] = bankStatementStarterConditions.map((c, i) => ({
  id: `c${i + 1}`,
  category: c.category,
  source: c.source,
  description: c.description,
  status: c.status ?? "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
}));

export const nqmBankstmt12moClean: Scenario = {
  id: "nqm-bankstmt-12mo-clean",
  name: "NQM Bank Statement — 12mo Clean",
  description: "Self-employed happy path. 12mo personal bank statements, clean file.",
  loan: {
    id: "2501000101",
    nqmProgram: "BankStatement12",
    qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "Sanchez, Maria A.", ssnMasked: "xxx-xx-4421", dob: "1987-05-14", maritalStatus: "Unmarried" },
    property: { street: "812 Alder Ln", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 1998 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 412000, salesPrice: 515000, appraisedValue: 515000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 6.875, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3319.51,
    },
    qualifying: { housingRatio: 27.3, totalDti: 38.1, piPayment: 2707.41, qualifyingRate: 6.875 },
    qualifyingWorksheet: {
      method: "BankStatementDeposits",
      monthsCovered: 12, avgDeposits: 18000, expenseFactor: 0.5, nsfCount: 0,
      derivedMonthlyIncome: 9000,
    },
    income: { totalMonthlyIncome: 9000, notes: "12mo personal bank statement avg × 50% expense factor" },
    assets: { totalLiquid: 78420, totalRetirement: 45000, reservesMonths: 6.4 },
    credit: { repScore: 742, tradelinesOpen: 6, tradelinesTotal: 9 },
    conditions: starter,
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
