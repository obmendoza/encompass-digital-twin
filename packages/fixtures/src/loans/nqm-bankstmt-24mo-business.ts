import type { Scenario, Condition, NewCondition } from "@twin/core";
import { bankStatementStarterConditions } from "../condition-templates.js";

const extraConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "Explanation of NSF count > 0 on business account" },
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

// loanAmount 525000, appraised 700000, LTV 75, FICO 700, PITI 4120.00
// piPayment ~ PITI - 520 = 3600; derivedMonthlyIncome ~ 9500 (24mo avg deposits * 0.5)
// housingRatio = 3600 / 9500 * 100 = 37.89; totalDti = 4120 / 9500 * 100 = 43.37
export const nqmBankstmt24moBusiness: Scenario = {
  id: "nqm-bankstmt-24mo-business",
  name: "NQM Bank Statement 24mo — Business Account",
  description: "Self-employed using 24mo business bank statements. NSF explanation required.",
  loan: {
    id: "2501000102",
    nqmProgram: "Flex Supreme",
    qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "Okafor, Samuel", ssnMasked: "xxx-xx-5512", dob: "1979-09-22", maritalStatus: "Married" },
    property: { street: "1044 Magnolia Ave", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 2002 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 525000, salesPrice: 700000, appraisedValue: 700000,
      ltv: 75, cltv: 75, hcltv: 75, noteRate: 7.125, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 4120.00,
    },
    qualifying: { housingRatio: 37.89, totalDti: 43.37, piPayment: 3600.00, qualifyingRate: 7.125 },
    qualifyingWorksheet: {
      method: "BankStatementDeposits",
      monthsCovered: 24, avgDeposits: 19000, expenseFactor: 0.5, nsfCount: 2,
      derivedMonthlyIncome: 9500,
    },
    income: { totalMonthlyIncome: 9500, notes: "24mo business bank statement avg × 50% expense factor" },
    assets: { totalLiquid: 95000, totalRetirement: 60000, reservesMonths: 23.1 },
    credit: {
      repScore: 700, tradelinesOpen: 5, tradelinesTotal: 8,
      tradelines: [
        { creditorName: "Bank of America Visa", accountType: "Revolving", balance: 5200, monthlyPayment: 130, limit: 12000, monthsOpen: 72, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Capital One", accountType: "Revolving", balance: 1800, monthlyPayment: 55, limit: 6000, monthsOpen: 48, late30: 1, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Ford Credit", accountType: "Installment", balance: 22500, monthlyPayment: 540, limit: undefined, monthsOpen: 42, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Chase Sapphire", accountType: "Revolving", balance: 3100, monthlyPayment: 95, limit: 10000, monthsOpen: 60, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "SBA Loan", accountType: "Installment", balance: 45000, monthlyPayment: 880, limit: undefined, monthsOpen: 30, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 1700, revolvingBalance: 10100, installmentBalance: 67500, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 77600 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Nakamura, James T.",
      appraisalType: "Full",
      appraisedValue: 700000,
      marketCondition: "Increasing",
      neighborhoodRating: "Good",
      siteArea: "0.28 acres",
      grossLivingArea: 2600,
      roomCount: 9,
      bedroomCount: 4,
      bathroomCount: 3,
      garageSpaces: 2,
      condition: "Good",
      comparables: [
        { address: "1102 Magnolia Ave, Fresno CA", salePrice: 688000, saleDate: "2026-02-10", sqft: 2550, distance: "0.2 mi", adjustedValue: 695000 },
        { address: "875 Willow Park Dr, Fresno CA", salePrice: 715000, saleDate: "2026-01-18", sqft: 2700, distance: "0.5 mi", adjustedValue: 708000 },
        { address: "1320 Heritage Blvd, Fresno CA", salePrice: 693000, saleDate: "2026-03-05", sqft: 2500, distance: "0.7 mi", adjustedValue: 698000 },
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
      totalPointsAndFees: 3200,
      pointsAndFeesThreshold: 5250,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "NQM-002", severity: "Info", description: "Income verified via bank statement deposits (non-standard documentation)", regulation: "12 CFR 1026.43(c)" },
      ],
    },
    // LTV 75 <= 90 Pass, FICO 700 >= 660 Pass, DTI 43.37 <= 50 Pass, Reserves 23.1 >= 6 Pass
    overlay: {
      programName: "Flex Supreme — Bank Statement 24mo",
      investorName: "NQM Capital",
      maxLTV: 90,
      minFICO: 660,
      maxDTI: 50,
      minDSCR: null,
      minReserves: 6,
      checks: [
        { category: "LTV", rule: "Max LTV", threshold: "≤ 90%", actual: "75%", result: "Pass" },
        { category: "FICO", rule: "Min FICO", threshold: "≥ 660", actual: "700", result: "Pass" },
        { category: "DTI", rule: "Max DTI", threshold: "≤ 50%", actual: "43.37%", result: "Pass" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 6 mo", actual: "23.1 mo", result: "Pass" },
        { category: "Income", rule: "Income Documentation", threshold: "Bank statement documentation required", actual: "24mo business bank statements provided", result: "Pass" },
      ],
    },
  },
};
