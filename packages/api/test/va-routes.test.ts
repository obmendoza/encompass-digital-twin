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
import { closePool, withDb, withTenantTx } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

// ── Demo tenant for non-toggle tests ───────────────────────────────────────
const T = "5d175193-6ee2-4d6a-b16e-f1777f7e18ad";
const POOL_ID = "00000000-0000-0000-0000-0000000099cc";
const POOL_OTHER_ID = "00000000-0000-0000-0000-0000000099cd";

const LOAN_CLAIM_OK = "TEST_VA_ROUTES_CLAIM_OK";
const LOAN_CLAIM_409 = "TEST_VA_ROUTES_CLAIM_409";
const LOAN_REVIEW_NOTCLAIMANT = "TEST_VA_ROUTES_REVIEW_NOTCLAIMANT";
const LOAN_REVIEW_OK = "TEST_VA_ROUTES_REVIEW_OK";
const LOAN_HISTORY = "TEST_VA_ROUTES_HISTORY";
const LOAN_QUEUE_1 = "TEST_VA_ROUTES_QUEUE_1";
const LOAN_QUEUE_2 = "TEST_VA_ROUTES_QUEUE_2";
const LOAN_QUEUE_OTHER = "TEST_VA_ROUTES_QUEUE_OTHER";
const ALL_LOANS = [
  LOAN_CLAIM_OK,
  LOAN_CLAIM_409,
  LOAN_REVIEW_NOTCLAIMANT,
  LOAN_REVIEW_OK,
  LOAN_HISTORY,
  LOAN_QUEUE_1,
  LOAN_QUEUE_2,
  LOAN_QUEUE_OTHER,
];

const SPECIALIST_SIGNOFFS = [
  { specialist: "doc", signoff: "concur", notes: null },
  { specialist: "income", signoff: "concur", notes: null },
  { specialist: "asset", signoff: "concur", notes: null },
  { specialist: "credit", signoff: "concur", notes: null },
  { specialist: "property", signoff: "concur", notes: null },
  { specialist: "compliance", signoff: "concur", notes: null },
];
const RATIONALE = "All specialists concur and the agent's recommendation is well supported.";
const AGENT_REC_ID = "11111111-1111-4111-8111-111111111111";
const KB_VERSION = "kb-2026-05-01";

// ── Dedicated tenant for the toggle test (mirrors va-toggle.test.ts) ──────
const TG_T = "5d175193-6ee2-4d6a-b16e-bb00bb00bb00";
const TG_POOL_ID = "00000000-0000-0000-0000-00000000b07e";
const TG_TENANT_NAME = "VA Routes Toggle Test Tenant";
const TG_TENANT_SLUG = "va-routes-toggle-test";

// Per-test state cleanup — keeps pools/memberships intact so we don't have
// to re-seed them every iteration. Used in beforeEach.
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

