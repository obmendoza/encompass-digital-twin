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

// DSCR Multi (5-8 Units) — multifamily DSCR. 6-unit building, $1.2M loan, 70% LTV, FICO 745, DSCR 1.30.
// Matrix tier (npnqm-twin kb_version=2): Investment - DSCR >=1.00, FICO 720-999, max loan $1.5M,
// max LTV(purchase) 75%, property_types includes "Residential 5-8 Units".
export const nqmDscrMulti5To8Units: Scenario = {
  id: "nqm-dscr-multi-5to8-units",
  name: "NQM DSCR Multi — 6-Unit Multifamily",
  description: "Multifamily DSCR investor purchase: 6-unit residential, $1.2M loan, DSCR 1.30 with strong rent roll.",
  loan: {
    id: "2501000115",
    nqmProgram: "DSCR Multi (5-8 Units)",
    qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "Okonkwo, Adaeze M.", ssnMasked: "xxx-xx-2244", dob: "1978-11-22", maritalStatus: "Married" },
    property: { street: "412 Vista Ridge Apartments", city: "San Diego", state: "CA", zip: "92101",
      propertyType: "Multi-Family", units: 6, yearBuilt: 1996 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 1200000, salesPrice: 1715000, appraisedValue: 1715000,
      ltv: 70, cltv: 70, hcltv: 70, noteRate: 7.5, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, rentalIncome: 11700,
      piti: 9000, pitia: 9000, dscrRatio: 1.30,
    },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 8390.10, qualifyingRate: 7.5 },
    qualifyingWorksheet: {
      method: "DSCRCoverage",
      dscrNumerator: 11700, dscrDenominator: 9000,
      derivedMonthlyIncome: 0,
    },
    income: { totalMonthlyIncome: 0, notes: "Multifamily DSCR — gross rent roll $11,700/mo from 6 units; no personal income" },
    assets: { totalLiquid: 245000, totalRetirement: 380000, reservesMonths: 27.2 },
    credit: {
      repScore: 745, tradelinesOpen: 7, tradelinesTotal: 11,
      tradelines: [
        { creditorName: "Bank of America Visa", accountType: "Revolving", balance: 2300, monthlyPayment: 70, limit: 18000, monthsOpen: 108, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Amex Gold", accountType: "Revolving", balance: 5600, monthlyPayment: 0, limit: 0, monthsOpen: 84, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Audi Financial", accountType: "Installment", balance: 28500, monthlyPayment: 580, limit: undefined, monthsOpen: 36, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Chase Mortgage (Primary)", accountType: "Mortgage", balance: 410000, monthlyPayment: 2750, limit: undefined, monthsOpen: 96, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Wells Fargo Mortgage (Investment SFR)", accountType: "Mortgage", balance: 320000, monthlyPayment: 2200, limit: undefined, monthsOpen: 60, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Citi Mastercard", accountType: "Revolving", balance: 1100, monthlyPayment: 33, limit: 12000, monthsOpen: 72, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 5633, revolvingBalance: 9000, installmentBalance: 28500, mortgageBalance: 730000, collectionsBalance: 0, totalBalance: 767500 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Romero, Daniel A.",
      appraisalType: "Full",
      appraisedValue: 1715000,
      marketCondition: "Stable",
      neighborhoodRating: "Good",
      siteArea: "0.45 acres",
      grossLivingArea: 6800,
      roomCount: 24,
      bedroomCount: 12,
      bathroomCount: 6,
      garageSpaces: 6,
      condition: "Average",
      comparables: [
        { address: "528 Vista Ridge Apartments, San Diego CA", salePrice: 1680000, saleDate: "2026-02-08", sqft: 6650, distance: "0.1 mi", adjustedValue: 1700000 },
        { address: "1140 Sunset Multifamily, San Diego CA", salePrice: 1750000, saleDate: "2026-01-15", sqft: 7100, distance: "0.6 mi", adjustedValue: 1730000 },
        { address: "320 Coronado Crest, San Diego CA", salePrice: 1650000, saleDate: "2026-03-02", sqft: 6500, distance: "0.9 mi", adjustedValue: 1690000 },
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
      totalPointsAndFees: 8500,
      pointsAndFeesThreshold: 12000,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "NQM-003", severity: "Info", description: "Non-QM: qualified using DSCR coverage on multifamily 5-8 units", regulation: "12 CFR 1026.43(c)" },
      ],
    },
    // LTV 70 <= 75 Pass, FICO 745 >= 720 Pass, DSCR 1.30 >= 1.00 Pass, Reserves 27.2 >= 9 Pass
    overlay: {
      programName: "DSCR Multi (5-8 Units)",
      investorName: "NQM Capital",
      maxLTV: 75,
      minFICO: 720,
      maxDTI: null,
      minDSCR: 1.0,
      minReserves: 9,
      checks: [
        { category: "LTV", rule: "Max LTV", threshold: "≤ 75%", actual: "70%", result: "Pass" },
        { category: "FICO", rule: "Min FICO", threshold: "≥ 720", actual: "745", result: "Pass" },
        { category: "DSCR", rule: "Min DSCR", threshold: "≥ 1.00", actual: "1.30", result: "Pass" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 9 mo", actual: "27.2 mo", result: "Pass" },
        { category: "Property", rule: "Property Type", threshold: "5-8 unit residential multifamily", actual: "6-unit Multi-Family", result: "Pass" },
      ],
    },
  },
};
