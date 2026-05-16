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

import { describe, test, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PortalProvidedHoiExtractor } from "../src/services/validators/hoi/portal-provided-extractor.js";
import { withDb, closePool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";
import { randomUUID } from "node:crypto";

describe("PortalProvidedHoiExtractor", () => {
  const tenantId = "5d175193-6ee2-4d6a-b16e-f1777f7e18ad";  // Demo tenant UUID — exists in dev DB
  const loanId = "TEST-PORTAL-EXTRACTOR";
  const documentId = randomUUID();

  beforeAll(async () => {
    await runMigrations();
    // Ensure the demo tenant exists
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO tenants (id, name, slug, status, type)
         VALUES ($1, 'Demo', 'default', 'active', 'demo')
         ON CONFLICT (id) DO NOTHING`,
        [tenantId],
      );
    });
  });

  beforeEach(async () => {
    await withDb(async (c) => {
      await c.query("DELETE FROM document_extractions WHERE document_id = $1", [documentId]);
    });
  });

  afterAll(async () => {
    await closePool();
  });

  test("canExtract returns true when active portal extraction exists", async () => {
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO document_extractions (tenant_id, loan_id, document_id, extractor_kind, schema_version, source, extracted_by, fields, extraction_confidence)
         VALUES ($1, $2, $3, 'hoi-policy', 1, 'portal', 'portal:test', '{}'::jsonb, NULL)`,
        [tenantId, loanId, documentId],
      );
    });
    const ext = new PortalProvidedHoiExtractor();
    const ok = await ext.canExtract({
      tenantId, loanId, documentId, category: "hoi-policy", storageUrl: "x",
    });
    expect(ok).toBe(true);
  });

  test("extract returns the cached row's fields", async () => {
    const fields = { carrier: "Test Co", policyNumber: "P-1", evidence: [] };
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO document_extractions (tenant_id, loan_id, document_id, extractor_kind, schema_version, source, extracted_by, fields)
         VALUES ($1, $2, $3, 'hoi-policy', 1, 'portal', 'portal:test', $4::jsonb)`,
        [tenantId, loanId, documentId, JSON.stringify(fields)],
      );
    });
    const ext = new PortalProvidedHoiExtractor();
    const r = await ext.extract({
      tenantId, loanId, documentId, category: "hoi-policy", storageUrl: "x",
    });
    expect(r.source).toBe("portal");
    expect((r.fields as Record<string, unknown>).carrier).toBe("Test Co");
  });

  test("canExtract returns false when no row exists", async () => {
    const ext = new PortalProvidedHoiExtractor();
    const ok = await ext.canExtract({
      tenantId, loanId, documentId: randomUUID(), category: "hoi-policy", storageUrl: "x",
    });
    expect(ok).toBe(false);
  });

  test("extract throws when no row exists", async () => {
    const ext = new PortalProvidedHoiExtractor();
    await expect(
      ext.extract({
        tenantId, loanId, documentId: randomUUID(), category: "hoi-policy", storageUrl: "x",
      }),
    ).rejects.toThrow("canExtract=false");
  });

  test("canExtract returns false when row is superseded", async () => {
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO document_extractions (tenant_id, loan_id, document_id, extractor_kind, schema_version, source, extracted_by, fields, superseded_at)
         VALUES ($1, $2, $3, 'hoi-policy', 1, 'portal', 'portal:test', '{}'::jsonb, now())`,
        [tenantId, loanId, documentId],
      );
    });
    const ext = new PortalProvidedHoiExtractor();
    const ok = await ext.canExtract({
      tenantId, loanId, documentId, category: "hoi-policy", storageUrl: "x",
    });
    expect(ok).toBe(false);
  });
});
