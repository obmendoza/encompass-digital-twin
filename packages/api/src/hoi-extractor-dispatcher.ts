import { withDb } from "./db/pool.js";
import type { HoiFieldExtractor } from "./services/validators/hoi/extractor.js";
import { LlmHoiExtractor } from "./services/validators/hoi/llm-extractor.js";
import { PortalProvidedHoiExtractor } from "./services/validators/hoi/portal-provided-extractor.js";
import { CompositeHoiExtractor } from "./services/validators/hoi/composite-extractor.js";
import { trackExtractionOutcome } from "./services/validators/hoi/cost-tracker.js";
import { HOI_SCHEMA_VERSION } from "@twin/core";
import { documentIdToUuid } from "./routes/analysis-output-ingest.js";
import Anthropic from "@anthropic-ai/sdk";

const ADVISORY_LOCK = 46;
const POLL_INTERVAL_MS = 5_000;
const BATCH_LIMIT = 10;

// Doc types that feed the HOI/Flood extractor.
const HOI_FLOOD_DOC_TYPES = [
  "Hazard Insurance",
  "Homeowner Insurance",
  "Flood Certificate",
  "Flood Cert",
];

let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Override the extractor factory for tests (DI).
 * Always reset to null in afterEach so tests stay independent.
 */
let extractorOverride: ((tenantId: string) => HoiFieldExtractor) | null = null;

export function setExtractorOverride(
  fn: ((tenantId: string) => HoiFieldExtractor) | null,
): void {
  extractorOverride = fn;
}

function defaultExtractor(_tenantId: string): HoiFieldExtractor {
  const portal = new PortalProvidedHoiExtractor();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Portal-only fallback when no Anthropic credentials in env.
    return portal;
  }
  const llm = new LlmHoiExtractor(new Anthropic({ apiKey }));
  return new CompositeHoiExtractor(portal, llm, "auto");
}

/**
 * One polling cycle: acquire advisory lock 46, scan ingested_documents for
 * HOI/Flood docs that don't yet have an active extraction at the current
 * schema version, invoke the extractor for each, and persist results.
 *
 * Exported for direct use in integration tests via setExtractorOverride DI.
 */
export async function runHoiExtractorOnce(): Promise<void> {
  await withDb(async (c) => {
    const { rows: lockRows } = await c.query<{ got: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS got",
      [ADVISORY_LOCK],
    );
    if (!lockRows[0]!.got) return;

    try {
      // Fetch candidate documents. The per-row existence check below handles
      // schema-version filtering; keeping the SQL simple avoids the
      // documentIdToUuid computation problem in SQL.
      const { rows: docs } = await c.query<{
        tenant_id: string;
        loan_id: string;
        document_id: string;
        doc_type: string;
        source_url: string;
      }>(
        `SELECT tenant_id, loan_id, document_id, doc_type, source_url
           FROM ingested_documents
          WHERE doc_type = ANY($1::text[])
            AND status = 'fetched'
          ORDER BY created_at
          LIMIT $2`,
        [HOI_FLOOD_DOC_TYPES, BATCH_LIMIT],
      );

      for (const doc of docs) {
        const documentUuid = documentIdToUuid(doc.document_id);
        const category: "hoi-policy" | "flood-cert" = doc.doc_type
          .toLowerCase()
          .includes("flood")
          ? "flood-cert"
          : "hoi-policy";

        // Per-row existence check: skip if an active extraction at the current
        // schema version already exists (error rows count too — they block
        // busy-loops on permanently-failing docs).
        const { rows: existing } = await c.query<{ n: string }>(
          `SELECT 1 FROM document_extractions
            WHERE tenant_id = $1
              AND document_id = $2
              AND extractor_kind = $3
              AND schema_version = $4
              AND superseded_at IS NULL
            LIMIT 1`,
          [doc.tenant_id, documentUuid, category, HOI_SCHEMA_VERSION],
        );
        if (existing.length > 0) continue;

        const extractor = extractorOverride
          ? extractorOverride(doc.tenant_id)
          : defaultExtractor(doc.tenant_id);

        try {
          const result = await extractor.extract({
            tenantId: doc.tenant_id,
            loanId: doc.loan_id,
            documentId: documentUuid,
            category,
            storageUrl: doc.source_url,
          });

          await c.query(
            `INSERT INTO document_extractions
               (id, tenant_id, loan_id, document_id, extractor_kind, schema_version,
                source, extracted_by, fields, extraction_confidence, extraction_error)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
             ON CONFLICT (tenant_id, document_id, extractor_kind, schema_version)
               WHERE superseded_at IS NULL
               DO NOTHING`,
            [
              doc.tenant_id,
              doc.loan_id,
              documentUuid,
              category,
              HOI_SCHEMA_VERSION,
              result.source,
              result.extractedBy,
              JSON.stringify(result.fields),
              result.confidence,
              (result as { extractionError?: string }).extractionError ?? null,
            ],
          );
          trackExtractionOutcome(doc.tenant_id, category, "success");
        } catch (e) {
          const errMsg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
          console.error("[hoi-extractor] extraction failed", {
            documentId: doc.document_id,
            error: errMsg,
          });
          trackExtractionOutcome(doc.tenant_id, category, "malformed");

          // Persist the failure with extraction_error populated so the
          // per-row existence check above filters this doc next cycle —
          // preventing a busy-loop on a permanently-failing document.
          await c.query(
            `INSERT INTO document_extractions
               (id, tenant_id, loan_id, document_id, extractor_kind, schema_version,
                source, extracted_by, fields, extraction_confidence, extraction_error)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'llm-extractor', $6, '{}'::jsonb, 0, $7)
             ON CONFLICT (tenant_id, document_id, extractor_kind, schema_version)
               WHERE superseded_at IS NULL
               DO UPDATE SET
                 extraction_error = EXCLUDED.extraction_error,
                 extracted_at = NOW()`,
            [
              doc.tenant_id,
              doc.loan_id,
              documentUuid,
              category,
              HOI_SCHEMA_VERSION,
              `worker:hoi-extractor:v${HOI_SCHEMA_VERSION}:error`,
              errMsg,
            ],
          );
        }
      }
    } finally {
      await c.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK]);
    }
  });
}

export function startHoiExtractorDispatcher(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    runHoiExtractorOnce().catch((e) =>
      console.error("[hoi-extractor] Error:", e),
    );
  }, POLL_INTERVAL_MS);
  runHoiExtractorOnce().catch((e) =>
    console.error("[hoi-extractor] Initial run error:", e),
  );
  console.log(
    `[hoi-extractor] starting dispatcher (lock ${ADVISORY_LOCK}, poll ${POLL_INTERVAL_MS}ms)`,
  );
}

export function stopHoiExtractorDispatcher(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
