import type { Loan, LoanContextExtras, AdapterConfig } from "@twin/core";
import { LenderAdapter, type DocumentMetadataInput, type ValidationResult } from "../lender-adapter.js";
import { GenericJsonTransformer } from "../generic-json.js";

const legacy = new GenericJsonTransformer();

export class GenericJsonAdapter extends LenderAdapter {
  readonly adapterType = "generic-json";

  extractExternalLoanId(raw: unknown): string {
    const r = raw as { externalId?: string; loanData?: { externalId?: string } };
    return r.externalId ?? r.loanData?.externalId ?? "";
  }

  transformLoan(raw: unknown, config: AdapterConfig): Partial<Loan> {
    const r = raw as { loanData?: unknown };
    const data = r.loanData ?? raw;
    const overrides = config.fieldPathOverrides;
    if (!overrides || Object.keys(overrides).length === 0) {
      return data as Partial<Loan>;
    }
    // Apply legacy field_map semantics (source -> target dot-path) via GenericJsonTransformer.
    return legacy.transform(data, overrides) as Partial<Loan>;
  }

  validateLoan(partial: Partial<Loan>): ValidationResult {
    const v = legacy.validate(partial);
    return { valid: v.valid, errors: v.errors };
  }

  extractExternalDocId(_raw: unknown): string {
    throw new Error("generic-json adapter: document channel not supported — use a typed adapter");
  }

  transformDocument(_raw: unknown, _config: AdapterConfig): DocumentMetadataInput {
    throw new Error("generic-json adapter: document channel not supported — use a typed adapter");
  }

  validateDocument(_meta: DocumentMetadataInput): ValidationResult {
    return { valid: false, errors: ["generic-json adapter does not support document channel"] };
  }

  deriveContextFields(_loan: Loan, _raw: unknown, _config: AdapterConfig): Partial<LoanContextExtras> {
    return {};
  }
}
