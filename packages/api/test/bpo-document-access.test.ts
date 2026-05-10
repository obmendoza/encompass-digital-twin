import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load .env (for DATABASE_URL) before any module that reads it.
if (!process.env.DATABASE_URL) {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, "../.env");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env not present — tests will surface a clearer DATABASE_URL error.
  }
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { closePool, withDb, withTenantTx } from "../src/db/pool.js";
import {
  issueSignedUrl,
  type SignedUrlStorage,
} from "../src/services/bpo-document-access.js";

// Service-level unit tests for issueSignedUrl. The Supabase client is
// dependency-injected via the deps argument so we don't touch the real bucket.
// The audit-row INSERT runs against the real (test) DB so we exercise the
// actual schema/RULE.

const T = "5d175193-6ee2-4d6a-b16e-f1777f7e18ad";

const PARTNER_ID = "00000000-0000-0000-0000-0000000bdc01";
const SME_ID = "00000000-0000-0000-0000-0000000bdc02";
const SME_NAME = "BPO Doc Access Test SME";
const KEY_ID = "00000000-0000-0000-0000-0000000bdc03";
const TOKEN = randomBytes(32).toString("hex");
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest();

const LOAN_OK = "TEST_BPO_DOC_ACCESS_OK";
const DOC_ID = "doc-test-001";
const FILE_KEY = "test/loan-doc-001.pdf";

function makeFakeSb(
  result: { data: { signedUrl: string } | null; error: { message: string } | null },
  spy?: (path: string, expiresIn: number) => void,
): SignedUrlStorage {
  return {
    storage: {
      from: (_bucket: string) => ({
        createSignedUrl: async (path: string, expiresIn: number) => {
          spy?.(path, expiresIn);
          return result;
        },
      }),
    },
  };
}

async function cleanupAuditRows() {
  await withDb(async (c) => {
    await c.query(
      `DELETE FROM tenant_audit_log
        WHERE action = 'bpo_document_access' AND actor_id = $1`,
      [`bpo:${SME_ID}`],
    );
  });
}

beforeAll(async () => {
  // Ensure tenant + partner + SME exist so the audit FK target_tenant_id and
  // any ambient FK constraints resolve. We don't strictly need bpo_api_keys
  // here (no HTTP layer) but keep the data tidy.
  await cleanupAuditRows();
  await withDb(async (c) => {
    await c.query(`DELETE FROM bpo_api_keys WHERE id = $1`, [KEY_ID]);
    await c.query(`DELETE FROM bpo_smes WHERE id = $1`, [SME_ID]);
    await c.query(`DELETE FROM bpo_partners WHERE id = $1`, [PARTNER_ID]);

    await c.query(
      `INSERT INTO bpo_partners (id, name, contact_email, active, dpa_on_file, dpa_reference)
       VALUES ($1, 'BPO Doc Access Partner', 'bpo-doc-access@test.example', true, true, 'DPA-TEST-DOCACCESS')`,
      [PARTNER_ID],
    );
    await c.query(
      `INSERT INTO bpo_smes (id, bpo_partner_id, name, email, active)
       VALUES ($1, $2, $3, 'bpo-doc-access-sme@test.example', true)`,
      [SME_ID, PARTNER_ID, SME_NAME],
    );
    await c.query(
      `INSERT INTO bpo_api_keys (id, sme_id, tenant_id, key_hash)
       VALUES ($1, $2, $3, $4)`,
      [KEY_ID, SME_ID, T, TOKEN_HASH],
    );
  });
});

beforeEach(async () => {
  await cleanupAuditRows();
});

afterAll(async () => {
  await cleanupAuditRows();
  await withDb(async (c) => {
    await c.query(`DELETE FROM bpo_api_keys WHERE id = $1`, [KEY_ID]);
    await c.query(`DELETE FROM bpo_smes WHERE id = $1`, [SME_ID]);
    await c.query(`DELETE FROM bpo_partners WHERE id = $1`, [PARTNER_ID]);
  });
  await closePool();
});

