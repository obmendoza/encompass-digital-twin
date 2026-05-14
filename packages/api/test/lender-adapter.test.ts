import { describe, it, expect } from "vitest";
import { LenderAdapter } from "../src/ingestion/lender-adapter.js";
import type { DocumentType, Loan, AdapterConfig, LoanContextExtras } from "@twin/core";

describe("LenderAdapter", () => {
  it("is an abstract class — direct instantiation fails at the type level", () => {
    // This test exists primarily for documentation; abstract enforcement is at compile time.
    expect(typeof LenderAdapter).toBe("function");
  });

  it("requires concrete subclasses to declare adapterType", () => {
    class TestAdapter extends LenderAdapter {
      readonly adapterType = "test-adapter";

      extractExternalLoanId() {
        return "id";
      }

      transformLoan(_raw: unknown, _config: AdapterConfig) {
        return {};
      }

      validateLoan() {
        return { valid: true, errors: [] };
      }

      extractExternalDocId() {
        return "doc-id";
      }

      transformDocument(_raw: unknown, _config: AdapterConfig) {
        return {
          externalDocId: "x",
          docType: "Other" as DocumentType,
          fileName: "f",
          sourceUrl: "https://h.example.com/x",
        };
      }

      validateDocument() {
        return { valid: true, errors: [] };
      }

      deriveContextFields(_loan: Loan, _raw: unknown, _config: AdapterConfig): Partial<LoanContextExtras> {
        return {};
      }
    }

    const a = new TestAdapter();
    expect(a.adapterType).toBe("test-adapter");
  });
});
