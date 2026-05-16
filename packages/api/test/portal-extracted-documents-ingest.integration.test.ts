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
  } catch { /* */ }
}

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { withDb, withTenantTx, closePool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";
import { createHash } from "node:crypto";
import { documentIdToUuid } from "../src/routes/analysis-output-ingest.js";

const T = "5d175193-6ee2-4d6a-b16e-ee11ee11ee11";
const KEY = "edtest_abcdef0123456789abcdef01234567";
const KEY_HASH = createHash("sha256").update(KEY).digest("hex");
const KEY_PREFIX = "edtest_abcdef01";

const LOAN_EXTERNAL_ID = "TEST-EXTR-DOCS-INGEST";
const DOC_EXTERNAL_ID = "test-hoi-doc-ext-1";
// document_id TEXT matches the pattern used by documents-ingest route.
const DOC_TEXT_ID = `NPNQM-${LOAN_EXTERNAL_ID}-DOC-${DOC_EXTERNAL_ID}`;
const BATCH_ID = "00000000-0000-0000-0000-000000000099";

let app: FastifyInstance;

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type) VALUES ($1, 'ED Test', 'ed-test', 'active', 'demo') ON CONFLICT (id) DO NOTHING`,
      [T],
    );
    await c.query(
      `INSERT INTO tenant_api_keys (tenant_id, key_hash, key_prefix, name, rate_limit_per_minute) VALUES ($1, $2, $3, 'test', 1000) ON CONFLICT DO NOTHING`,
      [T, KEY_HASH, KEY_PREFIX],
    );
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id=$1`, [T]);
    await c.query(
      `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
       VALUES ($1, 'npnqm-portal', 'npnqm-portal', 'npnqm-portal', $2::jsonb, '{}'::jsonb, true)`,
      [T, JSON.stringify({ identityPrefix: "NPNQM-", allowedFetchHosts: ["docs.example.com"], maxFileBytes: 50_000_000 })],
    );
    // Seed ingested_loans so the route resolves loanId deterministically.
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id=$1`, [T]);
    // Seed ingested_documents row with a matching loan_id + external_id.
    // Loan ID will be NPNQM- + externalId because no prior ingested_loans row exists yet.
    // We pre-seed it so the lookup works.
    await c.query(
      `INSERT INTO ingested_documents
         (tenant_id, external_id, document_id, loan_id, source_url, file_name, doc_type, status, ingest_batch_id)
       VALUES ($1, $2, $3, $4, 'https://docs.example.com/hoi.pdf', 'hoi.pdf', 'Hazard Insurance', 'fetched', $5)
       ON CONFLICT DO NOTHING`,
      [T, DOC_EXTERNAL_ID, DOC_TEXT_ID, `NPNQM-${LOAN_EXTERNAL_ID}`, BATCH_ID],
    );
    // Clean up document_extractions for this document in case of leftover from prior run.
    await withTenantTx(T, async (c2) => {
      await c2.query(
        `DELETE FROM document_extractions WHERE tenant_id=$1 AND document_id=$2`,
        [T, documentIdToUuid(DOC_TEXT_ID)],
      );
    });
  });
  app = buildServer({}).app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await withDb(async (c) => {
    await withTenantTx(T, async (c2) => {
      await c2.query(`DELETE FROM document_extractions WHERE tenant_id=$1`, [T]);
    });
    await c.query(`DELETE FROM ingested_documents WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM predicted_conditions WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM portal_eligibility_verdicts WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM loan_context_extras WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM tenant_api_keys WHERE tenant_id=$1`, [T]);
  });
  await closePool();
});

const MINIMAL_ANALYSIS_OUTPUT = {
  scenario_summary: {
    loan_number: LOAN_EXTERNAL_ID,
    program: "Investor DSCR",
    eligible_programs: ["Investor DSCR"],
    ineligible_programs: [],
    program_eligibility_detail: {},
    borrowers: [{ name: "Test Borrower", ssn: "xxx-xx-9999", dob: "1990-01-01" }],
    numbers: { loan_amount: 300000, LTV: 65, note_rate: 7.5, purchase_price: 400000, appraised_value: 400000, CLTV: 65 },
    property: { state: "TX", property_type: "SFR", county: "Travis" },
    loan_terms: { term_months: 360, amortization_type: "Fixed" },
    occupancy: "NOO",
    purpose: "Purchase",
  },
  document_requests: [],
  seen_conflicts: [],
  stats: { total_document_requests: 0, hard_stop_documents: 0, elapsed_seconds: 1.5, tool_calls: 3, by_category: {}, by_priority: {}, by_status: {} },
};

describe("portal extracted_documents ingestion", () => {
  test(
    "persists extracted_documents[] as document_extractions rows with source='portal'",
    { timeout: 30000 },
    async () => {
      const payload = {
        ...MINIMAL_ANALYSIS_OUTPUT,
        extracted_documents: [
          {
            document_external_id: DOC_EXTERNAL_ID,
            extractor_kind: "hoi-policy",
            schema_version: 1,
            fields: {
              carrier: "State Farm",
              policyNumber: "SF-12345",
              namedInsured: "Test Borrower",
              evidence: [],
            },
            extracted_at: "2026-05-16T10:00:00.000Z",
          },
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/api/ingest/ed-test/analysis-output",
        headers: { authorization: `Bearer ${KEY}` },
        payload: { source: "npnqm-portal", externalId: LOAN_EXTERNAL_ID, analysisOutput: payload },
      });

      expect(res.statusCode).toBe(201);

      const expectedDocumentUuid = documentIdToUuid(DOC_TEXT_ID);
      const { rows } = await withTenantTx(T, async (c) =>
        c.query<{ id: string; source: string; extractor_kind: string; document_id: string }>(
          `SELECT id, source, extractor_kind, document_id FROM document_extractions
             WHERE tenant_id = $1 AND document_id = $2`,
          [T, expectedDocumentUuid],
        ),
      );

      expect(rows.length).toBe(1);
      expect(rows[0]!.source).toBe("portal");
      expect(rows[0]!.extractor_kind).toBe("hoi-policy");
      expect(rows[0]!.document_id).toBe(expectedDocumentUuid);
    },
  );

  test(
    "idempotent: re-POSTing same extracted_documents[] is a no-op (no duplicate rows)",
    { timeout: 30000 },
    async () => {
      const payload = {
        ...MINIMAL_ANALYSIS_OUTPUT,
        // Use a different loan number so idempotency check doesn't return early.
        scenario_summary: {
          ...MINIMAL_ANALYSIS_OUTPUT.scenario_summary,
          loan_number: `${LOAN_EXTERNAL_ID}-IDEM`,
        },
        extracted_documents: [
          {
            document_external_id: DOC_EXTERNAL_ID,
            extractor_kind: "hoi-policy",
            schema_version: 1,
            fields: { carrier: "Allstate", evidence: [] },
            extracted_at: "2026-05-16T10:00:00.000Z",
          },
        ],
      };

      // First POST — also need an ingested_documents row for the idem loan.
      await withDb(async (c) => {
        await c.query(
          `INSERT INTO ingested_documents
             (tenant_id, external_id, document_id, loan_id, source_url, file_name, doc_type, status, ingest_batch_id)
           VALUES ($1, $2, $3, $4, 'https://docs.example.com/hoi2.pdf', 'hoi2.pdf', 'Hazard Insurance', 'fetched', $5)
           ON CONFLICT DO NOTHING`,
          [T, DOC_EXTERNAL_ID, DOC_TEXT_ID, `NPNQM-${LOAN_EXTERNAL_ID}-IDEM`, BATCH_ID],
        );
      });

      const res1 = await app.inject({
        method: "POST",
        url: "/api/ingest/ed-test/analysis-output",
        headers: { authorization: `Bearer ${KEY}` },
        payload: {
          source: "npnqm-portal",
          externalId: `${LOAN_EXTERNAL_ID}-IDEM`,
          analysisOutput: payload,
        },
      });
      expect(res1.statusCode).toBe(201);

      // Second POST with same content — idempotency via analysis_hash returns 200 duplicate.
      const res2 = await app.inject({
        method: "POST",
        url: "/api/ingest/ed-test/analysis-output",
        headers: { authorization: `Bearer ${KEY}` },
        payload: {
          source: "npnqm-portal",
          externalId: `${LOAN_EXTERNAL_ID}-IDEM`,
          analysisOutput: payload,
        },
      });
      expect(res2.statusCode).toBe(200);
      expect(JSON.parse(res2.body).duplicate).toBe(true);

      // Only one active document_extractions row for this document UUID.
      const expectedDocumentUuid = documentIdToUuid(DOC_TEXT_ID);
      const { rows } = await withTenantTx(T, async (c) =>
        c.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM document_extractions
             WHERE tenant_id = $1 AND document_id = $2 AND extractor_kind = 'hoi-policy'
               AND superseded_at IS NULL`,
          [T, expectedDocumentUuid],
        ),
      );
      expect(rows[0]!.count).toBe(1);
    },
  );

  test(
    "missing document_external_id → warn and skip (no error, 201 returned)",
    { timeout: 30000 },
    async () => {
      const payload = {
        ...MINIMAL_ANALYSIS_OUTPUT,
        scenario_summary: {
          ...MINIMAL_ANALYSIS_OUTPUT.scenario_summary,
          loan_number: `${LOAN_EXTERNAL_ID}-MISSING`,
        },
        extracted_documents: [
          {
            document_external_id: "nonexistent-doc-external-id",
            extractor_kind: "hoi-policy",
            schema_version: 1,
            fields: { carrier: "Nobody", evidence: [] },
            extracted_at: "2026-05-16T10:00:00.000Z",
          },
        ],
      };

      const res = await app.inject({
        method: "POST",
        url: "/api/ingest/ed-test/analysis-output",
        headers: { authorization: `Bearer ${KEY}` },
        payload: {
          source: "npnqm-portal",
          externalId: `${LOAN_EXTERNAL_ID}-MISSING`,
          analysisOutput: payload,
        },
      });

      // Should succeed (warn + skip, not error).
      expect(res.statusCode).toBe(201);
    },
  );
});
