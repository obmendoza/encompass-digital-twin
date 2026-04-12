import type { Scenario, Condition, NewCondition } from "@twin/core";
import { dscrStarterConditions } from "../condition-templates.js";

const extraConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "LOX for 30-day late 12/2025" },
];

const allTemplates: NewCondition[] = [...dscrStarterConditions, ...extraConditions];

const starter: Condition[] = allTemplates.map((c, i) => ({
  id: `c${i + 1}`,
  category: c.category,
  source: c.source,
  description: c.description,
  status: c.status ?? "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
}));

// loanAmount 410000, appraised 515000, LTV 80, FICO 660, PITI 3480.00
// Investment DSCR: rentalIncome 2500, pitia 3480, dscrRatio 0.72
// piPayment ~ PITI - 480 = 3000.00
export const nqmDenyCandidate: Scenario = {
  id: "nqm-deny-candidate",
  name: "NQM DSCR — Deny Candidate",
  description: "DSCR 0.72, low FICO 660, recent 30-day late. Most likely a denial scenario.",
  loan: {
    id: "2501000112",
    nqmProgram: "DSCR",
    qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "Carter, Devin", ssnMasked: "xxx-xx-6655", dob: "1991-10-03", maritalStatus: "Unmarried" },
    property: { street: "3820 Dusty Trail Blvd", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 1990 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 410000, salesPrice: 515000, appraisedValue: 515000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 8.25, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, rentalIncome: 2500,
      piti: 3480.00, pitia: 3480.00, dscrRatio: 0.72,
    },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 3000.00, qualifyingRate: 8.25 },
    qualifyingWorksheet: {
      method: "DSCRCoverage",
      dscrNumerator: 2500, dscrDenominator: 3480.00,
      derivedMonthlyIncome: 0,
    },
    income: { totalMonthlyIncome: 0, notes: "DSCR qualifying — no personal income used" },
    assets: { totalLiquid: 45000, totalRetirement: 12000, reservesMonths: 5.0 },
    credit: {
      repScore: 660, tradelinesOpen: 4, tradelinesTotal: 7, lastLate30d: "2025-12",
      tradelines: [
        { creditorName: "Avant Credit Card", accountType: "Revolving", balance: 2400, monthlyPayment: 90, limit: 2500, monthsOpen: 30, late30: 3, late60: 1, late90: 0, isDisputed: true },
        { creditorName: "LoanMart Auto", accountType: "Installment", balance: 14500, monthlyPayment: 380, limit: undefined, monthsOpen: 24, late30: 1, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "LVNV Funding (Coll.)", accountType: "Collection", balance: 1450, monthlyPayment: 0, limit: undefined, monthsOpen: 14, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Portfolio Recovery (Coll.)", accountType: "Collection", balance: 620, monthlyPayment: 0, limit: undefined, monthsOpen: 6, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 470, revolvingBalance: 2400, installmentBalance: 14500, mortgageBalance: 0, collectionsBalance: 2070, totalBalance: 18970 },
    },
    conditions: starter,
    documents: [],
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
