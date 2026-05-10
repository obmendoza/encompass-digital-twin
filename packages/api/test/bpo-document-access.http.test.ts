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

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { closePool, withDb, withTenantTx } from "../src/db/pool.js";

// Mock the service module BEFORE importing buildServer (which imports the
// route module which imports the service). vi.mock is hoisted so this is
// safe to declare alongside the imports above.
vi.mock("../src/services/bpo-document-access.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/services/bpo-document-access.js")
  >("../src/services/bpo-document-access.js");
  return {
    ...actual,
    issueSignedUrl: vi.fn(
      async (
        input: import("../src/services/bpo-document-access.js").IssueSignedUrlInput,
      ) => ({
        url: `https://mocked.supabase.co/signed?key=${input.fileKey}`,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
    ),
  };
});

import { buildServer } from "../src/server.js";

const T = "5d175193-6ee2-4d6a-b16e-f1777f7e18ad";

const PARTNER_ID = "00000000-0000-0000-0000-0000000bdd01";
const SME_ID = "00000000-0000-0000-0000-0000000bdd02";
const SME_NAME = "BPO Doc Access HTTP Test SME";
const KEY_ID = "00000000-0000-0000-0000-0000000bdd03";
const TOKEN = randomBytes(32).toString("hex");
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest();

const POOL_OWN = "00000000-0000-0000-0000-0000000bdd10";
const POOL_OTHER = "00000000-0000-0000-0000-0000000bdd11";

const LOAN_OK = "TEST_BPO_DOC_HTTP_OK";
const LOAN_NO_DOC = "TEST_BPO_DOC_HTTP_NO_DOC";
const LOAN_CROSS = "TEST_BPO_DOC_HTTP_CROSS";
const ALL_LOANS = [LOAN_OK, LOAN_NO_DOC, LOAN_CROSS];

const DOC_ID = "doc-test-001";
const FILE_KEY = "test/loan-doc-001.pdf";

// Minimal-ish loan object for the in-memory store. The reducer doesn't
// validate shape; only `id`, `tenantId`, and `documents[]` matter for the
// signed-url path. The non-essential fields are stub-typed via `unknown`
// to silence TS without producing runtime work.
function makeStubLoan(loanId: string, withDoc: boolean) {
  return {
    id: loanId,
    tenantId: T,
    nqmProgram: "DSCR",
    qualifyingMethod: "DSCRCoverage",
    borrower: {} as unknown,
    property: {} as unknown,
    transaction: {} as unknown,
    qualifying: {} as unknown,
    qualifyingWorksheet: {} as unknown,
    income: {} as unknown,
    assets: {} as unknown,
    credit: {} as unknown,
    appraisal: {} as unknown,
    compliance: {} as unknown,
    overlay: {} as unknown,
    conditions: [],
    decision: "pending",
    milestones: [],
    documents: withDoc
      ? [
          {
            id: DOC_ID,
            name: "Test Doc.pdf",
            docType: "BankStatement",
            status: "Received",
            uploadedBy: "uw1",
            uploadedAt: "2026-05-10T00:00:00.000Z",
            fileKey: FILE_KEY,
            fileUrl: `/uploads/${FILE_KEY}`,
            mimeType: "application/pdf",
            fileSize: 1024,
          },
        ]
      : [],
  };
}

async function cleanupPerTest() {
  await withTenantTx(T, async (c) => {
    await c.query(
      `DELETE FROM va_loan_state WHERE tenant_id = $1 AND loan_id = ANY($2::text[])`,
      [T, ALL_LOANS],
    );
  });
}

