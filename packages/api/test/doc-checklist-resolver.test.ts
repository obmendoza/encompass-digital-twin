import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

// Boot .env so DATABASE_URL is set (mirrors other integration tests).
if (!process.env.DATABASE_URL) {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    for (const line of readFileSync(resolvePath(here, "../.env"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* .env not present — DATABASE_URL error will surface clearly */ }
}

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  NoActiveKbVersionError,
  KbVersionNotFoundError,
  IncomeTypeUnresolvedError,
  resolveRequiredDocs,
} from "../src/services/doc-requirements.js";
import { withDb, withTenantTx, closePool } from "../src/db/pool.js";

describe("doc-requirements module shape", () => {
  it("exports the three domain error classes", () => {
    expect(NoActiveKbVersionError).toBeDefined();
    expect(KbVersionNotFoundError).toBeDefined();
    expect(IncomeTypeUnresolvedError).toBeDefined();
    expect(new NoActiveKbVersionError("test", "t1") instanceof Error).toBe(true);
  });

  it("resolveRequiredDocs is exported", () => {
    expect(typeof resolveRequiredDocs).toBe("function");
  });
});

const T = "5d175193-6ee2-4d6a-b16e-cc00cc00cc01"; // dedicated resolver test tenant

async function seedTenantAndKbVersion(kind: "active" | "pending"): Promise<number> {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'Resolver Test Tenant', 'resolver-test', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
  });
  return await withDb(async (c) => {
    // Pick a fresh version int we don't collide on.
    const { rows: maxRows } = await c.query<{ max: number | null }>(
      `SELECT MAX(version) AS max FROM kb_versions WHERE tenant_id = $1`, [T],
    );
    const v = (maxRows[0]?.max ?? 0) + 1;
    const status = kind === "active" ? "active" : "pending_approval";
    const { rows } = await c.query<{ id: number }>(
      `INSERT INTO kb_versions (tenant_id, version, status, source_documents)
         VALUES ($1, $2, $3, '{"kind":"doc_checklist"}'::jsonb)
       RETURNING id`,
      [T, v, status],
    );
    return rows[0]!.id;
  });
}

async function seedHappyPathRows(kbId: number): Promise<void> {
  await withTenantTx(T, async (c) => {
    await c.query(
      `INSERT INTO income_type_resolver
         (tenant_id, kb_version_id, income_doc_type, borrower_type, citizenship, is_itin, resolved_income_type)
       VALUES ($1, $2, 'Full Doc', 'W2', 'US Citizen', false, 'Full Documentation - Wage Earner')
       ON CONFLICT DO NOTHING`,
      [T, kbId],
    );
    await c.query(
      `INSERT INTO program_doc_checklist
         (tenant_id, kb_version_id, resolved_income_type, program, minimum_docs, income_docs, raw_min_msg, raw_income_msg)
       VALUES ($1, $2, 'Full Documentation - Wage Earner', 'Flex Select',
               $3::jsonb, $4::jsonb, 'raw_min_test', 'raw_inc_test')
       ON CONFLICT DO NOTHING`,
      [
        T, kbId,
        JSON.stringify([{ order: 1, name: "Initial Loan Application (1003)", note: null }]),
        JSON.stringify([{ order: 1, name: "Most recent paystub(s) reflecting 30 days of pay", note: null }]),
      ],
    );
  });
}

async function cleanup(): Promise<void> {
  await withDb(async (c) => {
    await c.query(`DELETE FROM income_type_resolver  WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM program_doc_checklist WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM program_doc_engine_rules WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM kb_versions WHERE tenant_id = $1`, [T]);
  });
}

beforeAll(async () => { await cleanup(); });
afterAll(async () => { await cleanup(); await closePool(); });

describe("resolveRequiredDocs — error contract (spec §4)", () => {
  it("throws NoActiveKbVersionError when null and no active row", async () => {
    await cleanup();
    await seedTenantAndKbVersion("pending");
    await expect(
      resolveRequiredDocs(T, null, baseLoanContext()),
    ).rejects.toBeInstanceOf(NoActiveKbVersionError);
  });

  it("throws KbVersionNotFoundError for a non-existent explicit id", async () => {
    await expect(
      resolveRequiredDocs(T, 999999999, baseLoanContext()),
    ).rejects.toBeInstanceOf(KbVersionNotFoundError);
  });

  it("throws IncomeTypeUnresolvedError when no resolver row matches", async () => {
    await cleanup();
    const kbId = await seedTenantAndKbVersion("active");
    // No rows in income_type_resolver
    await expect(
      resolveRequiredDocs(T, kbId, baseLoanContext()),
    ).rejects.toBeInstanceOf(IncomeTypeUnresolvedError);
  });

  it("happy path returns the resolved type + lists when all rows present", async () => {
    await cleanup();
    const kbId = await seedTenantAndKbVersion("active");
    await seedHappyPathRows(kbId);
    const r = await resolveRequiredDocs(T, null, baseLoanContext());
    expect(r.resolvedIncomeType).toBe("Full Documentation - Wage Earner");
    expect(r.minimum).toHaveLength(1);
    expect(r.income).toHaveLength(1);
    expect(r.appliedRules).toEqual([]);
    expect(r.kbVersionId).toBe(kbId);
  });
});

function baseLoanContext(): import("../src/services/doc-requirements.js").LoanContext {
  return {
    incomeDocType: "Full Doc",
    borrowerType: "W2",
    citizenship: "US Citizen",
    isItin: false,
    llcOrLegalEntity: false,
    occupancy: "primary",
    state: "CA",
    county: "Los Angeles",
    usCredit: true,
    program: "Flex Select",
  };
}
