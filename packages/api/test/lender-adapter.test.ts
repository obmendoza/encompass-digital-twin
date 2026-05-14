import { beforeEach, describe, it, expect } from "vitest";
import { LenderAdapter } from "../src/ingestion/lender-adapter.js";
import type { DocumentType, Loan, AdapterConfig, LoanContextExtras } from "@twin/core";
import { registerAdapter, getAdapter, clearAdapterRegistryForTesting } from "../src/ingestion/adapter-registry.js";
import {
  type PortalPrediction,
  type PortalDocCategory,
  type EligibilityVerdict,
  type PortalAnalysisStats,
  type TransformAnalysisOutput,
  MissingExternalIdError,
} from "../src/ingestion/lender-adapter.js";

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

describe("adapter-registry", () => {
  class Good extends LenderAdapter {
    readonly adapterType = "test-good";

    extractExternalLoanId() {
      return "";
    }

    transformLoan() {
      return {};
    }

    validateLoan() {
      return { valid: true, errors: [] };
    }

    extractExternalDocId() {
      return "";
    }

    transformDocument() {
      return {
        externalDocId: "x",
        docType: "Other" as const,
        fileName: "f",
        sourceUrl: "https://h.example.com/x",
      };
    }

    validateDocument() {
      return { valid: true, errors: [] };
    }

    deriveContextFields() {
      return {};
    }
  }

  class BadName extends Good {
    readonly adapterType = "Bad_Name";
  }

  class Empty extends Good {
    readonly adapterType = "";
  }

  beforeEach(() => clearAdapterRegistryForTesting());

  it("register + lookup", () => {
    const a = new Good();
    registerAdapter(a);
    expect(getAdapter("test-good")).toBe(a);
  });

  it("getAdapter returns null for unknown type", () => {
    expect(getAdapter("does-not-exist")).toBe(null);
  });

  it("rejects non-kebab-case adapterType at registration", () => {
    expect(() => registerAdapter(new BadName())).toThrow(/kebab-case/);
  });

  it("rejects empty adapterType at registration", () => {
    expect(() => registerAdapter(new Empty())).toThrow(/kebab-case/);
  });

  it("re-registering same type overwrites (last wins) — for test seeding only", () => {
    const first = new Good();
    registerAdapter(first);
    const second = new Good();
    registerAdapter(second);
    expect(getAdapter("test-good")).toBe(second);
  });
});

describe("Spec 1.5 adapter types", () => {
  it("PortalPrediction shape is well-typed", () => {
    const p: PortalPrediction = {
      documentType: "Credit Report",
      documentCategory: "Credit",
      priority: "P0",
      appliesTo: "all_borrowers",
      specifications: ["Must be tri-merge"],
      reasonsNeeded: ["FICO validation"],
      conditions: [],
      sourceReferences: ["NQMF Guidelines"],
      severity: "SOFT-STOP",
      portalStatus: "needed",
      tags: ["credit"],
      sourceModule: "04",
    };
    expect(p.priority).toBe("P0");
  });

  it("base LenderAdapter.transformAnalysisOutput throws by default", () => {
    class StubAdapter extends LenderAdapter {
      readonly adapterType = "stub-test-spec15";
      extractExternalLoanId() { return ""; }
      transformLoan() { return {}; }
      validateLoan() { return { valid: true, errors: [] }; }
      extractExternalDocId() { return ""; }
      transformDocument() {
        return { externalDocId: "x", docType: "Other" as const, fileName: "f", sourceUrl: "https://h.example.com/x" };
      }
      validateDocument() { return { valid: true, errors: [] }; }
      deriveContextFields() { return {}; }
    }
    const a = new StubAdapter();
    expect(() => a.transformAnalysisOutput({}, { allowedFetchHosts: [], maxFileBytes: 50_000_000, identityPrefix: "QL-" })).toThrow(/not supported/);
  });

  it("MissingExternalIdError exists and is throwable", () => {
    expect(() => { throw new MissingExternalIdError("test"); }).toThrow(MissingExternalIdError);
  });
});
