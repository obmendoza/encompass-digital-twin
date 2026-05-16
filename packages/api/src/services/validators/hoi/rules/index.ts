import type { Rule } from "./types.js";
import { H1_lossPayeeMatch } from "./identity.js";

export const HOI_RULES: Rule[] = [
  H1_lossPayeeMatch,
  // H2-H12, F1-F2 added in subsequent tasks
];

export * from "./types.js";
export { H1_lossPayeeMatch };
