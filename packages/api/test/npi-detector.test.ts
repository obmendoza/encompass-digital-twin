import { describe, it, expect } from "vitest";
import { detectNpi } from "../src/onboarding/npi-detector.js";

describe("detectNpi", () => {
  it("detects SSN with dashes", () => {
    const result = detectNpi("Borrower SSN is 123-45-6789");
    expect(result.detected).toBe(true);
    expect(result.matchCount).toBe(1);
    expect(result.types).toContain("SSN");
  });

  it("detects SSN without dashes", () => {
    const result = detectNpi("SSN: 123456789 on file");
    expect(result.detected).toBe(true);
    expect(result.matchCount).toBe(1);
    expect(result.types).toContain("SSN");
  });

  it("detects SSN with spaces", () => {
    const result = detectNpi("SSN: 123 45 6789 recorded");
    expect(result.detected).toBe(true);
    expect(result.matchCount).toBe(1);
    expect(result.types).toContain("SSN");
  });

  it("detects account numbers (10+ digits)", () => {
    const result = detectNpi("Account 1234567890123 at Chase");
    expect(result.detected).toBe(true);
    expect(result.matchCount).toBe(1);
    expect(result.types).toContain("AccountNumber");
  });

  it("clean text returns false", () => {
    const result = detectNpi("This is a clean guideline document with no sensitive data.");
    expect(result.detected).toBe(false);
    expect(result.matchCount).toBe(0);
    expect(result.types).toHaveLength(0);
  });

  it("counts multiple matches", () => {
    const result = detectNpi(
      "Primary borrower: 111-22-3333, Co-borrower: 444-55-6666, Account: 9876543210123",
    );
    expect(result.detected).toBe(true);
    expect(result.matchCount).toBe(3);
    expect(result.types).toContain("SSN");
    expect(result.types).toContain("AccountNumber");
  });

  it("does not false-positive on short numbers", () => {
    const result = detectNpi("FICO score is 742 and LTV is 80 percent.");
    expect(result.detected).toBe(false);
    expect(result.matchCount).toBe(0);
  });
});
