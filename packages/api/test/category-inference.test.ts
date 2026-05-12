import { describe, it, expect } from "vitest";
import { categoryInference } from "../src/services/predict-conditions/category-inference.js";

describe("categoryInference", () => {
  it("returns PTF for items mentioning 'HOI'", () => {
    expect(categoryInference({ name: "Final HOI with effective date ≥ closing" })).toBe("PTF");
  });

  it("returns PTF for items mentioning 'insurance'", () => {
    expect(categoryInference({ name: "Hazard insurance binder" })).toBe("PTF");
  });

  it("returns PTF for items prefixed with 'Final'", () => {
    expect(categoryInference({ name: "Final flood determination" })).toBe("PTF");
  });

  it("returns PTF for items mentioning 'wire instructions'", () => {
    expect(categoryInference({ name: "Wire instructions for closing" })).toBe("PTF");
  });

  it("returns PTD for ordinary intake docs (default)", () => {
    expect(categoryInference({ name: "Initial Loan Application (1003)" })).toBe("PTD");
    expect(categoryInference({ name: "Credit Report dated within 90 days" })).toBe("PTD");
    expect(categoryInference({ name: "Most recent paystub(s) reflecting 30 days of pay" })).toBe("PTD");
  });

  it("is case-insensitive on the PTF-trigger regex", () => {
    expect(categoryInference({ name: "FINAL hoi" })).toBe("PTF");
    expect(categoryInference({ name: "Recording instructions" })).toBe("PTF");
  });
});
