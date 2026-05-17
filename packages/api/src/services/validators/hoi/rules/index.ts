import type { Rule } from "./types.js";
import { H1_lossPayeeMatch, H2_namedInsuredMatch, H3_propertyAddressMatch } from "./identity.js";
import { H4_effectiveDateWindow, H5_term12Months } from "./dates.js";
import { H6_premiumPaidInFull, H7_deductibleCap, H8_windHailIncluded, H9_coverageMinimum } from "./coverage.js";
import { H10_dscrRentLoss, H11_condoWallsInOrHo6, H12_occupancyMatch } from "./conditional.js";
import { F1_floodDeductibleCap, F2_floodCoverageMinimum } from "./flood.js";

export const HOI_RULES: Rule[] = [
  H1_lossPayeeMatch,
  H2_namedInsuredMatch,
  H3_propertyAddressMatch,
  H4_effectiveDateWindow,
  H5_term12Months,
  H6_premiumPaidInFull,
  H7_deductibleCap,
  H8_windHailIncluded,
  H9_coverageMinimum,
  H10_dscrRentLoss,
  H11_condoWallsInOrHo6,
  H12_occupancyMatch,
  F1_floodDeductibleCap,
  F2_floodCoverageMinimum,
];

export * from "./types.js";
export { H1_lossPayeeMatch, H2_namedInsuredMatch, H3_propertyAddressMatch, H4_effectiveDateWindow, H5_term12Months, H6_premiumPaidInFull, H7_deductibleCap, H8_windHailIncluded, H9_coverageMinimum, H10_dscrRentLoss, H11_condoWallsInOrHo6, H12_occupancyMatch, F1_floodDeductibleCap, F2_floodCoverageMinimum };
