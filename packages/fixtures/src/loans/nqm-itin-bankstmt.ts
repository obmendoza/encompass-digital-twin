import type { Scenario, Condition } from "@twin/core";
import { itinStarterConditions, bankStatementStarterConditions } from "../condition-templates.js";

const allTemplates = [...itinStarterConditions, ...bankStatementStarterConditions];

const starter: Condition[] = allTemplates.map((c, i) => ({
  id: `c${i + 1}`,
  category: c.category,
  source: c.source,
  description: c.description,
  status: c.status ?? "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
}));

// loanAmount 275000, appraised 345000, LTV 80, FICO 690, PITI 2295.50
// monthsCovered 12, avgDeposits 9500, expenseFactor 0.5, derivedMonthlyIncome 4750
// piPayment ~ PITI - 470 = 1825.50; housingRatio = 1825.50 / 4750 * 100 = 38.4; totalDti = 2295.50 / 4750 * 100 = 48.3
export const nqmItinBankstmt: Scenario = {
  id: "nqm-itin-bankstmt",
  name: "NQM ITIN — Bank Statement Income",
  description: "ITIN borrower qualifying on 12mo bank statement deposits; alternative credit required.",
  loan: {
    id: "2501000109",
    nqmProgram: "ITIN",
    qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "Morales, Rosa", ssnMasked: "xxx-xx-3322", dob: "1990-06-17", maritalStatus: "Married" },
    property: { street: "615 Sunflower St", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 1995 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 275000, salesPrice: 345000, appraisedValue: 345000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7.5, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 2295.50,
    },
    qualifying: { housingRatio: 38.4, totalDti: 48.3, piPayment: 1825.50, qualifyingRate: 7.5 },
    qualifyingWorksheet: {
      method: "BankStatementDeposits",
      monthsCovered: 12, avgDeposits: 9500, expenseFactor: 0.5, nsfCount: 0,
      derivedMonthlyIncome: 4750,
    },
    income: { totalMonthlyIncome: 4750, notes: "12mo personal bank statement avg × 50% expense factor" },
    assets: { totalLiquid: 38000, totalRetirement: 0, reservesMonths: 6.0 },
    credit: {
      repScore: 690, tradelinesOpen: 4, tradelinesTotal: 7,
      tradelines: [
        { creditorName: "Secured Visa (local CU)", accountType: "Revolving", balance: 350, monthlyPayment: 15, limit: 1000, monthsOpen: 24, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Rent Reporter Account", accountType: "Other", balance: 0, monthlyPayment: 0, limit: undefined, monthsOpen: 18, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Utility Credit Builder", accountType: "Other", balance: 0, monthlyPayment: 0, limit: undefined, monthsOpen: 12, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 15, revolvingBalance: 350, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 350 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Flores, Ana G.",
      appraisalType: "Full",
      appraisedValue: 345000,
      marketCondition: "Stable",
      neighborhoodRating: "Average",
      siteArea: "0.15 acres",
      grossLivingArea: 1400,
      roomCount: 6,
      bedroomCount: 3,
      bathroomCount: 2,
      garageSpaces: 1,
      condition: "Average",
      comparables: [
        { address: "635 Sunflower St, Fresno CA", salePrice: 338000, saleDate: "2026-02-19", sqft: 1380, distance: "0.1 mi", adjustedValue: 342000 },
        { address: "910 Larkspur Ct, Fresno CA", salePrice: 352000, saleDate: "2026-01-27", sqft: 1460, distance: "0.4 mi", adjustedValue: 347000 },
        { address: "420 Morning Glory Ave, Fresno CA", salePrice: 331000, saleDate: "2026-03-11", sqft: 1350, distance: "0.6 mi", adjustedValue: 339000 },
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
      totalPointsAndFees: 1750,
      pointsAndFeesThreshold: 2750,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "NQM-002", severity: "Info", description: "Income verified via bank statement deposits (non-standard documentation)", regulation: "12 CFR 1026.43(c)" },
      ],
    },
    // LTV 80 <= 80 Pass, FICO 690 >= 660 Pass, DTI 48.3 <= 50 Pass, Reserves 6.0 >= 6 Pass
    overlay: {
      programName: "NQM ITIN",
      investorName: "NQM Capital",
      maxLTV: 80,
      minFICO: 660,
      maxDTI: 50,
      minDSCR: null,
      minReserves: 6,
      checks: [
        { category: "LTV", rule: "Max LTV", threshold: "≤ 80%", actual: "80%", result: "Pass" },
        { category: "FICO", rule: "Min FICO", threshold: "≥ 660", actual: "690", result: "Pass" },
        { category: "DTI", rule: "Max DTI", threshold: "≤ 50%", actual: "48.3%", result: "Pass" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 6 mo", actual: "6.0 mo", result: "Pass" },
        { category: "Income", rule: "Income Documentation", threshold: "Bank statement documentation required", actual: "12mo personal bank statements provided", result: "Pass" },
      ],
    },
  },
};
