import { withTenantTx } from "../../../db/pool.js";
import { HOI_SCHEMA_VERSION } from "@twin/core";
import type { DocumentRef, HoiExtractionResult, HoiFieldExtractor } from "./extractor.js";

export class PortalProvidedHoiExtractor implements HoiFieldExtractor {
  async canExtract(doc: DocumentRef): Promise<boolean> {
    return withTenantTx(doc.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT 1 FROM document_extractions
          WHERE tenant_id = $1 AND document_id = $2 AND extractor_kind = $3
            AND schema_version = $4 AND source = 'portal' AND superseded_at IS NULL
          LIMIT 1`,
        [doc.tenantId, doc.documentId, doc.category, HOI_SCHEMA_VERSION],
      );
      return rows.length > 0;
    });
  }

  async extract(doc: DocumentRef): Promise<HoiExtractionResult> {
    return withTenantTx(doc.tenantId, async (c) => {
      const { rows } = await c.query<{ id: string; fields: unknown; extracted_by: string }>(
        `SELECT id, fields, extracted_by FROM document_extractions
          WHERE tenant_id = $1 AND document_id = $2 AND extractor_kind = $3
            AND schema_version = $4 AND source = 'portal' AND superseded_at IS NULL
          ORDER BY extracted_at DESC LIMIT 1`,
        [doc.tenantId, doc.documentId, doc.category, HOI_SCHEMA_VERSION],
      );
      const row = rows[0];
      if (row === undefined) {
        throw new Error(`PortalProvidedHoiExtractor.extract called when canExtract=false (document=${doc.documentId})`);
      }
      return {
        fields: row.fields as HoiExtractionResult["fields"],
        source: "portal",
        confidence: null,
        extractedBy: row.extracted_by,
        extractionId: row.id,
        schemaVersion: HOI_SCHEMA_VERSION,
      };
    });
  }
}
