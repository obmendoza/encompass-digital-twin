import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
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
import { withDb, closePool } from "../src/db/pool.js";
import { resolveRequiredDocs } from "../src/services/doc-requirements.js";

const T = "5d175193-6ee2-4d6a-b16e-bb00bb00bb02"; // dedicated integration test tenant
const FIXTURE_PATH = "../../../docs/npnqm-source/Document_Requirements_All_Income_Types.md";
// Note path is 3 levels up — Task 4's correction (same monorepo depth).

async function cleanup(): Promise<void> {
  await withDb(async (c) => {
    await c.query(`DELETE FROM program_doc_checklist     WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM program_doc_engine_rules  WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM income_type_resolver      WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM kb_versions               WHERE tenant_id = $1`, [T]);
    // tenant_audit_log has a no_delete_audit rewrite rule (append-only).
    // We cannot delete those rows, and the FK from tenant_audit_log →
    // tenants prevents deleting the tenant row once audit rows exist.
    // Leave the tenant row in place; the beforeAll INSERT uses
    // ON CONFLICT (id) DO NOTHING so re-runs are idempotent.
  });
}

describe("doc-checklist ingest — end-to-end integration (spec §7.2)", () => {
  let kbId: number;

  beforeAll(async () => {
    await cleanup();
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO tenants (id, name, slug, status, type) VALUES ($1, 'Doc-Checklist Integration', 'doc-checklist-integration', 'active', 'demo')
         ON CONFLICT (id) DO NOTHING`,
        [T],
      );
    });

    // Exec the actual ingest-doc-checklist.ts CLI (not inline parser inserts).
    // This covers arg parsing, --version collision check, kb_versions row
    // creation, and the spec §3.2 exit-code contract.
    const ADMIN = "11111111-1111-1111-1111-111111111111";
    const COMPL = "22222222-2222-2222-2222-222222222222";
    const fixturePath = resolvePath(dirname(fileURLToPath(import.meta.url)), FIXTURE_PATH);

    const ingestOutput = execSync(
      `pnpm tsx scripts/ingest-doc-checklist.ts --tenant ${T} --version 1 --as ${ADMIN} --file ${fixturePath}`,
      { cwd: resolvePath(dirname(fileURLToPath(import.meta.url)), "../../.."), encoding: "utf8" },
    );
    const match = ingestOutput.match(/kb_versions\.id = (\d+)/);
    if (!match) throw new Error(`ingest CLI didn't print kb_versions.id: ${ingestOutput}`);
    kbId = parseInt(match[1]!, 10);

    // Chain through two-key approval to make the version status='active'.
    execSync(
      `pnpm tsx scripts/approve-kb.ts --tenant ${T} --version-id ${kbId} --as admin --user-id ${ADMIN} --yes`,
      { cwd: resolvePath(dirname(fileURLToPath(import.meta.url)), "../../.."), encoding: "utf8" },
    );
    execSync(
      `pnpm tsx scripts/approve-kb.ts --tenant ${T} --version-id ${kbId} --as compliance_officer --user-id ${COMPL} --activate --yes`,
      { cwd: resolvePath(dirname(fileURLToPath(import.meta.url)), "../../.."), encoding: "utf8" },
    );
  }, 120000); // generous timeout since this execs three subprocesses

  afterAll(async () => {
    await cleanup();
    await closePool();
  });

  it("seeded 32 program_doc_checklist rows", async () => {
    const r = await withDb(async (c) =>
      c.query<{ count: string }>(`SELECT COUNT(*)::text FROM program_doc_checklist WHERE tenant_id = $1`, [T]),
    );
    expect(parseInt(r.rows[0]!.count, 10)).toBe(32);
  });

  it("seeded 3 program_doc_engine_rules rows", async () => {
    const r = await withDb(async (c) =>
      c.query<{ count: string }>(`SELECT COUNT(*)::text FROM program_doc_engine_rules WHERE tenant_id = $1`, [T]),
    );
    expect(parseInt(r.rows[0]!.count, 10)).toBe(3);
  });

  it("seeded 32 income_type_resolver rows", async () => {
    const r = await withDb(async (c) =>
      c.query<{ count: string }>(`SELECT COUNT(*)::text FROM income_type_resolver WHERE tenant_id = $1`, [T]),
    );
    expect(parseInt(r.rows[0]!.count, 10)).toBe(32);
  });

  it("resolveRequiredDocs returns the 9-doc minimum for Full Doc / W2 / US Citizen", async () => {
    const r = await resolveRequiredDocs(T, null, {
      incomeDocType: "Full Doc", borrowerType: "W2", citizenship: "US Citizen", isItin: false,
      llcOrLegalEntity: false, occupancy: "primary", state: "CA", county: "Los Angeles", usCredit: true,
      program: "Flex Select",
    });
    expect(r.resolvedIncomeType).toBe("Full Documentation - Wage Earner");
    expect(r.minimum).toHaveLength(9);
    expect(r.income).toHaveLength(2);
    expect(r.appliedRules).toEqual([]);
  });

  it("resolveRequiredDocs applies us_credit_optional when usCredit=false", async () => {
    const r = await resolveRequiredDocs(T, null, {
      incomeDocType: "Full Doc", borrowerType: "W2", citizenship: "US Citizen", isItin: false,
      llcOrLegalEntity: false, occupancy: "primary", state: "CA", county: "Los Angeles", usCredit: false,
      program: "Flex Select",
    });
    expect(r.appliedRules).toContain("us_credit_optional");
    expect(r.minimum.map((d) => d.name)).not.toContain("Credit Report dated within 90 days");
    expect(r.minimum).toHaveLength(8);
  });

  it("resolveRequiredDocs applies field_review for NY Brooklyn investment", async () => {
    const r = await resolveRequiredDocs(T, null, {
      incomeDocType: "Full Doc", borrowerType: "W2", citizenship: "US Citizen", isItin: false,
      llcOrLegalEntity: false, occupancy: "investment", state: "NY", county: "Brooklyn", usCredit: true,
      program: "Flex Select",
    });
    expect(r.appliedRules).toContain("field_review");
    expect(r.minimum.map((d) => d.name)).toContain("Field review");
  });
});
