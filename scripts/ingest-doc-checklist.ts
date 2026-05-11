#!/usr/bin/env tsx
// scripts/ingest-doc-checklist.ts
//
// Parses NPNQM's Document_Requirements_All_Income_Types.md and writes the
// three doc-checklist tables (program_doc_checklist, program_doc_engine_rules,
// income_type_resolver) tied to a new kb_versions row.
//
// See spec docs/superpowers/specs/2026-05-12-doc-checklist-ingest-design.md.

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseAll,
  verifyParity,
  DocChecklistParseError,
} from "../packages/api/src/ingestion/doc-checklist-parser.js";
import { parseArgs, exitWith, CliArgsError } from "./lib/cli-args.js";
import { withDb, withTenantTx, closePool } from "../packages/api/src/db/pool.js";

async function resolveTenantId(slugOrUuid: string): Promise<string> {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(slugOrUuid)) {
    const { rows } = await withDb(async (c) =>
      c.query<{ id: string }>(`SELECT id FROM tenants WHERE id = $1 AND deleted_at IS NULL`, [slugOrUuid]),
    );
    if (rows.length === 0) exitWith(2, `tenant ${slugOrUuid} not found`);
    return rows[0]!.id;
  }
  const { rows } = await withDb(async (c) =>
    c.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL`, [slugOrUuid]),
  );
  if (rows.length === 0) exitWith(2, `tenant '${slugOrUuid}' not found`);
  return rows[0]!.id;
}

async function main(): Promise<void> {
  let args: Record<string, string | true>;
  try {
    args = parseArgs(process.argv.slice(2), [
      { name: "tenant", required: true },
      { name: "version", required: true },
      { name: "as", required: true },
      { name: "file", required: true },
      { name: "max-age", required: false },
      { name: "dry-run", required: false, hasValue: false },
    ]);
  } catch (e) {
    if (e instanceof CliArgsError) exitWith(e.exitCode, `usage error: ${e.message}`);
    throw e;
  }

  const tenantSlugOrId = args.tenant as string;
  const versionInt = parseInt(args.version as string, 10);
  if (!Number.isInteger(versionInt) || versionInt < 1) {
    exitWith(2, `--version must be a positive integer (got '${args.version}')`);
  }
  const operatorUserId = args.as as string;
  const filePath = resolve(args.file as string);
  const maxAgeDays = args["max-age"] ? parseInt(args["max-age"] as string, 10) : null;
  const dryRun = args["dry-run"] === true;

  // 1. Read file
  let markdown: string;
  let fileBytes: number;
  try {
    markdown = readFileSync(filePath, "utf8");
    fileBytes = statSync(filePath).size;
  } catch (e) {
    exitWith(2, `cannot read --file ${filePath}: ${(e as Error).message}`);
  }

  // 2. Parse
  let parsed: ReturnType<typeof parseAll>;
  try {
    parsed = parseAll(markdown);
  } catch (e) {
    if (e instanceof DocChecklistParseError) {
      exitWith(3, `parser invariant violated (File Section ${e.section}): ${e.message}`);
    }
    throw e;
  }

  // 3. Parity verify
  try {
    verifyParity(parsed.scenarios);
  } catch (e) {
    if (e instanceof DocChecklistParseError) exitWith(4, e.message);
    throw e;
  }

  // 4. Max-age check
  if (maxAgeDays !== null) {
    const ageMs = Date.now() - new Date(parsed.generatedAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > maxAgeDays) {
      exitWith(6, `file generated at ${parsed.generatedAt} (${ageDays.toFixed(1)} days ago) exceeds --max-age ${maxAgeDays}. Regenerate upstream and re-run.`);
    }
  }

  // 5. Resolve tenant
  const tenantId = await resolveTenantId(tenantSlugOrId);

  // 6. Verify version-int not already used
  const collision = await withDb(async (c) =>
    c.query<{ status: string }>(
      `SELECT status FROM kb_versions WHERE tenant_id = $1 AND version = $2`,
      [tenantId, versionInt],
    ),
  );
  if (collision.rows.length > 0) {
    exitWith(7, `kb_versions row already exists for tenant ${tenantSlugOrId} version ${versionInt} (status: ${collision.rows[0]!.status}). Pick the next integer.`);
  }

  // 7. Summary
  console.log("");
  console.log("  Tenant:        ", tenantSlugOrId, `(${tenantId})`);
  console.log("  Version:       ", versionInt);
  console.log("  File:          ", filePath, `(${fileBytes} bytes)`);
  console.log("  Generated at:  ", parsed.generatedAt);
  console.log("  Source SHA256: ", parsed.sourceHash);
  console.log("  Scenarios:     ", parsed.scenarios.length);
  console.log("  Rules:         ", parsed.rules.length);
  console.log("  Resolver rows: ", parsed.resolver.length);
  console.log("");

  if (dryRun) {
    console.log("--dry-run: parsed + verified, no DB writes. Re-run without --dry-run to ingest.");
    await closePool();
    process.exit(0);
  }

  // Task 13 fills in the DB writes below.
  console.log("TODO: DB writes land in Task 13.");
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
