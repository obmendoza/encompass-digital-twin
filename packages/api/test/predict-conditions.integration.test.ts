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
import { buildServer } from "../src/server.js";
import { writeExtrasFirstWriteWins } from "../src/ingestion/loan-context-extras.js";
import type { FastifyInstance } from "fastify";
import type { Store } from "@twin/core";

const T = "5d175193-6ee2-4d6a-b16e-dd00dd00dd02";

let app: FastifyInstance;
let appStore: Store;

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'PC HTTP Integration', 'pc-http-integration', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
    // Seed an active KB version with a minimal resolver row.
    const { rows: maxRows } = await c.query<{ max: number | null }>(
      `SELECT MAX(version) AS max FROM kb_versions WHERE tenant_id = $1`,
      [T],
    );
    const v = (maxRows[0]?.max ?? 0) + 1;
    const { rows: kbRows } = await c.query<{ id: number }>(
      `INSERT INTO kb_versions (tenant_id, version, status, source_documents)
         VALUES ($1, $2, 'active', '{"kind":"doc_checklist"}'::jsonb)
       RETURNING id`,
      [T, v],
    );
    const kbId = kbRows[0]!.id;
    await withTenantTx(T, async (tx) => {
      await tx.query(
        `INSERT INTO income_type_resolver
           (tenant_id, kb_version_id, income_doc_type, borrower_type, citizenship, is_itin, resolved_income_type)
         VALUES ($1, $2, 'Full Doc', 'W2', 'US Citizen', false, 'Full Documentation - Wage Earner')
         ON CONFLICT DO NOTHING`,
        [T, kbId],
      );
      await tx.query(
        `INSERT INTO program_doc_checklist
           (tenant_id, kb_version_id, resolved_income_type, program, minimum_docs, income_docs, raw_min_msg, raw_income_msg)
         VALUES ($1, $2, 'Full Documentation - Wage Earner', 'Flex Select',
                 $3::jsonb, $4::jsonb, 'raw_min', 'raw_inc')
         ON CONFLICT DO NOTHING`,
        [
          T, kbId,
          JSON.stringify([
            { order: 1, name: "Initial Loan Application (1003)", note: null },
            { order: 2, name: "Final HOI with effective date ≥ closing", note: null },
          ]),
          JSON.stringify([
            { order: 1, name: "Most recent paystub(s) reflecting 30 days of pay", note: null },
          ]),
        ],
      );
      // Permissive matrix tier so the Phase-B resolver finds a match and emits
      // no violations for the INT-1 loan (FICO 720, LTV 100, $100K, SFR Det.).
      await tx.query(
        `INSERT INTO program_matrix_tiers
           (tenant_id, kb_version, program, occupancy, min_fico, max_fico,
            max_loan_amount, max_ltv_purchase, max_ltv_cashout, max_ltv_rate_term,
            property_types, source_doc_hash, extraction_run_id)
         VALUES ($1, $2, 'Flex Select', 'primary', 600, 800,
                 999999, 105, 105, 105, ARRAY['SFR Det.'], 'hash',
                 '00000000-0000-0000-0000-000000000099')
         ON CONFLICT DO NOTHING`,
        [T, v],
      );
    });
  });
  const built = buildServer({});
  app = built.app;
  appStore = built.store;
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await withDb(async (c) => {
    await c.query(`DELETE FROM loan_context_extras     WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM predicted_conditions    WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM prediction_alerts       WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM income_type_resolver    WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM program_doc_checklist   WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM program_matrix_tiers    WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM geographic_restrictions WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM kb_versions             WHERE tenant_id = $1`, [T]);
  });
  await closePool();
});

function headers(role: "operator" | "va" = "operator") {
  return {
    "x-user-id": role === "va" ? "va-user-1" : "operator-user-1",
    "x-tenant-id": T,
    "x-user-role": role,
  };
}

