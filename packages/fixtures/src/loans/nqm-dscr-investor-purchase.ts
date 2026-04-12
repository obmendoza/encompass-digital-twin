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

// loanAmount 340000, appraised 460000, LTV 75, FICO 740, PITI 2890.10
// DSCR: no personal income ratios; piPayment ~ PITI - 490 = 2400.10
// dscrRatio: rentalIncome 3400 / pitia 2890.10 = 1.18
export const nqmDscrInvestorPurchase: Scenario = {
  id: "nqm-dscr-investor-purchase",
  name: "NQM DSCR — Investor Purchase",
  description: "DSCR investor purchase with healthy coverage ratio of 1.18.",
  loan: {
    id: "2501000103",
    nqmProgram: "DSCR",
    qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "Nguyen, Linh", ssnMasked: "xxx-xx-6633", dob: "1985-03-07", maritalStatus: "Unmarried" },
    property: { street: "2280 Harvest Rd", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 2005 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 340000, salesPrice: 460000, appraisedValue: 460000,
      ltv: 75, cltv: 75, hcltv: 75, noteRate: 7.375, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, rentalIncome: 3400,
      piti: 2890.10, pitia: 2890.10, dscrRatio: 1.18,
    },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2400.10, qualifyingRate: 7.375 },
    qualifyingWorksheet: {
      method: "DSCRCoverage",
      dscrNumerator: 3400, dscrDenominator: 2890.10,
      derivedMonthlyIncome: 0,
    },
    income: { totalMonthlyIncome: 0, notes: "DSCR qualifying — no personal income used" },
    assets: { totalLiquid: 62000, totalRetirement: 30000, reservesMonths: 7.0 },
    credit: {
      repScore: 740, tradelinesOpen: 6, tradelinesTotal: 9,
      tradelines: [
        { creditorName: "Chase Freedom", accountType: "Revolving", balance: 1200, monthlyPayment: 36, limit: 10000, monthsOpen: 96, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Amex Platinum", accountType: "Revolving", balance: 4500, monthlyPayment: 135, limit: 20000, monthsOpen: 72, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Tesla Motors", accountType: "Installment", balance: 31000, monthlyPayment: 720, limit: undefined, monthsOpen: 24, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "US Bank Mortgage", accountType: "Mortgage", balance: 285000, monthlyPayment: 1850, limit: undefined, monthsOpen: 84, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Discover Card", accountType: "Revolving", balance: 780, monthlyPayment: 28, limit: 5000, monthsOpen: 60, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Best Buy Financing", accountType: "Revolving", balance: 420, monthlyPayment: 18, limit: 3500, monthsOpen: 18, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 2787, revolvingBalance: 6900, installmentBalance: 31000, mortgageBalance: 285000, collectionsBalance: 0, totalBalance: 322900 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Okafor, Stephen N.",
      appraisalType: "Desktop",
      appraisedValue: 460000,
      marketCondition: "Stable",
      neighborhoodRating: "Average",
      siteArea: "0.18 acres",
      grossLivingArea: 1650,
      roomCount: 7,
      bedroomCount: 3,
      bathroomCount: 2,
      garageSpaces: 1,
      condition: "Average",
      comparables: [
        { address: "2350 Harvest Rd, Fresno CA", salePrice: 452000, saleDate: "2026-02-18", sqft: 1600, distance: "0.1 mi", adjustedValue: 457000 },
        { address: "1890 Vineyard Ct, Fresno CA", salePrice: 468000, saleDate: "2026-01-28", sqft: 1720, distance: "0.4 mi", adjustedValue: 462000 },
        { address: "2750 Farmstead Ave, Fresno CA", salePrice: 444000, saleDate: "2026-03-07", sqft: 1580, distance: "0.6 mi", adjustedValue: 454000 },
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
      totalPointsAndFees: 2100,
      pointsAndFeesThreshold: 3400,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "NQM-003", severity: "Info", description: "Non-QM: qualified using DSCR coverage (no personal income verification)", regulation: "12 CFR 1026.43(c)" },
      ],
    },
    // LTV 75 <= 80 Pass, FICO 740 >= 620 Pass, DSCR 1.18 >= 0.75 Pass, Reserves 7.0 >= 6 Pass
    overlay: {
      programName: "NQM DSCR",
      investorName: "NQM Capital",
      maxLTV: 80,
      minFICO: 620,
      maxDTI: null,
      minDSCR: 0.75,
      minReserves: 6,
      checks: [
        { category: "LTV", rule: "Max LTV", threshold: "≤ 80%", actual: "75%", result: "Pass" },
        { category: "FICO", rule: "Min FICO", threshold: "≥ 620", actual: "740", result: "Pass" },
        { category: "DSCR", rule: "Min DSCR", threshold: "≥ 0.75", actual: "1.18", result: "Pass" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 6 mo", actual: "7.0 mo", result: "Pass" },
        { category: "Property", rule: "Property Type", threshold: "Investment property required", actual: "Investment", result: "Pass" },
      ],
    },
  },
};
