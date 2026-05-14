import { describe, it, expect } from "vitest";
import { dedupFindings, type Finding } from "../src/services/predict-conditions/pre-underwriter.js";

function f(overrides: Partial<Finding> & { description: string; sourceList: Finding["sourceList"] }): Finding {
  return {
    note: null,
    category: "PTD",
    sourceRuleTable: null,
    sourceRuleId: null,
    emissionKind: "deterministic",
    ...overrides,
  };
}

describe("dedupFindings — cross-resolver priority ladder (spec §5.4)", () => {
  it("preserves single non-duplicate findings unchanged", () => {
    const input: Finding[] = [
      f({ description: "Doc A", sourceList: "minimum" }),
      f({ description: "Doc B", sourceList: "income" }),
      f({ description: "Doc C", sourceList: "matrix" }),
    ];
    const out = dedupFindings(input);
    expect(out).toHaveLength(3);
    expect(out.map(x => x.description)).toEqual(["Doc A", "Doc B", "Doc C"]);
  });

  it("collapses semantically-equal findings to the lower-priority sourceList (minimum > income > matrix > geographic > requirements)", () => {
    const input: Finding[] = [
      f({ description: "Same Doc", sourceList: "matrix", sourceRuleTable: "program_matrix_tiers", sourceRuleId: "rule-1" }),
      f({ description: "same DOC", sourceList: "minimum" }),  // normalizes equal
    ];
    const out = dedupFindings(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceList).toBe("minimum");
  });

  it("R3 — Stage A (deterministic) beats Stage B (LLM) within sourceList='requirements'", () => {
    const input: Finding[] = [
      f({
        description: "Reserves shortfall",
        sourceList: "requirements",
        emissionKind: "llm",
        sourceRuleTable: "program_requirements",
        sourceRuleId: "rule-llm",
      }),
      f({
        description: "Reserves shortfall",
        sourceList: "requirements",
        emissionKind: "deterministic",
        sourceRuleTable: "program_requirements",
        sourceRuleId: "rule-det",
      }),
    ];
    const out = dedupFindings(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.emissionKind).toBe("deterministic");
    expect(out[0]!.sourceRuleId).toBe("rule-det");
  });

  it("processes sources in the documented order (minimum, income, matrix, geographic, requirements-det, requirements-llm)", () => {
    // All findings normalize identically — only one survives. The survivor
    // tells us which step in the order won.
    const input: Finding[] = [
      f({ description: "X", sourceList: "requirements", emissionKind: "llm",            sourceRuleTable: "program_requirements", sourceRuleId: "r-llm" }),
      f({ description: "X", sourceList: "requirements", emissionKind: "deterministic",  sourceRuleTable: "program_requirements", sourceRuleId: "r-det" }),
      f({ description: "X", sourceList: "geographic",                                   sourceRuleTable: "geographic_restrictions", sourceRuleId: "g-1" }),
      f({ description: "X", sourceList: "matrix",                                       sourceRuleTable: "program_matrix_tiers", sourceRuleId: "m-1" }),
      f({ description: "X", sourceList: "income" }),
      f({ description: "X", sourceList: "minimum" }),
    ];
    const out = dedupFindings(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceList).toBe("minimum");
  });
});
