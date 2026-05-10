import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load .env (for DATABASE_URL) before any module that reads it.
// This is scoped to this test file so other tests' env behaviour is unchanged.
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
import { routeLoan } from "../src/services/va-routing.js";

const T = "5d175193-6ee2-4d6a-b16e-f1777f7e18ad"; // demo tenant
const POOL_A = "00000000-0000-0000-0000-000000007aaa";
const POOL_B = "00000000-0000-0000-0000-000000007bbb";
const POOL_FALLBACK = "00000000-0000-0000-0000-000000007ccc";

function fakeLoan(overrides: any = {}): any {
  return {
    id: "L_TEST",
    nqmProgram: "Flex Select",
    transaction: { loanAmount: 200000, occupancy: "Primary" },
    ...overrides,
  };
}

beforeEach(async () => {
  await withTenantTx(T, async (c) => {
    await c.query("DELETE FROM va_routing_rules WHERE tenant_id = $1", [T]);
    await c.query(
      `DELETE FROM va_pools WHERE tenant_id = $1 AND id IN ($2, $3, $4)`,
      [T, POOL_A, POOL_B, POOL_FALLBACK],
    );
    await c.query(
      `INSERT INTO va_pools (id, tenant_id, name, kind, active) VALUES
       ($1, $4, 'Test Pool A', 'internal', true),
       ($2, $4, 'Test Pool B', 'internal', true),
       ($3, $4, 'Test Fallback', 'internal', true)`,
      [POOL_A, POOL_B, POOL_FALLBACK, T],
    );
  });
});

afterAll(async () => {
  await withTenantTx(T, async (c) => {
    await c.query("DELETE FROM va_routing_rules WHERE tenant_id = $1", [T]);
    await c.query(
      `DELETE FROM va_pools WHERE tenant_id = $1 AND id IN ($2, $3, $4)`,
      [T, POOL_A, POOL_B, POOL_FALLBACK],
    );
  });
  await closePool();
});

describe("va-routing", () => {
  it("returns fallback when no rule matches", async () => {
    const result = await routeLoan(T, fakeLoan(), { fallbackPoolId: POOL_FALLBACK });
    expect(result.poolId).toBe(POOL_FALLBACK);
    expect(result.matchedRule).toBeNull();
  });

  it("matches by program", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_routing_rules (tenant_id, priority, match, target_pool_id) VALUES ($1, 1, $2::jsonb, $3)`,
        [T, JSON.stringify({ program: ["Investor DSCR", "DSCR Supreme"] }), POOL_A],
      );
    });
    const result = await routeLoan(
      T,
      fakeLoan({ nqmProgram: "Investor DSCR" }),
      { fallbackPoolId: POOL_FALLBACK },
    );
    expect(result.poolId).toBe(POOL_A);
  });

  it("returns first-priority match when multiple rules match", async () => {
    await withTenantTx(T, async (c) => {
      // Both rules will match the default fakeLoan; priority 1 must win over priority 2.
      await c.query(
        `INSERT INTO va_routing_rules (tenant_id, priority, match, target_pool_id) VALUES
         ($1, 2, $2::jsonb, $3),
         ($1, 1, $4::jsonb, $5)`,
        [
          T,
          JSON.stringify({ program: ["Flex Select"] }),
          POOL_B,
          JSON.stringify({ loanAmountMin: 100000 }),
          POOL_A,
        ],
      );
    });
    const result = await routeLoan(T, fakeLoan(), { fallbackPoolId: POOL_FALLBACK });
    expect(result.poolId).toBe(POOL_A); // priority 1 wins
  });

  it("respects loanAmountMin/Max bounds", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_routing_rules (tenant_id, priority, match, target_pool_id) VALUES ($1, 1, $2::jsonb, $3)`,
        [T, JSON.stringify({ loanAmountMin: 500000 }), POOL_A],
      );
    });
    const r1 = await routeLoan(
      T,
      fakeLoan({ transaction: { loanAmount: 200000, occupancy: "Primary" } }),
      { fallbackPoolId: POOL_FALLBACK },
    );
    expect(r1.poolId).toBe(POOL_FALLBACK);
    const r2 = await routeLoan(
      T,
      fakeLoan({ transaction: { loanAmount: 600000, occupancy: "Primary" } }),
      { fallbackPoolId: POOL_FALLBACK },
    );
    expect(r2.poolId).toBe(POOL_A);
  });

  it("respects occupancy filter", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_routing_rules (tenant_id, priority, match, target_pool_id) VALUES ($1, 1, $2::jsonb, $3)`,
        [T, JSON.stringify({ occupancy: ["Investment"] }), POOL_A],
      );
    });
    const investment = await routeLoan(
      T,
      fakeLoan({ transaction: { loanAmount: 200000, occupancy: "Investment" } }),
      { fallbackPoolId: POOL_FALLBACK },
    );
    expect(investment.poolId).toBe(POOL_A);
    const primary = await routeLoan(T, fakeLoan(), { fallbackPoolId: POOL_FALLBACK });
    expect(primary.poolId).toBe(POOL_FALLBACK);
  });
});
