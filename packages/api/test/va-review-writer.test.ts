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

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { withTenantTx, closePool } from "../src/db/pool.js";
import { submitVAReview } from "../src/services/va-review-writer.js";

const T = "5d175193-6ee2-4d6a-b16e-f1777f7e18ad"; // demo tenant
const POOL_ID = "00000000-0000-0000-0000-0000000099bb";

const LOAN_CONCUR = "TEST_VA_REVIEW_CONCUR_1";
const LOAN_DOCS = "TEST_VA_REVIEW_DOCS_1";
const LOAN_LOST = "TEST_VA_REVIEW_LOST_1";
const ALL_LOANS = [LOAN_CONCUR, LOAN_DOCS, LOAN_LOST];

const SPECIALIST_SIGNOFFS = [
  { specialist: "doc" as const, signoff: "concur" as const, notes: null },
  { specialist: "income" as const, signoff: "concur" as const, notes: null },
  { specialist: "asset" as const, signoff: "concur" as const, notes: null },
  { specialist: "credit" as const, signoff: "concur" as const, notes: null },
  { specialist: "property" as const, signoff: "concur" as const, notes: null },
  { specialist: "compliance" as const, signoff: "concur" as const, notes: null },
];

const RATIONALE =
  "All specialists concur and the agent's recommendation is well supported.";

const AGENT_REC_ID = "11111111-1111-4111-8111-111111111111";
const KB_VERSION = "kb-2026-05-01";

async function cleanup() {
  await withTenantTx(T, async (c) => {
    await c.query(
      `DELETE FROM va_event_outbox WHERE tenant_id = $1 AND loan_id LIKE 'TEST_VA_REVIEW_%'`,
      [T],
    );
    // Clear FK from va_loan_state -> va_reviews before deleting reviews.
    await c.query(
      `UPDATE va_loan_state SET current_va_review_id = NULL
        WHERE tenant_id = $1 AND loan_id LIKE 'TEST_VA_REVIEW_%'`,
      [T],
    );
    await c.query(
      `DELETE FROM va_reviews WHERE tenant_id = $1 AND loan_id LIKE 'TEST_VA_REVIEW_%'`,
      [T],
    );
    await c.query(
      `DELETE FROM va_loan_state WHERE tenant_id = $1 AND loan_id LIKE 'TEST_VA_REVIEW_%'`,
      [T],
    );
    await c.query(`DELETE FROM va_pools WHERE tenant_id = $1 AND id = $2`, [
      T,
      POOL_ID,
    ]);
  });
}

