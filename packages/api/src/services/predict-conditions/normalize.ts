// Re-export the shared normalizer from @twin/core for ergonomic imports
// inside the predict-conditions module. Single source of truth lives in
// @twin/core because the reducer also depends on it.
export { normalizeConditionDescription } from "@twin/core";
