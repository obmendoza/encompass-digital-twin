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
import { scenarios } from "@twin/fixtures";
import type { Loan } from "@twin/core";
import { closePool, withDb, withTenantTx } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

// Three dedicated test tenants — one per test scenario — so per-tenant
// settings don't bleed into each other. Stable UUIDs allow re-running.
const T_DISABLED = "5d175193-6ee2-4d6a-b16e-cc00cc00cc01"; // va.required = false
const T_REQUIRED = "5d175193-6ee2-4d6a-b16e-cc00cc00cc02"; // va.required = true (no rule)
const T_ROUTED   = "5d175193-6ee2-4d6a-b16e-cc00cc00cc03"; // va.required = true + matching rule

const POOL_DISABLED   = "00000000-0000-0000-0000-0000000000c1";
const POOL_FALLBACK   = "00000000-0000-0000-0000-0000000000c2";
const POOL_R_FALLBACK = "00000000-0000-0000-0000-0000000000c3";
const POOL_R_TARGET   = "00000000-0000-0000-0000-0000000000c4";

const FIXTURE_LOAN_ID = "2501000101"; // nqm-bankstmt-12mo-clean — program "Flex Select"

function buildHeaders(tenantId: string): Record<string, string> {
  return {
    "x-tenant-id": tenantId,
    "x-user-id": "u1",
    "x-user-email": "u1@test",
  };
}

function fixtureLoanFor(tenantId: string): Loan {
  const scenario = scenarios["nqm-bankstmt-12mo-clean"];
  // Deep-clone the fixture loan so mutating tenantId doesn't leak across tests.
  const loan: Loan = JSON.parse(JSON.stringify(scenario.loan));
  loan.tenantId = tenantId;
  return loan;
}

const STAGE_BODY = {
  recommendation: {
    recommendation: "approved" as const,
    rationale: "clean file",
    confidence: 0.92,
    conditions: [],
    trace: [],
  },
  actor: { kind: "agent" as const, id: "bot" },
};

beforeAll(async () => {
  // Seed the three tenants and their pools idempotently.
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'Rec Routing Disabled', 'rec-routing-disabled', 'active', 'demo'),
              ($2, 'Rec Routing Required', 'rec-routing-required', 'active', 'demo'),
              ($3, 'Rec Routing Routed',   'rec-routing-routed',   'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T_DISABLED, T_REQUIRED, T_ROUTED],
    );
  });

  for (const [tenant, poolId] of [
    [T_DISABLED, POOL_DISABLED],
    [T_REQUIRED, POOL_FALLBACK],
    [T_ROUTED, POOL_R_FALLBACK],
  ] as const) {
    await withTenantTx(tenant, async (c) => {
      await c.query(
        `INSERT INTO va_pools (id, tenant_id, name, kind, active)
         VALUES ($1, $2, 'Rec Routing Pool', 'internal', true)
         ON CONFLICT (id) DO NOTHING`,
        [poolId, tenant],
      );
    });
  }
  // T_ROUTED needs a second pool to act as the routing target.
  await withTenantTx(T_ROUTED, async (c) => {
    await c.query(
      `INSERT INTO va_pools (id, tenant_id, name, kind, active)
       VALUES ($1, $2, 'Rec Routing Target Pool', 'internal', true)
       ON CONFLICT (id) DO NOTHING`,
      [POOL_R_TARGET, T_ROUTED],
    );
  });

  // Seed tenants.settings.va per-tenant.
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
      [POOL_DISABLED, T_DISABLED],
    );
    await c.query(
      `UPDATE tenants
          SET settings = jsonb_build_object(
                'va', jsonb_build_object(
                  'required', true,
                  'fallbackPoolId', $1::text
                )
              )
        WHERE id = $2`,
      [POOL_FALLBACK, T_REQUIRED],
    );
    await c.query(
      `UPDATE tenants
          SET settings = jsonb_build_object(
                'va', jsonb_build_object(
                  'required', true,
                  'fallbackPoolId', $1::text
                )
              )
        WHERE id = $2`,
      [POOL_R_FALLBACK, T_ROUTED],
    );
  });
});

beforeEach(async () => {
  // Per-test cleanup of va_loan_state + va_routing_rules across all three tenants.
  for (const t of [T_DISABLED, T_REQUIRED, T_ROUTED]) {
    await withTenantTx(t, async (c) => {
      await c.query(`DELETE FROM va_loan_state WHERE tenant_id = $1`, [t]);
      await c.query(`DELETE FROM va_routing_rules WHERE tenant_id = $1`, [t]);
    });
  }
});

