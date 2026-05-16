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

  /**
   * Spec 1.5: optional. Adapters serving lenders whose portal runs its own
   * analysis implement this to convert the analyzed output into our domain shape.
   * Base default throws so non-analysis adapters fail loudly if routed here.
   */
  transformAnalysisOutput(_raw: unknown, _config: AdapterConfig): TransformAnalysisOutput {
    throw new Error(`adapter '${this.adapterType}': analysis-output channel not supported`);
  }
}

// ─── Spec 1.5: analysis-output channel ────────────────────────────────────

export type PortalDocCategory =
  | "Credit" | "Cross-Cutting" | "Compliance"
  | "Income" | "Assets" | "Property" | "Title";

export interface PortalPrediction {
  documentType: string;
  documentCategory: PortalDocCategory;
  priority: "P0" | "P1" | "P2";
  appliesTo: string;
  specifications: string[];
  reasonsNeeded: string[];
  conditions: string[];
  sourceReferences: string[];
  severity: "HARD-STOP" | "SOFT-STOP";
  portalStatus: string;
  tags: string[];
  sourceModule: string;
}

export interface EligibilityVerdict {
  eligiblePrograms: string[];
  ineligiblePrograms: string[];
  perProgram: Array<{
    program: string;
    status: "PASS" | "FAIL";
    passedCount: number;
    failedCount: number;
    failedRules: Array<{ requirement: string; message: string }>;
  }>;
}

export interface PortalAnalysisStats {
  totalDocumentRequests: number;
  hardStopDocuments: number;
  elapsedSeconds: number;
  toolCalls: number;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  byStatus: Record<string, number>;
}

export interface ExtractedDocumentPayload {
  documentExternalId: string;
  extractorKind: "hoi-policy" | "flood-cert";
  schemaVersion: number;
  fields: unknown;
  extractedAt: string;
}

export interface TransformAnalysisOutput {
  loan: Partial<Loan>;
  extras: Partial<LoanContextExtras>;
  portalPredictions: PortalPrediction[];
  eligibilityVerdict: EligibilityVerdict;
  seenConflicts: string[];
  stats: PortalAnalysisStats;
  extractedDocuments: ExtractedDocumentPayload[];
}

export class MissingExternalIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingExternalIdError";
  }
}