beforeEach(async () => {
  await cleanup();
  await withTenantTx(T, async (c) => {
    await c.query(
      `INSERT INTO va_pools (id, tenant_id, name, kind, active)
       VALUES ($1, $2, 'Test VA Review Pool', 'internal', true)`,
      [POOL_ID, T],
    );
  });
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe("va-review-writer", () => {
  it("verdict=concur persists review, transitions to uw_review_pending, no outbox event", async () => {
    const claimedAt = new Date(Date.now() - 20_000).toISOString();
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state
           (tenant_id, loan_id, va_state, va_id, assigned_pool_id, claimed_at)
         VALUES ($1, $2, 'va_in_review', 'u1', $3, $4)`,
        [T, LOAN_CONCUR, POOL_ID, claimedAt],
      );
    });

    const result = await submitVAReview({
      tenantId: T,
      loanId: LOAN_CONCUR,
      vaId: "u1",
      vaPoolId: POOL_ID,
      poolKind: "internal",
      verdict: "concur",
      specialistSignoffs: SPECIALIST_SIGNOFFS,
      conditionActions: [],
      overallRationale: RATIONALE,
      docRequest: null,
      agentRecommendationId: AGENT_REC_ID,
      kbVersion: KB_VERSION,
      chatbotConsultationIds: [],
      claimedAt,
    });

    expect(result.newState).toBe("uw_review_pending");
    expect(result.outboxEventId).toBeNull();
    expect(result.reviewId).toBeTruthy();

    await withTenantTx(T, async (c) => {
      const reviews = await c.query(
        `SELECT id, verdict, review_time_seconds, doc_request
           FROM va_reviews
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_CONCUR],
      );
      expect(reviews.rows.length).toBe(1);
      expect(reviews.rows[0].id).toBe(result.reviewId);
      expect(reviews.rows[0].verdict).toBe("concur");
      expect(reviews.rows[0].doc_request).toBeNull();
      expect(reviews.rows[0].review_time_seconds).toBeGreaterThanOrEqual(19);
      expect(reviews.rows[0].review_time_seconds).toBeLessThanOrEqual(60);

      const state = await c.query(
        `SELECT va_state, va_id, current_va_review_id, claimed_at
           FROM va_loan_state
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_CONCUR],
      );
      expect(state.rows[0].va_state).toBe("uw_review_pending");
      expect(state.rows[0].va_id).toBeNull();
      expect(state.rows[0].claimed_at).toBeNull();
      expect(state.rows[0].current_va_review_id).toBe(result.reviewId);

      const outbox = await c.query(
        `SELECT id FROM va_event_outbox
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_CONCUR],
      );
      expect(outbox.rows.length).toBe(0);
    });
  });

  it("verdict=request_docs persists review, transitions to va_doc_request_pending, emits outbox event", async () => {
    const claimedAt = new Date(Date.now() - 25_000).toISOString();
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state
           (tenant_id, loan_id, va_state, va_id, assigned_pool_id, claimed_at)
         VALUES ($1, $2, 'va_in_review', 'u1', $3, $4)`,
        [T, LOAN_DOCS, POOL_ID, claimedAt],
      );
    });

    const docRequest = {
      docs: [
        {
          docType: "Bank Statement",
          reason: "missing 3 months",
          required: true,
        },
      ],
      deadline: "2026-05-25",
      messageToOriginator: "Please upload the missing bank statements.",
    };

    const result = await submitVAReview({
      tenantId: T,
      loanId: LOAN_DOCS,
      vaId: "u1",
      vaPoolId: POOL_ID,
      poolKind: "internal",
      verdict: "request_docs",
      specialistSignoffs: SPECIALIST_SIGNOFFS,
      conditionActions: [],
      overallRationale: RATIONALE,
      docRequest,
      agentRecommendationId: AGENT_REC_ID,
      kbVersion: KB_VERSION,
      chatbotConsultationIds: [],
      claimedAt,
    });

    expect(result.newState).toBe("va_doc_request_pending");
    expect(result.outboxEventId).not.toBeNull();
    expect(result.reviewId).toBeTruthy();

    await withTenantTx(T, async (c) => {
      const reviews = await c.query(
        `SELECT id, verdict, doc_request
           FROM va_reviews
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_DOCS],
      );
      expect(reviews.rows.length).toBe(1);
      expect(reviews.rows[0].verdict).toBe("request_docs");
      expect(reviews.rows[0].doc_request).not.toBeNull();

      const state = await c.query(
        `SELECT va_state, va_id, current_va_review_id
           FROM va_loan_state
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_DOCS],
      );
      expect(state.rows[0].va_state).toBe("va_doc_request_pending");
      expect(state.rows[0].va_id).toBeNull();
      expect(state.rows[0].current_va_review_id).toBe(result.reviewId);

      const outbox = await c.query(
        `SELECT id, event_type, payload
           FROM va_event_outbox
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_DOCS],
      );
      expect(outbox.rows.length).toBe(1);
      expect(outbox.rows[0].id).toBe(result.outboxEventId);
      expect(outbox.rows[0].event_type).toBe("va.doc_request_issued");
      expect(outbox.rows[0].payload.docs.length).toBe(1);
      expect(outbox.rows[0].payload.docs[0].docType).toBe("Bank Statement");
      expect(outbox.rows[0].payload.deadline).toBe("2026-05-25");
      expect(outbox.rows[0].payload.vaReviewId).toBe(result.reviewId);
    });
  });

  it("rolls back the entire transaction when va_loan_state is not in va_in_review (claim lost)", async () => {
    const claimedAt = new Date(Date.now() - 10_000).toISOString();
    await withTenantTx(T, async (c) => {
      // Seed state in va_review_pending, NOT va_in_review.
      await c.query(
        `INSERT INTO va_loan_state
           (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3)`,
        [T, LOAN_LOST, POOL_ID],
      );
    });

    await expect(
      submitVAReview({
        tenantId: T,
        loanId: LOAN_LOST,
        vaId: "u1",
        vaPoolId: POOL_ID,
        poolKind: "internal",
        verdict: "request_docs",
        specialistSignoffs: SPECIALIST_SIGNOFFS,
        conditionActions: [],
        overallRationale: RATIONALE,
        docRequest: {
          docs: [
            { docType: "Paystub", reason: "missing", required: true },
          ],
          deadline: "2026-05-25",
          messageToOriginator: "Please upload paystub.",
        },
        agentRecommendationId: AGENT_REC_ID,
        kbVersion: KB_VERSION,
        chatbotConsultationIds: [],
        claimedAt,
      }),
    ).rejects.toThrow(/VA_REVIEW_STATE_LOST/);

    await withTenantTx(T, async (c) => {
      const reviews = await c.query(
        `SELECT id FROM va_reviews
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_LOST],
      );
      expect(reviews.rows.length).toBe(0);

      const outbox = await c.query(
        `SELECT id FROM va_event_outbox
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_LOST],
      );
      expect(outbox.rows.length).toBe(0);

      // State unchanged.
      const state = await c.query(
        `SELECT va_state FROM va_loan_state
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_LOST],
      );
      expect(state.rows[0].va_state).toBe("va_review_pending");
    });
  });
});
