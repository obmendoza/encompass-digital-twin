// Layer 2 integration tests for hoi-extractor-dispatcher.
// Uses a real DB connection; migrations 025 + 026 must be applied.
// The Anthropic SDK is never invoked — all extraction is stubbed via the DI
// hook (setExtractorOverride / setExtractorOverride(null) teardown).

import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    for (const line of readFileSync(resolvePath(here, "../.env"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* .env may not exist in CI */ }
}

import { describe, test, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from "vitest";
import { withDb, closePool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";
import { randomUUID } from "node:crypto";
import { runHoiExtractorOnce, setExtractorOverride } from "../src/hoi-extractor-dispatcher.js";
import { documentIdToUuid } from "../src/routes/analysis-output-ingest.js";
import { HOI_SCHEMA_VERSION } from "@twin/core";
import type { HoiFieldExtractor, DocumentRef, HoiExtractionResult } from "../src/services/validators/hoi/extractor.js";

// ── Fixture tenants ──────────────────────────────────────────────────────────

// Tenant A — primary test tenant
const TENANT_A = "5d175193-6ee2-4d6a-b16e-f1777f7e0017";
// Tenant B — isolation check
const TENANT_B = "5d175193-6ee2-4d6a-b16e-f1777f7e0018";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDocId(): string {
  // Use a short unique string so documentIdToUuid gives a deterministic UUID per test run.
  return `TEST-HOI-${randomUUID()}`;
}

async function insertIngestedDoc(opts: {
  tenantId: string;
  docId: string;
  loanId: string;
  docType: string;
}): Promise<void> {
  const { tenantId, docId, loanId, docType } = opts;
  await withDb(async (c) => {
    // external_id must satisfy ^[A-Za-z0-9_.:-]+$ — replace hyphens with dots
    const externalId = docId.replace(/-/g, ".");
    await c.query(
      `INSERT INTO ingested_documents
         (tenant_id, external_id, document_id, loan_id, source_url, file_name, status, doc_type, ingest_batch_id)
       VALUES ($1, $2, $3, $4, 'https://example.com/doc.pdf', 'doc.pdf', 'fetched', $5, gen_random_uuid())
       ON CONFLICT (tenant_id, external_id) DO NOTHING`,
      [tenantId, externalId, docId, loanId, docType],
    );
  });
}

async function countExtractions(opts: {
  tenantId: string;
  documentUuid: string;
  schemaVersion?: number;
}): Promise<number> {
  const { tenantId, documentUuid, schemaVersion } = opts;
  return withDb(async (c) => {
    const { rows } = await c.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM document_extractions
        WHERE tenant_id = $1 AND document_id = $2
          AND ($3::int IS NULL OR schema_version = $3)
          AND superseded_at IS NULL`,
      [tenantId, documentUuid, schemaVersion ?? null],
    );
    return parseInt(rows[0]!.n, 10);
  });
}

async function getExtraction(opts: {
  tenantId: string;
  documentUuid: string;
}): Promise<{ source: string; extraction_error: string | null; schema_version: number } | null> {
  return withDb(async (c) => {
    const { rows } = await c.query<{
      source: string;
      extraction_error: string | null;
      schema_version: number;
    }>(
      `SELECT source, extraction_error, schema_version
         FROM document_extractions
        WHERE tenant_id = $1 AND document_id = $2 AND superseded_at IS NULL
        ORDER BY extracted_at DESC LIMIT 1`,
      [opts.tenantId, opts.documentUuid],
    );
    return rows[0] ?? null;
  });
}

// ── Stub extractor builder ────────────────────────────────────────────────────

function makeStubExtractor(opts: {
  callCounter?: { count: number };
  shouldThrow?: boolean;
}): HoiFieldExtractor {
  const { callCounter, shouldThrow = false } = opts;
  return {
    async canExtract(_doc: DocumentRef): Promise<boolean> {
      return true;
    },
    async extract(doc: DocumentRef): Promise<HoiExtractionResult> {
      if (callCounter) callCounter.count++;
      if (shouldThrow) {
        throw new Error("stub extractor deliberately failed");
      }
      return {
        fields: { carrier: "Stub Insurance Co.", evidence: [] } as HoiExtractionResult["fields"],
        source: "llm-extractor",
        confidence: 0.95,
        extractedBy: `worker:hoi-extractor:v${HOI_SCHEMA_VERSION}:stub`,
        extractionId: randomUUID(),
        schemaVersion: HOI_SCHEMA_VERSION,
      };
    },
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("hoi-extractor-dispatcher integration", () => {
  beforeAll(async () => {
    await runMigrations();
    // Ensure both tenant rows exist
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO tenants (id, name, slug, status, type)
         VALUES ($1, 'HOI Test A', 'hoi-test-a', 'active', 'demo'),
                ($2, 'HOI Test B', 'hoi-test-b', 'active', 'demo')
         ON CONFLICT (id) DO NOTHING`,
        [TENANT_A, TENANT_B],
      );
    });
  });

  beforeEach(async () => {
    // Clean up any leftover test rows from prior runs
    await withDb(async (c) => {
      await c.query(
        `DELETE FROM ingested_documents WHERE tenant_id IN ($1, $2) AND loan_id LIKE 'TEST-HOI-%'`,
        [TENANT_A, TENANT_B],
      );
      await c.query(
        `DELETE FROM document_extractions WHERE tenant_id IN ($1, $2)`,
        [TENANT_A, TENANT_B],
      );
    });
  });

  afterEach(() => {
    // Always reset DI override so tests stay independent.
    setExtractorOverride(null);
  });

  afterAll(async () => {
    await closePool();
  });

  // ── Test 1: Worker picks up new HOI document ───────────────────────────────

  test("worker picks up fetched HOI document and inserts extraction row", async () => {
    const docId = makeDocId();
    const documentUuid = documentIdToUuid(docId);
    const loanId = `TEST-HOI-${randomUUID()}`;

    await insertIngestedDoc({
      tenantId: TENANT_A,
      docId,
      loanId,
      docType: "Hazard Insurance",
    });

    const counter = { count: 0 };
    setExtractorOverride(() => makeStubExtractor({ callCounter: counter }));

    await runHoiExtractorOnce();

    expect(counter.count).toBe(1);
    const row = await getExtraction({ tenantId: TENANT_A, documentUuid });
    expect(row).not.toBeNull();
    expect(row!.source).toBe("llm-extractor");
    expect(row!.extraction_error).toBeNull();
  });

  // ── Test 2: Portal extraction blocks LLM in auto mode ─────────────────────

  test("worker skips doc when active portal extraction already exists at current schema version", async () => {
    const docId = makeDocId();
    const documentUuid = documentIdToUuid(docId);
    const loanId = `TEST-HOI-${randomUUID()}`;

    await insertIngestedDoc({
      tenantId: TENANT_A,
      docId,
      loanId,
      docType: "Hazard Insurance",
    });

    // Pre-insert a portal extraction at the current schema version (simulates
    // what CompositeHoiExtractor would find in 'auto' mode).
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO document_extractions
           (id, tenant_id, loan_id, document_id, extractor_kind, schema_version,
            source, extracted_by, fields, extraction_confidence)
         VALUES (gen_random_uuid(), $1, $2, $3, 'hoi-policy', $4, 'portal', 'portal:test', '{}'::jsonb, NULL)`,
        [TENANT_A, loanId, documentUuid, HOI_SCHEMA_VERSION],
      );
    });

    const counter = { count: 0 };
    setExtractorOverride(() => makeStubExtractor({ callCounter: counter }));

    await runHoiExtractorOnce();

    // The worker's per-row existence check must have skipped this doc.
    expect(counter.count).toBe(0);
  });

  // ── Test 3: Schema version bump triggers re-extraction ────────────────────

  test("worker extracts doc that only has a stale schema-version row", async () => {
    // Strategy: insert an extraction row at schema_version = 0 (simulating a
    // stale row from before the current schema version was bumped). The worker
    // should see no active row at HOI_SCHEMA_VERSION and create one.
    const docId = makeDocId();
    const documentUuid = documentIdToUuid(docId);
    const loanId = `TEST-HOI-${randomUUID()}`;

    await insertIngestedDoc({
      tenantId: TENANT_A,
      docId,
      loanId,
      docType: "Homeowner Insurance",
    });

    // Directly insert a stale extraction at schema_version 0 — note this does
    // NOT conflict with the active-partial index (different schema_version).
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO document_extractions
           (id, tenant_id, loan_id, document_id, extractor_kind, schema_version,
            source, extracted_by, fields, extraction_confidence)
         VALUES (gen_random_uuid(), $1, $2, $3, 'hoi-policy', 0, 'llm-extractor', 'worker:stale', '{}'::jsonb, 0.5)`,
        [TENANT_A, loanId, documentUuid],
      );
    });

    const counter = { count: 0 };
    setExtractorOverride(() => makeStubExtractor({ callCounter: counter }));

    await runHoiExtractorOnce();

    // Should have invoked extractor exactly once for the current version.
    expect(counter.count).toBe(1);
    const newRow = await getExtraction({ tenantId: TENANT_A, documentUuid });
    expect(newRow).not.toBeNull();
    expect(newRow!.schema_version).toBe(HOI_SCHEMA_VERSION);
  });

  // ── Test 4: Tenant isolation ───────────────────────────────────────────────

  test("extractions for tenant A do not appear under tenant B", async () => {
    const docId = makeDocId();
    const documentUuid = documentIdToUuid(docId);
    const loanId = `TEST-HOI-${randomUUID()}`;

    // Insert doc only under tenant A
    await insertIngestedDoc({
      tenantId: TENANT_A,
      docId,
      loanId,
      docType: "Hazard Insurance",
    });

    setExtractorOverride(() => makeStubExtractor({}));
    await runHoiExtractorOnce();

    // Tenant A should have an extraction
    const countA = await countExtractions({ tenantId: TENANT_A, documentUuid });
    expect(countA).toBe(1);

    // Tenant B must not have any extraction for this document
    const countB = await countExtractions({ tenantId: TENANT_B, documentUuid });
    expect(countB).toBe(0);
  });

  // ── Test 5: Extraction failure path — no busy-loop ────────────────────────

  test("failed extraction persists error row and prevents busy-loop on next cycle", async () => {
    const docId = makeDocId();
    const documentUuid = documentIdToUuid(docId);
    const loanId = `TEST-HOI-${randomUUID()}`;

    await insertIngestedDoc({
      tenantId: TENANT_A,
      docId,
      loanId,
      docType: "Flood Certificate",
    });

    const counter = { count: 0 };
    setExtractorOverride(() =>
      makeStubExtractor({ callCounter: counter, shouldThrow: true }),
    );

    // First run — should fail and write an error row.
    await runHoiExtractorOnce();
    expect(counter.count).toBe(1);

    const errorRow = await getExtraction({ tenantId: TENANT_A, documentUuid });
    expect(errorRow).not.toBeNull();
    expect(errorRow!.extraction_error).toMatch(/stub extractor deliberately failed/);

    // Second run — the error row is treated as an active extraction, so the
    // doc must be skipped (no-busy-loop guarantee).
    await runHoiExtractorOnce();
    expect(counter.count).toBe(1); // call count must NOT increase
  });
});