// Full cleanup including pools — used at the very start (beforeAll) and
// at suite end (afterAll).
async function cleanupAll() {
  await cleanupPerTest();
  await withTenantTx(T, async (c) => {
    await c.query(`DELETE FROM va_pool_memberships WHERE pool_id = ANY($1::uuid[])`, [
      [POOL_ID, POOL_OTHER_ID],
    ]);
    await c.query(
      `DELETE FROM va_pools WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [T, [POOL_ID, POOL_OTHER_ID]],
    );
  });
}

beforeAll(async () => {
  // Demo tenant fixtures.
  await cleanupAll();
  await withTenantTx(T, async (c) => {
    await c.query(
      `INSERT INTO va_pools (id, tenant_id, name, kind, active)
       VALUES ($1, $2, 'Test VA Routes Pool', 'internal', true),
              ($3, $2, 'Test VA Routes Other Pool', 'internal', true)`,
      [POOL_ID, T, POOL_OTHER_ID],
    );
    await c.query(
      `INSERT INTO va_pool_memberships (pool_id, member_id, member_kind)
       VALUES ($1, 'u1', 'internal'), ($1, 'u2', 'internal')`,
      [POOL_ID],
    );
  });

  // Toggle tenant fixtures (idempotent, persistent).
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, $2, $3, 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [TG_T, TG_TENANT_NAME, TG_TENANT_SLUG],
    );
  });
  await withTenantTx(TG_T, async (c) => {
    await c.query(
      `INSERT INTO va_pools (id, tenant_id, name, kind, active)
       VALUES ($1, $2, 'VA Routes Toggle Pool', 'internal', true)
       ON CONFLICT (id) DO NOTHING`,
      [TG_POOL_ID, TG_T],
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

function buildHeaders(opts: { tenantId?: string; userId?: string } = {}): Record<string, string> {
  return {
    "x-tenant-id": opts.tenantId ?? T,
    "x-user-id": opts.userId ?? "u1",
    "x-user-email": `${opts.userId ?? "u1"}@test`,
  };
}

describe("va routes", () => {
  it("POST /loans/:id/va/claim — 200 when state=va_review_pending and user is in pool", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3)`,
        [T, LOAN_CLAIM_OK, POOL_ID],
      );
    });
    const { app } = buildServer();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: `/loans/${LOAN_CLAIM_OK}/va/claim`,
      headers: buildHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.claimed).toBe(true);
    expect(body.vaId).toBe("u1");
    await app.close();
  });

  it("POST /loans/:id/va/claim — 409 when not in va_review_pending", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'agent_review_pending', $3)`,
        [T, LOAN_CLAIM_409, POOL_ID],
      );
    });
    const { app } = buildServer();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: `/loans/${LOAN_CLAIM_409}/va/claim`,
      headers: buildHeaders(),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.claimed).toBe(false);
    expect(body.reason).toBeTruthy();
    await app.close();
  });

  it("POST /loans/:id/va/review — 409 when caller is not the claimant", async () => {
    const claimedAt = new Date(Date.now() - 5_000).toISOString();
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, va_id, assigned_pool_id, claimed_at)
         VALUES ($1, $2, 'va_in_review', 'u1', $3, $4)`,
        [T, LOAN_REVIEW_NOTCLAIMANT, POOL_ID, claimedAt],
      );
    });
    const { app } = buildServer();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: `/loans/${LOAN_REVIEW_NOTCLAIMANT}/va/review`,
      headers: buildHeaders({ userId: "u2" }),
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
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("VA_NOT_CLAIMANT");
    await app.close();
  });

  it("POST /loans/:id/va/review — 200 happy path (concur)", async () => {
    const claimedAt = new Date(Date.now() - 30_000).toISOString();
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, va_id, assigned_pool_id, claimed_at)
         VALUES ($1, $2, 'va_in_review', 'u1', $3, $4)`,
        [T, LOAN_REVIEW_OK, POOL_ID, claimedAt],
      );
    });
    const { app } = buildServer();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: `/loans/${LOAN_REVIEW_OK}/va/review`,
      headers: buildHeaders({ userId: "u1" }),
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
    expect(body.outboxEventId).toBeNull();
    await app.close();
  });

  it("GET /loans/:id/va/review-history — returns reviews ordered by submitted_at ASC", async () => {
    // Insert two va_reviews rows directly (skip the writer's state machine).
    const earlier = new Date(Date.now() - 60_000).toISOString();
    const later = new Date(Date.now() - 10_000).toISOString();
    const id1 = "22222222-2222-4222-8222-222222222222";
    const id2 = "33333333-3333-4333-8333-333333333333";
    await withTenantTx(T, async (c) => {
      // Insert *later* first to verify ordering.
      for (const [id, submittedAt] of [
        [id2, later],
        [id1, earlier],
      ] as const) {
        await c.query(
          `INSERT INTO va_reviews (
             id, tenant_id, loan_id, va_id, va_pool_id, pool_kind, verdict,
             specialist_signoffs, condition_actions, overall_rationale, doc_request,
             agent_recommendation_id, kb_version, chatbot_consultation_ids,
             claimed_at, submitted_at, review_time_seconds
           ) VALUES ($1, $2, $3, 'u1', $4, 'internal', 'concur',
                     $5::jsonb, '[]'::jsonb, $6, NULL,
                     $7, $8, '{}'::uuid[],
                     $9, $10, 12)`,
          [
            id,
            T,
            LOAN_HISTORY,
            POOL_ID,
            JSON.stringify(SPECIALIST_SIGNOFFS),
            RATIONALE,
            AGENT_REC_ID,
            KB_VERSION,
            submittedAt,
            submittedAt,
          ],
        );
      }
    });

    const { app } = buildServer();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: `/loans/${LOAN_HISTORY}/va/review-history`,
      headers: buildHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reviews).toHaveLength(2);
    expect(body.reviews[0].id).toBe(id1); // earlier first
    expect(body.reviews[1].id).toBe(id2);
    expect(new Date(body.reviews[0].submitted_at).getTime()).toBeLessThan(
      new Date(body.reviews[1].submitted_at).getTime(),
    );
    await app.close();
  });

  it("GET /va/queue — returns va_review_pending loans for the requested pool", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3),
                ($1, $4, 'va_review_pending', $3),
                ($1, $5, 'va_review_pending', $6)`,
        [T, LOAN_QUEUE_1, POOL_ID, LOAN_QUEUE_2, LOAN_QUEUE_OTHER, POOL_OTHER_ID],
      );
    });

    const { app } = buildServer();
    await app.ready();
    const res = await app.inject({
      method: "GET",
      url: `/va/queue?pool=${POOL_ID}&limit=50`,
      headers: buildHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = body.items.map((r: { loan_id: string }) => r.loan_id).sort();
    expect(ids).toEqual([LOAN_QUEUE_1, LOAN_QUEUE_2].sort());
    expect(body.items.every((r: { assigned_pool_id: string }) => r.assigned_pool_id === POOL_ID)).toBe(true);
    await app.close();
  });

  it("POST /admin/va/toggle — flips required and writes back to tenants.settings.va", async () => {
    // Reset toggle tenant settings to a known {required: false, fallbackPoolId: TG_POOL_ID} baseline.
    await withDb(async (c) => {
      await c.query(
        `UPDATE tenants
            SET settings = jsonb_build_object(
                  'va', jsonb_build_object(
                    'required', false,
                    'fallbackPoolId', $1::text
                  )
                )
          WHERE id = $2`,
        [TG_POOL_ID, TG_T],
      );
      // Clean any state rows from earlier toggle runs.
      await c.query(`DELETE FROM va_loan_state WHERE tenant_id = $1`, [TG_T]);
    });

    const { app } = buildServer();
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/admin/va/toggle",
        headers: buildHeaders({ tenantId: TG_T, userId: "admin" }),
        payload: { required: true },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.direction).toBe("false_to_true");

      // Verify tenants.settings.va.required was persisted.
      const after = await withDb(async (c) => {
        const { rows } = await c.query<{ settings: { va: { required: boolean; fallbackPoolId: string } } }>(
          `SELECT settings FROM tenants WHERE id = $1`,
          [TG_T],
        );
        return rows[0];
      });
      expect(after.settings.va.required).toBe(true);
      expect(after.settings.va.fallbackPoolId).toBe(TG_POOL_ID);
    } finally {
      // Reset for idempotent re-runs.
      await withDb(async (c) => {
        await c.query(
          `UPDATE tenants
              SET settings = jsonb_build_object(
                    'va', jsonb_build_object(
                      'required', false,
                      'fallbackPoolId', $1::text
                    )
                  )
            WHERE id = $2`,
          [TG_POOL_ID, TG_T],
        );
      });
      await app.close();
    }
  });
});
