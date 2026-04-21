import type { Scenario, Condition, NewCondition } from "@twin/core";
import { bankStatementStarterConditions } from "../condition-templates.js";

const extraConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "CPA license verification (state board)" },
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

// loanAmount 500000, appraised 670000, LTV 75, FICO 720, PITI 3950.75
// cpaCertifiedNetIncome 14200, derivedMonthlyIncome 14200
// piPayment ~ PITI - 550 = 3400.75; housingRatio = 3400.75 / 14200 * 100 = 23.95; totalDti = 3950.75 / 14200 * 100 = 27.82
export const nqmPnlOnlyCpa: Scenario = {
  id: "nqm-pnl-only-cpa",
  name: "NQM P&L Only — CPA Certified",
  description: "Business owner qualifying on CPA-certified P&L with strong net income.",
  loan: {
    id: "2501000107",
    nqmProgram: "PnL",
    qualifyingMethod: "PnLCPACertified",
    borrower: { fullName: "Patel, Anjali", ssnMasked: "xxx-xx-1100", dob: "1980-02-14", maritalStatus: "Married" },
    property: { street: "2100 Cypress Hill Dr", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 2006 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 500000, salesPrice: 670000, appraisedValue: 670000,
      ltv: 75, cltv: 75, hcltv: 75, noteRate: 7.125, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3950.75,
    },
    qualifying: { housingRatio: 23.95, totalDti: 27.82, piPayment: 3400.75, qualifyingRate: 7.125 },
    qualifyingWorksheet: {
      method: "PnLCPACertified",
      cpaCertifiedNetIncome: 14200,
      derivedMonthlyIncome: 14200,
    },
    income: { totalMonthlyIncome: 14200, notes: "CPA-certified P&L net income $14,200/mo" },
    assets: { totalLiquid: 88000, totalRetirement: 55000, reservesMonths: 22.3 },
    credit: {
      repScore: 720, tradelinesOpen: 6, tradelinesTotal: 9,
      tradelines: [
        { creditorName: "Chase Ink Business", accountType: "Revolving", balance: 6800, monthlyPayment: 204, limit: 25000, monthsOpen: 72, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Amex Blue Cash", accountType: "Revolving", balance: 2200, monthlyPayment: 66, limit: 15000, monthsOpen: 60, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Ally Auto", accountType: "Installment", balance: 24000, monthlyPayment: 520, limit: undefined, monthsOpen: 30, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Fifth Third Mortgage", accountType: "Mortgage", balance: 0, monthlyPayment: 0, limit: undefined, monthsOpen: 96, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Barclays Arrival", accountType: "Revolving", balance: 1450, monthlyPayment: 44, limit: 8000, monthsOpen: 48, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Kohls Charge", accountType: "Revolving", balance: 280, monthlyPayment: 12, limit: 2000, monthsOpen: 36, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 846, revolvingBalance: 10730, installmentBalance: 24000, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 34730 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Brennan, Patricia K.",
      appraisalType: "Full",
      appraisedValue: 670000,
      marketCondition: "Stable",
      neighborhoodRating: "Good",
      siteArea: "0.26 acres",
      grossLivingArea: 2350,
      roomCount: 9,
      bedroomCount: 4,
      bathroomCount: 3,
      garageSpaces: 2,
      condition: "Good",
      comparables: [
        { address: "2180 Cypress Hill Dr, Fresno CA", salePrice: 658000, saleDate: "2026-02-11", sqft: 2300, distance: "0.1 mi", adjustedValue: 664000 },
        { address: "1750 Canyon Crest Blvd, Fresno CA", salePrice: 682000, saleDate: "2026-01-21", sqft: 2450, distance: "0.5 mi", adjustedValue: 673000 },
        { address: "2450 Lakeview Dr, Fresno CA", salePrice: 645000, saleDate: "2026-03-03", sqft: 2250, distance: "0.7 mi", adjustedValue: 657000 },
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
      totalPointsAndFees: 3100,
      pointsAndFeesThreshold: 5000,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "NQM-005", severity: "Info", description: "Non-QM: income qualified via CPA-certified P&L (non-standard documentation)", regulation: "12 CFR 1026.43(c)" },
      ],
    },
    // LTV 75 <= 80 Pass, FICO 720 >= 700 Pass, DTI 27.82 <= 45 Pass, Reserves 22.3 >= 6 Pass
    overlay: {
      programName: "NQM P&L",
      investorName: "NQM Capital",
      maxLTV: 80,
      minFICO: 700,
      maxDTI: 45,
      minDSCR: null,
      minReserves: 6,
      checks: [
        { category: "LTV", rule: "Max LTV", threshold: "≤ 80%", actual: "75%", result: "Pass" },
        { category: "FICO", rule: "Min FICO", threshold: "≥ 700", actual: "720", result: "Pass" },
        { category: "DTI", rule: "Max DTI", threshold: "≤ 45%", actual: "27.82%", result: "Pass" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 6 mo", actual: "22.3 mo", result: "Pass" },
        { category: "Income", rule: "Income Documentation", threshold: "CPA-certified P&L required", actual: "CPA-certified P&L provided", result: "Pass" },
      ],
    },
  },
};
