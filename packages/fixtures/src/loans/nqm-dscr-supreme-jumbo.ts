import type { Scenario, Condition } from "@twin/core";
import { dscrStarterConditions } from "../condition-templates.js";

const starter: Condition[] = dscrStarterConditions.map((c, i) => ({
  id: `c${i + 1}`,
  category: c.category,
  source: c.source,
  description: c.description,
  status: c.status ?? "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
}));

// DSCR Supreme — premium investor tier. Loan $1.8M, FICO 765, LTV 75%, DSCR 1.45.
// Matrix tier (npnqm-twin kb_version=2): Investment, FICO 740-999, max loan $2M, max LTV(purchase) 80%.
export const nqmDscrSupremeJumbo: Scenario = {
  id: "nqm-dscr-supreme-jumbo",
  name: "NQM DSCR Supreme — Premium Investor",
  description: "Premium-tier DSCR investor loan. $1.8M, 765 FICO, DSCR 1.45 — happy path on the upper-tier matrix.",
  loan: {
    id: "2501000114",
    nqmProgram: "DSCR Supreme",
    qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "Vasquez, Reynaldo C.", ssnMasked: "xxx-xx-9081", dob: "1972-09-14", maritalStatus: "Married" },
    property: { street: "8421 Coastal View Dr", city: "Newport Beach", state: "CA", zip: "92660",
      propertyType: "SFR Det.", units: 1, yearBuilt: 2014 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 1800000, salesPrice: 2400000, appraisedValue: 2400000,
      ltv: 75, cltv: 75, hcltv: 75, noteRate: 7.125, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, rentalIncome: 13500,
      piti: 12931.20, pitia: 12931.20, dscrRatio: 1.45,
    },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 12117.30, qualifyingRate: 7.125 },
    qualifyingWorksheet: {
      method: "DSCRCoverage",
      dscrNumerator: 13500, dscrDenominator: 9310.34,
      derivedMonthlyIncome: 0,
    },
    income: { totalMonthlyIncome: 0, notes: "DSCR Supreme — qualified on rental coverage; no personal income used" },
    assets: { totalLiquid: 482000, totalRetirement: 1250000, reservesMonths: 37.3 },
    credit: {
      repScore: 765, tradelinesOpen: 8, tradelinesTotal: 14,
      tradelines: [
        { creditorName: "JPMorgan Private Bank", accountType: "Revolving", balance: 4200, monthlyPayment: 105, limit: 50000, monthsOpen: 132, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Amex Centurion", accountType: "Revolving", balance: 8800, monthlyPayment: 0, limit: 0, monthsOpen: 96, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "BMW Financial", accountType: "Installment", balance: 78000, monthlyPayment: 1320, limit: undefined, monthsOpen: 30, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Wells Fargo Mortgage (Primary)", accountType: "Mortgage", balance: 920000, monthlyPayment: 5800, limit: undefined, monthsOpen: 108, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "BofA Mortgage (Investment 1)", accountType: "Mortgage", balance: 540000, monthlyPayment: 3700, limit: undefined, monthsOpen: 72, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Citi Visa Signature", accountType: "Revolving", balance: 1850, monthlyPayment: 60, limit: 25000, monthsOpen: 84, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 10985, revolvingBalance: 14850, installmentBalance: 78000, mortgageBalance: 1460000, collectionsBalance: 0, totalBalance: 1552850 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Patel, Anjali R.",
      appraisalType: "Full",
      appraisedValue: 2400000,
      marketCondition: "Stable",
      neighborhoodRating: "Good",
      siteArea: "0.31 acres",
      grossLivingArea: 4250,
      roomCount: 12,
      bedroomCount: 5,
      bathroomCount: 4.5,
      garageSpaces: 3,
      condition: "Good",
      comparables: [
        { address: "8512 Coastal View Dr, Newport Beach CA", salePrice: 2380000, saleDate: "2026-02-22", sqft: 4180, distance: "0.1 mi", adjustedValue: 2395000 },
        { address: "8120 Bayfront Ln, Newport Beach CA", salePrice: 2450000, saleDate: "2026-01-30", sqft: 4350, distance: "0.5 mi", adjustedValue: 2425000 },
        { address: "9032 Harbor Crest, Newport Beach CA", salePrice: 2350000, saleDate: "2026-03-14", sqft: 4100, distance: "0.7 mi", adjustedValue: 2380000 },
      ],
    },
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
    compliance: {
      qmStatus: "Non-QM",
      atrCompliant: true,
      hpml: false,
      hoepa: false,
      higherPricedCoveredTransaction: false,
      stateLicenseRequired: false,
      stateHighCostTest: "Pass",
      tridToleranceCure: "None",
      totalPointsAndFees: 12500,
      pointsAndFeesThreshold: 18000,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "NQM-003", severity: "Info", description: "Non-QM: qualified using DSCR coverage (no personal income verification)", regulation: "12 CFR 1026.43(c)" },
      ],
    },
    // LTV 75 <= 80 Pass, FICO 765 >= 740 Pass, DSCR 1.45 >= 1.00 Pass, Reserves 37.3 >= 12 Pass
    overlay: {
      programName: "DSCR Supreme",
      investorName: "NQM Capital",
      maxLTV: 80,
      minFICO: 740,
      maxDTI: null,
      minDSCR: 1.0,
      minReserves: 12,
      checks: [
        { category: "LTV", rule: "Max LTV", threshold: "≤ 80%", actual: "75%", result: "Pass" },
        { category: "FICO", rule: "Min FICO", threshold: "≥ 740", actual: "765", result: "Pass" },
        { category: "DSCR", rule: "Min DSCR", threshold: "≥ 1.00", actual: "1.45", result: "Pass" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 12 mo", actual: "37.3 mo", result: "Pass" },
        { category: "Property", rule: "Property Type", threshold: "Investment property required", actual: "Investment", result: "Pass" },
      ],
    },
  },
};
