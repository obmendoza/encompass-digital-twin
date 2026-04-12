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
    credit: {
      repScore: 680, tradelinesOpen: 4, tradelinesTotal: 7,
      tradelines: [
        { creditorName: "Milestone Mastercard", accountType: "Revolving", balance: 1800, monthlyPayment: 65, limit: 2000, monthsOpen: 36, late30: 2, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Surge Card", accountType: "Revolving", balance: 950, monthlyPayment: 40, limit: 1200, monthsOpen: 24, late30: 1, late60: 0, late90: 0, isDisputed: true },
        { creditorName: "Carmax Auto Finance", accountType: "Installment", balance: 19500, monthlyPayment: 450, limit: undefined, monthsOpen: 18, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Jefferson Capital (Coll.)", accountType: "Collection", balance: 880, monthlyPayment: 0, limit: undefined, monthsOpen: 8, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 555, revolvingBalance: 2750, installmentBalance: 19500, mortgageBalance: 0, collectionsBalance: 880, totalBalance: 23130 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Morrison, Gary L.",
      appraisalType: "Full",
      appraisedValue: 455000,
      marketCondition: "Stable",
      neighborhoodRating: "Average",
      siteArea: "0.19 acres",
      grossLivingArea: 1700,
      roomCount: 7,
      bedroomCount: 3,
      bathroomCount: 2,
      garageSpaces: 2,
      condition: "Average",
      comparables: [
        { address: "215 Willow Creek Rd, Fresno CA", salePrice: 446000, saleDate: "2026-02-17", sqft: 1660, distance: "0.1 mi", adjustedValue: 451000 },
        { address: "580 Briarwood Ct, Fresno CA", salePrice: 463000, saleDate: "2026-01-29", sqft: 1760, distance: "0.4 mi", adjustedValue: 457000 },
        { address: "340 Ridgewood Ave, Fresno CA", salePrice: 440000, saleDate: "2026-03-13", sqft: 1640, distance: "0.6 mi", adjustedValue: 448000 },
      ],
    },
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
