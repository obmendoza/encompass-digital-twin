import { describe, it, expect } from "vitest";
import { normalizeConditionDescription } from "../src/services/predict-conditions/normalize.js";

describe("normalizeConditionDescription", () => {
  // Algorithm: .toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30)
  // Must match packages/core/src/reduce.ts AddCondition collision detector.
  const cases: Array<[string, string]> = [
    ["Initial Loan Application (1003)", "initialloanapplication1003"],
    ["Final HOI with effective date ≥ closing", "finalhoiwitheffectivedateclosi"],
    ["Most recent paystub(s) reflecting 30 days of pay", "mostrecentpaystubsreflecting30"],
    ["", ""],
    ["UPPER CASE only", "uppercaseonly"],
    ["spaces and punctuation, oh my!", "spacesandpunctuationohmy"],
    ["digits 12345 stay", "digits12345stay"],
    ["unicode é and emoji 🔥 strip", "unicodeandemojistrip"],
    ["truncates after thirty characters which is the cap", "truncatesafterthirtycharacters"],
  ];

  it.each(cases)("normalizes %j → %j", (input, expected) => {
    expect(normalizeConditionDescription(input)).toBe(expected);
  });

  it("output is at most 30 chars", () => {
    expect(normalizeConditionDescription("a".repeat(100)).length).toBeLessThanOrEqual(30);
  });

  it("output is lowercase alphanumeric only", () => {
    expect(normalizeConditionDescription("Mixed Case! @#$%")).toMatch(/^[a-z0-9]*$/);
  });
});
