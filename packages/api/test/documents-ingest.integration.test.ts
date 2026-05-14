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

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee05";
// Key format: slug_hexrandom — prefix stored as slug_first8hex.
// e.g. key "docstest_abcdef0123456789abcdef0123456789" => prefix "docstest_abcdef01"
const KEY = "docstest_abcdef0123456789abcdef0123456789";
const KEY_PREFIX = "docstest_abcdef01";
const KEY_HASH = createHash("sha256").update(KEY).digest("hex");

let app: FastifyInstance;

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'Docs Test', 'docs-test', 'active', 'demo')
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
       VALUES ($1, 'npnqm-portal', 'npnqm-portal', 'npnqm-portal', $2::jsonb, '{}'::jsonb, true)`,
      [T, JSON.stringify({ identityPrefix: "NPNQM-", allowedFetchHosts: ["docs.example.com"], maxFileBytes: 50_000_000 })],
    );
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id = $1`, [T]);
    await c.query(
      `INSERT INTO ingested_loans (tenant_id, external_id, loan_id, status) VALUES ($1, 'CASE-1', 'NPNQM-CASE-1', 'queued')`,
      [T],
    );
    await c.query(`DELETE FROM ingested_documents WHERE tenant_id = $1`, [T]);
  });
  app = buildServer({}).app;
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await withDb(async (c) => {
    await c.query(`DELETE FROM ingested_documents WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM tenant_api_keys WHERE tenant_id = $1`, [T]);
  });
  await closePool();
});

describe("POST /api/ingest/:tenantSlug/documents", () => {
  it("queues documents and returns 202", async () => {
    const body = {
      source: "npnqm-portal", externalLoanId: "CASE-1",
      documents: [
        { attachmentId: "ATT-1", attachmentName: "Stub.pdf", attachmentType: "PayStub", downloadUrl: "https://docs.example.com/abc", sizeBytes: 50000, mime: "application/pdf" },
        { attachmentId: "ATT-2", attachmentName: "Stmt.pdf", attachmentType: "BankStatement", downloadUrl: "https://docs.example.com/def", sizeBytes: 60000, mime: "application/pdf" },
      ],
    };
    const res = await app.inject({
      method: "POST", url: "/api/ingest/docs-test/documents",
      headers: { authorization: `Bearer ${KEY}` }, payload: body,
    });
    expect(res.statusCode).toBe(202);
    const r = JSON.parse(res.body);
    expect(r.accepted).toBe(2);
    expect(r.duplicates).toBe(0);
    expect(r.ingest_batch_id).toMatch(/^[0-9a-f]{8}-/);
  });

  it("rejects with 400 if all docs fail the security gate", async () => {
    const body = {
      source: "npnqm-portal", externalLoanId: "CASE-1",
      documents: [
        { attachmentId: "ATT-BAD", attachmentName: "x.bin", attachmentType: "Other", downloadUrl: "http://docs.example.com/insecure", sizeBytes: 1, mime: "application/octet-stream" },
      ],
    };
    const res = await app.inject({
      method: "POST", url: "/api/ingest/docs-test/documents",
      headers: { authorization: `Bearer ${KEY}` }, payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error_class).toBe("validation_failed");
  });

  it("rejects 404 when externalLoanId has no matching ingested loan", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/ingest/docs-test/documents",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "npnqm-portal", externalLoanId: "DOES-NOT-EXIST", documents: [] },
    });
    expect(res.statusCode).toBe(404);
  });

  it("idempotent — same externalDocId re-pushed returns duplicates=N", async () => {
    const body = {
      source: "npnqm-portal", externalLoanId: "CASE-1",
      documents: [{ attachmentId: "ATT-1", attachmentName: "Stub.pdf", attachmentType: "PayStub", downloadUrl: "https://docs.example.com/abc", sizeBytes: 50000, mime: "application/pdf" }],
    };
    const res = await app.inject({
      method: "POST", url: "/api/ingest/docs-test/documents",
      headers: { authorization: `Bearer ${KEY}` }, payload: body,
    });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).duplicates).toBe(1);
  });
});