async function cleanupAll() {
  await cleanupPerTest();
  await withDb(async (c) => {
    await c.query(`DELETE FROM bpo_api_keys WHERE id = $1`, [KEY_ID]);
  });
  await withTenantTx(T, async (c) => {
    await c.query(
      `DELETE FROM va_pool_memberships WHERE pool_id = ANY($1::uuid[])`,
      [[POOL_OWN, POOL_OTHER]],
    );
    await c.query(
      `DELETE FROM va_pools WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [T, [POOL_OWN, POOL_OTHER]],
    );
  });
  await withDb(async (c) => {
    await c.query(`DELETE FROM bpo_smes WHERE id = $1`, [SME_ID]);
    await c.query(`DELETE FROM bpo_partners WHERE id = $1`, [PARTNER_ID]);
  });
}

beforeAll(async () => {
  await cleanupAll();

  await withDb(async (c) => {
    await c.query(
      `INSERT INTO bpo_partners (id, name, contact_email, active, dpa_on_file, dpa_reference)
       VALUES ($1, 'BPO Doc HTTP Partner', 'bpo-doc-http@test.example', true, true, 'DPA-TEST-DOCHTTP')`,
      [PARTNER_ID],
    );
    await c.query(
      `INSERT INTO bpo_smes (id, bpo_partner_id, name, email, active)
       VALUES ($1, $2, $3, 'bpo-doc-http-sme@test.example', true)`,
      [SME_ID, PARTNER_ID, SME_NAME],
    );
    await c.query(
      `INSERT INTO bpo_api_keys (id, sme_id, tenant_id, key_hash)
       VALUES ($1, $2, $3, $4)`,
      [KEY_ID, SME_ID, T, TOKEN_HASH],
    );
  });

  await withTenantTx(T, async (c) => {
    await c.query(
      `INSERT INTO va_pools (id, tenant_id, name, kind, bpo_partner_id, active)
       VALUES ($1, $2, 'BPO Doc HTTP Pool Own', 'bpo', $3, true),
              ($4, $2, 'BPO Doc HTTP Pool Other', 'bpo', $3, true)`,
      [POOL_OWN, T, PARTNER_ID, POOL_OTHER],
    );
    await c.query(
      `INSERT INTO va_pool_memberships (pool_id, member_id, member_kind)
       VALUES ($1, $2, 'bpo')`,
      [POOL_OWN, SME_ID],
    );
  });
});

beforeEach(async () => {
  await cleanupPerTest();
});

afterAll(async () => {
  await cleanupAll();
  await closePool();
});

function bearer(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}` };
}

describe("GET /bpo/loans/:id/documents/:docId/signed-url", () => {
  it("happy path — returns 200 with url + expiresAt", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3)`,
        [T, LOAN_OK, POOL_OWN],
      );
    });

    const { app, store } = buildServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.dispatch({ type: "InjectLoan", loan: makeStubLoan(LOAN_OK, true) as any });
    await app.ready();
    try {
      const res = await app.inject({
        method: "GET",
        url: `/bpo/loans/${LOAN_OK}/documents/${DOC_ID}/signed-url`,
        headers: bearer(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.url).toContain(FILE_KEY);
      expect(typeof body.expiresAt).toBe("string");
      expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
    } finally {
      await app.close();
    }
  });

  it("404 — SME is not in the loan's pool (cross-pool)", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3)`,
        [T, LOAN_CROSS, POOL_OTHER],
      );
    });

    const { app, store } = buildServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.dispatch({ type: "InjectLoan", loan: makeStubLoan(LOAN_CROSS, true) as any });
    await app.ready();
    try {
      const res = await app.inject({
        method: "GET",
        url: `/bpo/loans/${LOAN_CROSS}/documents/${DOC_ID}/signed-url`,
        headers: bearer(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "loan_not_found" });
    } finally {
      await app.close();
    }
  });

  it("404 — SME in pool but the document id doesn't exist on the loan", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3)`,
        [T, LOAN_NO_DOC, POOL_OWN],
      );
    });

    const { app, store } = buildServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store.dispatch({ type: "InjectLoan", loan: makeStubLoan(LOAN_NO_DOC, false) as any });
    await app.ready();
    try {
      const res = await app.inject({
        method: "GET",
        url: `/bpo/loans/${LOAN_NO_DOC}/documents/does-not-exist/signed-url`,
        headers: bearer(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "document_not_found" });
    } finally {
      await app.close();
    }
  });
});
