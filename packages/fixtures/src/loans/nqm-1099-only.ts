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
    credit: {
      repScore: 710, tradelinesOpen: 5, tradelinesTotal: 8,
      tradelines: [
        { creditorName: "Chase Freedom Flex", accountType: "Revolving", balance: 2800, monthlyPayment: 84, limit: 10000, monthsOpen: 60, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Synchrony Home", accountType: "Revolving", balance: 1100, monthlyPayment: 40, limit: 5000, monthsOpen: 36, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Honda Financial", accountType: "Installment", balance: 16800, monthlyPayment: 395, limit: undefined, monthsOpen: 30, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Student Aid Federal", accountType: "Installment", balance: 22000, monthlyPayment: 250, limit: undefined, monthsOpen: 72, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Target RedCard", accountType: "Revolving", balance: 460, monthlyPayment: 18, limit: 2500, monthsOpen: 24, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 787, revolvingBalance: 4360, installmentBalance: 38800, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 43160 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Vasquez, Carlos R.",
      appraisalType: "Full",
      appraisedValue: 495000,
      marketCondition: "Stable",
      neighborhoodRating: "Good",
      siteArea: "0.20 acres",
      grossLivingArea: 1900,
      roomCount: 7,
      bedroomCount: 3,
      bathroomCount: 2,
      garageSpaces: 2,
      condition: "Good",
      comparables: [
        { address: "821 Palm Tree Blvd, Fresno CA", salePrice: 487000, saleDate: "2026-02-20", sqft: 1850, distance: "0.1 mi", adjustedValue: 492000 },
        { address: "544 Sycamore Ct, Fresno CA", salePrice: 502000, saleDate: "2026-01-14", sqft: 1980, distance: "0.4 mi", adjustedValue: 498000 },
        { address: "1103 Hazelnut Way, Fresno CA", salePrice: 479000, saleDate: "2026-03-01", sqft: 1800, distance: "0.6 mi", adjustedValue: 490000 },
      ],
    },
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
