import type { Scenario, Condition } from "@twin/core";
import { bankStatementStarterConditions } from "../condition-templates.js";

const starter: Condition[] = bankStatementStarterConditions.map((c, i) => ({
  id: `c${i + 1}`,
  category: c.category,
  source: c.source,
  description: c.description,
  status: c.status ?? "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
}));

const edgeCondition1: Condition = {
  id: `c${bankStatementStarterConditions.length + 1}`,
  category: "PTA",
  source: "UW",
  description: "Gift funds: $45,000 (44% of down payment) from parent. Verify investor gift policy for bank statement program. If gift disallowed: LTV increases to 90%, reserves drop below 3mo minimum.",
  status: "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
};

const edgeCondition2: Condition = {
  id: `c${bankStatementStarterConditions.length + 2}`,
  category: "PTD",
  source: "UW",
  description: "Gift letter + donor bank statements + transfer documentation",
  status: "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
};

export const nqmEdgeGiftFundsNqm: Scenario = {
  id: "nqm-edge-gift-funds-nqm",
  name: "NQM Edge — Gift Funds on Non-QM",
  description: "$45,000 gift (44% of $103K down payment) from parent. NQM investor gift policy unclear — some cap at 25%, others disallow. If disallowed: LTV jumps from 80% to 90%, triggering different tier.",
  loan: {
    id: "2501000208",
    nqmProgram: "BankStatement12",
    qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "Chen, Lisa W.", ssnMasked: "xxx-xx-8836", dob: "1991-03-28", maritalStatus: "Unmarried" },
    property: { street: "9214 Harbor Glen Way", city: "San Diego", state: "CA", zip: "92131",
      propertyType: "SFR Det.", units: 1, yearBuilt: 2011 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 412000, salesPrice: 515000, appraisedValue: 520000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7.500, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3591.68,
    },
    qualifying: { housingRatio: 56.1, totalDti: 56.1, piPayment: 2880.06, qualifyingRate: 7.500 },
    qualifyingWorksheet: {
      method: "BankStatementDeposits",
      monthsCovered: 12, avgDeposits: 12800, expenseFactor: 0.5, nsfCount: 0,
      derivedMonthlyIncome: 6400,
    },
    income: {
      totalMonthlyIncome: 6400,
      notes: "Standard 12-mo bank statement qualifying",
    },
    assets: { totalLiquid: 62000, totalRetirement: 18000, reservesMonths: 4.2 },
    credit: {
      repScore: 705, tradelinesOpen: 4, tradelinesTotal: 6,
      tradelines: [
        { creditorName: "Chase Slate", accountType: "Revolving", balance: 1800, monthlyPayment: 72, limit: 8000, monthsOpen: 48, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Hyundai Motor Finance", accountType: "Installment", balance: 12500, monthlyPayment: 348, limit: undefined, monthsOpen: 30, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Citi Double Cash", accountType: "Revolving", balance: 920, monthlyPayment: 37, limit: 6000, monthsOpen: 36, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Student Loan — Navient", accountType: "Installment", balance: 28400, monthlyPayment: 310, limit: undefined, monthsOpen: 60, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 767, revolvingBalance: 2720, installmentBalance: 40900, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 43620 },
    },
    conditions: [...starter, edgeCondition1, edgeCondition2],
    documents: [
      { id: "d1", name: "12mo Bank Statements.pdf", docType: "BankStatement", linkedConditionId: "c1", status: "Received", uploadedBy: "system", uploadedAt: "2026-04-08T09:00:00.000Z" },
      { id: "d2", name: "Gift Letter — Parent.pdf", docType: "LOX", linkedConditionId: "c6", status: "Received", uploadedBy: "system", uploadedAt: "2026-04-08T09:00:00.000Z", notes: "$45,000 gift from parent — not a loan" },
      { id: "d3", name: "4506-C Signed.pdf", docType: "TaxReturn", linkedConditionId: "c3", status: "Pending", uploadedBy: "system", uploadedAt: "2026-04-08T09:00:00.000Z" },
    ],
    appraisal: {
      appraisalDate: "2026-04-06",
      appraiserName: "Nakamura, Yuki B.",
      appraisalType: "Full",
      appraisedValue: 520000,
      marketCondition: "Increasing",
      neighborhoodRating: "Good",
      siteArea: "0.17 acres",
      grossLivingArea: 2050,
      roomCount: 8,
      bedroomCount: 4,
      bathroomCount: 2.5,
      garageSpaces: 2,
      condition: "Good",
      comparables: [
        { address: "9188 Harbor Glen Way, San Diego CA", salePrice: 512000, saleDate: "2026-02-14", sqft: 2010, distance: "0.1 mi", adjustedValue: 516000 },
        { address: "4405 Torrey Hills Blvd, San Diego CA", salePrice: 528000, saleDate: "2026-01-28", sqft: 2120, distance: "0.5 mi", adjustedValue: 522000 },
        { address: "8930 Pacific Ridge Ct, San Diego CA", salePrice: 504000, saleDate: "2026-03-09", sqft: 1980, distance: "0.8 mi", adjustedValue: 511000 },
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
      totalPointsAndFees: 2540,
      pointsAndFeesThreshold: 4120,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "NQM-002", severity: "Info", description: "Income verified via bank statement deposits (non-standard documentation)", regulation: "12 CFR 1026.43(c)" },
        { code: "NQM-017", severity: "Info", description: "Gift funds comprise 44% of down payment — investor gift policy verification required", regulation: "12 CFR 1026.43(c)" },
      ],
    },
    overlay: {
      programName: "NQM Bank Statement",
      investorName: "NQM Capital",
      maxLTV: 90,
      minFICO: 660,
      maxDTI: 50,
      minDSCR: null,
      minReserves: 6,
      checks: [
        { category: "LTV", rule: "Max LTV", threshold: "≤ 90%", actual: "80% (with gift)", result: "Pass", notes: "80% LTV assumes gift eligibility. Without gift: 90% LTV exceeds program max." },
        { category: "FICO", rule: "Min FICO", threshold: "≥ 660", actual: "705", result: "Pass" },
        { category: "DTI", rule: "Max DTI", threshold: "≤ 50%", actual: "56.1%", result: "Fail" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 6 mo", actual: "4.2 mo (includes gift)", result: "Fail", notes: "Reserves 4.2 months includes gift funds. If gift excluded: reserves may drop below 3 months minimum." },
        { category: "Income", rule: "Income Documentation", threshold: "Bank statement documentation required", actual: "12mo personal bank statements provided", result: "Pass" },
      ],
    },
  },
};
