import { describe, it, expect } from "vitest";
import { previewPatch, getAtPath, setAtPath, deleteAtPath } from "../src/learning/guideline-patcher.js";
import type { SpecificChange } from "@twin/core";
import type { GuidelineRules } from "@twin/core";

// ── Base guideline matching GuidelineRulesSchema ─────────────────
function makeBaseGuideline(): GuidelineRules {
  return {
    credit: { minFico: 620, maxFico: 850 },
    income: { methods: ["BankStatementDeposits"], minMonths: 12 },
    ltv: { maxLtv: 80, maxCltv: 85 },
    reserves: { minMonths: 6 },
    documents: { required: ["BankStatement", "ID"] },
    conditions: { autoGenerate: ["income_verification"] },
    compliance: { requireQm: true, requireAtr: true },
  };
}

function makeChange(
  operation: string,
  path: string,
  to: unknown,
  from?: unknown,
  scope = "Conv30",
): SpecificChange {
  const c: SpecificChange = { operation, path, to, scope };
  if (from !== undefined) c.from = from;
  return c;
}

// ── Helper tests ─────────────────────────────────────────────────
describe("JSON Pointer helpers", () => {
  it("getAtPath resolves nested paths", () => {
    const obj = { a: { b: { c: 42 } } };
    expect(getAtPath(obj, "/a/b/c")).toBe(42);
  });

  it("getAtPath returns undefined for missing paths", () => {
    expect(getAtPath({ a: 1 }, "/b/c")).toBeUndefined();
  });

  it("setAtPath creates intermediate objects", () => {
    const obj: Record<string, unknown> = {};
    setAtPath(obj, "/a/b/c", 99);
    expect(getAtPath(obj, "/a/b/c")).toBe(99);
  });

  it("deleteAtPath removes a key", () => {
    const obj = { a: { b: 1, c: 2 } };
    const deleted = deleteAtPath(obj, "/a/b");
    expect(deleted).toBe(true);
    expect(getAtPath(obj, "/a/b")).toBeUndefined();
    expect(getAtPath(obj, "/a/c")).toBe(2);
  });

  it("deleteAtPath returns false for missing path", () => {
    const obj = { a: 1 };
    expect(deleteAtPath(obj, "/b")).toBe(false);
  });
});

// ── previewPatch tests ───────────────────────────────────────────
describe("previewPatch", () => {
  it("replaces a value successfully", () => {
    const base = makeBaseGuideline();
    const change = makeChange("replace", "/credit/minFico", 640, 620);

    const result = previewPatch(base, change);
    expect(result.success).toBe(true);
    expect(getAtPath(result.before, "/credit/minFico")).toBe(620);
    expect(getAtPath(result.after, "/credit/minFico")).toBe(640);
  });

  it("stale-view check fails when expected value does not match", () => {
    const base = makeBaseGuideline();
    // from=600 but actual is 620
    const change = makeChange("replace", "/credit/minFico", 640, 600);

    const result = previewPatch(base, change);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Stale view");
    expect(result.error).toContain("600");
    expect(result.error).toContain("620");
  });

  it("adds a new field", () => {
    const base = makeBaseGuideline();
    const change = makeChange("add", "/reserves/liquidOnly", true);

    const result = previewPatch(base, change);
    expect(result.success).toBe(true);
    expect(getAtPath(result.after, "/reserves/liquidOnly")).toBe(true);
    expect(getAtPath(result.before, "/reserves/liquidOnly")).toBeUndefined();
  });

  it("schema evolution: replace on missing path treated as add", () => {
    const base = makeBaseGuideline();
    // minMonthsInvestment doesn't exist yet — replace should act as add
    const change = makeChange("replace", "/reserves/minMonthsInvestment", 3);

    const result = previewPatch(base, change);
    expect(result.success).toBe(true);
    expect(getAtPath(result.after, "/reserves/minMonthsInvestment")).toBe(3);
  });

  it("invalid result after patch returns success=false", () => {
    const base = makeBaseGuideline();
    // Set minFico to 200 which is below schema minimum of 300
    const change = makeChange("replace", "/credit/minFico", 200, 620);

    const result = previewPatch(base, change);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Schema validation failed");
  });

  it("remove operation deletes a field", () => {
    const base = makeBaseGuideline();
    base.reserves.liquidOnly = true;
    const change = makeChange("remove", "/reserves/liquidOnly", undefined);

    const result = previewPatch(base, change);
    expect(result.success).toBe(true);
    expect(getAtPath(result.after, "/reserves/liquidOnly")).toBeUndefined();
  });

  it("remove on missing path fails", () => {
    const base = makeBaseGuideline();
    const change = makeChange("remove", "/reserves/nonexistent", undefined);

    const result = previewPatch(base, change);
    expect(result.success).toBe(false);
    expect(result.error).toContain("does not exist");
  });

  it("does not mutate the original guideline", () => {
    const base = makeBaseGuideline();
    const originalFico = base.credit.minFico;
    const change = makeChange("replace", "/credit/minFico", 700, 620);

    previewPatch(base, change);
    expect(base.credit.minFico).toBe(originalFico);
  });
});