describe("predict-conditions HTTP integration", () => {
  it("auto-fires on ingest and exposes predictions via GET", async () => {
    // Dispatch InjectLoan against the app's own store so /predictions/run finds the loan.
    const store = appStore;
    store.dispatch({
      type: "InjectLoan",
      loan: {
        id: "INT-1",
        tenantId: T,
        nqmProgram: "Flex Select",
        qualifyingMethod: "TraditionalDocs",
        borrower: { fullName: "Test", ssnMasked: "x", dob: "1980-01-01", maritalStatus: "Unmarried" },
        property: { street: "1", city: "Los Angeles", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
        transaction: {
          loanPurpose: "Purchase", loanAmount: 100000, salesPrice: 100000, appraisedValue: 100000,
          ltv: 100, cltv: 100, hcltv: 100, noteRate: 7, term: 360, amortType: "Fixed",
          lienPosition: 1, occupancy: "Primary", isInvestmentProperty: false, piti: 600,
        },
        qualifying: { housingRatio: 0, totalDti: 0, piPayment: 600, qualifyingRate: 7 },
        qualifyingWorksheet: { method: "TraditionalDocs", derivedMonthlyIncome: 10000 },
        income: { totalMonthlyIncome: 10000 },
        assets: { totalLiquid: 0, totalRetirement: 0, reservesMonths: 0 },
        credit: { repScore: 720, tradelinesOpen: 1, tradelinesTotal: 1, tradelines: [], liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 } },
        appraisal: { appraisalDate: "2026-01-01", appraiserName: "T", appraisalType: "Full", appraisedValue: 100000, marketCondition: "Stable", neighborhoodRating: "Average", siteArea: "N/A", grossLivingArea: 1000, roomCount: 4, bedroomCount: 2, bathroomCount: 1, garageSpaces: 1, condition: "Average", comparables: [] },
        conditions: [], documents: [], decision: "pending",
        milestones: [{ name: "Submitted to UW", by: "t", at: "2026-01-01T00:00:00.000Z" }],
        compliance: { qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false, higherPricedCoveredTransaction: false, stateLicenseRequired: false, stateHighCostTest: "Pass", tridToleranceCure: "None", totalPointsAndFees: 0, pointsAndFeesThreshold: 0, pointsAndFeesPass: true, flags: [] },
        overlay: { programName: "Flex Select", investorName: "T", maxLTV: 100, minFICO: 600, maxDTI: 50, minDSCR: null, minReserves: 0, checks: [] },
      },
    });

    const runRes = await app.inject({
      method: "POST",
      url: "/loans/INT-1/predictions/run",
      headers: headers("operator"),
      payload: {},
    });
    expect(runRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: "GET",
      url: "/loans/INT-1/predictions",
      headers: headers("operator"),
    });
    expect(listRes.statusCode).toBe(200);
    const body = JSON.parse(listRes.body) as { predictions: Array<{ id: string }>; alerts: unknown[] };
    expect(body.predictions.length).toBe(3);
  });

  it("GET /predictions rejects a loan that doesn't exist in the store (Task 7 reviewer I-2)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/loans/INT-NOT-IN-STORE/predictions",
      headers: headers("operator"),
    });
    // requireLoanForTenant throws ActionError("LOAN_NOT_FOUND") which the
    // global error handler maps to 400, consistent with the other PC
    // mutation routes. Previously this returned 200 with empty
    // {predictions:[], alerts:[]} which callers couldn't distinguish from a
    // legitimate empty result.
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { code?: string; error?: string };
    expect(body.code ?? body.error).toBe("LOAN_NOT_FOUND");
  });

  it("fires v2 sources when loan_context_extras is populated", async () => {
    // The existing beforeAll seeded a loan with id "INT-1" in tenant T.
    // Write extras so PC v2's matrix/geographic/requirements resolvers have
    // real values instead of degrading on undefined.
    // LTV is set to 110 to exceed the tier's max_ltv_purchase of 105,
    // ensuring the matrix resolver emits a v2 source finding.
    await writeExtrasFirstWriteWins(T, "INT-1", {
      repFico: 720,
      ltv: 110,
      county: "King County",
      isItin: false,
      loanAmount: 100000,
      loanPurpose: "Purchase",
    });

    // Verify extras were written before running predictions
    const extrasCheck = await withDb(async (c) => {
      const { rows } = await c.query<{ extras: unknown }>(
        `SELECT extras FROM loan_context_extras WHERE tenant_id = $1 AND loan_id = $2`,
        [T, "INT-1"],
      );
      return rows.length > 0;
    });
    expect(extrasCheck).toBe(true);

    const runRes = await app.inject({
      method: "POST",
      url: "/loans/INT-1/predictions/run",
      headers: headers("operator"),
      payload: {},
    });
    expect(runRes.statusCode).toBe(200);

    const listRes = await app.inject({
      method: "GET",
      url: "/loans/INT-1/predictions",
      headers: headers("operator"),
    });
    expect(listRes.statusCode).toBe(200);
    const body = JSON.parse(listRes.body) as { predictions: Array<{ source_list?: string }> };
    const sources = new Set(body.predictions.map((p) => p.source_list ?? ""));
    // Matrix resolver fires because LTV (110) exceeds tier max (105).
    // Confirms PC v2 sources (matrix/geographic/requirements) are emitted
    // when loan_context_extras provides real v2 fields instead of undefined.
    expect(sources.has("matrix")).toBe(true);
  });
});
