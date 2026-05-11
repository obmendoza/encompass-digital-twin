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
import { parseAll, verifyParity } from "../src/ingestion/doc-checklist-parser.js";
import { resolveRequiredDocs } from "../src/services/doc-requirements.js";

const T = "5d175193-6ee2-4d6a-b16e-bb00bb00bb02"; // dedicated integration test tenant
const FIXTURE_PATH = "../../../docs/npnqm-source/Document_Requirements_All_Income_Types.md";
// Note path is 3 levels up — Task 4's correction (same monorepo depth).

async function ingest(kbId: number): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const md = readFileSync(resolvePath(here, FIXTURE_PATH), "utf8");
  const parsed = parseAll(md);
  verifyParity(parsed.scenarios);
  await withTenantTx(T, async (c) => {
    for (const s of parsed.scenarios) {
      await c.query(
        `INSERT INTO program_doc_checklist (tenant_id, kb_version_id, resolved_income_type, program, minimum_docs, income_docs, raw_min_msg, raw_income_msg)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
        [T, kbId, s.resolved_income_type, s.program, JSON.stringify(s.minimum_docs), JSON.stringify(s.income_docs), s.raw_min_msg, s.raw_income_msg],
      );
    }
    for (const r of parsed.rules) {
      await c.query(
        `INSERT INTO program_doc_engine_rules (tenant_id, kb_version_id, rule_name, predicate, effect, description)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
        [T, kbId, r.rule_name, JSON.stringify(r.predicate), JSON.stringify(r.effect), r.description],
      );
    }
    for (const rr of parsed.resolver) {
      await c.query(
        `INSERT INTO income_type_resolver (tenant_id, kb_version_id, income_doc_type, borrower_type, citizenship, is_itin, resolved_income_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [T, kbId, rr.income_doc_type, rr.borrower_type, rr.citizenship, rr.is_itin, rr.resolved_income_type],
      );
    }
  });
}

async function cleanup(): Promise<void> {
  await withDb(async (c) => {
    await c.query(`DELETE FROM program_doc_checklist     WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM program_doc_engine_rules  WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM income_type_resolver      WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM kb_versions               WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM tenants                   WHERE id = $1`, [T]);
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
      const r = await c.query<{ id: number }>(
        `INSERT INTO kb_versions (tenant_id, version, status, source_documents) VALUES ($1, 1, 'active', '{"kind":"doc_checklist"}'::jsonb) RETURNING id`,
        [T],
      );
      kbId = r.rows[0]!.id;
    });
    await ingest(kbId);
  });

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
