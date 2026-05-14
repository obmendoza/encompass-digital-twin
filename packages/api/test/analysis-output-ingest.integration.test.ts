import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath, join } from "node:path";
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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { withDb, withTenantTx, closePool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";
import { createHash } from "node:crypto";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee09";
// Auth key format: <slugprefix>_<32-hex>. The auth middleware derives key_prefix
// as <slugprefix>_<first 8 hex>. We seed key_prefix to match.
const KEY = "aotest_abcdef0123456789abcdef0123456789";
const KEY_HASH = createHash("sha256").update(KEY).digest("hex");
const KEY_PREFIX = "aotest_abcdef01";  // slug + "_" + first 8 hex

let app: FastifyInstance;

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(`INSERT INTO tenants (id, name, slug, status, type) VALUES ($1, 'AO Test', 'ao-test', 'active', 'demo') ON CONFLICT (id) DO NOTHING`, [T]);
    await c.query(`INSERT INTO tenant_api_keys (tenant_id, key_hash, key_prefix, name, rate_limit_per_minute) VALUES ($1, $2, $3, 'test', 1000) ON CONFLICT DO NOTHING`, [T, KEY_HASH, KEY_PREFIX]);
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id=$1`, [T]);
    await c.query(
      `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
       VALUES ($1, 'npnqm-portal', 'npnqm-portal', 'npnqm-portal', $2::jsonb, '{}'::jsonb, true)`,
      [T, JSON.stringify({ identityPrefix: "NPNQM-", allowedFetchHosts: ["docs.npnqm-portal.example.com"], maxFileBytes: 50_000_000 })],
    );
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM predicted_conditions WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM portal_eligibility_verdicts WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM loan_context_extras WHERE tenant_id=$1`, [T]);
  });
  app = buildServer({}).app;
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await withDb(async (c) => {
    await c.query(`DELETE FROM portal_eligibility_verdicts WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM predicted_conditions WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM loan_context_extras WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM tenant_api_keys WHERE tenant_id=$1`, [T]);
  });
  await closePool();
});

function loadSample(name: string): unknown {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(here, "fixtures/portal-analysis", name), "utf8"));
}

describe("POST /api/ingest/:tenantSlug/analysis-output", () => {
  it("accepts a real sample and returns 201 with portalPredictionCount", { timeout: 90000 }, async () => {
    const sample = loadSample("aubrey_output.json");
    const res = await app.inject({
      method: "POST", url: "/api/ingest/ao-test/analysis-output",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "npnqm-portal", externalId: "AUBREY-001", analysisOutput: sample },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { loanId: string; portalPredictionCount: number };
    expect(body.loanId).toBe("NPNQM-AUBREY-001");
    expect(body.portalPredictionCount).toBe(17);
  });

  it("idempotency: re-POSTing same content returns 200 duplicate", async () => {
    const sample = loadSample("aubrey_output.json");
    const res = await app.inject({
      method: "POST", url: "/api/ingest/ao-test/analysis-output",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "npnqm-portal", externalId: "AUBREY-001", analysisOutput: sample },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).duplicate).toBe(true);
  });

  it("idempotency: re-POSTing with different content supersedes and inserts fresh", { timeout: 90000 }, async () => {
    const sample = loadSample("aubrey_output.json") as { document_requests: unknown[] };
    sample.document_requests = sample.document_requests.slice(0, 5);
    const res = await app.inject({
      method: "POST", url: "/api/ingest/ao-test/analysis-output",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "npnqm-portal", externalId: "AUBREY-001", analysisOutput: sample },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { portalPredictionCount: number; loanId: string };
    expect(body.portalPredictionCount).toBe(5);
    // Use withTenantTx to set app.current_tenant GUC — withDb alone doesn't
    // satisfy RLS on predicted_conditions (tenant_isolation_pc policy).
    const { rows } = await withTenantTx(T, async (c) => c.query<{ active: number; superseded: number; total: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE superseded_at IS NULL)::int AS active,
         COUNT(*) FILTER (WHERE superseded_at IS NOT NULL)::int AS superseded,
         COUNT(*)::int AS total
       FROM predicted_conditions WHERE tenant_id=$1 AND loan_id=$2 AND source_list='portal-llm'`,
      [T, body.loanId],
    ));
    expect(rows[0]!.active).toBe(5);
    expect(rows[0]!.superseded).toBeGreaterThanOrEqual(17);
  });

  it("PII redaction: SSN never lands in store or DB", async () => {
    const sample = {
      document_requests: [], scenario_summary: {
        loan_number: "PII-AO-1", program: "Investor DSCR",
        borrowers: [{ name: "Test", ssn: "555443333", dob: "1990-01-01" }],
        numbers: { loan_amount: 100000, LTV: 50, note_rate: 7 },
        property: { state: "CA", property_type: "SFR" }, occupancy: "NOO", purpose: "Purchase",
      },
      seen_conflicts: [],
      stats: { total_document_requests: 0, hard_stop_documents: 0, elapsed_seconds: 0, tool_calls: 0, by_category: {}, by_priority: {}, by_status: {} },
    };
    const res = await app.inject({
      method: "POST", url: "/api/ingest/ao-test/analysis-output",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "npnqm-portal", externalId: "PII-AO-1", analysisOutput: sample },
    });
    expect(res.statusCode).toBe(201);
    const loanRes = await app.inject({
      method: "GET", url: `/loans/NPNQM-PII-AO-1`,
      headers: { "x-user-id": "test", "x-tenant-id": T, "x-user-role": "operator" },
    });
    expect(loanRes.body).not.toContain("555443333");
  });

  it("400 when unknown adapter_type in mapping", async () => {
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
         VALUES ($1, 'bogus-src', 'no-such', 'no-such', '{}'::jsonb, '{}'::jsonb, true)
         ON CONFLICT DO NOTHING`,
        [T],
      );
    });
    const res = await app.inject({
      method: "POST", url: "/api/ingest/ao-test/analysis-output",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "bogus-src", externalId: "BAD-1", analysisOutput: { document_requests: [], scenario_summary: { loan_number: "BAD-1" }, seen_conflicts: [], stats: {} } },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error_class).toBe("unknown_adapter_type");
  });
});
