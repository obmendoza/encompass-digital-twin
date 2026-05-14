import { describe, it, expect } from "vitest";
import { GenericJsonAdapter } from "../src/ingestion/adapters/generic-json-adapter.js";

describe("GenericJsonAdapter", () => {
  const adapter = new GenericJsonAdapter();
  const config = { allowedFetchHosts: [], maxFileBytes: 50_000_000, identityPrefix: "QL-" as const };

  it("adapterType is kebab-case generic-json", () => {
    expect(adapter.adapterType).toBe("generic-json");
  });

  it("transformLoan returns the loanData unchanged when no fieldMap is supplied", () => {
    const raw = { externalId: "EXT-1", loanData: { transaction: { loanAmount: 500000 } } };
    const partial = adapter.transformLoan(raw, config);
    expect(partial.transaction?.loanAmount).toBe(500000);
  });

  it("extractExternalLoanId reads loanData.externalId or raw.externalId", () => {
    expect(adapter.extractExternalLoanId({ externalId: "EXT-9" })).toBe("EXT-9");
  });

  it("validateLoan enforces legacy requirements (borrower.fullName, transaction.loanAmount)", () => {
    const valid = { borrower: { fullName: "John Doe" }, transaction: { loanAmount: 100 } };
    const missing = { transaction: { loanAmount: 100 } as never };
    expect(adapter.validateLoan(valid).valid).toBe(true);
    expect(adapter.validateLoan(missing).valid).toBe(false);
  });

  it("transformDocument throws (channel not supported by generic adapter)", () => {
    expect(() => adapter.transformDocument({}, config)).toThrow(/not supported/);
  });

  it("deriveContextFields returns empty (no derivation for generic JSON)", () => {
    expect(adapter.deriveContextFields({} as never, {}, config)).toEqual({});
  });

  it("transformLoan applies fieldPathOverrides for legacy field_map compat", () => {
    // fieldPathOverrides uses legacy source->target dot-path semantics
    // (same as GenericJsonTransformer.transform's fieldMap argument).
    const raw = { loanData: { external: { loan: { amt: 500000 }, b: { name: "Test Borrower" } } } };
    const configWithOverrides = {
      ...config,
      fieldPathOverrides: {
        "external.loan.amt": "transaction.loanAmount",
        "external.b.name": "borrower.fullName",
      },
    };
    const partial = adapter.transformLoan(raw, configWithOverrides);
    expect(partial.transaction?.loanAmount).toBe(500000);
    expect(partial.borrower?.fullName).toBe("Test Borrower");
  });
});
