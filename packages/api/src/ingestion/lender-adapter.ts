import type { Loan, DocumentType, AdapterConfig, LoanContextExtras } from "@twin/core";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface DocumentMetadataInput {
  externalDocId: string;
  docType: DocumentType;
  fileName: string;
  contentHash?: string;
  fileSize?: number;
  mimeType?: string;
  sourceUrl: string;
  classification?: string;
}

export abstract class LenderAdapter {
  abstract readonly adapterType: string;

  // Loan channel
  abstract extractExternalLoanId(raw: unknown): string;
  abstract transformLoan(raw: unknown, config: AdapterConfig): Partial<Loan>;
  abstract validateLoan(partial: Partial<Loan>): ValidationResult;

  // Document channel
  abstract extractExternalDocId(raw: unknown): string;
  abstract transformDocument(
    raw: unknown,
    config: AdapterConfig
  ): DocumentMetadataInput;
  abstract validateDocument(meta: DocumentMetadataInput): ValidationResult;

  // Context derivation — closes F2-deferred LoanContext fields
  abstract deriveContextFields(
    loan: Loan,
    raw: unknown,
    config: AdapterConfig
  ): Partial<LoanContextExtras>;
}
