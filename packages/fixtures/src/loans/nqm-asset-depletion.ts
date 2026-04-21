import type { Scenario, Condition } from "@twin/core";
import { assetDepletionStarterConditions } from "../condition-templates.js";

const starter: Condition[] = assetDepletionStarterConditions.map((c, i) => ({
  id: `c${i + 1}`,
  category: c.category,
  source: c.source,
  description: c.description,
  status: c.status ?? "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
}));

// loanAmount 650000, appraised 1000000, LTV 65, FICO 730, PITI 5120.00
// totalAssets 3_100_000, depletionMonths 60, derivedMonthlyIncome 51666
// piPayment = amortization(650000, 7.5, 360) = 4544.89
// housingRatio = 4544.89 / 51666 * 100 = 8.8; totalDti = 5120 / 51666 * 100 = 9.91
export const nqmAssetDepletion: Scenario = {
  id: "nqm-asset-depletion",
  name: "NQM Asset Depletion — Retiree Purchase",
  description: "High-net-worth borrower qualifying via asset depletion over 60 months.",
  loan: {
    id: "2501000105",
    nqmProgram: "AssetDepletion",
    qualifyingMethod: "AssetDepletionMonths",
    borrower: { fullName: "Weber, Hans", ssnMasked: "xxx-xx-8855", dob: "1961-04-02", maritalStatus: "Married" },
    property: { street: "5501 Estate Dr", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 2008 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 650000, salesPrice: 1000000, appraisedValue: 1000000,
      ltv: 65, cltv: 65, hcltv: 65, noteRate: 7.5, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 5120.00,
    },
    qualifying: { housingRatio: 8.8, totalDti: 9.91, piPayment: 4544.89, qualifyingRate: 7.5 },
    qualifyingWorksheet: {
      method: "AssetDepletionMonths",
      totalAssets: 3_100_000, depletionMonths: 60,
      derivedMonthlyIncome: 51666,
    },
    income: { totalMonthlyIncome: 51666, notes: "Asset depletion: $3,100,000 / 60 months" },
    assets: { totalLiquid: 2_200_000, totalRetirement: 900_000, reservesMonths: 429.7 },
    credit: {
      repScore: 730, tradelinesOpen: 5, tradelinesTotal: 8,
      tradelines: [
        { creditorName: "Schwab Visa Signature", accountType: "Revolving", balance: 3200, monthlyPayment: 96, limit: 25000, monthsOpen: 144, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Fidelity Rewards Visa", accountType: "Revolving", balance: 1500, monthlyPayment: 45, limit: 20000, monthsOpen: 120, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Lexus Financial", accountType: "Installment", balance: 42000, monthlyPayment: 850, limit: undefined, monthsOpen: 36, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Wells Fargo Home Equity", accountType: "Revolving", balance: 0, monthlyPayment: 0, limit: 200000, monthsOpen: 60, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Citibank Mortgage", accountType: "Mortgage", balance: 0, monthlyPayment: 0, limit: undefined, monthsOpen: 180, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 991, revolvingBalance: 4700, installmentBalance: 42000, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 46700 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Thornton, Beverly A.",
      appraisalType: "Full",
      appraisedValue: 1000000,
      marketCondition: "Increasing",
      neighborhoodRating: "Good",
      siteArea: "0.45 acres",
      grossLivingArea: 2800,
      roomCount: 10,
      bedroomCount: 4,
      bathroomCount: 3.5,
      garageSpaces: 3,
      condition: "Good",
      comparables: [
        { address: "5620 Estate Dr, Fresno CA", salePrice: 985000, saleDate: "2026-02-08", sqft: 2750, distance: "0.2 mi", adjustedValue: 995000 },
        { address: "4890 Grand Oaks Blvd, Fresno CA", salePrice: 1020000, saleDate: "2026-01-25", sqft: 2900, distance: "0.5 mi", adjustedValue: 1010000 },
        { address: "5280 Ridgecrest Dr, Fresno CA", salePrice: 970000, saleDate: "2026-03-12", sqft: 2700, distance: "0.8 mi", adjustedValue: 990000 },
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
      totalPointsAndFees: 4000,
      pointsAndFeesThreshold: 6500,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "NQM-004", severity: "Info", description: "Non-QM: qualified using asset depletion methodology", regulation: "12 CFR 1026.43(c)" },
      ],
    },
    // LTV 65 <= 70 Pass, FICO 730 >= 700 Pass, Reserves 429.7 >= 12 Pass
    overlay: {
      programName: "NQM Asset Utilization",
      investorName: "NQM Capital",
      maxLTV: 70,
      minFICO: 700,
      maxDTI: null,
      minDSCR: null,
      minReserves: 12,
      checks: [
        { category: "LTV", rule: "Max LTV", threshold: "≤ 70%", actual: "65%", result: "Pass" },
        { category: "FICO", rule: "Min FICO", threshold: "≥ 700", actual: "730", result: "Pass" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 12 mo", actual: "429.7 mo", result: "Pass" },
        { category: "Income", rule: "Income Documentation", threshold: "Asset depletion methodology required", actual: "Asset depletion $3,100,000 / 60 months provided", result: "Pass" },
      ],
    },
  },
};
