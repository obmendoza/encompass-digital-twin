#!/usr/bin/env tsx
// packages/api/scripts/seed-loan-context-extras.ts
//
// One-shot demo backfill — writes loan_context_extras rows for the
// committed fixture loans so PC v2's matrix/geographic/requirements
// resolvers fire against the demo tenant.
//
// Idempotent via first-write-wins (ON CONFLICT DO NOTHING). Safe to
// re-run; only fills missing rows.

import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolvePath(here, "../.env");
try {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* .env optional */ }

import { withDb, closePool } from "../src/db/pool.js";
import { writeExtrasFirstWriteWins } from "../src/ingestion/loan-context-extras.js";
import { scenarios } from "@twin/fixtures";
import type { Loan } from "@twin/core";
import type { LoanContextExtras } from "@twin/core";

function deriveFromFixture(loan: Loan): LoanContextExtras {
  const transaction = loan.transaction;
  const credit = loan.credit;
  const property = loan.property;
  const qualifying = loan.qualifying;
  const assets = loan.assets;

  const purposeRaw = transaction?.loanPurpose as string | undefined;
  const purpose: LoanContextExtras["loanPurpose"] =
    purposeRaw === "Purchase" ? "Purchase" :
    purposeRaw === "Refi-CO" ? "Cash-Out Refinance" :
    purposeRaw === "Refi-RT" ? "Rate & Term Refinance" :
    undefined;

  const out: LoanContextExtras = {};

  const repFico = credit?.repScore;
  if (typeof repFico === "number" && repFico >= 300 && repFico <= 900) out.repFico = repFico;

  const ltv = transaction?.ltv;
  if (typeof ltv === "number") out.ltv = ltv;

  const loanAmount = transaction?.loanAmount;
  if (typeof loanAmount === "number") out.loanAmount = loanAmount;

  if (purpose) out.loanPurpose = purpose;

  const propertyType = property?.propertyType;
  if (typeof propertyType === "string") out.propertyType = propertyType;

  const dti = qualifying?.totalDti;
  if (typeof dti === "number") out.dti = dti;

  const reservesMonths = assets?.reservesMonths;
  if (typeof reservesMonths === "number") out.reservesMonths = reservesMonths;

  const noteRate = transaction?.noteRate;
  if (typeof noteRate === "number") out.noteRate = noteRate;

  // county is rarely populated in fixtures — skip unless present
  const county = (property as Record<string, unknown> | undefined)?.["county"] as string | undefined;
  if (typeof county === "string" && county.length > 0) out.county = county;

  // isItin / llcOrLegalEntity are not standard Loan fields — skip

  return out;
}

async function main(): Promise<void> {
  const tenantId = await withDb(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `SELECT id FROM tenants WHERE type = 'demo' LIMIT 1`,
    );
    if (rows.length === 0) throw new Error("no demo tenant — run migrations first");
    return rows[0]!.id;
  });

  let inserted = 0;
  let skipped = 0;

  for (const [fixtureKey, scenario] of Object.entries(scenarios)) {
    const loan = scenario.loan;
    if (!loan?.id) {
      console.warn(`[seed] skipping ${fixtureKey} — no loan.id`);
      continue;
    }

    const extras = deriveFromFixture(loan);
    if (Object.keys(extras).length === 0) {
      console.warn(`[seed] skipping ${fixtureKey} — no derivable extras`);
      continue;
    }

    const before = await withDb(async (c) => {
      const { rows } = await c.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM loan_context_extras
         WHERE tenant_id = $1 AND loan_id = $2`,
        [tenantId, loan.id],
      );
      return Number(rows[0]!.count);
    });

    await writeExtrasFirstWriteWins(tenantId, loan.id, extras);

    if (before > 0) {
      skipped++;
    } else {
      inserted++;
    }
  }

  console.log(
    `[seed-loan-context-extras] tenant=${tenantId}: ${inserted} inserted, ${skipped} skipped (already present)`,
  );
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
