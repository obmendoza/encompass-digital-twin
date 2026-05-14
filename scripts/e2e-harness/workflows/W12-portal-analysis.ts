// scripts/e2e-harness/workflows/W12-portal-analysis.ts
//
// W12 — portal analysis-output ingest full path.
// Asserts: analysis-output POST → portal predictions + eligibility verdict
// persisted → PC v2 second opinion fires → portal_eligibility_verdicts populated.
//
// Fixture: packages/api/test/fixtures/portal-analysis/aubrey_output.json
//
// NOTE on PC v2 assertion: pcV2Triggered is true only if the debounce window
// fires synchronously in the route handler (or the route sets the flag directly).
// If it's async-only, the assertion degrades to a DB-side count check.

import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CellResult, WorkflowDef } from "../types.js";
import { createHash, randomUUID } from "node:crypto";

const CANONICAL_FIXTURE = "portal-analysis-sample";
const HARNESS_TENANT_SLUG = "harness-w12-portal";
const HARNESS_TENANT_ID = "7c000000-0000-0000-0000-000000000012";

function loadEnv(): void {
  if (process.env.DATABASE_URL) return;
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    const envPath = resolvePath(here, "../../../packages/api/.env");
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env — assume process env is configured */ }
}

/**
 * Compute the key_prefix stored in tenant_api_keys, matching the logic
 * in api-key-auth.ts validateApiKey().
 *
 * For key `slug_hexpart`, prefix = `slug_<first8charsOfHexPart>`.
 */
function computeKeyPrefix(apiKey: string): string {
  const underscoreIdx = apiKey.indexOf("_");
  if (underscoreIdx > 0) {
    const slug = apiKey.slice(0, underscoreIdx);
    const hexPart = apiKey.slice(underscoreIdx + 1, underscoreIdx + 9);
    return `${slug}_${hexPart}`;
  }
  return apiKey.slice(0, 8);
}

