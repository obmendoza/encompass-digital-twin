import { describe, it, expect, vi } from "vitest";
import { handleRequirement } from "../src/services/predict-conditions/resolvers/requirements-resolver.js";
import type { LoanContext } from "../src/services/doc-requirements.js";

function loan(overrides: Partial<LoanContext> = {}): LoanContext {
  return {
    incomeDocType: "Full Doc", borrowerType: "W2", citizenship: "US Citizen",
    isItin: false, llcOrLegalEntity: false, occupancy: "primary",
    state: "CA", county: "", usCredit: true, program: "Flex Select",
    repFico: 720, ltv: 75, loanAmount: 500000, loanPurpose: "Purchase",
    propertyType: "SFR Det.", dti: 42, reservesMonths: 6, noteRate: 7.5,
    ...overrides,
  };
}

const RULE_ID = "00000000-0000-0000-0000-000000001234";

describe("handleRequirement — DTI Max", () => {
  it("fires when loan.dti exceeds parsed cap", () => {
    const out = handleRequirement(loan({ dti: 55 }),
      { id: RULE_ID, requirement_key: "DTI Max", requirement_value: "50%" });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.description).toMatch(/DTI 55%.*exceeds program max 50%/);
    expect(out.unhandled).toBe(false);
  });
  it("does not fire when loan.dti is within cap", () => {
    const out = handleRequirement(loan({ dti: 42 }),
      { id: RULE_ID, requirement_key: "DTI Max", requirement_value: "50%" });
    expect(out.findings).toEqual([]);
    expect(out.unhandled).toBe(false);
  });
  it("falls to backstop when value is unparseable", () => {
    const out = handleRequirement(loan(),
      { id: RULE_ID, requirement_key: "DTI Max", requirement_value: "case by case" });
    expect(out.unhandled).toBe(true);
  });
});

describe("handleRequirement — FICO Min", () => {
  it("fires when loan.repFico is below parsed min", () => {
    const out = handleRequirement(loan({ repFico: 600 }),
      { id: RULE_ID, requirement_key: "FICO Min", requirement_value: "660" });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.description).toMatch(/FICO 600.*below program min 660/);
  });
  it("does not fire when loan.repFico is at or above min", () => {
    const out = handleRequirement(loan({ repFico: 720 }),
      { id: RULE_ID, requirement_key: "FICO Min", requirement_value: "660" });
    expect(out.findings).toEqual([]);
  });
});

describe("handleRequirement — Reserves Min", () => {
  it("fires when reservesMonths is below parsed min", () => {
    const out = handleRequirement(loan({ reservesMonths: 3 }),
      { id: RULE_ID, requirement_key: "Reserves Min", requirement_value: "6 months" });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.category).toBe("PTD");
  });
  it("does not fire when reserves are sufficient", () => {
    const out = handleRequirement(loan({ reservesMonths: 12 }),
      { id: RULE_ID, requirement_key: "Reserves Min", requirement_value: "6 months" });
    expect(out.findings).toEqual([]);
  });
});

describe("handleRequirement — Loan Amounts", () => {
  it("fires when loan.loanAmount is below parsed minimum", () => {
    const out = handleRequirement(loan({ loanAmount: 50000 }),
      { id: RULE_ID, requirement_key: "Loan Amounts", requirement_value: "Minimum $100,000 and Max $3,000,000" });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.description).toMatch(/outside program range/);
  });
  it("fires when loan.loanAmount is above parsed max", () => {
    const out = handleRequirement(loan({ loanAmount: 4000000 }),
      { id: RULE_ID, requirement_key: "Loan Amounts", requirement_value: "Minimum $100,000 and Max $3,000,000" });
    expect(out.findings).toHaveLength(1);
  });
  it("falls to backstop when value has no parseable min/max", () => {
    const out = handleRequirement(loan(),
      { id: RULE_ID, requirement_key: "Loan Amounts", requirement_value: "see attached supplement" });
    expect(out.unhandled).toBe(true);
  });
});

describe("handleRequirement — Exceptions / Loan Purpose / Interest Only", () => {
  it("Exceptions=Ineligible always fires a UW-review finding", () => {
    const out = handleRequirement(loan(),
      { id: RULE_ID, requirement_key: "Exceptions", requirement_value: "Ineligible" });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.description).toMatch(/does not permit exceptions/);
  });
  it("Loan Purpose: fires when loan.loanPurpose isn't in the permitted prose", () => {
    const out = handleRequirement(loan({ loanPurpose: "Cash-Out Refinance" }),
      { id: RULE_ID, requirement_key: "Loan Purpose", requirement_value: "Purchase, Rate & Term Refinance" });
    expect(out.findings).toHaveLength(1);
  });
  it("Loan Purpose: does not fire when purpose appears in prose", () => {
    const out = handleRequirement(loan({ loanPurpose: "Purchase" }),
      { id: RULE_ID, requirement_key: "Loan Purpose", requirement_value: "Purchase, Rate & Term Refinance and Cash-Out" });
    expect(out.findings).toEqual([]);
  });
});

describe("handleRequirement — unknown key", () => {
  it("returns unhandled for any requirement_key not in the dispatch table", () => {
    const out = handleRequirement(loan(),
      { id: RULE_ID, requirement_key: "Some Future Rule", requirement_value: "anything" });
    expect(out.unhandled).toBe(true);
  });
});

describe("handleRequirement — graceful degradation on missing v2 fields", () => {
  it("DTI Max returns no findings + warn when loan.dti is undefined", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = handleRequirement(loan({ dti: undefined }),
      { id: RULE_ID, requirement_key: "DTI Max", requirement_value: "50%" });
    expect(out.findings).toEqual([]);
    expect(out.unhandled).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[requirements-resolver]"), expect.objectContaining({ missingField: "dti" }));
    warn.mockRestore();
  });
});
