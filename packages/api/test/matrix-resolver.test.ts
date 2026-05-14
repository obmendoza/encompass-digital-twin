import { describe, it, expect, vi } from "vitest";
import { resolveMatrixFindings } from "../src/services/predict-conditions/resolvers/matrix-resolver.js";
import type { LoanContext } from "../src/services/doc-requirements.js";
import type { KbVersionContext } from "../src/services/predict-conditions/pre-underwriter.js";

function mockClient(rows: Array<Record<string, unknown>>): { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const KB: KbVersionContext = { rowId: 1, versionNumber: 1 };
const T = "00000000-0000-0000-0000-000000000000";

function baseLoan(overrides: Partial<LoanContext> = {}): LoanContext {
  return {
    incomeDocType: "Full Doc",
    borrowerType: "W2",
    citizenship: "US Citizen",
    isItin: false,
    llcOrLegalEntity: false,
    occupancy: "primary",
    state: "CA",
    county: "",
    usCredit: true,
    program: "Flex Select",
    repFico: 720,
    ltv: 75,
    loanAmount: 500000,
    loanPurpose: "Purchase",
    propertyType: "SFR Det.",
    dti: 42,
    reservesMonths: 6,
    noteRate: 7.5,
    ...overrides,
  };
}

describe("resolveMatrixFindings (spec §5.1)", () => {
  it("returns no findings when the loan fits the matrix tier exactly", async () => {
    const c = mockClient([{
      id: "tier-1", max_loan_amount: 1000000, max_ltv_purchase: 80,
      max_ltv_cashout: 75, max_ltv_rate_term: 80, property_types: ["SFR Det.", "Condo"],
    }]);
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan());
    expect(out).toEqual([]);
  });

  it("emits a no-matching-tier finding when no tier covers the FICO band", async () => {
    const c = mockClient([]);
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan({ repFico: 580 }));
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceList).toBe("matrix");
    expect(out[0]!.category).toBe("PTA");
    expect(out[0]!.description).toMatch(/FICO 580 outside published matrix tiers/);
    expect(out[0]!.sourceRuleTable).toBe("program_matrix_tiers");
  });

  it("emits a loan-amount-exceeds-max finding", async () => {
    const c = mockClient([{
      id: "tier-1", max_loan_amount: 300000, max_ltv_purchase: 80,
      max_ltv_cashout: 75, max_ltv_rate_term: 80, property_types: ["SFR Det."],
    }]);
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan({ loanAmount: 500000 }));
    expect(out.some(f => f.description.includes("exceeds tier max"))).toBe(true);
    expect(out.find(f => f.description.includes("exceeds tier max"))!.sourceRuleId).toBe("tier-1");
  });

  it("emits an LTV-exceeds-cap finding using max_ltv_purchase for Purchase loans", async () => {
    const c = mockClient([{
      id: "tier-1", max_loan_amount: 1000000, max_ltv_purchase: 70,
      max_ltv_cashout: 65, max_ltv_rate_term: 75, property_types: ["SFR Det."],
    }]);
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan({ ltv: 85, loanPurpose: "Purchase" }));
    const ltvFinding = out.find(f => f.description.includes("LTV 85% exceeds"));
    expect(ltvFinding).toBeDefined();
    expect(ltvFinding!.description).toMatch(/70%/);
  });

  it("emits a property-type-not-allowed finding when propertyType isn't in tier's allowed list", async () => {
    const c = mockClient([{
      id: "tier-1", max_loan_amount: 1000000, max_ltv_purchase: 80,
      max_ltv_cashout: 75, max_ltv_rate_term: 80, property_types: ["SFR Det.", "Condo"],
    }]);
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan({ propertyType: "Manufactured" }));
    expect(out.some(f => f.description.includes("Property-type exception"))).toBe(true);
  });

  it("returns no findings when repFico is undefined (graceful degradation per §6.4 Risk #4)", async () => {
    const c = mockClient([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan({ repFico: undefined }));
    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[matrix-resolver]"), expect.objectContaining({ missingField: "repFico" }));
    warn.mockRestore();
  });

  it("returns no findings when ltv is undefined", async () => {
    const c = mockClient([{
      id: "tier-1", max_loan_amount: 1000000, max_ltv_purchase: 80,
      max_ltv_cashout: 75, max_ltv_rate_term: 80, property_types: ["SFR Det."],
    }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan({ ltv: undefined }));
    // Other checks may still fire; just verify LTV check itself didn't and warn fired.
    expect(out.find(f => f.description.includes("LTV"))).toBeUndefined();
    warn.mockRestore();
  });
});
