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

  // 4. Apply the role's writes + audit row in a single transaction
  await withTenantTx(tenant.id, async (c) => {
    if (role === "admin") {
      const r = await c.query<{ status: string }>(
        `UPDATE kb_versions
            SET approved_by = $1,
                approved_at = now(),
                status = 'pending_compliance'
          WHERE id = $2 AND tenant_id = $3 AND status = 'pending_approval'
          RETURNING status`,
        [userId, versionId, tenant.id],
      );
      if (r.rowCount !== 1) {
        throw new Error(
          `expected to update 1 kb_versions row (current status must be 'pending_approval'); updated ${r.rowCount}. Concurrent edit or wrong status?`,
        );
      }
      // ON CONFLICT DO NOTHING cannot be used with tenant_audit_log because
      // migration 008 adds a no_update_audit rewrite rule (append-only). Use
      // WHERE NOT EXISTS to achieve the same dedup intent (spec §8.3).
      await c.query(
        `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
         SELECT $1, $2, 'kb_version.approve', $3, $4::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM tenant_audit_log
            WHERE target_tenant_id = $1
              AND action = 'kb_version.approve'
              AND metadata->>'kb_version_id' = $5
              AND actor_id = $2
         )`,
        [
          tenant.id,
          userId,
          `admin approval of kb_version ${versionId}`,
          JSON.stringify({ kb_version_id: String(versionId), prior_status: "pending_approval", new_status: "pending_compliance" }),
          String(versionId),
        ],
      );
      console.log(`Approved as admin. Status: pending_compliance. Next: re-run with --as compliance_officer.`);
      return;
    }

    // role === "compliance_officer"
    if (!activate) {
      const r = await c.query<{ status: string }>(
        `UPDATE kb_versions
            SET compliance_signoff_by = $1,
                compliance_signoff_at = now()
          WHERE id = $2 AND tenant_id = $3 AND status = 'pending_compliance'
          RETURNING status`,
        [userId, versionId, tenant.id],
      );
      if (r.rowCount !== 1) {
        throw new Error(
          `expected to update 1 kb_versions row (current status must be 'pending_compliance'); updated ${r.rowCount}.`,
        );
      }
      await c.query(
        `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
         SELECT $1, $2, 'kb_version.compliance_signoff', $3, $4::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM tenant_audit_log
            WHERE target_tenant_id = $1
              AND action = 'kb_version.compliance_signoff'
              AND metadata->>'kb_version_id' = $5
              AND actor_id = $2
         )`,
        [
          tenant.id,
          userId,
          `compliance signoff of kb_version ${versionId}`,
          JSON.stringify({ kb_version_id: String(versionId), prior_status: "pending_compliance", new_status: "pending_compliance" }),
          String(versionId),
        ],
      );
      console.log(`Compliance signoff recorded. Status: pending_compliance. Next: re-run with --activate to make active.`);
      return;
    }

    // --activate path: atomic SELECT FOR UPDATE + demote + promote (spec §8.2)
    await c.query(
      `SELECT id FROM kb_versions
        WHERE tenant_id = $1 AND status = 'active'
          FOR UPDATE`,
      [tenant.id],
    );
    await c.query(
      `UPDATE kb_versions
          SET status = 'superseded',
              superseded_at = now()
        WHERE tenant_id = $1 AND status = 'active'`,
      [tenant.id],
    );
    const r = await c.query<{ status: string }>(
      `UPDATE kb_versions
          SET status = 'active',
              activated_at = now(),
              compliance_signoff_by = $1,
              compliance_signoff_at = now()
        WHERE id = $2 AND tenant_id = $3 AND status = 'pending_compliance'
        RETURNING status`,
      [userId, versionId, tenant.id],
    );
    if (r.rowCount !== 1) {
      throw new Error(
        `activation: expected to promote 1 row from pending_compliance to active; promoted ${r.rowCount}. Concurrent edit raced us — transaction rolling back.`,
      );
    }
    await c.query(
      `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
       SELECT $1, $2, 'kb_version.activate', $3, $4::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM tenant_audit_log
          WHERE target_tenant_id = $1
            AND action = 'kb_version.activate'
            AND metadata->>'kb_version_id' = $5
            AND actor_id = $2
       )`,
      [
        tenant.id,
        userId,
        `activated kb_version ${versionId}`,
        JSON.stringify({ kb_version_id: String(versionId), prior_status: "pending_compliance", new_status: "active" }),
        String(versionId),
      ],
    );
    console.log(`Activated. kb_version ${versionId} is now status='active' for tenant ${tenant.slug}. Any prior active version was demoted to 'superseded'.`);
  });

  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
