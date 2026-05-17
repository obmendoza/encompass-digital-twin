// Layer 3 integration tests for HOI validator resolver wired into PC v2 service.run().
// Verifies that resolveHoiValidatorFindings fires during a normal PC v2 run cycle,
// that findings are persisted with ON CONFLICT DO NOTHING idempotency (R2), and
// that the correct source_list / source_rule_id values appear in predicted_conditions.
//
// Uses a real DB; migrations 025 and 026 must be applied.

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
  } catch { /* .env may not exist in CI */ }
}

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { withDb, withTenantTx, closePool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrations.js";
import { run } from "../src/services/predict-conditions/service.js";
import { documentIdToUuid } from "../src/routes/analysis-output-ingest.js";
import { HOI_SCHEMA_VERSION, createStore } from "@twin/core";
import type { Store, HoiPolicyFields, FloodCertFields } from "@twin/core";
import { scenarios } from "@twin/fixtures";
import type { LoanContext } from "../src/services/doc-requirements.js";

// ── Test tenant ──────────────────────────────────────────────────────────────
// UUID chosen to avoid collisions with other integration tests.
const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee03";
const HOI_TENANT_SLUG = "hoi-validator-integration";

// ── Shared KB state ──────────────────────────────────────────────────────────
let kbId: number;
let kbVersion: number;

// ── Base loan context: Wholesale TX SFR purchase ─────────────────────────────
// All HOI rules use "Wholesale" channel → expected loss payee = "NQM Funding, LLC"
const BASE_LOAN: LoanContext = {
  incomeDocType: "Full Doc",
  borrowerType: "W2",
  citizenship: "US Citizen",
  isItin: false,
  llcOrLegalEntity: false,
  occupancy: "primary",
  state: "TX",
  county: "Travis County",
  usCredit: true,
  program: "Flex Select",
  repFico: 720,
  ltv: 75,
  loanAmount: 300000,
  loanPurpose: "Purchase",
  propertyType: "SFR Det.",
  channel: "Wholesale",
  borrowerFullName: "Jane Borrower",
  subjectPropertyAddress: {
    line1: "123 Main St",
    city: "Austin",
    state: "TX",
    zip: "78701",
  },
  noteDate: "2026-06-01",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Insert ingested_documents + document_extractions rows for a test loan. */
async function seedHoiExtraction(opts: {
  loanId: string;
  fields: HoiPolicyFields;
  confidence?: number;
}): Promise<{ documentId: string; documentUuid: string; extractionId: string }> {
  const { loanId, fields, confidence = 0.92 } = opts;
  const documentId = `HOI-L3-${loanId}`;
  const documentUuid = documentIdToUuid(documentId);
  let extractionId = "";

  await withTenantTx(T, async (c) => {
    // ingested_documents row
    await c.query(
      `INSERT INTO ingested_documents
         (tenant_id, external_id, document_id, loan_id, source_url, file_name, status, doc_type, ingest_batch_id)
       VALUES ($1, $2, $3, $4, 'https://example.com/hoi.pdf', 'hoi.pdf', 'fetched', 'Hazard Insurance', gen_random_uuid())
       ON CONFLICT (tenant_id, external_id) DO NOTHING`,
      [T, documentId, documentId, loanId],
    );
    // document_extractions row
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO document_extractions
         (tenant_id, loan_id, document_id, extractor_kind, schema_version, source,
          extracted_by, fields, extraction_confidence)
       VALUES ($1, $2, $3, 'hoi-policy', $4, 'portal', 'portal:test', $5::jsonb, $6)
       ON CONFLICT (tenant_id, document_id, extractor_kind, schema_version)
         WHERE superseded_at IS NULL
         DO NOTHING
       RETURNING id`,
      [T, loanId, documentUuid, HOI_SCHEMA_VERSION, JSON.stringify(fields), confidence],
    );
    extractionId = rows[0]?.id ?? "";
    // If DO NOTHING fired, fetch existing id
    if (!extractionId) {
      const { rows: ex } = await c.query<{ id: string }>(
        `SELECT id FROM document_extractions
          WHERE tenant_id = $1 AND document_id = $2 AND extractor_kind = 'hoi-policy'
            AND schema_version = $3 AND superseded_at IS NULL
          LIMIT 1`,
        [T, documentUuid, HOI_SCHEMA_VERSION],
      );
      extractionId = ex[0]?.id ?? "";
    }
  });

  return { documentId, documentUuid, extractionId };
}

/** Insert ingested_documents + document_extractions rows for a flood-cert test loan. */
async function seedFloodExtraction(opts: {
  loanId: string;
  fields: FloodCertFields;
  confidence?: number;
}): Promise<{ documentId: string; documentUuid: string; extractionId: string }> {
  const { loanId, fields, confidence = 0.92 } = opts;
  const documentId = `FLOOD-L3-${loanId}`;
  const documentUuid = documentIdToUuid(documentId);
  let extractionId = "";

  await withTenantTx(T, async (c) => {
    // ingested_documents row
    await c.query(
      `INSERT INTO ingested_documents
         (tenant_id, external_id, document_id, loan_id, source_url, file_name, status, doc_type, ingest_batch_id)
       VALUES ($1, $2, $3, $4, 'https://example.com/flood.pdf', 'flood.pdf', 'fetched', 'Flood Insurance', gen_random_uuid())
       ON CONFLICT (tenant_id, external_id) DO NOTHING`,
      [T, documentId, documentId, loanId],
    );
    // document_extractions row
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO document_extractions
         (tenant_id, loan_id, document_id, extractor_kind, schema_version, source,
          extracted_by, fields, extraction_confidence)
       VALUES ($1, $2, $3, 'flood-cert', $4, 'portal', 'portal:test', $5::jsonb, $6)
       ON CONFLICT (tenant_id, document_id, extractor_kind, schema_version)
         WHERE superseded_at IS NULL
         DO NOTHING
       RETURNING id`,
      [T, loanId, documentUuid, HOI_SCHEMA_VERSION, JSON.stringify(fields), confidence],
    );
    extractionId = rows[0]?.id ?? "";
    // If DO NOTHING fired, fetch existing id
    if (!extractionId) {
      const { rows: ex } = await c.query<{ id: string }>(
        `SELECT id FROM document_extractions
          WHERE tenant_id = $1 AND document_id = $2 AND extractor_kind = 'flood-cert'
            AND schema_version = $3 AND superseded_at IS NULL
          LIMIT 1`,
        [T, documentUuid, HOI_SCHEMA_VERSION],
      );
      extractionId = ex[0]?.id ?? "";
    }
  });

  return { documentId, documentUuid, extractionId };
}

/** Seed a loan into the in-memory store and return the loan ID. */
async function seedLoanInStore(store: Store, loanId: string, loan: LoanContext): Promise<void> {
  store.dispatch({
    type: "InjectLoan",
    loan: {
      id: loanId,
      tenantId: T,
      nqmProgram: loan.program,
      qualifyingMethod: "TraditionalDocs",
      borrower: {
        fullName: loan.borrowerFullName ?? "Test Borrower",
        ssnMasked: "xxx-xx-0000",
        dob: "1980-01-01",
        maritalStatus: "Unmarried",
      },
      property: {
        street: loan.subjectPropertyAddress?.line1 ?? "1 Main St",
        city: loan.subjectPropertyAddress?.city ?? "Austin",
        state: loan.state,
        zip: loan.subjectPropertyAddress?.zip ?? "78701",
        propertyType: loan.propertyType ?? "SFR Det.",
        units: 1,
        yearBuilt: 2000,
      },
      transaction: {
        loanPurpose: "Purchase",
        loanAmount: loan.loanAmount ?? 300000,
        salesPrice: loan.loanAmount ?? 300000,
        appraisedValue: loan.loanAmount ?? 300000,
        ltv: loan.ltv ?? 75,
        cltv: loan.ltv ?? 75,
        hcltv: loan.ltv ?? 75,
        noteRate: 7,
        term: 360,
        amortType: "Fixed",
        lienPosition: 1,
        occupancy: "Primary",
        isInvestmentProperty: false,
        piti: 2000,
      },
      qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2000, qualifyingRate: 7 },
      qualifyingWorksheet: { method: "TraditionalDocs", derivedMonthlyIncome: 10000 },
      income: { totalMonthlyIncome: 10000 },
      assets: { totalLiquid: 0, totalRetirement: 0, reservesMonths: 0 },
      credit: {
        repScore: loan.repFico ?? 720,
        tradelinesOpen: 1,
        tradelinesTotal: 1,
        tradelines: [],
        liabilities: {
          totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0,
          mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0,
        },
      },
      appraisal: {
        appraisalDate: "2026-01-01", appraiserName: "Test", appraisalType: "Full",
        appraisedValue: loan.loanAmount ?? 300000, marketCondition: "Stable",
        neighborhoodRating: "Average", siteArea: "N/A", grossLivingArea: 1000,
        roomCount: 4, bedroomCount: 2, bathroomCount: 1, garageSpaces: 1,
        condition: "Average", comparables: [],
      },
      conditions: [],
      documents: [],
      decision: "pending",
      milestones: [{ name: "Submitted to UW", by: "test", at: "2026-01-01T00:00:00.000Z" }],
      compliance: {
        qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false,
        higherPricedCoveredTransaction: false, stateLicenseRequired: false,
        stateHighCostTest: "Pass", tridToleranceCure: "None",
        totalPointsAndFees: 0, pointsAndFeesThreshold: 0, pointsAndFeesPass: true,
        flags: [],
      },
      overlay: {
        programName: loan.program, investorName: "Test", maxLTV: 80, minFICO: 600,
        maxDTI: 50, minDSCR: null, minReserves: 0, checks: [],
      },
    },
  });
}

