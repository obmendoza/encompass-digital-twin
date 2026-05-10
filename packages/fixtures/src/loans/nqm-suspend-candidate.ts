import type { Scenario, Condition, NewCondition } from "@twin/core";
import { bankStatementStarterConditions } from "../condition-templates.js";

const extraConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "LOX for 3 NSF occurrences + mitigating circumstances" },
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

// loanAmount 385000, appraised 455000, LTV 85, FICO 680, PITI 3200.00
// monthsCovered 12, avgDeposits 11000, expenseFactor 0.5, nsfCount 3, derivedMonthlyIncome 5500
// piPayment = amortization(385000, 8.125, 360) = 2858.61; housingRatio = 2858.61 / 5500 * 100 = 51.97; totalDti = 3200 / 5500 * 100 = 58.18
export const nqmSuspendCandidate: Scenario = {
  id: "nqm-suspend-candidate",
  name: "NQM Bank Statement — Suspend Candidate",
  description: "High LTV, high DTI, 3 NSFs. Likely to be suspended pending LOX and mitigation.",
  loan: {
    id: "2501000111",
    nqmProgram: "Flex Select",
    qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "Brooks, Tammy", ssnMasked: "xxx-xx-5544", dob: "1988-01-09", maritalStatus: "Unmarried" },
    property: { street: "199 Willow Creek Rd", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 1997 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 385000, salesPrice: 455000, appraisedValue: 455000,
      ltv: 85, cltv: 85, hcltv: 85, noteRate: 8.125, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3200.00,
    },
    qualifying: { housingRatio: 51.97, totalDti: 58.18, piPayment: 2858.61, qualifyingRate: 8.125 },
    qualifyingWorksheet: {
      method: "BankStatementDeposits",
      monthsCovered: 12, avgDeposits: 11000, expenseFactor: 0.5, nsfCount: 3,
      derivedMonthlyIncome: 5500,
    },
    income: { totalMonthlyIncome: 5500, notes: "12mo personal bank statement avg × 50% expense factor; 3 NSFs noted" },
    assets: { totalLiquid: 32000, totalRetirement: 10000, reservesMonths: 10.0 },
    credit: {
      repScore: 680, tradelinesOpen: 4, tradelinesTotal: 7,
      tradelines: [
        { creditorName: "Milestone Mastercard", accountType: "Revolving", balance: 1800, monthlyPayment: 65, limit: 2000, monthsOpen: 36, late30: 2, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Surge Card", accountType: "Revolving", balance: 950, monthlyPayment: 40, limit: 1200, monthsOpen: 24, late30: 1, late60: 0, late90: 0, isDisputed: true },
        { creditorName: "Carmax Auto Finance", accountType: "Installment", balance: 19500, monthlyPayment: 450, limit: undefined, monthsOpen: 18, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Jefferson Capital (Coll.)", accountType: "Collection", balance: 880, monthlyPayment: 0, limit: undefined, monthsOpen: 8, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 555, revolvingBalance: 2750, installmentBalance: 19500, mortgageBalance: 0, collectionsBalance: 880, totalBalance: 23130 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Morrison, Gary L.",
      appraisalType: "Full",
      appraisedValue: 455000,
      marketCondition: "Stable",
      neighborhoodRating: "Average",
      siteArea: "0.19 acres",
      grossLivingArea: 1700,
      roomCount: 7,
      bedroomCount: 3,
      bathroomCount: 2,
      garageSpaces: 2,
      condition: "Average",
      comparables: [
        { address: "215 Willow Creek Rd, Fresno CA", salePrice: 446000, saleDate: "2026-02-17", sqft: 1660, distance: "0.1 mi", adjustedValue: 451000 },
        { address: "580 Briarwood Ct, Fresno CA", salePrice: 463000, saleDate: "2026-01-29", sqft: 1760, distance: "0.4 mi", adjustedValue: 457000 },
        { address: "340 Ridgewood Ave, Fresno CA", salePrice: 440000, saleDate: "2026-03-13", sqft: 1640, distance: "0.6 mi", adjustedValue: 448000 },
      ],
    },
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
    compliance: {
      qmStatus: "Non-QM",
      atrCompliant: true,
      hpml: false,
      hoepa: false,
      higherPricedCoveredTransaction: true,
      stateLicenseRequired: false,
      stateHighCostTest: "Pass",
      tridToleranceCure: "None",
      totalPointsAndFees: 2400,
      pointsAndFeesThreshold: 3850,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "DTI-001", severity: "Warning", description: "Total DTI 58.18% exceeds standard Non-QM guideline threshold of 55%", regulation: "12 CFR 1026.43(c)(2)" },
        { code: "HPCT-001", severity: "Warning", description: "Higher-priced covered transaction — additional disclosures and escrow required", regulation: "12 CFR 1026.35" },
      ],
    },
    // LTV 85 <= 90 Exception (high LTV requires conditions), FICO 680 >= 660 Pass, DTI 58.18 > 50 Fail, Reserves 10.0 >= 6 Pass
    overlay: {
      programName: "Flex Select — Bank Statement 12mo",
      investorName: "NQM Capital",
      maxLTV: 90,
      minFICO: 660,
      maxDTI: 50,
      minDSCR: null,
      minReserves: 6,
      checks: [
        { category: "LTV", rule: "Max LTV", threshold: "≤ 90%", actual: "85%", result: "Exception", notes: "LTV > 85% requires additional conditions and compensating factors" },
        { category: "FICO", rule: "Min FICO", threshold: "≥ 660", actual: "680", result: "Pass" },
        { category: "DTI", rule: "Max DTI", threshold: "≤ 50%", actual: "58.18%", result: "Fail" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 6 mo", actual: "10.0 mo", result: "Pass" },
        { category: "Income", rule: "Income Documentation", threshold: "Bank statement documentation required", actual: "12mo personal bank statements provided", result: "Pass" },
      ],
    },
  },
};
