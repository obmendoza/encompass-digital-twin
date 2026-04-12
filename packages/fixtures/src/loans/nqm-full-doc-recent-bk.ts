import type { Scenario, Condition } from "@twin/core";
import { bkSeasoningStarterConditions } from "../condition-templates.js";

const starter: Condition[] = bkSeasoningStarterConditions.map((c, i) => ({
  id: `c${i + 1}`,
  category: c.category,
  source: c.source,
  description: c.description,
  status: c.status ?? "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
}));

// loanAmount 385000, appraised 550000, LTV 70, FICO 680, PITI 3010.00
// derivedMonthlyIncome 8800, TraditionalDocs
// piPayment ~ PITI - 510 = 2500.00; housingRatio = 2500 / 8800 * 100 = 28.4; totalDti = 3010 / 8800 * 100 = 34.2
export const nqmFullDocRecentBk: Scenario = {
  id: "nqm-full-doc-recent-bk",
  name: "NQM Full Doc — Recent Bankruptcy",
  description: "W2/full-doc borrower with recent BK discharge. BK seasoning and re-established credit required.",
  loan: {
    id: "2501000110",
    nqmProgram: "FullDocNonQM",
    qualifyingMethod: "TraditionalDocs",
    borrower: { fullName: "Johnson, Lamar", ssnMasked: "xxx-xx-4433", dob: "1975-08-25", maritalStatus: "Separated" },
    property: { street: "888 Cedar Grove Ave", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 1993 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 385000, salesPrice: 550000, appraisedValue: 550000,
      ltv: 70, cltv: 70, hcltv: 70, noteRate: 7.875, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3010.00,
    },
    qualifying: { housingRatio: 28.4, totalDti: 34.2, piPayment: 2500.00, qualifyingRate: 7.875 },
    qualifyingWorksheet: {
      method: "TraditionalDocs",
      derivedMonthlyIncome: 8800,
    },
    income: { totalMonthlyIncome: 8800, notes: "Full doc W2 + tax returns" },
    assets: { totalLiquid: 48000, totalRetirement: 25000, reservesMonths: 6.0 },
    credit: {
      repScore: 680, tradelinesOpen: 4, tradelinesTotal: 7, lastLate30d: "2023-11",
      tradelines: [
        { creditorName: "Capital One Secured", accountType: "Revolving", balance: 480, monthlyPayment: 20, limit: 1500, monthsOpen: 24, late30: 1, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Credit One Bank", accountType: "Revolving", balance: 650, monthlyPayment: 25, limit: 1500, monthsOpen: 18, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Regional Finance Inst.", accountType: "Installment", balance: 8500, monthlyPayment: 220, limit: undefined, monthsOpen: 18, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Wells Fargo Auto Refi", accountType: "Installment", balance: 12400, monthlyPayment: 310, limit: undefined, monthsOpen: 12, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 575, revolvingBalance: 1130, installmentBalance: 20900, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 22030 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Harper, William E.",
      appraisalType: "Full",
      appraisedValue: 550000,
      marketCondition: "Stable",
      neighborhoodRating: "Good",
      siteArea: "0.23 acres",
      grossLivingArea: 2050,
      roomCount: 8,
      bedroomCount: 4,
      bathroomCount: 2.5,
      garageSpaces: 2,
      condition: "Good",
      comparables: [
        { address: "920 Cedar Grove Ave, Fresno CA", salePrice: 541000, saleDate: "2026-02-16", sqft: 2000, distance: "0.1 mi", adjustedValue: 547000 },
        { address: "1450 Brookside Ln, Fresno CA", salePrice: 562000, saleDate: "2026-01-24", sqft: 2150, distance: "0.4 mi", adjustedValue: 555000 },
        { address: "775 Pinecrest Dr, Fresno CA", salePrice: 531000, saleDate: "2026-03-06", sqft: 1950, distance: "0.7 mi", adjustedValue: 544000 },
      ],
    },
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
