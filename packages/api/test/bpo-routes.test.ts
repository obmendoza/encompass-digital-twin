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
import { buildServer } from "../src/server.js";

// ── Demo tenant (same one used by va-routes.test.ts) ───────────────────────
const T = "5d175193-6ee2-4d6a-b16e-f1777f7e18ad";

// ── BPO identity fixtures ──────────────────────────────────────────────────
const PARTNER_ID = "00000000-0000-0000-0000-0000000bbf01";
const SME_ID = "00000000-0000-0000-0000-0000000bbf02";
const SME_NAME = "BPO Routes Test SME";
const KEY_ID = "00000000-0000-0000-0000-0000000bbf03";
const TOKEN = randomBytes(32).toString("hex");
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest();

// ── BPO pools (one with the SME as a member, one without) ─────────────────
const POOL_A_ID = "00000000-0000-0000-0000-0000000bbf10"; // SME is a member
const POOL_B_ID = "00000000-0000-0000-0000-0000000bbf11"; // SME is NOT a member

// ── Test loans ─────────────────────────────────────────────────────────────
const LOAN_QUEUE_A_1 = "TEST_BPO_ROUTES_QUEUE_A_1";
const LOAN_QUEUE_A_2 = "TEST_BPO_ROUTES_QUEUE_A_2";
const LOAN_QUEUE_B = "TEST_BPO_ROUTES_QUEUE_B"; // in pool B → must NOT appear
const LOAN_DETAIL_CROSS = "TEST_BPO_ROUTES_DETAIL_CROSS"; // in pool B → 404
const LOAN_CLAIM_OK = "TEST_BPO_ROUTES_CLAIM_OK";
const LOAN_REVIEW_OK = "TEST_BPO_ROUTES_REVIEW_OK";
const LOAN_DOCS_RETURNED = "TEST_BPO_ROUTES_DOCS_RETURNED";
const LOAN_SIGNED_URL = "TEST_BPO_ROUTES_SIGNED_URL";
const ALL_LOANS = [
  LOAN_QUEUE_A_1,
  LOAN_QUEUE_A_2,
  LOAN_QUEUE_B,
  LOAN_DETAIL_CROSS,
  LOAN_CLAIM_OK,
  LOAN_REVIEW_OK,
  LOAN_DOCS_RETURNED,
  LOAN_SIGNED_URL,
];

const SPECIALIST_SIGNOFFS = [
  { specialist: "doc", signoff: "concur", notes: null },
  { specialist: "income", signoff: "concur", notes: null },
  { specialist: "asset", signoff: "concur", notes: null },
  { specialist: "credit", signoff: "concur", notes: null },
  { specialist: "property", signoff: "concur", notes: null },
  { specialist: "compliance", signoff: "concur", notes: null },
];
const RATIONALE =
  "All specialists concur and the agent's recommendation is well supported.";
const AGENT_REC_ID = "44444444-4444-4444-8444-444444444444";
const KB_VERSION = "kb-2026-05-01";