afterAll(async () => {
  for (const t of [T_DISABLED, T_REQUIRED, T_ROUTED]) {
    await withTenantTx(t, async (c) => {
      await c.query(`DELETE FROM va_loan_state WHERE tenant_id = $1`, [t]);
      await c.query(`DELETE FROM va_routing_rules WHERE tenant_id = $1`, [t]);
    });
  }
  await closePool();
});

async function readState(tenantId: string, loanId: string) {
  return withTenantTx(tenantId, async (c) => {
    const { rows } = await c.query<{ va_state: string; assigned_pool_id: string | null }>(
      `SELECT va_state, assigned_pool_id FROM va_loan_state
        WHERE tenant_id = $1 AND loan_id = $2`,
      [tenantId, loanId],
    );
    return rows[0] ?? null;
  });
}

describe("StageRecommendation → va_loan_state routing", () => {
  it("VA-disabled tenant: stages directly to uw_review_pending", async () => {
    const { app } = buildServer();
    await app.ready();
    try {
      const inject = await app.inject({
        method: "POST",
        url: "/world/inject-loan",
        headers: buildHeaders(T_DISABLED),
        payload: { loan: fixtureLoanFor(T_DISABLED) },
      });
      expect(inject.statusCode).toBe(200);

      const res = await app.inject({
        method: "POST",
        url: `/loans/${FIXTURE_LOAN_ID}/recommendation`,
        headers: buildHeaders(T_DISABLED),
        payload: STAGE_BODY,
      });
      expect(res.statusCode).toBe(200);

      const row = await readState(T_DISABLED, FIXTURE_LOAN_ID);
      expect(row).not.toBeNull();
      expect(row!.va_state).toBe("uw_review_pending");
      expect(row!.assigned_pool_id).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("VA-required tenant (no matching rule): stages to va_review_pending with the fallback pool", async () => {
    const { app } = buildServer();
    await app.ready();
    try {
      const inject = await app.inject({
        method: "POST",
        url: "/world/inject-loan",
        headers: buildHeaders(T_REQUIRED),
        payload: { loan: fixtureLoanFor(T_REQUIRED) },
      });
      expect(inject.statusCode).toBe(200);

      const res = await app.inject({
        method: "POST",
        url: `/loans/${FIXTURE_LOAN_ID}/recommendation`,
        headers: buildHeaders(T_REQUIRED),
        payload: STAGE_BODY,
      });
      expect(res.statusCode).toBe(200);

      const row = await readState(T_REQUIRED, FIXTURE_LOAN_ID);
      expect(row).not.toBeNull();
      expect(row!.va_state).toBe("va_review_pending");
      expect(row!.assigned_pool_id).toBe(POOL_FALLBACK);
    } finally {
      await app.close();
    }
  });

  it("VA-required tenant + matching routing rule: stages to the rule's target pool", async () => {
    // Insert a routing rule that matches the fixture's program ("Flex Select")
    // and points at POOL_R_TARGET (NOT the fallback).
    await withTenantTx(T_ROUTED, async (c) => {
      await c.query(
        `INSERT INTO va_routing_rules (tenant_id, priority, match, target_pool_id)
         VALUES ($1, 10, $2::jsonb, $3)`,
        [T_ROUTED, JSON.stringify({ program: ["Flex Select"] }), POOL_R_TARGET],
      );
    });

    const { app } = buildServer();
    await app.ready();
    try {
      const inject = await app.inject({
        method: "POST",
        url: "/world/inject-loan",
        headers: buildHeaders(T_ROUTED),
        payload: { loan: fixtureLoanFor(T_ROUTED) },
      });
      expect(inject.statusCode).toBe(200);

      const res = await app.inject({
        method: "POST",
        url: `/loans/${FIXTURE_LOAN_ID}/recommendation`,
        headers: buildHeaders(T_ROUTED),
        payload: STAGE_BODY,
      });
      expect(res.statusCode).toBe(200);

      const row = await readState(T_ROUTED, FIXTURE_LOAN_ID);
      expect(row).not.toBeNull();
      expect(row!.va_state).toBe("va_review_pending");
      expect(row!.assigned_pool_id).toBe(POOL_R_TARGET);
      expect(row!.assigned_pool_id).not.toBe(POOL_R_FALLBACK);
    } finally {
      await app.close();
    }
  });
});
