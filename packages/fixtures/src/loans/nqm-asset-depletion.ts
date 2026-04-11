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
// piPayment ~ PITI - 620 = 4500.00
// housingRatio = 4500 / 51666 * 100 = 8.7; totalDti = 5120 / 51666 * 100 = 9.9
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
      ltv: 65, cltv: 65, hcltv: 65, noteRate: 7.0, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 5120.00,
    },
    qualifying: { housingRatio: 8.7, totalDti: 9.9, piPayment: 4500.00, qualifyingRate: 7.0 },
    qualifyingWorksheet: {
      method: "AssetDepletionMonths",
      totalAssets: 3_100_000, depletionMonths: 60,
      derivedMonthlyIncome: 51666,
    },
    income: { totalMonthlyIncome: 51666, notes: "Asset depletion: $3,100,000 / 60 months" },
    assets: { totalLiquid: 2_200_000, totalRetirement: 900_000, reservesMonths: 24.0 },
    credit: { repScore: 730, tradelinesOpen: 5, tradelinesTotal: 8 },
    conditions: starter,
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
