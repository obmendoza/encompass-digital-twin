/**
 * Normalize a Condition description for collision/dedup comparison. Consumed
 * by both:
 *   - packages/core/src/reduce.ts AddCondition collision detector (silent
 *     reducer dedup on near-duplicate descriptions).
 *   - packages/api/src/services/predict-conditions/pre-underwriter.ts
 *     orchestrator dedup-key construction (so cross-resolver duplicates
 *     collapse before they become predicted_conditions rows).
 *
 * One function, two consumers. Changes to the normalization rule propagate
 * to both call sites automatically — no "must match" invariant to police.
 *
 * Algorithm (preserves the historical reducer behavior):
 *   1. Lowercase.
 *   2. Drop any character that isn't [a-z0-9].
 *   3. Truncate to 30 characters.
 */
export function normalizeConditionDescription(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
}
