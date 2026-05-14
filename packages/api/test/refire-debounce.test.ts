import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    for (const line of readFileSync(resolvePath(here, "../.env"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* */ }
}

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withDb, withTenantTx, closePool } from "../src/db/pool.js";
import { enqueueRefire, drainReadyRefires } from "../src/ingestion/refire-debounce.js";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee04";

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'Debounce Test', 'debounce-test', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
    await c.query(`DELETE FROM pc_v2_refire_debounce WHERE tenant_id = $1`, [T]);
  });
});
afterAll(async () => {
  await withDb(async (c) => {
    await c.query(`DELETE FROM pc_v2_refire_debounce WHERE tenant_id = $1`, [T]);
  });
  await closePool();
});

describe("refire-debounce", () => {
  it("enqueueRefire inserts a row with ready_at = NOW() + delay", async () => {
    await enqueueRefire(T, "DB-L1", "doc_added", 30);
    const ready = await withTenantTx(T, async (c) => {
      const { rows } = await c.query<{ ready_at: Date }>(
        `SELECT ready_at FROM pc_v2_refire_debounce WHERE tenant_id=$1 AND loan_id=$2`,
        [T, "DB-L1"],
      );
      return rows[0]!.ready_at;
    });
    expect(ready.getTime()).toBeGreaterThan(Date.now() + 25_000);
    expect(ready.getTime()).toBeLessThan(Date.now() + 35_000);
  });

  it("second enqueue pushes ready_at forward (debounce)", async () => {
    await enqueueRefire(T, "DB-L2", "doc_added", 30);
    await new Promise((r) => setTimeout(r, 50));
    await enqueueRefire(T, "DB-L2", "doc_added", 30);
    const ready = await withTenantTx(T, async (c) => {
      const { rows } = await c.query<{ ready_at: Date }>(
        `SELECT ready_at FROM pc_v2_refire_debounce WHERE tenant_id=$1 AND loan_id=$2`,
        [T, "DB-L2"],
      );
      return rows[0]!.ready_at;
    });
    expect(ready.getTime()).toBeGreaterThan(Date.now() + 25_000);
  });

  it("drainReadyRefires returns only rows with ready_at <= NOW() and deletes them", async () => {
    await enqueueRefire(T, "DB-L3-ready", "doc_added", -1);  // already ready
    await enqueueRefire(T, "DB-L3-pending", "doc_added", 60);
    const drained = await drainReadyRefires(50);
    const ids = drained.map((d) => d.loanId);
    expect(ids).toContain("DB-L3-ready");
    expect(ids).not.toContain("DB-L3-pending");
    // The drained row was deleted; the pending row remains.
    const remaining = await withTenantTx(T, async (c) => {
      const { rows } = await c.query<{ loan_id: string }>(
        `SELECT loan_id FROM pc_v2_refire_debounce WHERE tenant_id=$1`, [T],
      );
      return rows.map((r) => r.loan_id);
    });
    expect(remaining).toContain("DB-L3-pending");
    expect(remaining).not.toContain("DB-L3-ready");
  });
});
