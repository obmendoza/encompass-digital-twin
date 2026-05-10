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

// loanAmount 310000, appraised 450000, LTV 68.89 (310000/450000*100), FICO 760, PITI 2650.00
// DSCR sub-1: rentalIncome 2250 / pitia 2650 = 0.85
// piPayment ~ PITI - 450 = 2200.00
export const nqmDscrSub1: Scenario = {
  id: "nqm-dscr-sub-1",
  name: "NQM DSCR — Sub-1.0 Coverage",
  description: "DSCR investor purchase with below-1.0 coverage. Edge case for underwriter review.",
  loan: {
    id: "2501000104",
    nqmProgram: "Investor DSCR No Ratio",
    qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "Kohli, Priya", ssnMasked: "xxx-xx-7744", dob: "1982-11-18", maritalStatus: "Married" },
    property: { street: "3310 Vineyard Ct", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 1999 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 310000, salesPrice: 450000, appraisedValue: 450000,
      ltv: 68.89, cltv: 68.89, hcltv: 68.89, noteRate: 7.625, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, rentalIncome: 2250,
      piti: 2650.00, pitia: 2650.00, dscrRatio: 0.85,
    },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2200.00, qualifyingRate: 7.625 },
    qualifyingWorksheet: {
      method: "DSCRCoverage",
      dscrNumerator: 2250, dscrDenominator: 2650.00,
      derivedMonthlyIncome: 0,
    },
    income: { totalMonthlyIncome: 0, notes: "DSCR qualifying — no personal income used" },
    assets: { totalLiquid: 58000, totalRetirement: 40000, reservesMonths: 21.9 },
    credit: {
      repScore: 760, tradelinesOpen: 7, tradelinesTotal: 10,
      tradelines: [
        { creditorName: "Citi Double Cash", accountType: "Revolving", balance: 900, monthlyPayment: 27, limit: 12000, monthsOpen: 108, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Chase United", accountType: "Revolving", balance: 2100, monthlyPayment: 63, limit: 15000, monthsOpen: 84, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "BMW Financial", accountType: "Installment", balance: 28500, monthlyPayment: 650, limit: undefined, monthsOpen: 36, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "PNC Bank Mortgage", accountType: "Mortgage", balance: 195000, monthlyPayment: 1420, limit: undefined, monthsOpen: 96, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Costco Visa", accountType: "Revolving", balance: 650, monthlyPayment: 20, limit: 8000, monthsOpen: 48, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Apple Card", accountType: "Revolving", balance: 380, monthlyPayment: 15, limit: 4000, monthsOpen: 30, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Navient Student", accountType: "Installment", balance: 14200, monthlyPayment: 195, limit: undefined, monthsOpen: 120, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 2390, revolvingBalance: 4030, installmentBalance: 42700, mortgageBalance: 195000, collectionsBalance: 0, totalBalance: 241730 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Petersen, Lynn M.",
      appraisalType: "Desktop",
      appraisedValue: 450000,
      marketCondition: "Stable",
      neighborhoodRating: "Average",
      siteArea: "0.17 acres",
      grossLivingArea: 1550,
      roomCount: 6,
      bedroomCount: 3,
      bathroomCount: 2,
      garageSpaces: 1,
      condition: "Average",
      comparables: [
        { address: "3420 Vineyard Ct, Fresno CA", salePrice: 441000, saleDate: "2026-02-22", sqft: 1500, distance: "0.1 mi", adjustedValue: 446000 },
        { address: "2910 Valley Oak Ln, Fresno CA", salePrice: 458000, saleDate: "2026-01-16", sqft: 1620, distance: "0.5 mi", adjustedValue: 452000 },
        { address: "3180 Sunridge Way, Fresno CA", salePrice: 436000, saleDate: "2026-03-04", sqft: 1480, distance: "0.7 mi", adjustedValue: 443000 },
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
      totalPointsAndFees: 1950,
      pointsAndFeesThreshold: 3100,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "NQM-003", severity: "Info", description: "Non-QM: qualified using DSCR coverage (no personal income verification)", regulation: "12 CFR 1026.43(c)" },
      ],
    },
    // LTV 68.89 <= 80 Pass, FICO 760 >= 620 Pass, DSCR 0.85 >= 0.75 Pass, Reserves 21.9 >= 6 Pass
    overlay: {
      programName: "Investor DSCR No Ratio",
      investorName: "NQM Capital",
      maxLTV: 80,
      minFICO: 620,
      maxDTI: null,
      minDSCR: 0.75,
      minReserves: 6,
      checks: [
        { category: "LTV", rule: "Max LTV", threshold: "≤ 80%", actual: "68.89%", result: "Pass" },
        { category: "FICO", rule: "Min FICO", threshold: "≥ 620", actual: "760", result: "Pass" },
        { category: "DSCR", rule: "Min DSCR", threshold: "≥ 0.75", actual: "0.85", result: "Pass" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 6 mo", actual: "21.9 mo", result: "Pass" },
        { category: "Property", rule: "Property Type", threshold: "Investment property required", actual: "Investment", result: "Pass" },
      ],
    },
  },
};