/** Clean all test rows for a given loan. */
async function cleanLoan(loanId: string): Promise<void> {
  await withTenantTx(T, async (c) => {
    await c.query(`DELETE FROM predicted_conditions  WHERE tenant_id = $1 AND loan_id = $2`, [T, loanId]);
    await c.query(`DELETE FROM prediction_alerts     WHERE tenant_id = $1 AND loan_id = $2`, [T, loanId]);
    await c.query(`DELETE FROM document_extractions  WHERE tenant_id = $1 AND loan_id = $2`, [T, loanId]);
    await c.query(`DELETE FROM ingested_documents    WHERE tenant_id = $1 AND loan_id = $2`, [T, loanId]);
    await c.query(`DELETE FROM loan_context_extras   WHERE tenant_id = $1 AND loan_id = $2`, [T, loanId]);
  });
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

let store: import("@twin/core").Store;

beforeAll(async () => {
  // Apply migrations (including 027-pc-source-rule-id-text.sql if not yet applied).
  await runMigrations();

  // Seed tenant with hoi.enabled=true
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type, settings)
       VALUES ($1, $2, $3, 'active', 'demo', '{"validators":{"hoi":{"enabled":true}}}'::jsonb)
       ON CONFLICT (id) DO UPDATE SET settings = '{"validators":{"hoi":{"enabled":true}}}'::jsonb`,
      [T, "HOI Validator L3 Integration", HOI_TENANT_SLUG],
    );

    // Seed active KB version
    const { rows: maxRows } = await c.query<{ max: number | null }>(
      `SELECT MAX(version) AS max FROM kb_versions WHERE tenant_id = $1`,
      [T],
    );
    kbVersion = (maxRows[0]?.max ?? 0) + 1;
    const { rows: kbRows } = await c.query<{ id: number }>(
      `INSERT INTO kb_versions (tenant_id, version, status, source_documents)
         VALUES ($1, $2, 'active', '{"kind":"doc_checklist"}'::jsonb)
       RETURNING id`,
      [T, kbVersion],
    );
    kbId = kbRows[0]!.id;
  });

  await withTenantTx(T, async (tx) => {
    // Minimal income resolver for the base loan
    await tx.query(
      `INSERT INTO income_type_resolver
         (tenant_id, kb_version_id, income_doc_type, borrower_type, citizenship, is_itin, resolved_income_type)
       VALUES ($1, $2, 'Full Doc', 'W2', 'US Citizen', false, 'Full Documentation - Wage Earner')
       ON CONFLICT DO NOTHING`,
      [T, kbId],
    );
    // Minimal income resolver for DSCR loan scenario
    await tx.query(
      `INSERT INTO income_type_resolver
         (tenant_id, kb_version_id, income_doc_type, borrower_type, citizenship, is_itin, resolved_income_type)
       VALUES ($1, $2, 'DSCR', 'W2', 'US Citizen', false, 'DSCR - Rental Income Only')
       ON CONFLICT DO NOTHING`,
      [T, kbId],
    );
    // Program doc checklist (Full Doc)
    await tx.query(
      `INSERT INTO program_doc_checklist
         (tenant_id, kb_version_id, resolved_income_type, program, minimum_docs, income_docs, raw_min_msg, raw_income_msg)
       VALUES ($1, $2, 'Full Documentation - Wage Earner', 'Flex Select',
               $3::jsonb, $4::jsonb, 'raw_min', 'raw_inc')
       ON CONFLICT DO NOTHING`,
      [
        T, kbId,
        JSON.stringify([{ order: 1, name: "Initial Loan Application (1003)", note: null }]),
        JSON.stringify([{ order: 1, name: "W2 (most recent 2 years)", note: null }]),
      ],
    );
    // Program doc checklist (DSCR)
    await tx.query(
      `INSERT INTO program_doc_checklist
         (tenant_id, kb_version_id, resolved_income_type, program, minimum_docs, income_docs, raw_min_msg, raw_income_msg)
       VALUES ($1, $2, 'DSCR - Rental Income Only', 'Flex Select',
               $3::jsonb, $4::jsonb, 'raw_min', 'raw_inc')
       ON CONFLICT DO NOTHING`,
      [
        T, kbId,
        JSON.stringify([{ order: 1, name: "Initial Loan Application (1003)", note: null }]),
        JSON.stringify([{ order: 1, name: "Lease Agreement or Rental Schedule", note: null }]),
      ],
    );
    // Permissive matrix tier (covers LTV=75, FICO=720, $300K, SFR Det.)
    await tx.query(
      `INSERT INTO program_matrix_tiers
         (tenant_id, kb_version, program, occupancy, min_fico, max_fico,
          max_loan_amount, max_ltv_purchase, max_ltv_cashout, max_ltv_rate_term,
          property_types, source_doc_hash, extraction_run_id)
       VALUES ($1, $2, 'Flex Select', 'primary', 600, 850,
               1000000, 80, 80, 80, ARRAY['SFR Det.'], 'test-hash',
               '00000000-0000-0000-0000-000000000099')
       ON CONFLICT DO NOTHING`,
      [T, kbVersion],
    );
  });

  // Build a minimal store for the test tenant
  store = createStore({ scenarios });
});

afterAll(async () => {
  await withDb(async (c) => {
    await c.query(`DELETE FROM loan_context_extras    WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM predicted_conditions   WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM prediction_alerts      WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM document_extractions   WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM ingested_documents     WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM income_type_resolver   WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM program_doc_checklist  WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM program_matrix_tiers   WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM geographic_restrictions WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM kb_versions            WHERE tenant_id = $1`, [T]);
    // Reset HOI validator settings so re-runs start clean.
    await c.query(
      `UPDATE tenants SET settings = '{}' WHERE id = $1`,
      [T],
    );
  });
  await closePool();
});

// ── Scenarios ────────────────────────────────────────────────────────────────

describe("HOI Validator resolver — Layer 3 integration (PC v2 run cycle)", () => {
  test("Scenario 1: Clean HOI policy — no hoi-validator findings emitted", async () => {
    const loanId = "HOI-L3-CLEAN";
    await cleanLoan(loanId);

    // Clean HOI policy: all required fields present and valid.
    const cleanFields: HoiPolicyFields = {
      carrier: "Carrier A",
      policyNumber: "POL-001",
      namedInsured: "Jane Borrower",
      propertyAddress: {
        line1: "123 Main St",
        line2: null,
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
      effectiveDate: "2026-06-01",
      expirationDate: "2027-06-01",
      termMonths: 12,
      // H1: loss payee must match "NQM Funding, LLC" for Wholesale channel
      lossPayeeClause: "NQM Funding, LLC ISAOA",
      loanNumberOnPolicy: loanId, // matches loanNumber arg (loanId)
      coverageAmount: 350000, // > loanAmount (300000) → H9 ok
      replacementCost: 350000,
      deductiblePct: 0.02, // < 0.05 → H7 ok
      deductibleAmount: 7000,
      windHailHurricane: { included: true, wording: "included", separatePolicy: false, confidence: 0.95 },
      rentLossCoverageMonths: 6,
      rentLossWording: null,
      rentLossActualCostSustained: null,
      occupancyOnPolicy: "Primary",
      premiumPaidInFull: { paid: true, confidence: 0.92 },
      premiumDueDays: null,
      wallsInCoverage: null,
      ho6Policy: null,
      evidence: [],
    };

    await seedHoiExtraction({ loanId, fields: cleanFields });
    await seedLoanInStore(store, loanId, BASE_LOAN);

    await run(T, loanId, BASE_LOAN, "system:test");

    // Assert: zero hoi-validator rows
    const { rows } = await withTenantTx(T, async (c) =>
      c.query<{ source_list: string; source_rule_id: string }>(
        `SELECT source_list, source_rule_id FROM predicted_conditions
          WHERE tenant_id = $1 AND loan_id = $2 AND source_list = 'hoi-validator' AND superseded_at IS NULL`,
        [T, loanId],
      ),
    );
    expect(rows.length).toBe(0);
  });

  test("Scenario 2: Wrong loss-payee → one hoi.loss-payee.match finding", async () => {
    const loanId = "HOI-L3-LOSS-PAYEE";
    await cleanLoan(loanId);

    const badLossPayeeFields: HoiPolicyFields = {
      carrier: "Carrier B",
      policyNumber: "POL-002",
      namedInsured: "Jane Borrower",
      propertyAddress: {
        line1: "123 Main St",
        line2: null,
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
      effectiveDate: "2026-06-01",
      expirationDate: "2027-06-01",
      termMonths: 12,
      // H1: wrong loss payee → rule fires
      lossPayeeClause: "Wrong Lender LLC ISAOA",
      loanNumberOnPolicy: loanId,
      coverageAmount: 350000,
      replacementCost: 350000,
      deductiblePct: 0.02,
      deductibleAmount: 7000,
      windHailHurricane: { included: true, wording: "included", separatePolicy: false, confidence: 0.95 },
      rentLossCoverageMonths: 6,
      rentLossWording: null,
      rentLossActualCostSustained: null,
      occupancyOnPolicy: "Primary",
      premiumPaidInFull: { paid: true, confidence: 0.92 },
      premiumDueDays: null,
      wallsInCoverage: null,
      ho6Policy: null,
      evidence: [],
    };

    const { extractionId } = await seedHoiExtraction({ loanId, fields: badLossPayeeFields });
    await seedLoanInStore(store, loanId, BASE_LOAN);

    await run(T, loanId, BASE_LOAN, "system:test");

    const { rows } = await withTenantTx(T, async (c) =>
      c.query<{ source_list: string; source_rule_id: string; portal_metadata: unknown }>(
        `SELECT source_list, source_rule_id, portal_metadata
          FROM predicted_conditions
         WHERE tenant_id = $1 AND loan_id = $2 AND source_list = 'hoi-validator' AND superseded_at IS NULL`,
        [T, loanId],
      ),
    );

    // Exactly one hoi-validator row
    expect(rows.length).toBe(1);
    expect(rows[0]!.source_rule_id).toBe("hoi.loss-payee.match");
    // portal_metadata must carry validationFindings and extractionId
    const meta = rows[0]!.portal_metadata as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta["extractionId"]).toBe(extractionId);
    expect(Array.isArray(meta["validationFindings"])).toBe(true);
    expect((meta["validationFindings"] as unknown[]).length).toBeGreaterThan(0);
  });

  test("Scenario 2b: Idempotent re-run does not insert duplicate hoi-validator rows", async () => {
    // Re-run PC v2 for the same loan from Scenario 2; should still be exactly 1 row.
    const loanId = "HOI-L3-LOSS-PAYEE";

    await run(T, loanId, BASE_LOAN, "system:test");

    const { rows } = await withTenantTx(T, async (c) =>
      c.query<{ id: string }>(
        `SELECT id FROM predicted_conditions
          WHERE tenant_id = $1 AND loan_id = $2 AND source_list = 'hoi-validator'
            AND source_rule_id = 'hoi.loss-payee.match' AND superseded_at IS NULL`,
        [T, loanId],
      ),
    );
    // ON CONFLICT DO NOTHING ensures no duplicates
    expect(rows.length).toBe(1);
  });

  test("Scenario 3: DSCR loan with rentLossCoverageMonths=3 → hoi.dscr.rent-loss-coverage finding", async () => {
    const loanId = "HOI-L3-DSCR";
    await cleanLoan(loanId);

    const dscrLoan: LoanContext = {
      ...BASE_LOAN,
      // DSCR income type triggers H10
      incomeDocType: "DSCR",
      occupancy: "investment",
    };

    const dscrFields: HoiPolicyFields = {
      carrier: "Carrier C",
      policyNumber: "POL-003",
      namedInsured: "Jane Borrower",
      propertyAddress: {
        line1: "123 Main St",
        line2: null,
        city: "Austin",
        state: "TX",
        zip: "78701",
      },
      effectiveDate: "2026-06-01",
      expirationDate: "2027-06-01",
      termMonths: 12,
      lossPayeeClause: "NQM Funding, LLC ISAOA",
      loanNumberOnPolicy: loanId,
      coverageAmount: 350000,
      replacementCost: 350000,
      deductiblePct: 0.02,
      deductibleAmount: 7000,
      windHailHurricane: { included: true, wording: "included", separatePolicy: false, confidence: 0.95 },
      // H10: DSCR requires ≥ 6 months rent loss; 3 months → fires
      rentLossCoverageMonths: 3,
      rentLossWording: "Rental loss 3 months",
      rentLossActualCostSustained: null,
      // H12: DSCR loan with "Investment" occupancy on policy → no occupancy mismatch
      occupancyOnPolicy: "Investment",
      premiumPaidInFull: { paid: true, confidence: 0.92 },
      premiumDueDays: null,
      wallsInCoverage: null,
      ho6Policy: null,
      evidence: [],
    };

    await seedHoiExtraction({ loanId, fields: dscrFields });
    await seedLoanInStore(store, loanId, dscrLoan);

    await run(T, loanId, dscrLoan, "system:test");

    const { rows } = await withTenantTx(T, async (c) =>
      c.query<{ source_rule_id: string }>(
        `SELECT source_rule_id FROM predicted_conditions
          WHERE tenant_id = $1 AND loan_id = $2 AND source_list = 'hoi-validator' AND superseded_at IS NULL`,
        [T, loanId],
      ),
    );

    const ruleIds = rows.map((r) => r.source_rule_id);
    expect(ruleIds).toContain("hoi.dscr.rent-loss-coverage");
  });

  test("Scenario 4: HOI + Flood coexistence — each finding carries its own extractionId (Finding B)", async () => {
    const loanId = "HOI-L3-FINDING-B-COEXIST";
    await cleanLoan(loanId);

    // HOI policy: only wrong loss-payee triggers H1; all other HOI fields pass.
    const hoiFields: HoiPolicyFields = {
      carrier: "Carrier D",
      policyNumber: "POL-COEXIST-HOI",
      namedInsured: "Jane Borrower",
      propertyAddress: { line1: "123 Main St", line2: null, city: "Austin", state: "TX", zip: "78701" },
      effectiveDate: "2026-06-01",
      expirationDate: "2027-06-01",
      termMonths: 12,
      // H1: wrong loss payee fires
      lossPayeeClause: "Wrong Entity LLC ISAOA",
      loanNumberOnPolicy: loanId,
      coverageAmount: 350000,
      replacementCost: 350000,
      deductiblePct: 0.02,
      deductibleAmount: 7000,
      windHailHurricane: { included: true, wording: "included", separatePolicy: false, confidence: 0.95 },
      rentLossCoverageMonths: 6,
      rentLossWording: null,
      rentLossActualCostSustained: null,
      occupancyOnPolicy: "Primary",
      premiumPaidInFull: { paid: true, confidence: 0.92 },
      premiumDueDays: null,
      wallsInCoverage: null,
      ho6Policy: null,
      evidence: [],
    };

    // Flood cert: floodDeductible=12000 > $10K SFR cap → F1 fires.
    // floodCoverage=250000 >= min(300K, NFIP_MAX_SFR=250K)=250K → F2 passes.
    const floodFields: FloodCertFields = {
      carrier: null,
      policyNumber: null,
      namedInsured: null,
      propertyAddress: null,
      effectiveDate: null,
      expirationDate: null,
      termMonths: null,
      floodZone: null,
      floodCoverage: 250000,
      floodDeductible: 12000,
      isNfip: null,
      nfipMaxApplied: null,
      evidence: [],
    };

    const { extractionId: hoiExtractionId } = await seedHoiExtraction({ loanId, fields: hoiFields });
    const { extractionId: floodExtractionId } = await seedFloodExtraction({ loanId, fields: floodFields });
    await seedLoanInStore(store, loanId, BASE_LOAN);

    await run(T, loanId, BASE_LOAN, "system:test");

    const { rows } = await withTenantTx(T, async (c) =>
      c.query<{ source_rule_id: string; portal_metadata: Record<string, unknown> }>(
        `SELECT source_rule_id, portal_metadata
           FROM predicted_conditions
          WHERE tenant_id = $1 AND loan_id = $2 AND source_list = 'hoi-validator'
            AND superseded_at IS NULL
          ORDER BY source_rule_id`,
        [T, loanId],
      ),
    );

    // Exactly 2 hoi-validator findings
    expect(rows.length).toBe(2);

    const hoiFinding = rows.find((r) => r.source_rule_id === "hoi.loss-payee.match");
    const floodFinding = rows.find((r) => r.source_rule_id === "flood.deductible.cap");
    expect(hoiFinding).toBeDefined();
    expect(floodFinding).toBeDefined();

    // H1 finding must carry the HOI extraction UUID
    expect((hoiFinding!.portal_metadata)["extractionId"]).toBe(hoiExtractionId);
    // F1 finding must carry the Flood extraction UUID — different from HOI's
    expect((floodFinding!.portal_metadata)["extractionId"]).toBe(floodExtractionId);
    expect(hoiExtractionId).not.toBe(floodExtractionId);
  });
});