describe("issueSignedUrl (service)", () => {
  it("happy path — returns url + expiresAt and writes audit row WITHOUT file_key", async () => {
    const calls: Array<{ path: string; expiresIn: number }> = [];
    const fake = makeFakeSb(
      { data: { signedUrl: "https://test.supabase.co/signed?token=abc" }, error: null },
      (path, expiresIn) => calls.push({ path, expiresIn }),
    );

    const before = Date.now();
    const result = await issueSignedUrl(
      {
        tenantId: T,
        partnerId: PARTNER_ID,
        smeId: SME_ID,
        loanId: LOAN_OK,
        docId: DOC_ID,
        fileKey: FILE_KEY,
      },
      { supabase: fake },
    );

    expect(result.url).toBe("https://test.supabase.co/signed?token=abc");
    // 15-minute expiry
    expect(calls).toEqual([{ path: FILE_KEY, expiresIn: 15 * 60 }]);
    const expiresMs = Date.parse(result.expiresAt);
    expect(expiresMs).toBeGreaterThanOrEqual(before + 15 * 60 * 1000 - 1000);
    expect(expiresMs).toBeLessThanOrEqual(Date.now() + 15 * 60 * 1000 + 1000);

    // Audit row was written using the verified schema. tenant_audit_log is
    // append-only (RULEs in migration 008) so we just SELECT.
    const row = await withDb(async (c) => {
      const { rows } = await c.query<{
        actor_id: string;
        target_tenant_id: string;
        action: string;
        reason: string;
        metadata: Record<string, unknown>;
      }>(
        `SELECT actor_id, target_tenant_id, action, reason, metadata
           FROM tenant_audit_log
          WHERE action = 'bpo_document_access' AND actor_id = $1
          ORDER BY created_at DESC LIMIT 1`,
        [`bpo:${SME_ID}`],
      );
      return rows[0];
    });
    expect(row).toBeTruthy();
    expect(row.actor_id).toBe(`bpo:${SME_ID}`);
    expect(row.target_tenant_id).toBe(T);
    expect(row.action).toBe("bpo_document_access");
    expect(row.reason).toContain(DOC_ID);
    expect(row.reason).toContain(LOAN_OK);
    expect(row.metadata).toMatchObject({
      partner_id: PARTNER_ID,
      sme_id: SME_ID,
      loan_id: LOAN_OK,
      doc_id: DOC_ID,
    });
    // Sensitive: file_key (storage path) MUST NOT appear in metadata.
    expect(row.metadata).not.toHaveProperty("file_key");
    expect(JSON.stringify(row.metadata)).not.toContain(FILE_KEY);
  });

  it("Supabase failure — throws BPO_SIGNED_URL_FAILED and writes no audit row", async () => {
    const countRows = async (): Promise<number> =>
      withDb(async (c) => {
        const { rows } = await c.query<{ n: string }>(
          `SELECT count(*) AS n FROM tenant_audit_log WHERE actor_id = $1`,
          [`bpo:${SME_ID}`],
        );
        return Number(rows[0].n);
      });

    const before = await countRows();
    const fake = makeFakeSb({ data: null, error: { message: "bucket not found" } });
    await expect(
      issueSignedUrl(
        {
          tenantId: T,
          partnerId: PARTNER_ID,
          smeId: SME_ID,
          loanId: LOAN_OK,
          docId: DOC_ID,
          fileKey: FILE_KEY,
        },
        { supabase: fake },
      ),
    ).rejects.toThrow(/BPO_SIGNED_URL_FAILED.*bucket not found/);
    const after = await countRows();
    // Service threw before the INSERT — row count must be unchanged.
    expect(after).toBe(before);
  });

  it("missing env vars — throws BPO_DOC_STORAGE_UNCONFIGURED when no deps + no env", async () => {
    const savedUrl = process.env.SUPABASE_URL;
    const savedKey = process.env.SUPABASE_SERVICE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    try {
      await expect(
        issueSignedUrl({
          tenantId: T,
          partnerId: PARTNER_ID,
          smeId: SME_ID,
          loanId: LOAN_OK,
          docId: DOC_ID,
          fileKey: FILE_KEY,
        }),
      ).rejects.toThrow(/BPO_DOC_STORAGE_UNCONFIGURED/);
    } finally {
      if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
      if (savedKey !== undefined) process.env.SUPABASE_SERVICE_KEY = savedKey;
    }
  });
});
