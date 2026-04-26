import { describe, it, expect } from "vitest";
import { runThresholdChecks, hasBlockingIssues } from "../src/onboarding/compliance-gating.js";
import type { GuidelineRules } from "@twin/core";

function makeRules(overrides: Record<string, unknown> = {}): Partial<GuidelineRules> {
  const base: Partial<GuidelineRules> = {
    credit: {
      minFico: 620,
      maxFico: 850,
    },
    income: {
      methods: ["BankStatementDeposits"],
      maxDtiBack: 50,
    } as GuidelineRules["income"] & { maxDtiBack?: number },
    ltv: {
      maxLtv: 90,
      maxCltv: 90,
    },
    compliance: {
      maxPointsAndFees: 5,
    },
  };

  // Apply overrides via dot-path
  for (const [path, value] of Object.entries(overrides)) {
    const parts = path.split(".");
    let target: Record<string, unknown> = base as unknown as Record<string, unknown>;
    for (let i = 0; i < parts.length - 1; i++) {
      target = target[parts[i]] as Record<string, unknown>;
    }
    target[parts[parts.length - 1]] = value;
  }

  return base;
}

describe("runThresholdChecks", () => {
  it("valid guidelines — all pass", () => {
    const results = runThresholdChecks(makeRules());
    expect(results.every((r) => r.result === "pass")).toBe(true);
    expect(hasBlockingIssues(results)).toBe(false);
  });

  it("DTI 70 — block", () => {
    const results = runThresholdChecks(makeRules({ "income.maxDtiBack": 70 }));
    const dti = results.find((r) => r.field === "income.maxDtiBack");
    expect(dti).toBeDefined();
    expect(dti!.result).toBe("block");
    expect(dti!.value).toBe(70);
    expect(dti!.bound).toBe(65);
    expect(hasBlockingIssues(results)).toBe(true);
  });

  it("FICO 400 — block", () => {
    const results = runThresholdChecks(makeRules({ "credit.minFico": 400 }));
    const fico = results.find((r) => r.field === "credit.minFico");
    expect(fico).toBeDefined();
    expect(fico!.result).toBe("block");
    expect(fico!.value).toBe(400);
    expect(fico!.bound).toBe(500);
    expect(hasBlockingIssues(results)).toBe(true);
  });

  it("LTV 98 — block", () => {
    const results = runThresholdChecks(makeRules({ "ltv.maxLtv": 98 }));
    const ltv = results.find((r) => r.field === "ltv.maxLtv");
    expect(ltv).toBeDefined();
    expect(ltv!.result).toBe("block");
    expect(ltv!.value).toBe(98);
    expect(ltv!.bound).toBe(97);
    expect(hasBlockingIssues(results)).toBe(true);
  });

  it("points & fees 9% — block", () => {
    const results = runThresholdChecks(makeRules({ "compliance.maxPointsAndFees": 9 }));
    const pf = results.find((r) => r.field === "compliance.maxPointsFeesPct");
    expect(pf).toBeDefined();
    expect(pf!.result).toBe("block");
    expect(pf!.value).toBe(9);
    expect(pf!.bound).toBe(8);
    expect(hasBlockingIssues(results)).toBe(true);
  });

  it("empty rules — no checks produced", () => {
    const results = runThresholdChecks({});
    expect(results).toHaveLength(0);
    expect(hasBlockingIssues(results)).toBe(false);
  });
});
