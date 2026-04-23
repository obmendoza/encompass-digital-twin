import { describe, it, expect } from "vitest";
import {
  checkThresholdReasonableness,
  checkFairLending,
  determineVisibility,
} from "../src/learning/compliance-checker.js";
import type { SpecificChange } from "@twin/core";

function makeChange(path: string, to: unknown): SpecificChange {
  return { operation: "replace", path, to, scope: "Conv30" };
}

describe("checkThresholdReasonableness", () => {
  it("DTI 50% → pass", () => {
    const result = checkThresholdReasonableness(makeChange("/income/maxDtiBack", 0.50));
    expect(result.result).toBe("pass");
  });

  it("DTI 70% → block", () => {
    const result = checkThresholdReasonableness(makeChange("/income/maxDtiBack", 0.70));
    expect(result.result).toBe("block");
  });

  it("FICO 400 → block", () => {
    const result = checkThresholdReasonableness(makeChange("/credit/minFico", 400));
    expect(result.result).toBe("block");
  });

  it("LTV 98% → block", () => {
    const result = checkThresholdReasonableness(makeChange("/ltv/maxLtv", 0.98));
    expect(result.result).toBe("block");
  });

  it("ATR false → block", () => {
    const result = checkThresholdReasonableness(
      makeChange("/income/atrVerificationRequired", false),
    );
    expect(result.result).toBe("block");
    expect(result.details.reason).toContain("ATR");
  });

  it("unknown path → pass", () => {
    const result = checkThresholdReasonableness(
      makeChange("/some/unknown/path", 42),
    );
    expect(result.result).toBe("pass");
  });
});

describe("checkFairLending", () => {
  it("delta ≤5pp → pass", () => {
    const result = checkFairLending({ east: 0.20, west: 0.22 });
    expect(result.result).toBe("pass");
  });

  it("delta >5pp → warn", () => {
    const result = checkFairLending({ east: 0.10, west: 0.20 });
    expect(result.result).toBe("warn");
  });

  it("insufficient groups → pass", () => {
    const result = checkFairLending({ east: 0.20 });
    expect(result.result).toBe("pass");
  });
});

describe("determineVisibility", () => {
  it("all pass → admin", () => {
    const vis = determineVisibility([
      { checkType: "threshold_reasonableness", result: "pass", details: {} },
      { checkType: "disparate_impact", result: "pass", details: {} },
    ]);
    expect(vis).toBe("admin");
  });

  it("any block → compliance_only", () => {
    const vis = determineVisibility([
      { checkType: "threshold_reasonableness", result: "block", details: {} },
    ]);
    expect(vis).toBe("compliance_only");
  });

  it("any warn → compliance_only", () => {
    const vis = determineVisibility([
      { checkType: "disparate_impact", result: "warn", details: {} },
    ]);
    expect(vis).toBe("compliance_only");
  });
});
