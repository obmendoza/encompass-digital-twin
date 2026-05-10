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
import { claimLoan, releaseLoan } from "../src/services/va-pool.js";

const T = "5d175193-6ee2-4d6a-b16e-f1777f7e18ad"; // demo tenant
const POOL_ID = "00000000-0000-0000-0000-0000000099aa";
const LOAN_RACE = "TEST_CLAIM_RACE";
const LOAN_NONMEMBER = "TEST_CLAIM_NONMEMBER";
const LOAN_RELEASE = "TEST_CLAIM_RELEASE";
const LOAN_RELEASE_BAD = "TEST_CLAIM_RELEASE_BAD";
const ALL_LOANS = [LOAN_RACE, LOAN_NONMEMBER, LOAN_RELEASE, LOAN_RELEASE_BAD];

async function cleanup() {
  await withTenantTx(T, async (c) => {
    await c.query(
      `DELETE FROM va_loan_state WHERE tenant_id = $1 AND loan_id = ANY($2::text[])`,
      [T, ALL_LOANS],
    );
    await c.query(`DELETE FROM va_pool_memberships WHERE pool_id = $1`, [POOL_ID]);
    await c.query(
      `DELETE FROM va_pools WHERE tenant_id = $1 AND id = $2`,
      [T, POOL_ID],
    );
  });
}

beforeEach(async () => {
  await cleanup();
  await withTenantTx(T, async (c) => {
    await c.query(
      `INSERT INTO va_pools (id, tenant_id, name, kind, active)
       VALUES ($1, $2, 'Test Claim Pool', 'internal', true)`,
      [POOL_ID, T],
    );
  });
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe("va-pool", () => {
  it("only one of two concurrent claims succeeds (race-safe)", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3)`,
        [T, LOAN_RACE, POOL_ID],
      );
      await c.query(
        `INSERT INTO va_pool_memberships (pool_id, member_id, member_kind)
         VALUES ($1, 'u1', 'internal'), ($1, 'u2', 'internal')`,
        [POOL_ID],
      );
    });

    const results = await Promise.allSettled([
      claimLoan(T, LOAN_RACE, "u1"),
      claimLoan(T, LOAN_RACE, "u2"),
    ]);

    const fulfilled = results.flatMap((r) =>
      r.status === "fulfilled" ? [r.value] : [],
    );
    expect(fulfilled.length).toBe(2);
    const winners = fulfilled.filter((r) => r.claimed);
    const losers = fulfilled.filter((r) => !r.claimed);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
    expect(losers[0].reason).toBeTruthy();
    // Loser sees the wrong-state diagnostic (winner already moved it to va_in_review).
    expect(losers[0].reason).toMatch(/already claimed|state is va_in_review/);

    // Verify DB matches the winner.
    const winner = winners[0];
    await withTenantTx(T, async (c) => {
      const { rows } = await c.query(
        `SELECT va_state, va_id FROM va_loan_state WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_RACE],
      );
      expect(rows[0].va_state).toBe("va_in_review");
      expect(rows[0].va_id).toBe(winner.vaId);
    });
  });

  it("rejects claim by a non-member of the assigned pool", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3)`,
        [T, LOAN_NONMEMBER, POOL_ID],
      );
      // u1 is a member; u_outsider is NOT.
      await c.query(
        `INSERT INTO va_pool_memberships (pool_id, member_id, member_kind)
         VALUES ($1, 'u1', 'internal')`,
        [POOL_ID],
      );
    });

    const result = await claimLoan(T, LOAN_NONMEMBER, "u_outsider");
    expect(result.claimed).toBe(false);
    expect(result.reason).toMatch(/not a member/);

    // DB unchanged.
    await withTenantTx(T, async (c) => {
      const { rows } = await c.query(
        `SELECT va_state, va_id FROM va_loan_state WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_NONMEMBER],
      );
      expect(rows[0].va_state).toBe("va_review_pending");
      expect(rows[0].va_id).toBeNull();
    });
  });

  it("releases a claimed loan back to va_review_pending", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3)`,
        [T, LOAN_RELEASE, POOL_ID],
      );
      await c.query(
        `INSERT INTO va_pool_memberships (pool_id, member_id, member_kind)
         VALUES ($1, 'u1', 'internal')`,
        [POOL_ID],
      );
    });

    const claim = await claimLoan(T, LOAN_RELEASE, "u1");
    expect(claim.claimed).toBe(true);

    const release = await releaseLoan(T, LOAN_RELEASE, "u1");
    expect(release.released).toBe(true);
    expect(release.loanId).toBe(LOAN_RELEASE);

    await withTenantTx(T, async (c) => {
      const { rows } = await c.query(
        `SELECT va_state, va_id, claimed_at FROM va_loan_state
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_RELEASE],
      );
      expect(rows[0].va_state).toBe("va_review_pending");
      expect(rows[0].va_id).toBeNull();
      expect(rows[0].claimed_at).toBeNull();
    });
  });

  it("rejects release by a user other than the current claimant", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
         VALUES ($1, $2, 'va_review_pending', $3)`,
        [T, LOAN_RELEASE_BAD, POOL_ID],
      );
      await c.query(
        `INSERT INTO va_pool_memberships (pool_id, member_id, member_kind)
         VALUES ($1, 'u1', 'internal'), ($1, 'u2', 'internal')`,
        [POOL_ID],
      );
    });

    const claim = await claimLoan(T, LOAN_RELEASE_BAD, "u1");
    expect(claim.claimed).toBe(true);

    const release = await releaseLoan(T, LOAN_RELEASE_BAD, "u2");
    expect(release.released).toBe(false);
    expect(release.reason).toMatch(/not currently claimed by this user/);

    await withTenantTx(T, async (c) => {
      const { rows } = await c.query(
        `SELECT va_state, va_id FROM va_loan_state WHERE tenant_id = $1 AND loan_id = $2`,
        [T, LOAN_RELEASE_BAD],
      );
      expect(rows[0].va_state).toBe("va_in_review");
      expect(rows[0].va_id).toBe("u1");
    });
  });
});
