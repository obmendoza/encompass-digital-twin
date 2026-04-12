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
// piPayment ~ PITI - 500 = 2910.00
export const nqmForeignNational: Scenario = {
  id: "nqm-foreign-national",
  name: "NQM Foreign National — DSCR Investment",
  description: "Foreign national investor qualifying via DSCR; no US credit score; OFAC clearance required.",
  loan: {
    id: "2501000108",
    nqmProgram: "ForeignNational",
    qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "Silva, Lucas", ssnMasked: "xxx-xx-2211", dob: "1977-12-05", maritalStatus: "Married" },
    property: { street: "4490 Olive Branch Way", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 2004 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 420000, salesPrice: 650000, appraisedValue: 650000,
      ltv: 65, cltv: 65, hcltv: 65, noteRate: 8.0, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, rentalIncome: 3900,
      piti: 3410.00, pitia: 3410.00, dscrRatio: 1.14,
    },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2910.00, qualifyingRate: 8.0 },
    qualifyingWorksheet: {
      method: "DSCRCoverage",
      dscrNumerator: 3900, dscrDenominator: 3410.00,
      derivedMonthlyIncome: 0,
    },
    income: { totalMonthlyIncome: 0, notes: "Foreign national — DSCR only, no personal income qualifying" },
    assets: { totalLiquid: 120_000, totalRetirement: 0, reservesMonths: 12.0 },
    credit: { repScore: null, tradelinesOpen: 0, tradelinesTotal: 0 },
    conditions: starter,
    documents: [],
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
