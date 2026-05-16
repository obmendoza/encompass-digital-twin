import type { HoiPolicyFields } from "@twin/core";

const WIND_TRUE = ["included", "covered", "all perils", "special form", "comprehensive", "windstorm", "hail", "hurricane"];
const WIND_FALSE = ["excluded", "not covered", "exclusion", "excludes"];
const ACS_TRUE = ["actual cost sustained", "actual loss sustained"];
// const WALLS_TRUE = ["walls-in", "walls in", "unit interior", "bare walls"];  // wording field absent on schema; deferred
// const PREMIUM_PAID_TRUE = ["paid in full", "paid receipt", "premium paid", "payment in full"];  // wording field absent; deferred

const OVERRIDE_CONFIDENCE = 0.3;

function contains(haystack: string | null | undefined, needles: string[]): boolean {
  if (!haystack) return false;
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n));
}

export interface GroundingResult {
  fields: HoiPolicyFields;
  groundingErrors: Array<{ field: string; conclusion: string; reason: string }>;
}

export function groundingPass(fields: HoiPolicyFields): GroundingResult {
  const errors: GroundingResult["groundingErrors"] = [];
  const out: HoiPolicyFields = JSON.parse(JSON.stringify(fields));

  // windHailHurricane — polarity check: inclusion markers must be present and
  // exclusion markers must be absent when included=true; for included=false,
  // at least one exclusion marker must appear. This catches the canonical
  // hallucination case: "Wind and hail excluded" → included=true (R1 fix).
  // Skip grounding when wording is null — nothing to ground against.
  if (out.windHailHurricane && out.windHailHurricane.wording != null) {
    const { included, wording } = out.windHailHurricane;
    const hasInclusion = contains(wording, WIND_TRUE);
    const hasExclusion = contains(wording, WIND_FALSE);
    const supported = included ? (hasInclusion && !hasExclusion) : hasExclusion;
    if (!supported) {
      errors.push({
        field: "windHailHurricane",
        conclusion: String(included),
        reason: included
          ? "wording contains exclusion markers or lacks inclusion markers"
          : "wording does not contain exclusion markers",
      });
      out.windHailHurricane.confidence = Math.min(out.windHailHurricane.confidence, OVERRIDE_CONFIDENCE);
    }
  }

  // rentLossActualCostSustained — semantic check on rentLossWording
  if (out.rentLossActualCostSustained) {
    const { detected } = out.rentLossActualCostSustained;
    const wordingHasPhrase = contains(out.rentLossWording, ACS_TRUE);
    if (detected !== wordingHasPhrase) {
      errors.push({
        field: "rentLossActualCostSustained",
        conclusion: String(detected),
        reason: detected
          ? "wording does not contain 'actual cost sustained'"
          : "wording contains 'actual cost sustained' but detected=false",
      });
      out.rentLossActualCostSustained.confidence = Math.min(out.rentLossActualCostSustained.confidence, OVERRIDE_CONFIDENCE);
    }
  }

  // wallsInCoverage — wording field absent on schema; grounding deferred to v1.1
  // premiumPaidInFull — wording field absent on schema; grounding deferred to v1.1

  return { fields: out, groundingErrors: errors };
}
