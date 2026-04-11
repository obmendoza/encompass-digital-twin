import type { NewCondition } from "@twin/core";

export const bankStatementStarterConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "12 months personal bank statements (all pages)" },
  { category: "PTD", source: "UW", description: "Bank statement income analysis worksheet" },
  { category: "PTD", source: "UW", description: "Signed 4506-C" },
  { category: "PTF", source: "Compliance", description: "Final HOI with effective date ≥ closing" },
];

export const dscrStarterConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "Executed lease or market rent (1007)" },
  { category: "PTD", source: "UW", description: "Property insurance with rent loss coverage" },
  { category: "PTA", source: "UW", description: "Reserves — 6 months PITIA" },
  { category: "PTF", source: "Compliance", description: "Entity docs if titled in LLC" },
];

export const assetDepletionStarterConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "60 days asset statements (all pages)" },
  { category: "PTD", source: "UW", description: "Asset depletion calculation worksheet" },
  { category: "PTA", source: "UW", description: "Source of large deposits > 1% loan amount" },
];

export const itinStarterConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "Valid ITIN letter from IRS" },
  { category: "PTD", source: "UW", description: "12 months alternative credit (rent, utilities)" },
  { category: "PTD", source: "UW", description: "Two forms of government-issued ID" },
];

export const foreignNationalStarterConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "Valid foreign passport + visa" },
  { category: "PTA", source: "UW", description: "12 months reserves in US bank" },
  { category: "PTD", source: "Compliance", description: "OFAC clearance" },
];

export const bkSeasoningStarterConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "BK discharge / dismissal papers" },
  { category: "PTD", source: "UW", description: "Letter of explanation — cause + re-established credit" },
  { category: "PTD", source: "UW", description: "Evidence of re-established credit (3 tradelines, 12mo clean)" },
];
