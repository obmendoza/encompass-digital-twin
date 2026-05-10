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

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { withTenantTx, withDb, closePool } from "../src/db/pool.js";
import { applyToggleFlip } from "../src/services/va-toggle.js";

// va-toggle is a tenant-WIDE bulk operation (false→true and true→false both run
// UPDATE statements scoped only by tenant_id and va_state). To avoid clobbering
// state used by parallel tests on the demo tenant (e.g. va-review-writer.test.ts,
// va-pool.test.ts), this suite uses its own dedicated tenant created in beforeAll
// and torn down in afterAll. Stable UUIDs let the test be re-run idempotently.
const T = "5d175193-6ee2-4d6a-b16e-aa00aa00aa00";
const POOL_ID = "00000000-0000-0000-0000-00000000a07e";
const TENANT_NAME = "VA Toggle Test Tenant";
const TENANT_SLUG = "va-toggle-test";

const LOAN_PREFIX = "TEST_TOGGLE_";
const LOAN_1 = `${LOAN_PREFIX}1`; // false→true: agent_review_pending → va_review_pending
const LOAN_2 = `${LOAN_PREFIX}2`; // false→true: uw_review_pending unchanged
const LOAN_3 = `${LOAN_PREFIX}3`; // true→false: va_review_pending → uw_review_pending
const LOAN_4 = `${LOAN_PREFIX}4`; // true→false: va_in_review → uw_review_pending (clear va_id/claimed_at)
const LOAN_5 = `${LOAN_PREFIX}5`; // true→false: va_doc_request_pending preserved
const LOAN_6 = `${LOAN_PREFIX}6`; // true→false: decided unchanged

async function clearTenantState() {
  // Clear test-tenant state without deleting the tenant itself. The
  // tenant_audit_log rows from prior runs cannot be removed (append-only RULE
  // blocks DELETE; FK is RESTRICT, not CASCADE), so the tenant persists across
  // runs as a stable idempotent fixture.
  await withDb(async (c) => {
    await c.query(`DELETE FROM va_loan_state WHERE tenant_id = $1`, [T]);
  });
}

beforeAll(async () => {
  await withDb(async (c) => {
    // Idempotent tenant + pool seed. Stable IDs allow re-running without churn.
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, $2, $3, 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T, TENANT_NAME, TENANT_SLUG],
    );
  });
  await withTenantTx(T, async (c) => {
    // va_pools has no UNIQUE on (tenant_id, name); use a stable id + ON CONFLICT.
    await c.query(
      `INSERT INTO va_pools (id, tenant_id, name, kind, active)
       VALUES ($1, $2, 'VA Toggle Test Pool', 'internal', true)
       ON CONFLICT (id) DO NOTHING`,
      [POOL_ID, T],
    );
  });
  await clearTenantState();
});

beforeEach(async () => {
  // Clear any per-test loan rows; pool + tenant persist across tests.
  await clearTenantState();
});

afterAll(async () => {
  await clearTenantState();
  await closePool();
});

describe("va-toggle", () => {
  it("returns direction='noop' with zero counts when fromRequired === toRequired", async () => {
    const result = await applyToggleFlip(T, true, true, POOL_ID);
    expect(result.direction).toBe("noop");
    expect(result.transitioned).toBe(0);
    expect(result.released).toBe(0);
    expect(result.preservedDocRequest).toBe(0);

    const result2 = await applyToggleFlip(T, false, false, POOL_ID);
    expect(result2.direction).toBe("noop");
    expect(result2.transitioned).toBe(0);
    expect(result2.released).toBe(0);
    expect(result2.preservedDocRequest).toBe(0);
  });

  it("false→true backfills agent_review_pending loans into va_review_pending with fallback pool", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state)
         VALUES ($1, $2, 'agent_review_pending')`,
        [T, LOAN_1],
      );
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state)
         VALUES ($1, $2, 'uw_review_pending')`,
        [T, LOAN_2],
      );
    });

    const result = await applyToggleFlip(T, false, true, POOL_ID);

    expect(result.direction).toBe("false_to_true");
    expect(result.transitioned).toBe(1);
    expect(result.released).toBe(0);
    expect(result.preservedDocRequest).toBe(0);

    await withTenantTx(T, async (c) => {
      const r1 = await c.query(
        `SELECT va_state, assigned_pool_id FROM va_loan_state
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_1],
      );
      expect(r1.rows[0].va_state).toBe("va_review_pending");
      expect(r1.rows[0].assigned_pool_id).toBe(POOL_ID);

      const r2 = await c.query(
        `SELECT va_state, assigned_pool_id FROM va_loan_state
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_2],
      );
      expect(r2.rows[0].va_state).toBe("uw_review_pending");
      expect(r2.rows[0].assigned_pool_id).toBeNull();
    });
  });

  it("true→false releases va_review_pending and va_in_review; preserves va_doc_request_pending and decided", async () => {
    const claimedAt = new Date(Date.now() - 30_000).toISOString();
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state
           (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3)`,
        [T, LOAN_3, POOL_ID],
      );
      await c.query(
        `INSERT INTO va_loan_state
           (tenant_id, loan_id, va_state, va_id, assigned_pool_id, claimed_at)
         VALUES ($1, $2, 'va_in_review', 'u1', $3, $4)`,
        [T, LOAN_4, POOL_ID, claimedAt],
      );
      await c.query(
        `INSERT INTO va_loan_state
           (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_doc_request_pending', $3)`,
        [T, LOAN_5, POOL_ID],
      );
      await c.query(
        `INSERT INTO va_loan_state
           (tenant_id, loan_id, va_state)
         VALUES ($1, $2, 'decided')`,
        [T, LOAN_6],
      );
    });

    const result = await applyToggleFlip(T, true, false, POOL_ID);

    expect(result.direction).toBe("true_to_false");
    expect(result.transitioned).toBe(0);
    expect(result.released).toBe(2); // LOAN_3 + LOAN_4
    expect(result.preservedDocRequest).toBe(1); // LOAN_5

    await withTenantTx(T, async (c) => {
      const r3 = await c.query(
        `SELECT va_state, va_id, claimed_at FROM va_loan_state
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_3],
      );
      expect(r3.rows[0].va_state).toBe("uw_review_pending");
      expect(r3.rows[0].va_id).toBeNull();
      expect(r3.rows[0].claimed_at).toBeNull();

      const r4 = await c.query(
        `SELECT va_state, va_id, claimed_at FROM va_loan_state
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_4],
      );
      expect(r4.rows[0].va_state).toBe("uw_review_pending");
      expect(r4.rows[0].va_id).toBeNull();
      expect(r4.rows[0].claimed_at).toBeNull();

      const r5 = await c.query(
        `SELECT va_state FROM va_loan_state
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_5],
      );
      expect(r5.rows[0].va_state).toBe("va_doc_request_pending");

      const r6 = await c.query(
        `SELECT va_state FROM va_loan_state
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_6],
      );
      expect(r6.rows[0].va_state).toBe("decided");
    });
  });
});
