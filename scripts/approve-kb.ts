#!/usr/bin/env tsx
// scripts/approve-kb.ts
//
// Two-key approval for kb_versions rows. See spec §8.
//
// Usage:
//   pnpm tsx scripts/approve-kb.ts --tenant <slug-or-uuid> --version-id <int> \
//     --as admin --user-id <uuid> [--activate] [--yes]

import { createInterface } from "node:readline/promises";
import { parseArgs, exitWith, CliArgsError } from "./lib/cli-args.js";
import { withDb, withTenantTx, closePool } from "../packages/api/src/db/pool.js";

interface KbVersionRow {
  id: number;
  tenant_id: string;
  version: number;
  status: string;
  approved_by: string | null;
  compliance_signoff_by: string | null;
}

async function lookupVersion(versionId: number): Promise<KbVersionRow | null> {
  const { rows } = await withDb(async (c) =>
    c.query<KbVersionRow>(
      `SELECT id, tenant_id, version, status, approved_by, compliance_signoff_by
         FROM kb_versions WHERE id = $1`,
      [versionId],
    ),
  );
  return rows[0] ?? null;
}

async function resolveTenantId(slugOrUuid: string): Promise<{ id: string; slug: string }> {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(slugOrUuid)) {
    const { rows } = await withDb(async (c) =>
      c.query<{ id: string; slug: string }>(
        `SELECT id, slug FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
        [slugOrUuid],
      ),
    );
    if (rows.length === 0) exitWith(2, `tenant ${slugOrUuid} not found`);
    return rows[0]!;
  }
  const { rows } = await withDb(async (c) =>
    c.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM tenants WHERE slug = $1 AND deleted_at IS NULL`,
      [slugOrUuid],
    ),
  );
  if (rows.length === 0) exitWith(2, `tenant '${slugOrUuid}' not found`);
  return rows[0]!;
}

async function promptYes(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("Proceed? [y/N]: ")).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

async function main(): Promise<void> {
  let args: Record<string, string | true>;
  try {
    args = parseArgs(process.argv.slice(2), [
      { name: "tenant", required: true },
      { name: "version-id", required: true },
      { name: "as", required: true },
      { name: "user-id", required: true },
      { name: "activate", required: false, hasValue: false },
      { name: "yes", required: false, hasValue: false },
    ]);
  } catch (e) {
    if (e instanceof CliArgsError) exitWith(e.exitCode, `usage error: ${e.message}`);
    throw e;
  }

  const tenantSlugOrId = args.tenant as string;
  const versionId = parseInt(args["version-id"] as string, 10);
  if (!Number.isInteger(versionId)) exitWith(2, `--version-id must be an integer`);
  const role = args.as as string;
  if (role !== "admin" && role !== "compliance_officer") {
    exitWith(2, `--as must be 'admin' or 'compliance_officer' (got '${role}')`);
  }
  const userId = args["user-id"] as string;
  const activate = args.activate === true;
  const skipConfirm = args.yes === true;

  if (activate && role !== "compliance_officer") {
    exitWith(2, `--activate is only valid with --as compliance_officer`);
  }

  // 1. Look up the version
  const version = await lookupVersion(versionId);
  if (!version) exitWith(2, `kb_versions row id=${versionId} not found`);

  // 2. Tenant-match assertion (defense against cross-tenant operator error)
  const tenant = await resolveTenantId(tenantSlugOrId);
  if (version.tenant_id !== tenant.id) {
    exitWith(
      2,
      `cross-tenant mismatch: kb_versions.id=${versionId} belongs to tenant ${version.tenant_id}, not '${tenantSlugOrId}' (${tenant.id}). Approval aborted.`,
    );
  }

  // 3. Confirmation prompt
  console.log("");
  console.log(`Version ${versionId} belongs to tenant ${tenant.slug} (id: ${tenant.id}).`);
  console.log(`  Current status: ${version.status}`);
  console.log(`  Action: approve as ${role} with user-id ${userId}${activate ? " + activate" : ""}.`);
  console.log("");
  if (!skipConfirm) {
    const ok = await promptYes();
    if (!ok) {
      console.log("Aborted by operator.");
      await closePool();
      process.exit(0);
    }
  }

  // Task 15 fills in the writes below.
  console.log("TODO: DB approval writes land in Task 15.");
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
