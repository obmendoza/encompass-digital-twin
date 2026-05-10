import type { Scenario, Condition } from "@twin/core";
import { foreignNationalStarterConditions, dscrStarterConditions } from "../condition-templates.js";

const allTemplates = [...foreignNationalStarterConditions, ...dscrStarterConditions];

const starter: Condition[] = allTemplates.map((c, i) => ({
  id: `c${i + 1}`,
  category: c.category,
  source: c.source,
  description: c.description,
  status: c.status ?? "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
}));

// loanAmount 420000, appraised 650000, LTV 65, FICO null, PITI 3410.00
// Investment DSCR: rentalIncome 3900, pitia 3410, dscrRatio 1.14
// piPayment = amortization(420000, 8.125, 360) = 3118.49; DSCR loan: housingRatio=0, totalDti=0
export const nqmForeignNational: Scenario = {
  id: "nqm-foreign-national",
  name: "NQM Foreign National — DSCR Investment",
  description: "Foreign national investor qualifying via DSCR; no US credit score; OFAC clearance required.",
  loan: {
    id: "2501000108",
    nqmProgram: "Foreign National",
    qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "Silva, Lucas", ssnMasked: "xxx-xx-2211", dob: "1977-12-05", maritalStatus: "Married" },
    property: { street: "4490 Olive Branch Way", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 2004 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 420000, salesPrice: 650000, appraisedValue: 650000,
      ltv: 65, cltv: 65, hcltv: 65, noteRate: 8.125, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, rentalIncome: 3900,
      piti: 3410.00, pitia: 3410.00, dscrRatio: 1.14,
    },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 3118.49, qualifyingRate: 8.125 },
    qualifyingWorksheet: {
      method: "DSCRCoverage",
      dscrNumerator: 3900, dscrDenominator: 3410.00,
      derivedMonthlyIncome: 0,
    },
    income: { totalMonthlyIncome: 0, notes: "Foreign national — DSCR only, no personal income qualifying" },
    assets: { totalLiquid: 120_000, totalRetirement: 0, reservesMonths: 35.2 },
    credit: {
      repScore: null, tradelinesOpen: 0, tradelinesTotal: 0,
      tradelines: [],
      liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 },
    },
    conditions: starter,
    documents: [],
    appraisal: {
      appraisalDate: "2026-04-05",
      appraiserName: "Zhang, Michelle W.",
      appraisalType: "Exterior-Only",
      appraisedValue: 650000,
      marketCondition: "Stable",
      neighborhoodRating: "Good",
      siteArea: "0.25 acres",
      grossLivingArea: 2400,
      roomCount: 9,
      bedroomCount: 4,
      bathroomCount: 3,
      garageSpaces: 2,
      condition: "Good",
      comparables: [
        { address: "4560 Olive Branch Way, Fresno CA", salePrice: 638000, saleDate: "2026-02-14", sqft: 2350, distance: "0.1 mi", adjustedValue: 645000 },
        { address: "3920 Terracina Dr, Fresno CA", salePrice: 662000, saleDate: "2026-01-20", sqft: 2500, distance: "0.4 mi", adjustedValue: 655000 },
        { address: "4780 Sunrise Pkwy, Fresno CA", salePrice: 628000, saleDate: "2026-03-09", sqft: 2300, distance: "0.6 mi", adjustedValue: 640000 },
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
      stateLicenseRequired: true,
      stateHighCostTest: "Pass",
      tridToleranceCure: "None",
      totalPointsAndFees: 2600,
      pointsAndFeesThreshold: 4200,
      pointsAndFeesPass: true,
      flags: [
        { code: "NQM-001", severity: "Info", description: "Loan originated as Non-QM product", regulation: "12 CFR 1026.43(e)" },
        { code: "NQM-003", severity: "Info", description: "Non-QM: qualified using DSCR coverage (no personal income verification)", regulation: "12 CFR 1026.43(c)" },
        { code: "FN-001", severity: "Info", description: "Foreign national borrower — state-specific licensing verification required", regulation: "CA Fin. Code §22100" },
      ],
    },
    // LTV 65 <= 70 Pass, DSCR 1.14 >= 1.0 Pass, Reserves 35.2 >= 12 Pass, Property Investment Pass, Occupancy Investment Pass
    overlay: {
      programName: "Foreign National",
      investorName: "NQM Capital",
      maxLTV: 70,
      minFICO: null,
      maxDTI: null,
      minDSCR: 1.0,
      minReserves: 12,
      checks: [
        { category: "LTV", rule: "Max LTV", threshold: "≤ 70%", actual: "65%", result: "Pass" },
        { category: "DSCR", rule: "Min DSCR", threshold: "≥ 1.0", actual: "1.14", result: "Pass" },
        { category: "Reserves", rule: "Min Reserves", threshold: "≥ 12 mo", actual: "35.2 mo", result: "Pass" },
        { category: "Property", rule: "Property Type", threshold: "Investment property required", actual: "Investment", result: "Pass" },
        { category: "Occupancy", rule: "Occupancy", threshold: "Investment occupancy required", actual: "Investment", result: "Pass" },
      ],
    },
  },
};
