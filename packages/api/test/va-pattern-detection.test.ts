import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

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

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { withTenantTx, withDb, closePool } from "../src/db/pool.js";
import { detectVAPatterns } from "../src/learning/va-pattern-detector.js";

// Dedicated test tenant — keeps detection queries (which scan the full 30-day
// window across the tenant) isolated from demo-tenant noise.
const T = "5d175193-6ee2-4d6a-b16e-bb00bb00bb00";
const POOL_ID = "00000000-0000-0000-0000-00000000bb01";
const TENANT_NAME = "VA Pattern Detection Test Tenant";
const TENANT_SLUG = "va-pattern-detection-test";

const LOAN_PREFIX = "TEST_VA_PAT_";

const RATIONALE =
  "Test review rationale — must be at least twenty characters long.";
const KB_VERSION = "kb-test-2026-05-01";

type Signoff = "concur" | "disagree";
type SpecialistKind =
  | "doc"
  | "income"
  | "asset"
  | "credit"
  | "property"
  | "compliance";

function signoffs(opts: { disagreeOne?: boolean } = {}) {
  const list: SpecialistKind[] = [
    "doc",
    "income",
    "asset",
    "credit",
    "property",
    "compliance",
  ];
  return list.map((s, i) => ({
    specialist: s,
    signoff: (opts.disagreeOne && i === 0 ? "disagree" : "concur") as Signoff,
    notes: null,
  }));
}

async function clearTenantState() {
  await withDb(async (c) => {
    // Clear FK from va_loan_state -> va_reviews before deleting reviews.
    await c.query(
      `UPDATE va_loan_state SET current_va_review_id = NULL
        WHERE tenant_id = $1 AND loan_id LIKE $2`,
      [T, `${LOAN_PREFIX}%`],
    );
    await c.query(
      `DELETE FROM va_reviews WHERE tenant_id = $1 AND loan_id LIKE $2`,
      [T, `${LOAN_PREFIX}%`],
    );
    await c.query(
      `DELETE FROM va_loan_state WHERE tenant_id = $1 AND loan_id LIKE $2`,
      [T, `${LOAN_PREFIX}%`],
    );
    await c.query(
      `DELETE FROM decision_records WHERE tenant_id = $1 AND loan_id LIKE $2`,
      [T, `${LOAN_PREFIX}%`],
    );
    await c.query(
      `DELETE FROM detected_patterns WHERE tenant_id = $1 AND rule_name LIKE 'va_%'`,
      [T],
    );
  });
}

interface SeedReviewOpts {
  loanId: string;
  verdict: "concur" | "request_docs";
  disagreeOne?: boolean;
  contestOne?: boolean;
  submittedAt?: Date;
}

async function seedReview(opts: SeedReviewOpts) {
  const submittedAt = opts.submittedAt ?? new Date();
  const claimedAt = new Date(submittedAt.getTime() - 60_000);
  const conditionActions = opts.contestOne
    ? [{ conditionId: "c1", action: "contest", notes: "test contest" }]
    : [];
  const docRequest =
    opts.verdict === "request_docs"
      ? { docs: [{ kind: "paystub", reason: "test" }] }
      : null;
  await withTenantTx(T, async (c) => {
    await c.query(
      `INSERT INTO va_reviews
        (id, tenant_id, loan_id, va_id, va_pool_id, pool_kind, verdict,
         specialist_signoffs, condition_actions, overall_rationale, doc_request,
         agent_recommendation_id, kb_version, chatbot_consultation_ids,
         claimed_at, submitted_at, review_time_seconds)
       VALUES ($1, $2, $3, 'u-test', $4, 'internal', $5,
               $6::jsonb, $7::jsonb, $8, $9::jsonb,
               $10, $11, '{}',
               $12, $13, 60)`,
      [
        randomUUID(),
        T,
        opts.loanId,
        POOL_ID,
        opts.verdict,
        JSON.stringify(signoffs({ disagreeOne: opts.disagreeOne })),
        JSON.stringify(conditionActions),
        RATIONALE,
        docRequest ? JSON.stringify(docRequest) : null,
        randomUUID(),
        KB_VERSION,
        claimedAt.toISOString(),
        submittedAt.toISOString(),
      ],
    );
  });
}

