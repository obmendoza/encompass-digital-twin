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

// Second Lien Select — second-lien purchase on a primary residence.
// Loan: $250K (within $350K cap), CLTV 80% on a $750K appraised SFR with $350K existing 1st.
// Matrix tier (npnqm-twin kb_version=2): Primary, FICO 720-999, max loan $350K, max LTV(purchase) 85%.
export const nqmSecondLienSelect: Scenario = {
  id: "nqm-second-lien-select",
  name: "NQM Second Lien Select — HELOAN Equity Pull",
  description: "Second-lien purchase: $250K HELOAN behind a $350K first on a $750K primary residence. CLTV 80%.",
  loan: {
    id: "2501000116",
    nqmProgram: "Second Lien Select",
    qualifyingMethod: "TraditionalDocs",
    borrower: { fullName: "Hartwell, Eleanor M.", ssnMasked: "xxx-xx-7720", dob: "1969-04-30", maritalStatus: "Married" },
    property: { street: "5524 Ashbury Heights", city: "Sacramento", state: "CA", zip: "95825",
      propertyType: "SFR Det.", units: 1, yearBuilt: 1992 },
    transaction: {
      loanPurpose: "Refi-CO", loanAmount: 250000, salesPrice: 750000, appraisedValue: 750000,
      ltv: 33.33, cltv: 80, hcltv: 80, noteRate: 8.25, term: 240, amortType: "Fixed", lienPosition: 2,
      occupancy: "Primary", isInvestmentProperty: false, piti: 2127.50,
    },
    qualifying: { housingRatio: 33.06, totalDti: 41.25, piPayment: 1980.00, qualifyingRate: 8.25 },
    qualifyingWorksheet: {
      method: "TraditionalDocs",
      monthsCovered: 24,
      derivedMonthlyIncome: 6435,
    },
    income: { totalMonthlyIncome: 6435, notes: "Full-doc W-2 + paystub income; 24-mo employment history" },
    assets: { totalLiquid: 88000, totalRetirement: 215000, reservesMonths: 41.4 },
    credit: {
      repScore: 728, tradelinesOpen: 5, tradelinesTotal: 8,
      tradelines: [
        { creditorName: "Capital One Visa", accountType: "Revolving", balance: 1850, monthlyPayment: 56, limit: 12000, monthsOpen: 144, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Macy's Card", accountType: "Revolving", balance: 220, monthlyPayment: 25, limit: 2500, monthsOpen: 96, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Honda Financial", accountType: "Installment", balance: 14600, monthlyPayment: 410, limit: undefined, monthsOpen: 42, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Wells Fargo Mortgage (1st Lien)", accountType: "Mortgage", balance: 350000, monthlyPayment: 2280, limit: undefined, monthsOpen: 156, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Discover Card", accountType: "Revolving", balance: 540, monthlyPayment: 22, limit: 6000, monthsOpen: 78, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 2793, revolvingBalance: 2610, installmentBalance: 14600, mortgageBalance: 350000, collectionsBalance: 0, totalBalance: 367210 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Tan, Marcus L.",
      appraisalType: "Full",
      appraisedValue: 750000,
      marketCondition: "Stable",
      neighborhoodRating: "Good",
      siteArea: "0.18 acres",
      grossLivingArea: 2380,
      roomCount: 9,
      bedroomCount: 4,
      bathroomCount: 3,
      garageSpaces: 2,
      condition: "Good",
      comparables: [
        { address: "5612 Ashbury Heights, Sacramento CA", salePrice: 740000, saleDate: "2026-02-12", sqft: 2310, distance: "0.1 mi", adjustedValue: 745000 },
        { address: "5238 Brookline Ct, Sacramento CA", salePrice: 762000, saleDate: "2026-01-20", sqft: 2450, distance: "0.4 mi", adjustedValue: 755000 },
        { address: "5832 Larkspur Way, Sacramento CA", salePrice: 730000, saleDate: "2026-03-04", sqft: 2280, distance: "0.5 mi", adjustedValue: 738000 },
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
      totalPointsAndFees: 1850,
      pointsAndFeesThreshold: 2500,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "NQM-004", severity: "Info", description: "Second-lien position (junior to existing first mortgage)", regulation: "12 CFR 1026.43(e)" },
      ],
    },
    // CLTV 80 <= 85 Pass, FICO 728 >= 720 Pass, DTI 41.25 <= 50 Pass, Reserves 41.4 >= 6 Pass
    overlay: {
      programName: "Second Lien Select",
      investorName: "NQM Capital",
      maxLTV: 85,
      minFICO: 720,
      maxDTI: 50,
      minDSCR: null,
      minReserves: 6,
      checks: [
        { category: "LTV", rule: "Max CLTV (1st + 2nd)", threshold: "≤ 85%", actual: "80% CLTV", result: "Pass" },
        { category: "FICO", rule: "Min FICO", threshold: "≥ 720", actual: "728", result: "Pass" },
        { category: "DTI", rule: "Max DTI", threshold: "≤ 50%", actual: "41.25%", result: "Pass" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 6 mo", actual: "41.4 mo", result: "Pass" },
        { category: "Other", rule: "Lien Position", threshold: "Second lien only", actual: "Lien Position 2", result: "Pass" },
      ],
    },
  },
};
