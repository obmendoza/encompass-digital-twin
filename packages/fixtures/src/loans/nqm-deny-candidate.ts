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
    assets: { totalLiquid: 45000, totalRetirement: 12000, reservesMonths: 12.9 },
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
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Coleman, Frank D.",
      appraisalType: "Exterior-Only",
      appraisedValue: 515000,
      marketCondition: "Stable",
      neighborhoodRating: "Average",
      siteArea: "0.21 acres",
      grossLivingArea: 1750,
      roomCount: 7,
      bedroomCount: 3,
      bathroomCount: 2,
      garageSpaces: 2,
      condition: "Average",
      comparables: [
        { address: "3905 Dusty Trail Blvd, Fresno CA", salePrice: 505000, saleDate: "2026-02-12", sqft: 1720, distance: "0.1 mi", adjustedValue: 510000 },
        { address: "4210 Mesa Ridge Rd, Fresno CA", salePrice: 522000, saleDate: "2026-01-30", sqft: 1800, distance: "0.4 mi", adjustedValue: 516000 },
        { address: "3650 Canyon View Dr, Fresno CA", salePrice: 498000, saleDate: "2026-03-10", sqft: 1680, distance: "0.7 mi", adjustedValue: 508000 },
      ],
    },
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
    compliance: {
      qmStatus: "Non-QM",
      atrCompliant: false,
      hpml: true,
      hoepa: false,
      higherPricedCoveredTransaction: true,
      stateLicenseRequired: false,
      stateHighCostTest: "Pass",
      tridToleranceCure: "None",
      totalPointsAndFees: 2600,
      pointsAndFeesThreshold: 4100,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "ATR-001", severity: "Warning", description: "DSCR 0.72 — borrower ability-to-repay cannot be reasonably established", regulation: "12 CFR 1026.43(c)" },
        { code: "HPML-001", severity: "Warning", description: "Higher-priced mortgage loan — APR exceeds APOR threshold; escrow and appraisal requirements apply", regulation: "12 CFR 1026.35" },
        { code: "CRED-001", severity: "Warning", description: "Recent 30-day late payment (12/2025) and active collection accounts present", regulation: "12 CFR 1026.43(c)(3)" },
      ],
    },
    // LTV 80 <= 80 Pass, FICO 660 >= 620 Pass, DSCR 0.72 < 0.75 Fail, Reserves 12.9 >= 6 Pass, Property Investment Pass
    overlay: {
      programName: "NQM DSCR",
      investorName: "NQM Capital",
      maxLTV: 80,
      minFICO: 620,
      maxDTI: null,
      minDSCR: 0.75,
      minReserves: 6,
      checks: [
        { category: "LTV", rule: "Max LTV", threshold: "≤ 80%", actual: "80%", result: "Pass" },
        { category: "FICO", rule: "Min FICO", threshold: "≥ 620", actual: "660", result: "Pass" },
        { category: "DSCR", rule: "Min DSCR", threshold: "≥ 0.75", actual: "0.72", result: "Fail" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 6 mo", actual: "12.9 mo", result: "Pass" },
        { category: "Property", rule: "Property Type", threshold: "Investment property required", actual: "Investment", result: "Pass" },
      ],
    },
  },
};
