// ── Compliance Gating — Threshold reasonableness checks for extracted guidelines ──

import type { GuidelineRules } from "@twin/core";

export interface ThresholdCheckResult {
  field: string;
  value: number | undefined;
  bound: number;
  result: "pass" | "block";
  reason: string;
}

// ── Threshold bounds ────────────────────────────────────────────────
// These are absolute regulatory/safety maximums. Extracted guidelines
// exceeding these bounds are blocked for manual review.

interface ThresholdRule {
  field: string;
  extract: (rules: Partial<GuidelineRules>) => number | undefined;
  bound: number;
  direction: "max" | "min"; // "max" = value must be <= bound; "min" = value must be >= bound
  reason: string;
}

const THRESHOLD_RULES: ThresholdRule[] = [
  {
    field: "income.maxDtiBack",
    extract: (rules) => {
      // DTI may come from extracted data as maxDtiBack on income
      const income = rules.income as Record<string, unknown> | undefined;
      return income?.maxDtiBack != null ? Number(income.maxDtiBack) : undefined;
    },
    bound: 65,
    direction: "max",
    reason: "Back-end DTI exceeds maximum safe threshold of 65%",
  },
  {
    field: "credit.minFico",
    extract: (rules) => rules.credit?.minFico,
    bound: 500,
    direction: "min",
    reason: "Minimum FICO below regulatory floor of 500",
  },
  {
    field: "ltv.maxLtv",
    extract: (rules) => rules.ltv?.maxLtv,
    bound: 97,
    direction: "max",
    reason: "Maximum LTV exceeds safe threshold of 97%",
  },
  {
    field: "compliance.maxPointsFeesPct",
    extract: (rules) => {
      // May come as maxPointsAndFees (percentage) on compliance
      const compliance = rules.compliance as Record<string, unknown> | undefined;
      // Check both possible field names
      const val = compliance?.maxPointsFeesPct ?? compliance?.maxPointsAndFees;
      return val != null ? Number(val) : undefined;
    },
    bound: 8,
    direction: "max",
    reason: "Points and fees percentage exceeds maximum safe threshold of 8%",
  },
];

// ── Main functions ──────────────────────────────────────────────────

export function runThresholdChecks(
  rules: Partial<GuidelineRules>,
): ThresholdCheckResult[] {
  const results: ThresholdCheckResult[] = [];

  for (const rule of THRESHOLD_RULES) {
    const value = rule.extract(rules);
    if (value === undefined) continue;

    let result: "pass" | "block";
    if (rule.direction === "max") {
      result = value <= rule.bound ? "pass" : "block";
    } else {
      result = value >= rule.bound ? "pass" : "block";
    }

    results.push({
      field: rule.field,
      value,
      bound: rule.bound,
      result,
      reason: result === "block" ? rule.reason : `${rule.field} within acceptable range`,
    });
  }

  return results;
}

export function hasBlockingIssues(results: ThresholdCheckResult[]): boolean {
  return results.some((r) => r.result === "block");
}