async function seedDecision(opts: {
  loanId: string;
  decisionType: "accepted" | "overridden" | "manual";
  decidedAt: Date;
  loanProgram?: string;
}) {
  const overrideReason =
    opts.decisionType === "overridden" ? "guideline_exception" : null;
  await withTenantTx(T, async (c) => {
    await c.query(
      `INSERT INTO decision_records
        (tenant_id, loan_id, loan_program, decision_type,
         agent_recommendation, agent_confidence, final_decision,
         override_reason, rationale,
         guideline_version_id, agent_version, prompt_version, model_id,
         ingested_at, decided_at, decision_time_seconds, recorded_by)
       VALUES ($1, $2, $3, $4,
               'approve', 0.8, 'approve',
               $5, 'test rationale',
               $6, 'v1', 'v1', 'claude-test',
               $7, $8, 12.5, 'test')`,
      [
        T,
        opts.loanId,
        opts.loanProgram ?? "bank_statement",
        opts.decisionType,
        overrideReason,
        randomUUID(),
        new Date(opts.decidedAt.getTime() - 86_400_000).toISOString(),
        opts.decidedAt.toISOString(),
      ],
    );
  });
}

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, $2, $3, 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T, TENANT_NAME, TENANT_SLUG],
    );
  });
  await withTenantTx(T, async (c) => {
    await c.query(
      `INSERT INTO va_pools (id, tenant_id, name, kind, active)
       VALUES ($1, $2, 'VA Pattern Test Pool', 'internal', true)
       ON CONFLICT (id) DO NOTHING`,
      [POOL_ID, T],
    );
  });
  await clearTenantState();
});

beforeEach(async () => {
  await clearTenantState();
});

afterAll(async () => {
  await clearTenantState();
  await closePool();
});

describe("detectVAPatterns", () => {
  it("returns no candidates when there are no reviews", async () => {
    const candidates = await detectVAPatterns(T);
    expect(candidates).toEqual([]);
  });

  it("returns no candidates when all rates sit below thresholds", async () => {
    // 5 reviews, all concur, all signoffs concur, no contests, verdict=concur.
    // disagree rate = 0, contest rate = 0, request_docs rate = 0 — all below.
    for (let i = 0; i < 5; i++) {
      await seedReview({ loanId: `${LOAN_PREFIX}low_${i}`, verdict: "concur" });
    }
    const candidates = await detectVAPatterns(T);
    expect(candidates).toEqual([]);
  }, 30_000);

  it("emits va_disagree_rate when the disagree rate exceeds the threshold", async () => {
    // 5 reviews, 4 of which carry one 'disagree' signoff. Rate = 0.8 > 0.20.
    for (let i = 0; i < 5; i++) {
      await seedReview({
        loanId: `${LOAN_PREFIX}dis_${i}`,
        verdict: "concur",
        disagreeOne: i < 4,
      });
    }
    const candidates = await detectVAPatterns(T);
    const hit = candidates.find((c) => c.ruleName === "va_disagree_rate");
    expect(hit).toBeDefined();
    expect(hit!.metricsSnapshot.total).toBe(5);
    expect(hit!.metricsSnapshot.disagreed).toBe(4);
    expect(hit!.metricsSnapshot.rate).toBeCloseTo(0.8, 5);
    expect(hit!.program).toBeUndefined();
  }, 30_000);

  it("emits va_request_docs_rate when the request_docs rate exceeds the threshold", async () => {
    // 5 reviews, 3 with verdict=request_docs (rate = 0.6 > 0.35).
    for (let i = 0; i < 5; i++) {
      await seedReview({
        loanId: `${LOAN_PREFIX}rd_${i}`,
        verdict: i < 3 ? "request_docs" : "concur",
      });
    }
    const candidates = await detectVAPatterns(T);
    const hit = candidates.find((c) => c.ruleName === "va_request_docs_rate");
    expect(hit).toBeDefined();
    expect(hit!.metricsSnapshot.total).toBe(5);
    expect(hit!.metricsSnapshot.requested).toBe(3);
    expect(hit!.metricsSnapshot.rate).toBeCloseTo(0.6, 5);
  }, 30_000);

  it("emits va_concur_then_uw_override when VA-concur loans get UW-overridden", async () => {
    // 5 va_reviews concur + 5 decision_records overridden, joined on loan_id.
    // Override rate within concurred loans = 1.0 > 0.15.
    const submittedAt = new Date(Date.now() - 7 * 86_400_000);
    const decidedAt = new Date(Date.now() - 1 * 86_400_000);
    for (let i = 0; i < 5; i++) {
      const loanId = `${LOAN_PREFIX}cto_${i}`;
      await seedReview({ loanId, verdict: "concur", submittedAt });
      await seedDecision({
        loanId,
        decisionType: "overridden",
        decidedAt,
        loanProgram: "bank_statement",
      });
    }
    const candidates = await detectVAPatterns(T);
    const hit = candidates.find(
      (c) => c.ruleName === "va_concur_then_uw_override",
    );
    expect(hit).toBeDefined();
    expect(hit!.program).toBe("bank_statement");
    expect(hit!.metricsSnapshot.total).toBe(5);
    expect(hit!.metricsSnapshot.overridden).toBe(5);
    expect(hit!.metricsSnapshot.rate).toBeCloseTo(1.0, 5);
    // Generous timeout: 10 sequential withTenantTx writes + the detection
    // query against a session-pooled Postgres takes >5s in CI/local.
  }, 30_000);
});
