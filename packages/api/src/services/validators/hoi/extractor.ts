import type { HoiPolicyFields, FloodCertFields } from "@twin/core";

export interface DocumentRef {
  tenantId: string;
  loanId: string;
  documentId: string;
  category: "hoi-policy" | "flood-cert";
  storageUrl: string;
}

export interface HoiExtractionResult {
  fields: HoiPolicyFields | FloodCertFields;
  source: "portal" | "llm-extractor";
  confidence: number | null;
  extractedBy: string;
  extractionId: string;
  schemaVersion: number;
}

export interface HoiFieldExtractor {
  canExtract(doc: DocumentRef): Promise<boolean>;
  extract(doc: DocumentRef): Promise<HoiExtractionResult>;
}
