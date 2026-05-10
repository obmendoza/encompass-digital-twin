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

const edgeCondition1: Condition = {
  id: `c${dscrStarterConditions.length + 1}`,
  category: "PTA",
  source: "UW",
  description: "Property flip: seller held 67 days, 56% price increase ($310K → $485K). Verify renovation scope justifies value increase. Review permits, contractor invoices, before/after photos.",
  status: "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
};

const edgeCondition2: Condition = {
  id: `c${dscrStarterConditions.length + 2}`,
  category: "PTD",
  source: "UW",
  description: "Second appraisal or desk review may be required per investor flip policy",
  status: "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
};

export const nqmEdgePropertyFlip: Scenario = {
  id: "nqm-edge-property-flip",
  name: "NQM Edge — Recent Property Flip (< 90 Days)",
  description: "Seller acquired property 67 days ago at $310K, now selling at $485K (56% appreciation). Appraised at $480K. Flip seasoning policy triggered. Renovation documented but UW must verify legitimacy.",
  loan: {
    id: "2501000207",
    nqmProgram: "Investor DSCR",
    qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "Ellis, Morgan J.", ssnMasked: "xxx-xx-6623", dob: "1986-10-05", maritalStatus: "Unmarried" },
    property: { street: "5540 Rosewood Ave", city: "Tampa", state: "FL", zip: "33606",
      propertyType: "SFR Det.", units: 1, yearBuilt: 1965 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 360000, salesPrice: 485000, appraisedValue: 480000,
      ltv: 75, cltv: 75, hcltv: 75, noteRate: 7.625, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, rentalIncome: 3100,
      piti: 2850.00, pitia: 2850.00, dscrRatio: 1.09,
    },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2547.96, qualifyingRate: 7.625 },
    qualifyingWorksheet: {
      method: "DSCRCoverage",
      dscrNumerator: 3100, dscrDenominator: 2850,
      derivedMonthlyIncome: 3100,
    },
    income: {
      totalMonthlyIncome: 3100,
      notes: "N/A — DSCR qualifying",
    },
    assets: { totalLiquid: 68000, totalRetirement: 24000, reservesMonths: 23.9 },
    credit: {
      repScore: 730, tradelinesOpen: 5, tradelinesTotal: 8,
      tradelines: [
        { creditorName: "Chase Preferred", accountType: "Revolving", balance: 4100, monthlyPayment: 123, limit: 20000, monthsOpen: 72, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Ally Auto", accountType: "Installment", balance: 21000, monthlyPayment: 548, limit: undefined, monthsOpen: 36, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "SunTrust Mortgage", accountType: "Mortgage", balance: 198000, monthlyPayment: 1380, limit: undefined, monthsOpen: 72, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Capital One Quicksilver", accountType: "Revolving", balance: 1700, monthlyPayment: 68, limit: 10000, monthsOpen: 48, late30: 0, late60: 0, late90: 0, isDisputed: false },
        { creditorName: "Best Buy Financing", accountType: "Revolving", balance: 540, monthlyPayment: 22, limit: 4000, monthsOpen: 30, late30: 0, late60: 0, late90: 0, isDisputed: false },
      ],
      liabilities: { totalMonthlyPayments: 2141, revolvingBalance: 6340, installmentBalance: 21000, mortgageBalance: 198000, collectionsBalance: 0, totalBalance: 225340 },
    },
    conditions: [...starter, edgeCondition1, edgeCondition2],
    documents: [
      { id: "d1", name: "Executed Lease Agreement.pdf", docType: "LeaseAgreement", linkedConditionId: "c1", status: "Received", uploadedBy: "system", uploadedAt: "2026-04-08T09:00:00.000Z" },
      { id: "d2", name: "Renovation Permits — City of Tampa.pdf", docType: "Other", linkedConditionId: "c5", status: "Received", uploadedBy: "system", uploadedAt: "2026-04-08T09:00:00.000Z", notes: "Permits on file: kitchen, bath, roof, HVAC" },
      { id: "d3", name: "Prior Chain of Title.pdf", docType: "Title", linkedConditionId: "c5", status: "Received", uploadedBy: "system", uploadedAt: "2026-04-08T09:00:00.000Z", notes: "Seller acquired 67 days prior at $310,000" },
      { id: "d4", name: "Contractor Invoices.pdf", docType: "Other", linkedConditionId: "c5", status: "Pending", uploadedBy: "system", uploadedAt: "2026-04-08T09:00:00.000Z" },
    ],
    appraisal: {
      appraisalDate: "2026-04-04",
      appraiserName: "Sullivan, Frank D.",
      appraisalType: "Full",
      appraisedValue: 480000,
      marketCondition: "Increasing",
      neighborhoodRating: "Average",
      siteArea: "0.14 acres",
      grossLivingArea: 1640,
      roomCount: 6,
      bedroomCount: 3,
      bathroomCount: 2,
      garageSpaces: 1,
      condition: "Good",
      comparables: [
        { address: "5512 Rosewood Ave, Tampa FL", salePrice: 465000, saleDate: "2026-02-18", sqft: 1580, distance: "0.1 mi", adjustedValue: 471000 },
        { address: "6120 Bay Breeze Blvd, Tampa FL", salePrice: 492000, saleDate: "2026-01-30", sqft: 1700, distance: "0.5 mi", adjustedValue: 487000 },
        { address: "4890 Harbor View Dr, Tampa FL", salePrice: 458000, saleDate: "2026-03-11", sqft: 1600, distance: "0.7 mi", adjustedValue: 466000 },
      ],
      notes: "FLIP ALERT: Seller acquired 67 days ago at $310,000. Current sale $485,000 (56% appreciation). Renovation permits on file. Appraiser noted substantial rehab (kitchen, bathrooms, roof, HVAC).",
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
      totalPointsAndFees: 2200,
      pointsAndFeesThreshold: 3600,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "NQM-003", severity: "Info", description: "Non-QM: qualified using DSCR coverage (no personal income verification)", regulation: "12 CFR 1026.43(c)" },
        { code: "NQM-016", severity: "Warning", description: "Property resale within 90 days — enhanced review required", regulation: "12 CFR 1026.43(c)" },
      ],
    },
    overlay: {
      programName: "Investor DSCR — Property Flip",
      investorName: "NQM Capital",
      maxLTV: 80,
      minFICO: 620,
      maxDTI: null,
      minDSCR: 1.0,
      minReserves: 6,
      checks: [
        { category: "LTV", rule: "Max LTV", threshold: "≤ 80%", actual: "75%", result: "Pass" },
        { category: "FICO", rule: "Min FICO", threshold: "≥ 620", actual: "730", result: "Pass" },
        { category: "DSCR", rule: "Min DSCR", threshold: "≥ 1.00", actual: "1.09", result: "Pass" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 6 mo", actual: "23.9 mo", result: "Pass" },
        { category: "Seasoning", rule: "Property Seasoning", threshold: "≥ 90 days prior ownership", actual: "67 days (seller)", result: "Fail", notes: "Seller held property 67 days — below 90-day flip policy threshold. 56% price increase ($310K → $485K) requires enhanced review. Renovation permits on file." },
      ],
    },
  },
};
