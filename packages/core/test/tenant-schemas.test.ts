import { describe, expect, it } from "vitest";
import {
  TenantSlugSchema,
  SlaConfigSchema,
  CreateTenantSchema,
  GuidelineRulesSchema,
  IngestLoanRequestSchema,
} from "../src/tenant-schemas.js";
import { RESERVED_SLUGS } from "../src/tenant-types.js";

// ── TenantSlugSchema ───────────────────────────────────────────────
describe("TenantSlugSchema", () => {
  it("accepts valid slugs", () => {
    expect(TenantSlugSchema.parse("acme")).toBe("acme");
    expect(TenantSlugSchema.parse("acme-lending")).toBe("acme-lending");
    expect(TenantSlugSchema.parse("a1")).toBe("a1");
  });

  it("rejects empty string", () => {
    expect(() => TenantSlugSchema.parse("")).toThrow();
  });

  it("rejects uppercase", () => {
    expect(() => TenantSlugSchema.parse("Acme")).toThrow();
  });

  it("rejects slug starting with hyphen", () => {
    expect(() => TenantSlugSchema.parse("-acme")).toThrow();
  });

  it("rejects single character (too short)", () => {
    expect(() => TenantSlugSchema.parse("a")).toThrow();
  });

  it("rejects slug longer than 31 characters", () => {
    expect(() => TenantSlugSchema.parse("a".repeat(32))).toThrow();
  });

  it("rejects reserved slugs", () => {
    expect(() => TenantSlugSchema.parse("admin")).toThrow();
    expect(() => TenantSlugSchema.parse("api")).toThrow();
    expect(() => TenantSlugSchema.parse("platform")).toThrow();
  });

  it("rejects trailing hyphens", () => {
    expect(() => TenantSlugSchema.parse("acme-")).toThrow();
  });
});

// ── RESERVED_SLUGS ─────────────────────────────────────────────────
describe("RESERVED_SLUGS", () => {
  it("contains expected reserved words", () => {
    expect(RESERVED_SLUGS.has("admin")).toBe(true);
    expect(RESERVED_SLUGS.has("api")).toBe(true);
    expect(RESERVED_SLUGS.has("platform")).toBe(true);
    expect(RESERVED_SLUGS.has("system")).toBe(true);
    expect(RESERVED_SLUGS.has("default")).toBe(true);
  });
});

// ── SlaConfigSchema ────────────────────────────────────────────────
describe("SlaConfigSchema", () => {
  it("applies defaults when no values provided", () => {
    const result = SlaConfigSchema.parse({});
    expect(result).toEqual({
      maxQueueTimeMinutes: 30,
      maxProcessingTimeMinutes: 60,
      maxReviewTimeMinutes: 120,
      maxTotalTimeMinutes: 240,
    });
  });

  it("rejects negative values", () => {
    expect(() =>
      SlaConfigSchema.parse({ maxQueueTimeMinutes: -1 })
    ).toThrow();
  });
});

// ── CreateTenantSchema ─────────────────────────────────────────────
describe("CreateTenantSchema", () => {
  it("validates a complete create request", () => {
    const result = CreateTenantSchema.parse({
      name: "Acme Lending",
      slug: "acme-lending",
    });
    expect(result.name).toBe("Acme Lending");
    expect(result.slug).toBe("acme-lending");
  });

  it("rejects empty name", () => {
    expect(() =>
      CreateTenantSchema.parse({ name: "", slug: "acme" })
    ).toThrow();
  });
});

// ── GuidelineRulesSchema ───────────────────────────────────────────
describe("GuidelineRulesSchema", () => {
  const validRules = {
    credit: { minFico: 620, maxFico: 850 },
    income: { methods: ["BankStatementDeposits"] },
    ltv: { maxLtv: 80, maxCltv: 85 },
    reserves: { minMonths: 6 },
    documents: { required: ["BankStatement", "ID"] },
    conditions: {},
    compliance: {},
  };

  it("validates complete rules", () => {
    const result = GuidelineRulesSchema.parse(validRules);
    expect(result.credit.minFico).toBe(620);
    expect(result.ltv.maxLtv).toBe(80);
  });

  it("rejects FICO below 300", () => {
    expect(() =>
      GuidelineRulesSchema.parse({
        ...validRules,
        credit: { ...validRules.credit, minFico: 299 },
      })
    ).toThrow();
  });

  it("rejects FICO above 850", () => {
    expect(() =>
      GuidelineRulesSchema.parse({
        ...validRules,
        credit: { ...validRules.credit, maxFico: 851 },
      })
    ).toThrow();
  });

  it("limits lenderNotes to 2000 characters", () => {
    expect(() =>
      GuidelineRulesSchema.parse({
        ...validRules,
        tenantContext: { lenderNotes: "x".repeat(2001) },
      })
    ).toThrow();

    const result = GuidelineRulesSchema.parse({
      ...validRules,
      tenantContext: { lenderNotes: "x".repeat(2000) },
    });
    expect(result.tenantContext?.lenderNotes).toHaveLength(2000);
  });
});

// ── IngestLoanRequestSchema ────────────────────────────────────────
describe("IngestLoanRequestSchema", () => {
  it("validates a minimal request", () => {
    const result = IngestLoanRequestSchema.parse({
      source: "encompass",
      externalId: "EXT-001",
      loanData: { borrowerName: "Jane Doe", loanAmount: 500000 },
    });
    expect(result.externalId).toBe("EXT-001");
    expect(result.source).toBe("encompass");
  });

  it("rejects missing source", () => {
    expect(() =>
      IngestLoanRequestSchema.parse({
        externalId: "EXT-001",
        loanData: {},
      })
    ).toThrow();
  });
});
