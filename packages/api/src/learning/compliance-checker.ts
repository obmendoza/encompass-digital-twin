// ── Compliance Checker — threshold reasonableness + fair-lending ──

import type {
  SpecificChange,
  ComplianceCheckType,
  ComplianceCheckResult,
  SuggestionVisibility,
} from "@twin/core";

// ── Types ────────────────────────────────────────────────────────

export interface ComplianceCheckOutput {
  checkType: ComplianceCheckType;
  result: ComplianceCheckResult;
  details: Record<string, unknown>;
}

// ── Threshold bounds ─────────────────────────────────────────────

interface ThresholdBound {
  max?: number;
  min?: number;
  hardBlock?: { value: unknown; reason: string };
}

const THRESHOLD_BOUNDS: Record<string, ThresholdBound> = {
  "/income/maxDtiBack": { max: 0.65 },
  "/income/maxDtiFront": { max: 0.55 },
  "/credit/minFico": { min: 500 },
  "/ltv/maxLtv": { max: 0.97 },
  "/compliance/maxPointsFeesPct": { max: 0.08 },
  "/reserves/minMonths": { min: 0 },
  "/income/atrVerificationRequired": {
    hardBlock: { value: false, reason: "ATR verification cannot be disabled" },
  },
};

// ── Sensitive paths that trigger compliance checks ───────────────

const SENSITIVE_PATHS = [
  "/credit/minFico",
  "/income/maxDtiBack",
  "/income/maxDtiFront",
  "/ltv/maxLtv",
  "/reserves/minMonths",
  "/income/atrVerificationRequired",
  "/compliance/maxPointsFeesPct",
];

// ── Threshold Reasonableness ─────────────────────────────────────

export function checkThresholdReasonableness(
  change: SpecificChange,
): ComplianceCheckOutput {
  const bound = THRESHOLD_BOUNDS[change.path];

  if (!bound) {
    return {
      checkType: "threshold_reasonableness",
      result: "pass",
      details: { path: change.path, reason: "No bound defined for path" },
    };
  }

  // Hard block check
  if (bound.hardBlock && change.to === bound.hardBlock.value) {
    return {
      checkType: "threshold_reasonableness",
      result: "block",
      details: {
        path: change.path,
        proposedValue: change.to,
        reason: bound.hardBlock.reason,
      },
    };
  }

  const proposed = typeof change.to === "number" ? change.to : NaN;

  if (isNaN(proposed)) {
    return {
      checkType: "threshold_reasonableness",
      result: "pass",
      details: { path: change.path, reason: "Non-numeric value, skipping bound check" },
    };
  }

  // Max bound check
  if (bound.max != null && proposed > bound.max) {
    return {
      checkType: "threshold_reasonableness",
      result: "block",
      details: {
        path: change.path,
        proposedValue: proposed,
        maxAllowed: bound.max,
        reason: `Value ${proposed} exceeds maximum ${bound.max}`,
      },
    };
  }

  // Min bound check
  if (bound.min != null && proposed < bound.min) {
    return {
      checkType: "threshold_reasonableness",
      result: "block",
      details: {
        path: change.path,
        proposedValue: proposed,
        minAllowed: bound.min,
        reason: `Value ${proposed} below minimum ${bound.min}`,
      },
    };
  }

  return {
    checkType: "threshold_reasonableness",
    result: "pass",
    details: { path: change.path, proposedValue: proposed },
  };
}

// ── Fair Lending ─────────────────────────────────────────────────

export function checkFairLending(
  geoOverrideRates: Record<string, number>,
): ComplianceCheckOutput {
  const groups = Object.entries(geoOverrideRates);

  if (groups.length < 2) {
    return {
      checkType: "disparate_impact",
      result: "pass",
      details: { reason: "Insufficient groups for comparison" },
    };
  }

  let maxRate = -Infinity;
  let minRate = Infinity;
  let maxGroup = "";
  let minGroup = "";

  for (const [group, rate] of groups) {
    if (rate > maxRate) {
      maxRate = rate;
      maxGroup = group;
    }
    if (rate < minRate) {
      minRate = rate;
      minGroup = group;
    }
  }

  const delta = maxRate - minRate;

  if (delta > 0.05) {
    return {
      checkType: "disparate_impact",
      result: "warn",
      details: {
        maxGroup,
        maxRate,
        minGroup,
        minRate,
        delta,
        reason: `Delta ${(delta * 100).toFixed(1)}pp exceeds 5pp threshold`,
      },
    };
  }

  return {
    checkType: "disparate_impact",
    result: "pass",
    details: { delta, reason: "Within acceptable range" },
  };
}

// ── Run All Compliance Checks ────────────────────────────────────

export function runComplianceChecks(
  change: SpecificChange,
  geoRates?: Record<string, number>,
): ComplianceCheckOutput[] {
  const checks: ComplianceCheckOutput[] = [];

  const isSensitive = SENSITIVE_PATHS.some((p) => change.path.startsWith(p));

  if (isSensitive) {
    checks.push(checkThresholdReasonableness(change));

    if (geoRates) {
      checks.push(checkFairLending(geoRates));
    }
  } else {
    checks.push({
      checkType: "threshold_reasonableness",
      result: "pass",
      details: { path: change.path, reason: "Not a sensitive path" },
    });
  }

  return checks;
}

// ── Determine Visibility ─────────────────────────────────────────

export function determineVisibility(
  checks: ComplianceCheckOutput[],
): SuggestionVisibility {
  const hasBlockOrWarn = checks.some(
    (c) => c.result === "block" || c.result === "warn",
  );
  return hasBlockOrWarn ? "compliance_only" : "admin";
}
