import type { Scenario, Condition, NewCondition } from "@twin/core";
import { bankStatementStarterConditions } from "../condition-templates.js";

const extraConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "LOX for 3 NSF occurrences + mitigating circumstances" },
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

// loanAmount 385000, appraised 455000, LTV 85, FICO 680, PITI 3200.00
// monthsCovered 12, avgDeposits 11000, expenseFactor 0.5, nsfCount 3, derivedMonthlyIncome 5500
// piPayment ~ PITI - 500 = 2700.00; housingRatio = 2700 / 5500 * 100 = 49.1; totalDti = 3200 / 5500 * 100 = 58.2
export const nqmSuspendCandidate: Scenario = {
  id: "nqm-suspend-candidate",
  name: "NQM Bank Statement — Suspend Candidate",
  description: "High LTV, high DTI, 3 NSFs. Likely to be suspended pending LOX and mitigation.",
  loan: {
    id: "2501000111",
    nqmProgram: "BankStatement12",
    qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "Brooks, Tammy", ssnMasked: "xxx-xx-5544", dob: "1988-01-09", maritalStatus: "Unmarried" },
    property: { street: "199 Willow Creek Rd", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 1997 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 385000, salesPrice: 455000, appraisedValue: 455000,
      ltv: 85, cltv: 85, hcltv: 85, noteRate: 8.125, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3200.00,
    },
    qualifying: { housingRatio: 49.1, totalDti: 58.2, piPayment: 2700.00, qualifyingRate: 8.125 },
    qualifyingWorksheet: {
      method: "BankStatementDeposits",
      monthsCovered: 12, avgDeposits: 11000, expenseFactor: 0.5, nsfCount: 3,
      derivedMonthlyIncome: 5500,
    },
    income: { totalMonthlyIncome: 5500, notes: "12mo personal bank statement avg × 50% expense factor; 3 NSFs noted" },
    assets: { totalLiquid: 32000, totalRetirement: 10000, reservesMonths: 4.0 },
    credit: { repScore: 680, tradelinesOpen: 4, tradelinesTotal: 7 },
    conditions: starter,
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
