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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { withDb, closePool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";
import { createHash } from "node:crypto";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee02";
// Key format: slug_hexrandom — prefix computed as slug_first8hex
const KEY = "enctest_abcdef0123456789abcdef01";
const KEY_PREFIX = "enctest_abcdef01";
const KEY_HASH = createHash("sha256").update(KEY).digest("hex");

let app: FastifyInstance;

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'Loan Channel Test', 'loan-channel-test', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
    await c.query(
      `INSERT INTO tenant_api_keys (tenant_id, key_hash, key_prefix, name, rate_limit_per_minute)
       VALUES ($1, $2, $3, 'test', 1000)
       ON CONFLICT DO NOTHING`,
      [T, KEY_HASH, KEY_PREFIX],
    );
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id = $1`, [T]);
    await c.query(
      `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
       VALUES ($1, 'encompass-los', 'encompass-los', 'encompass-los',
               $2::jsonb, '{}'::jsonb, true)`,
      [T, JSON.stringify({
        identityPrefix: "ENC-",
        allowedFetchHosts: ["docs.encompass.example.com"],
        maxFileBytes: 50_000_000,
      })],
    );
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM loan_context_extras WHERE tenant_id = $1`, [T]);
    // Also clear PC v2 output tables in case of prior test runs.
    await c.query(`DELETE FROM predicted_conditions WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM prediction_alerts WHERE tenant_id = $1`, [T]);
  });
  app = buildServer({}).app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await withDb(async (c) => {
    await c.query(`DELETE FROM predicted_conditions WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM prediction_alerts WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM loan_context_extras WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM tenant_api_keys WHERE tenant_id = $1`, [T]);
    // tenant_audit_log has a no_delete_audit rewrite rule (append-only).
    // Cannot delete audit rows; FK from tenant_audit_log → tenants blocks
    // deleting the tenant row once audit rows exist. Leave the tenant row in
    // place; beforeAll uses ON CONFLICT (id) DO NOTHING so re-runs are idempotent.
  });
  await closePool();
});

describe("POST /api/ingest/:tenantSlug/loans — adapter dispatch", () => {
  it("dispatches the encompass-los adapter and writes extras first-write-wins", async () => {
    const body = {
      source: "encompass-los",
      externalId: "ENC-TEST-1",
      loanData: {
        loanNumber: "ENC-TEST-1",
        programName: "Flex Select",
        transaction: { loanAmount: 500000, ltv: 80, noteRate: 7.5, salesPrice: 625000, appraisedValue: 625000, loanPurpose: "Purchase", term: 360, amortType: "Fixed", occupancy: "Primary", piti: 4000 },
        borrower: { fullName: "Test User", ssnMasked: "xxx-xx-1234", dob: "1985-01-01", maritalStatus: "Married" },
        credit: { representativeScore: 720 },
        property: { county: "King County", propertyType: "SFR Det." },
      },
    };
    const res = await app.inject({
      method: "POST",
      url: "/api/ingest/loan-channel-test/loans",
      headers: { authorization: `Bearer ${KEY}` },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const parsed = JSON.parse(res.body);
    expect(parsed.loanId).toBe("ENC-ENC-TEST-1");
  });

  it("first-write-wins — re-ingesting the same external_id returns 200 with duplicate=true", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ingest/loan-channel-test/loans",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "encompass-los", externalId: "ENC-TEST-1", loanData: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).duplicate).toBe(true);
  });

  it("rejects unknown adapter_type with 400 + error_class", async () => {
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
         VALUES ($1, 'bad-source', 'no-such-adapter', 'no-such-adapter', '{}'::jsonb, '{}'::jsonb, true)
         ON CONFLICT DO NOTHING`,
        [T],
      );
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/ingest/loan-channel-test/loans",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "bad-source", externalId: "BAD-1", loanData: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error_class).toBe("unknown_adapter_type");
  });

  it("falls back to request externalId when generic-json adapter returns empty (Codex round-3 P2)", async () => {
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
         VALUES ($1, 'generic-bare', 'generic-json', 'generic-json', $2::jsonb, '{}'::jsonb, true)
         ON CONFLICT DO NOTHING`,
        [T, JSON.stringify({ identityPrefix: "GEN-", allowedFetchHosts: [], maxFileBytes: 50_000_000 })],
      );
    });
    // loanData omits externalId — GenericJsonAdapter.extractExternalLoanId returns "" without throwing.
    // The fix must use the request envelope externalId as fallback.
    const res = await app.inject({
      method: "POST",
      url: "/api/ingest/loan-channel-test/loans",
      headers: { authorization: `Bearer ${KEY}` },
      payload: {
        source: "generic-bare",
        externalId: "BARE-001",
        loanData: {
          borrower: { fullName: "Test Borrower" },
          transaction: { loanAmount: 300000 },
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const r = JSON.parse(res.body);
    expect(r.loanId).toBe("GEN-BARE-001");
  });
});
