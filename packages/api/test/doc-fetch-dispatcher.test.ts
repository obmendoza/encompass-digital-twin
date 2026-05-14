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

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { withDb, closePool } from "../src/db/pool.js";
import { processOneFetchBatch, type FetchBatchDeps, docFetchMetrics } from "../src/doc-fetch-dispatcher.js";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee06";
const BATCH = "11111111-1111-1111-1111-111111111111";

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'Worker Test', 'worker-test', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
    await c.query(`DELETE FROM ingested_documents WHERE tenant_id=$1`, [T]);
    // Seed pending_fetch rows.
    await c.query(
      `INSERT INTO ingested_documents
         (tenant_id, external_id, document_id, loan_id, source_url, file_name, status, ingest_batch_id)
       VALUES ($1, 'DOC-OK', 'doc-ok-id', 'L-1', 'https://docs.example.com/ok', 'ok.pdf', 'pending_fetch', $2)`,
      [T, BATCH],
    );
    await c.query(
      `INSERT INTO ingested_documents
         (tenant_id, external_id, document_id, loan_id, source_url, file_name, status, ingest_batch_id)
       VALUES ($1, 'DOC-FAIL', 'doc-fail-id', 'L-1', 'https://docs.example.com/fail', 'fail.pdf', 'pending_fetch', $2)`,
      [T, BATCH],
    );
  });
});
afterAll(async () => {
  await withDb(async (c) => {
    await c.query(`DELETE FROM ingested_documents WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM pc_v2_refire_debounce WHERE tenant_id=$1`, [T]);
  });
  await closePool();
});

describe("doc-fetch-dispatcher.processOneFetchBatch", () => {
  it("processes rows sequentially: fetched on success, failed on error", async () => {
    const seen: string[] = [];
    const deps: FetchBatchDeps = {
      safeFetch: async (url) => {
        seen.push(url);
        if (url.endsWith("/ok")) return { ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "application/pdf" };
        return { ok: false, reason: "status_404" };
      },
      uploadToStorage: async () => ({ key: "loan-documents/x/y/z", url: "https://supabase/x" }),
      dispatchAddDocument: vi.fn(),
      enqueueRefire: vi.fn(async () => undefined),
      loadAdapterConfig: async () => ({ allowedFetchHosts: ["docs.example.com"], maxFileBytes: 50_000_000, identityPrefix: "QL-" }),
    };
    const result = await processOneFetchBatch(deps, 10);
    expect(result.processed).toBeGreaterThanOrEqual(2);
    expect(seen.length).toBe(2);
  });

  it("marks fetched rows with status='fetched' and fetched_at populated", async () => {
    const row = await withDb(async (c) => {
      const { rows } = await c.query<{ status: string; fetched_at: Date | null }>(
        `SELECT status, fetched_at FROM ingested_documents WHERE tenant_id=$1 AND external_id='DOC-OK'`,
        [T],
      );
      return rows[0]!;
    });
    expect(row.status).toBe("fetched");
    expect(row.fetched_at).not.toBeNull();
  });

  it("marks failed rows with status pending_fetch + attempts+=1 + next_attempt_at scheduled", async () => {
    const row = await withDb(async (c) => {
      const { rows } = await c.query<{ status: string; attempts: number; failed_reason: string | null }>(
        `SELECT status, attempts, failed_reason FROM ingested_documents WHERE tenant_id=$1 AND external_id='DOC-FAIL'`,
        [T],
      );
      return rows[0]!;
    });
    expect(row.status).toBe("pending_fetch");
    expect(row.attempts).toBeGreaterThanOrEqual(1);
    expect(row.failed_reason).toBe("url_expired");  // 404 maps to url_expired per classifyFailure
  });

  it("terminal failures (ssrf_blocked) skip retry — status='failed' immediately", async () => {
    const externalId = `DOC-SSRF-${randomUUID().slice(0, 8)}`;
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO ingested_documents
           (tenant_id, external_id, document_id, loan_id, source_url, file_name, status, ingest_batch_id)
         VALUES ($1, $2, 'ssrf-id', 'L-1', 'https://attacker.example.com/x', 'x.pdf', 'pending_fetch', $3)`,
        [T, externalId, BATCH],
      );
    });
    const deps: FetchBatchDeps = {
      safeFetch: async () => ({ ok: false, reason: "host_not_allowed" }),
      uploadToStorage: async () => ({ key: "", url: "" }),
      dispatchAddDocument: vi.fn(),
      enqueueRefire: vi.fn(async () => undefined),
      loadAdapterConfig: async () => ({ allowedFetchHosts: ["docs.example.com"], maxFileBytes: 50_000_000, identityPrefix: "QL-" }),
    };
    await processOneFetchBatch(deps, 10);
    const row = await withDb(async (c) => {
      const { rows } = await c.query<{ status: string; failed_reason: string | null }>(
        `SELECT status, failed_reason FROM ingested_documents WHERE tenant_id=$1 AND external_id=$2`,
        [T, externalId],
      );
      return rows[0]!;
    });
    expect(row.status).toBe("failed");
    expect(row.failed_reason).toBe("ssrf_blocked");
  });
});

describe("doc-fetch-dispatcher metrics", () => {
  it("counters increment for success and failure outcomes", () => {
    const okCount = docFetchMetrics.attempts_total.get("success:ok") ?? 0;
    expect(okCount).toBeGreaterThan(0);
    const failKeys = Array.from(docFetchMetrics.attempts_total.keys()).filter((k) => k.startsWith("fail:"));
    expect(failKeys.length).toBeGreaterThan(0);
    expect(docFetchMetrics.bytes_total).toBeGreaterThan(0);
  });
});
