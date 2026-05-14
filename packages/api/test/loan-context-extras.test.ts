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
import { loadExtras, writeExtrasFirstWriteWins } from "../src/ingestion/loan-context-extras.js";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee01";

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'Extras Test', 'extras-test', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
    await c.query(`DELETE FROM loan_context_extras WHERE tenant_id = $1`, [T]);
  });
});

afterAll(async () => {
  await withDb(async (c) => {
    await c.query(`DELETE FROM loan_context_extras WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM tenants WHERE id = $1`, [T]);
  });
  await closePool();
});

describe("loan-context-extras", () => {
  it("loadExtras returns null when no row exists", async () => {
    const r = await loadExtras(T, "no-such-loan");
    expect(r).toBe(null);
  });

  it("write + load roundtrips with Zod validation", async () => {
    await writeExtrasFirstWriteWins(T, "L-1", { repFico: 720, ltv: 80, county: "King County" });
    const r = await loadExtras(T, "L-1");
    expect(r).toEqual({ repFico: 720, ltv: 80, county: "King County" });
  });

  it("first-write-wins — second write is a no-op", async () => {
    await writeExtrasFirstWriteWins(T, "L-2", { repFico: 700 });
    await writeExtrasFirstWriteWins(T, "L-2", { repFico: 800, ltv: 90 });
    const r = await loadExtras(T, "L-2");
    expect(r).toEqual({ repFico: 700 });
  });

  it("loadExtras returns null when stored extras fails Zod validation", async () => {
    // Insert a corrupt row directly (bypassing the write helper) to simulate a legacy/bad row.
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO loan_context_extras (tenant_id, loan_id, extras)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (tenant_id, loan_id) DO UPDATE SET extras = EXCLUDED.extras`,
        [T, "L-3", JSON.stringify({ mysteryField: "bad", repFico: "not a number" })],
      );
    });
    const r = await loadExtras(T, "L-3");
    expect(r).toBe(null);
  });
});
