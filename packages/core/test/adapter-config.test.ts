import { describe, it, expect } from "vitest";
import { AdapterConfigSchema, LoanContextExtrasSchema } from "../src/adapter-config.js";

describe("AdapterConfigSchema", () => {
  it("accepts a complete config", () => {
    const r = AdapterConfigSchema.safeParse({
      programMapping: { "FlexSelect_NPNQM": "Flex Select" },
      identityPrefix: "NPNQM-",
      allowedFetchHosts: ["docs.npnqm-portal.example.com"],
      maxFileBytes: 25_000_000,
    });
    expect(r.success).toBe(true);
  });

  it("defaults allowedFetchHosts to []", () => {
    const r = AdapterConfigSchema.parse({});
    expect(r.allowedFetchHosts).toEqual([]);
    expect(r.maxFileBytes).toBe(50_000_000);
  });

  it("rejects identityPrefix without trailing dash", () => {
    const r = AdapterConfigSchema.safeParse({ identityPrefix: "NPNQM" });
    expect(r.success).toBe(false);
  });

  it("rejects allowedFetchHosts entries containing scheme or path", () => {
    expect(AdapterConfigSchema.safeParse({ allowedFetchHosts: ["https://host.example.com"] }).success).toBe(false);
    expect(AdapterConfigSchema.safeParse({ allowedFetchHosts: ["host.example.com/path"] }).success).toBe(false);
    expect(AdapterConfigSchema.safeParse({ allowedFetchHosts: ["host.example.com:8080"] }).success).toBe(false);
  });

  it("rejects maxFileBytes outside reasonable bounds", () => {
    expect(AdapterConfigSchema.safeParse({ maxFileBytes: 0 }).success).toBe(false);
    expect(AdapterConfigSchema.safeParse({ maxFileBytes: 600_000_000 }).success).toBe(false);
  });
});

describe("LoanContextExtrasSchema", () => {
  it("accepts a full extras row", () => {
    const r = LoanContextExtrasSchema.safeParse({
      repFico: 720, ltv: 80, loanAmount: 500000,
      loanPurpose: "Cash-Out Refinance",
      propertyType: "SFR Det.", dti: 38, reservesMonths: 6,
      noteRate: 7.5, county: "King County",
      isItin: false, llcOrLegalEntity: false,
    });
    expect(r.success).toBe(true);
  });

  it("rejects out-of-range repFico", () => {
    expect(LoanContextExtrasSchema.safeParse({ repFico: 50 }).success).toBe(false);
    expect(LoanContextExtrasSchema.safeParse({ repFico: 999 }).success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const r = LoanContextExtrasSchema.safeParse({ repFico: 720, mysteryField: "bad" });
    expect(r.success).toBe(false);
  });

  it("accepts partial extras (all fields optional)", () => {
    expect(LoanContextExtrasSchema.safeParse({}).success).toBe(true);
    expect(LoanContextExtrasSchema.safeParse({ repFico: 720 }).success).toBe(true);
  });
});