export const W12: WorkflowDef = {
  id: "W12_portal_analysis",
  name: "Portal Analysis Output — full path",
  specRefs: ["2026-05-15-portal-analysis-output-ingestion §13"],
  appliesTo: (f) => f.id === CANONICAL_FIXTURE,
  run: async (fixture, ctx) => {
    const start = Date.now();
    const assertions: Array<{ name: string; expected: string; actual: string; ok: boolean }> = [];

    loadEnv();

    // Derive a fresh API key each run for isolation.
    // Format: w12test_<32hexchars> → prefix w12test_<first8hexchars>
    const hexPart = randomUUID().replace(/-/g, "");           // 32-char hex
    const apiKey = `w12test_${hexPart}`;
    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
    const apiKeyPrefix = computeKeyPrefix(apiKey);            // "w12test_" + hexPart.slice(0,8)

    // ── Pre-cleanup + seed ──────────────────────────────────────────────
    if (process.env.DATABASE_URL) {
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        // Upsert harness tenant.
        await client.query(
          `INSERT INTO tenants (id, name, slug, status, type)
           VALUES ($1, 'Harness W12', $2, 'active', 'demo')
           ON CONFLICT (id) DO NOTHING`,
          [HARNESS_TENANT_ID, HARNESS_TENANT_SLUG],
        );
        // Upsert API key for this run (use fresh hash each time).
        await client.query(
          `INSERT INTO tenant_api_keys (tenant_id, key_hash, key_prefix, name, rate_limit_per_minute)
           VALUES ($1, $2, $3, 'w12-harness', 1000)
           ON CONFLICT (key_prefix) DO UPDATE SET key_hash = EXCLUDED.key_hash`,
          [HARNESS_TENANT_ID, apiKeyHash, apiKeyPrefix],
        );
        // Wipe prior W12 state — RLS tables require the GUC inside a tx.
        await client.query("BEGIN");
        await client.query(`SET LOCAL app.current_tenant = $1::uuid`, [HARNESS_TENANT_ID]);
        await client.query(`DELETE FROM predicted_conditions       WHERE tenant_id = $1`, [HARNESS_TENANT_ID]);
        await client.query(`DELETE FROM portal_eligibility_verdicts WHERE tenant_id = $1`, [HARNESS_TENANT_ID]);
        await client.query(`DELETE FROM ingested_loans             WHERE tenant_id = $1`, [HARNESS_TENANT_ID]);
        await client.query(`DELETE FROM loan_context_extras        WHERE tenant_id = $1`, [HARNESS_TENANT_ID]);
        await client.query("COMMIT");
        // ingestion_mappings is not RLS-gated at the row level; delete outside tx.
        await client.query(`DELETE FROM ingestion_mappings WHERE tenant_id = $1`, [HARNESS_TENANT_ID]);
        // Seed the adapter mapping required by the analysis-output ingest route.
        await client.query(
          `INSERT INTO ingestion_mappings
             (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
           VALUES ($1, 'npnqm-portal', 'npnqm-portal', 'npnqm-portal', $2::jsonb, '{}'::jsonb, true)`,
          [
            HARNESS_TENANT_ID,
            JSON.stringify({
              identityPrefix: "NPNQM-",
              allowedFetchHosts: ["docs.npnqm-portal.example.com"],
              maxFileBytes: 50_000_000,
            }),
          ],
        );
      } finally {
        await client.end();
      }
    }

    // ── Load fixture ────────────────────────────────────────────────────
    const fixturesDir = resolvePath(
      dirname(fileURLToPath(import.meta.url)),
      "../../../packages/api/test/fixtures/portal-analysis",
    );
    const sample = JSON.parse(readFileSync(join(fixturesDir, "aubrey_output.json"), "utf8")) as unknown;

    // ── POST /api/ingest/:slug/analysis-output ──────────────────────────
    const res = await fetch(
      `${ctx.apiUrl}/api/ingest/${HARNESS_TENANT_SLUG}/analysis-output`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ source: "npnqm-portal", externalId: "W12-AUBREY", analysisOutput: sample }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    const text = await res.text();
    const body = text ? (JSON.parse(text) as { loanId?: string; portalPredictionCount?: number; pcV2Triggered?: boolean }) : {};

    assertions.push({
      name: "analysis_output_201",
      expected: "201",
      actual: String(res.status),
      ok: res.status === 201,
    });
    assertions.push({
      name: "portal_prediction_count",
      expected: ">0",
      actual: String(body.portalPredictionCount ?? 0),
      ok: (body.portalPredictionCount ?? 0) > 0,
    });
    assertions.push({
      name: "pc_v2_triggered",
      expected: "true",
      actual: String(body.pcV2Triggered ?? false),
      ok: body.pcV2Triggered === true,
    });

    // ── DB-side: portal_eligibility_verdicts populated ──────────────────
    if (process.env.DATABASE_URL && body.loanId) {
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SET LOCAL app.current_tenant = $1::uuid`, [HARNESS_TENANT_ID]);
        const { rows } = await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count
           FROM portal_eligibility_verdicts
           WHERE tenant_id = $1
             AND loan_id = $2
             AND superseded_at IS NULL`,
          [HARNESS_TENANT_ID, body.loanId],
        );
        await client.query("COMMIT");
        assertions.push({
          name: "eligibility_verdicts_persisted",
          expected: ">0",
          actual: String(rows[0]!.count),
          ok: rows[0]!.count > 0,
        });
      } finally {
        await client.end();
      }
    }

    const allOk = assertions.every((a) => a.ok);
    return {
      loanId: body.loanId ?? null,
      fixture: fixture.id,
      workflow: "W12_portal_analysis",
      status: allOk ? "pass" : "fail",
      severity: allOk ? null : "P0",
      durationMs: Date.now() - start,
      assertions,
      evidence: { tenantId: HARNESS_TENANT_ID },
      error: null,
    } as CellResult;
  },
};
