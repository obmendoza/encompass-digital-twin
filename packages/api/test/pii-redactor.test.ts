import { describe, it, expect } from "vitest";
import {
  redactText,
  bucketNumeric,
  checkKAnonymity,
  redactSamples,
} from "../src/learning/pii-redactor.js";

describe("redactText", () => {
  it("redacts SSN with dashes", () => {
    const { redacted, types } = redactText("SSN: 123-45-6789");
    expect(redacted).toContain("[REDACTED_SSN]");
    expect(redacted).not.toContain("123-45-6789");
    expect(types).toContain("SSN:1");
  });

  it("redacts SSN without dashes", () => {
    const { redacted, types } = redactText("SSN: 123456789");
    expect(redacted).toContain("[REDACTED_SSN]");
    expect(redacted).not.toContain("123456789");
    expect(types).toContain("SSN:1");
  });

  it("redacts partial SSN (XXX-XX-1234)", () => {
    const { redacted, types } = redactText("Last four: XXX-XX-1234");
    expect(redacted).toContain("[REDACTED_SSN]");
    expect(redacted).not.toContain("XXX-XX-1234");
    expect(types).toContain("SSN:1");
  });

  it("redacts email addresses", () => {
    const { redacted, types } = redactText("Contact: john@example.com");
    expect(redacted).toContain("[REDACTED_EMAIL]");
    expect(redacted).not.toContain("john@example.com");
    expect(types).toContain("EMAIL");
  });

  it("redacts phone numbers", () => {
    const { redacted, types } = redactText("Call (555) 123-4567");
    expect(redacted).toContain("[REDACTED_PHONE]");
    expect(redacted).not.toContain("123-4567");
    expect(types).toContain("PHONE");
  });

  it("redacts street addresses", () => {
    const { redacted, types } = redactText("Lives at 123 Main St");
    expect(redacted).toContain("[REDACTED_ADDRESS]");
    expect(redacted).not.toContain("123 Main St");
    expect(types).toContain("ADDRESS");
  });

  it("replaces known borrower names with BORROWER_1", () => {
    const { redacted, types } = redactText(
      "Borrower John Smith has good credit",
      ["John Smith"],
    );
    expect(redacted).toContain("[BORROWER_1]");
    expect(redacted).not.toContain("John Smith");
    expect(types).toContain("PERSON:1");
  });

  it("does NOT redact dollar amounts like $487500", () => {
    const { redacted } = redactText("Loan amount $487500 is approved");
    expect(redacted).toContain("$487500");
  });

  it("returns clean text unchanged", () => {
    const input = "This loan has a standard conforming profile";
    const { redacted, types } = redactText(input);
    expect(redacted).toBe(input);
    expect(types).toHaveLength(0);
  });
});

describe("bucketNumeric", () => {
  it("buckets 723 with band 5 to 720", () => {
    expect(bucketNumeric(723, 5)).toBe(720);
  });

  it("buckets exact multiples to themselves", () => {
    expect(bucketNumeric(700, 5)).toBe(700);
  });
});

describe("checkKAnonymity", () => {
  const baseSample = {
    loanProgram: "Conv30",
    occupancy: "primary",
    propertyType: "SFR",
    ficoBucket: 720,
    ltvBucket: 80,
    dtiBucket: 40,
  };

  it("passes with 3 identical records (k=3)", () => {
    const samples = [baseSample, baseSample, baseSample];
    const result = checkKAnonymity(samples, 3);
    expect(result.passes).toBe(true);
    expect(result.uniqueIndices).toHaveLength(0);
  });

  it("fails when a record is unique", () => {
    const unique = { ...baseSample, ficoBucket: 580 };
    const samples = [baseSample, baseSample, baseSample, unique];
    const result = checkKAnonymity(samples, 3);
    expect(result.passes).toBe(false);
    expect(result.uniqueIndices).toContain(3);
  });
});

describe("redactSamples", () => {
  it("produces manifests and drops unique records", () => {
    const samples = [
      {
        id: "a",
        loanProgram: "Conv30",
        occupancy: "primary",
        propertyType: "SFR",
        fico: 723,
        ltv: 82,
        dti: 41,
        rationale: "Borrower SSN 123-45-6789 looks good",
      },
      {
        id: "b",
        loanProgram: "Conv30",
        occupancy: "primary",
        propertyType: "SFR",
        fico: 724,
        ltv: 83,
        dti: 42,
        rationale: "Standard review",
      },
      {
        id: "c",
        loanProgram: "Conv30",
        occupancy: "primary",
        propertyType: "SFR",
        fico: 721,
        ltv: 81,
        dti: 40,
        rationale: "Good profile",
      },
      {
        id: "unique",
        loanProgram: "FHA30",
        occupancy: "investment",
        propertyType: "Condo",
        fico: 580,
        ltv: 96,
        dti: 55,
        rationale: "Exception case",
      },
    ];

    const result = redactSamples(samples);

    // Should have manifests for all samples
    expect(result.manifests).toHaveLength(4);

    // Unique record should be dropped
    const droppedManifest = result.manifests.find(
      (m) => m.sampleId === "unique",
    );
    expect(droppedManifest?.kAnonDropped).toBe(true);

    // Redacted output should not include the unique record
    expect(result.redacted.find((r) => r.id === "unique")).toBeUndefined();

    // SSN in rationale should be redacted
    const sampleA = result.redacted.find((r) => r.id === "a");
    expect(sampleA?.rationale).toContain("[REDACTED_SSN]");

    // Numerics should be bucketed
    expect(sampleA?.fico).toBe(720);
  });
});
