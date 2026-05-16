import type { Rule } from "./types.js";
import { H1_lossPayeeMatch, H2_namedInsuredMatch, H3_propertyAddressMatch } from "./identity.js";
import { H4_effectiveDateWindow, H5_term12Months } from "./dates.js";
import { H6_premiumPaidInFull } from "./coverage.js";

export const HOI_RULES: Rule[] = [
  H1_lossPayeeMatch,
  H2_namedInsuredMatch,
  H3_propertyAddressMatch,
  H4_effectiveDateWindow,
  H5_term12Months,
  H6_premiumPaidInFull,
];

export * from "./types.js";
export { H1_lossPayeeMatch, H2_namedInsuredMatch, H3_propertyAddressMatch, H4_effectiveDateWindow, H5_term12Months, H6_premiumPaidInFull };
