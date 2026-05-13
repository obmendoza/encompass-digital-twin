import { describe, it, expect, vi } from "vitest";
import { resolveGeographicFindings } from "../src/services/predict-conditions/resolvers/geographic-resolver.js";
import type { LoanContext } from "../src/services/doc-requirements.js";
import type { KbVersionContext } from "../src/services/predict-conditions/pre-underwriter.js";

function mockClient(rows: Array<Record<string, unknown>>) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const KB: KbVersionContext = { rowId: 1, versionNumber: 1 };
const T = "00000000-0000-0000-0000-000000000000";

function baseLoan(overrides: Partial<LoanContext> = {}): LoanContext {
  return {
    incomeDocType: "Full Doc", borrowerType: "W2", citizenship: "US Citizen",
    isItin: false, llcOrLegalEntity: false, occupancy: "primary",
    state: "CA", county: "", usCredit: true, program: "Flex Select",
    ...overrides,
  };
}

describe("resolveGeographicFindings (spec §5.2)", () => {
  it("returns no findings when there are no rows for the state", async () => {
    const c = mockClient([]);
    const out = await resolveGeographicFindings(c as never, T, KB, baseLoan());
    expect(out).toEqual([]);
  });

  it("emits one finding per row that applies (no program/occupancy filter)", async () => {
    const c = mockClient([
      { id: "g-1", restriction: "Disclosure A", occupancy_affected: null, programs_affected: null, notes: null },
      { id: "g-2", restriction: "Disclosure B", occupancy_affected: null, programs_affected: null, notes: "see manual" },
    ]);
    const out = await resolveGeographicFindings(c as never, T, KB, baseLoan());
    expect(out).toHaveLength(2);
    expect(out[0]!.sourceList).toBe("geographic");
    expect(out[0]!.category).toBe("PTF");
    expect(out[0]!.description).toContain("CA-specific compliance documentation");
    expect(out[0]!.description).toContain("Disclosure A");
    expect(out[1]!.note).toBe("see manual");
  });

  it("skips a row whose programs_affected excludes the loan's program", async () => {
    const c = mockClient([
      { id: "g-1", restriction: "Flex-only disclosure", occupancy_affected: null, programs_affected: ["Flex Supreme"], notes: null },
    ]);
    const out = await resolveGeographicFindings(c as never, T, KB, baseLoan({ program: "Flex Select" }));
    expect(out).toEqual([]);
  });

  it("includes a row whose programs_affected contains the loan's program", async () => {
    const c = mockClient([
      { id: "g-1", restriction: "Flex-only disclosure", occupancy_affected: null, programs_affected: ["Flex Select", "Flex Supreme"], notes: null },
    ]);
    const out = await resolveGeographicFindings(c as never, T, KB, baseLoan({ program: "Flex Select" }));
    expect(out).toHaveLength(1);
  });

  it("skips a row whose occupancy_affected differs from the loan's occupancy", async () => {
    const c = mockClient([
      { id: "g-1", restriction: "Investment-only", occupancy_affected: "investment", programs_affected: null, notes: null },
    ]);
    const out = await resolveGeographicFindings(c as never, T, KB, baseLoan({ occupancy: "primary" }));
    expect(out).toEqual([]);
  });
});