async function cleanupPerTest() {
  await withTenantTx(T, async (c) => {
    await c.query(
      `DELETE FROM va_event_outbox WHERE tenant_id = $1 AND loan_id = ANY($2::text[])`,
      [T, ALL_LOANS],
    );
    await c.query(
      `UPDATE va_loan_state SET current_va_review_id = NULL
        WHERE tenant_id = $1 AND loan_id = ANY($2::text[])`,
      [T, ALL_LOANS],
    );
    await c.query(
      `DELETE FROM va_reviews WHERE tenant_id = $1 AND loan_id = ANY($2::text[])`,
      [T, ALL_LOANS],
    );
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
      [[POOL_A_ID, POOL_B_ID]],
    );
    await c.query(
      `DELETE FROM va_pools WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [T, [POOL_A_ID, POOL_B_ID]],
    );
  });
  await withDb(async (c) => {
    await c.query(`DELETE FROM bpo_smes WHERE id = $1`, [SME_ID]);
    await c.query(`DELETE FROM bpo_partners WHERE id = $1`, [PARTNER_ID]);
  });
}

beforeAll(async () => {
  await cleanupAll();

  // Partner with DPA on file (required so we can create a kind='bpo' pool).
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO bpo_partners (id, name, contact_email, active, dpa_on_file, dpa_reference)
       VALUES ($1, 'BPO Routes Test Partner', 'bpo-routes@test.example', true, true, 'DPA-TEST-BPOROUTES')`,
      [PARTNER_ID],
    );
    await c.query(
      `INSERT INTO bpo_smes (id, bpo_partner_id, name, email, active)
       VALUES ($1, $2, $3, 'bpo-routes-sme@test.example', true)`,
      [SME_ID, PARTNER_ID, SME_NAME],
    );
    await c.query(
      `INSERT INTO bpo_api_keys (id, sme_id, tenant_id, key_hash)
       VALUES ($1, $2, $3, $4)`,
      [KEY_ID, SME_ID, T, TOKEN_HASH],
    );
  });

  // Two BPO pools and SME-in-pool-A membership.
  await withTenantTx(T, async (c) => {
    await c.query(
      `INSERT INTO va_pools (id, tenant_id, name, kind, bpo_partner_id, active)
       VALUES ($1, $2, 'BPO Routes Pool A', 'bpo', $3, true),
              ($4, $2, 'BPO Routes Pool B', 'bpo', $3, true)`,
      [POOL_A_ID, T, PARTNER_ID, POOL_B_ID],
    );
    await c.query(
      `INSERT INTO va_pool_memberships (pool_id, member_id, member_kind)
       VALUES ($1, $2, 'bpo')`,
      [POOL_A_ID, SME_ID],
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

describe("bpo routes", () => {
  it("POST /bpo/auth — valid token returns smeId/partnerId/tenantId", async () => {
    const { app } = buildServer();
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/bpo/auth",
        headers: bearer(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tenantId).toBe(T);
      expect(body.smeId).toBe(SME_ID);
      expect(body.partnerId).toBe(PARTNER_ID);
      expect(body.smeName).toBe(SME_NAME);
    } finally {
      await app.close();
    }
  });

  it("POST /bpo/auth — missing token returns 401", async () => {
    const { app } = buildServer();
    await app.ready();
    try {
      const res = await app.inject({ method: "POST", url: "/bpo/auth" });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: "missing_bearer_token" });
    } finally {
      await app.close();
    }
  });

  it("GET /bpo/queue — returns only loans in pools the SME is a member of", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3),
                ($1, $4, 'va_review_pending', $3),
                ($1, $5, 'va_review_pending', $6)`,
        [T, LOAN_QUEUE_A_1, POOL_A_ID, LOAN_QUEUE_A_2, LOAN_QUEUE_B, POOL_B_ID],
      );
    });

    const { app } = buildServer();
    await app.ready();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/bpo/queue",
        headers: bearer(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const ids = body.items.map((r: { loan_id: string }) => r.loan_id).sort();
      expect(ids).toEqual([LOAN_QUEUE_A_1, LOAN_QUEUE_A_2].sort());
      expect(
        body.items.every(
          (r: { assigned_pool_id: string }) => r.assigned_pool_id === POOL_A_ID,
        ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("GET /bpo/loans/:id — 404 when SME isn't in the loan's pool", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3)`,
        [T, LOAN_DETAIL_CROSS, POOL_B_ID],
      );
    });

    const { app } = buildServer();
    await app.ready();
    try {
      const res = await app.inject({
        method: "GET",
        url: `/bpo/loans/${LOAN_DETAIL_CROSS}`,
        headers: bearer(),
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: "loan_not_found" });
    } finally {
      await app.close();
    }
  });

  it("POST /bpo/loans/:id/claim — 200 and claimed: true on happy path", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3)`,
        [T, LOAN_CLAIM_OK, POOL_A_ID],
      );
    });

    const { app } = buildServer();
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/bpo/loans/${LOAN_CLAIM_OK}/claim`,
        headers: bearer(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.claimed).toBe(true);
      expect(body.vaId).toBe(SME_ID);
    } finally {
      await app.close();
    }
  });

  it("POST /bpo/loans/:id/review — 200 happy path with poolKind='bpo'", async () => {
    const claimedAt = new Date(Date.now() - 30_000).toISOString();
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, va_id, assigned_pool_id, claimed_at)
         VALUES ($1, $2, 'va_in_review', $3, $4, $5)`,
        [T, LOAN_REVIEW_OK, SME_ID, POOL_A_ID, claimedAt],
      );
    });

    const { app } = buildServer();
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/bpo/loans/${LOAN_REVIEW_OK}/review`,
        headers: bearer(),
        payload: {
          verdict: "concur",
          specialistSignoffs: SPECIALIST_SIGNOFFS,
          conditionActions: [],
          overallRationale: RATIONALE,
          docRequest: null,
          agentRecommendationId: AGENT_REC_ID,
          kbVersion: KB_VERSION,
          chatbotConsultationIds: [],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.reviewId).toBeTruthy();
      expect(body.newState).toBe("uw_review_pending");

      // Verify the persisted row has pool_kind='bpo' and the SME as actor.
      const persisted = await withTenantTx(T, async (c) => {
        const { rows } = await c.query<{
          pool_kind: string;
          va_id: string;
          va_pool_id: string;
        }>(
          `SELECT pool_kind, va_id, va_pool_id FROM va_reviews WHERE id = $1`,
          [body.reviewId],
        );
        return rows[0];
      });
      expect(persisted?.pool_kind).toBe("bpo");
      expect(persisted?.va_id).toBe(SME_ID);
      expect(persisted?.va_pool_id).toBe(POOL_A_ID);
    } finally {
      await app.close();
    }
  });

  it("POST /bpo/loans/:id/docs-returned — 501 stub", async () => {
    const { app } = buildServer();
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: `/bpo/loans/${LOAN_DOCS_RETURNED}/docs-returned`,
        headers: bearer(),
        payload: {},
      });
      expect(res.statusCode).toBe(501);
      const body = res.json();
      expect(body.error).toBe("NOT_IMPLEMENTED");
      expect(body.details).toMatch(/Task 18/);
    } finally {
      await app.close();
    }
  });

  // Note: GET /bpo/loans/:id/documents/:docId/signed-url is fully covered by
  // bpo-document-access.test.ts (Task 16). Service-unit + route integration
  // tests live there together with their Supabase mock setup.
});
