import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

// Boot .env so DATABASE_URL is set (mirrors other integration tests).
if (!process.env.DATABASE_URL) {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    for (const line of readFileSync(resolvePath(here, "../.env"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* */ }
}

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { withDb, withTenantTx, closePool } from "../src/db/pool.js";
import { run } from "../src/services/predict-conditions/service.js";
import type { LoanContext } from "../src/services/doc-requirements.js";
import { createStore } from "@twin/core";
import { scenarios } from "@twin/fixtures";
import {
  accept,
  dismiss,
  reopenAndAccept,
  clearAlert,
  PredictionNotFoundError,
  PredictionNotPendingError,
  PredictionNotDismissedError,
  DismissalReasonTooShortError,
  AlertNotFoundError,
  configurePredictConditionsService,
} from "../src/services/predict-conditions/index.js";
import type { Store, Loan } from "@twin/core";

function stubLoanForStore(loanId: string): Loan {
  return {
    id: loanId,
    tenantId: T,
    nqmProgram: "Flex Select",
    qualifyingMethod: "TraditionalDocs",
    borrower: { fullName: "Test", ssnMasked: "xxx-xx-0000", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "1", city: "LA", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 100000, salesPrice: 100000, appraisedValue: 100000,
      ltv: 100, cltv: 100, hcltv: 100, noteRate: 7, term: 360, amortType: "Fixed",
      lienPosition: 1, occupancy: "Primary", isInvestmentProperty: false, piti: 600,
    },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 600, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "TraditionalDocs", derivedMonthlyIncome: 10000 },
    income: { totalMonthlyIncome: 10000 },
    assets: { totalLiquid: 0, totalRetirement: 0, reservesMonths: 0 },
    credit: {
      repScore: 720, tradelinesOpen: 1, tradelinesTotal: 1, tradelines: [],
      liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 },
    },
    appraisal: {
      appraisalDate: "2026-01-01", appraiserName: "Test", appraisalType: "Full", appraisedValue: 100000,
      marketCondition: "Stable", neighborhoodRating: "Average", siteArea: "N/A", grossLivingArea: 1000,
      roomCount: 4, bedroomCount: 2, bathroomCount: 1, garageSpaces: 1, condition: "Average", comparables: [],
    },
    conditions: [], documents: [], decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "test", at: "2026-01-01T00:00:00.000Z" }],
    compliance: {
      qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false,
      higherPricedCoveredTransaction: false, stateLicenseRequired: false,
      stateHighCostTest: "Pass", tridToleranceCure: "None",
      totalPointsAndFees: 0, pointsAndFeesThreshold: 0, pointsAndFeesPass: true, flags: [],
    },
    overlay: {
      programName: "Flex Select", investorName: "Test", maxLTV: 100, minFICO: 600, maxDTI: 50,
      minDSCR: null, minReserves: 0, checks: [],
    },
  };
}

let sharedStore: Store | null = null;

const T = "5d175193-6ee2-4d6a-b16e-dd00dd00dd01";

async function seedTenant(): Promise<void> {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'Predict-Conditions Test', 'predict-conditions-test', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
  });
}

async function seedActiveKbWithMinimalResolver(): Promise<number> {
  return await withDb(async (c) => {
    const { rows: maxRows } = await c.query<{ max: number | null }>(
      `SELECT MAX(version) AS max FROM kb_versions WHERE tenant_id = $1`,
      [T],
    );
    const v = (maxRows[0]?.max ?? 0) + 1;
    const { rows } = await c.query<{ id: number }>(
      `INSERT INTO kb_versions (tenant_id, version, status, source_documents)
         VALUES ($1, $2, 'active', '{"kind":"doc_checklist"}'::jsonb)
       RETURNING id`,
      [T, v],
    );
    return rows[0]!.id;
  });
}

async function seedResolverHappyPath(kbId: number): Promise<void> {
  await withTenantTx(T, async (c) => {
    await c.query(
      `INSERT INTO income_type_resolver
         (tenant_id, kb_version_id, income_doc_type, borrower_type, citizenship, is_itin, resolved_income_type)
       VALUES ($1, $2, 'Full Doc', 'W2', 'US Citizen', false, 'Full Documentation - Wage Earner')
       ON CONFLICT DO NOTHING`,
      [T, kbId],
    );
    await c.query(
      `INSERT INTO program_doc_checklist
         (tenant_id, kb_version_id, resolved_income_type, program, minimum_docs, income_docs, raw_min_msg, raw_income_msg)
       VALUES ($1, $2, 'Full Documentation - Wage Earner', 'Flex Select',
               $3::jsonb, $4::jsonb, 'raw_min', 'raw_inc')
       ON CONFLICT DO NOTHING`,
      [
        T,
        kbId,
        JSON.stringify([
          { order: 1, name: "Initial Loan Application (1003)", note: null },
          { order: 2, name: "Final HOI with effective date ≥ closing", note: null },
        ]),
        JSON.stringify([
          { order: 1, name: "Most recent paystub(s) reflecting 30 days of pay", note: null },
        ]),
      ],
    );
  });
}

async function cleanupAll(): Promise<void> {
  await withDb(async (c) => {
    await c.query(`DELETE FROM predicted_conditions      WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM prediction_alerts         WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM income_type_resolver      WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM program_doc_checklist     WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM program_doc_engine_rules  WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM kb_versions               WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM tenant_audit_log         WHERE target_tenant_id = $1`, [T]);
  });
}

function loanContextFullDocW2(): LoanContext {
  return {
    incomeDocType: "Full Doc",
    borrowerType: "W2",
    citizenship: "US Citizen",
    isItin: false,
    llcOrLegalEntity: false,
    occupancy: "primary",
    state: "CA",
    county: "Los Angeles",
    usCredit: true,
    program: "Flex Select",
  };
}

beforeAll(async () => {
  await seedTenant();
  if (!sharedStore) {
    sharedStore = createStore({ scenarios });
    configurePredictConditionsService({ store: sharedStore });
  }
});

beforeEach(async () => {
  await cleanupAll();
  // Re-inject stub loans for every loan_id used by the mutation tests.
  if (sharedStore) {
    for (const loanId of ["L-ACC-1","L-ACC-2","L-DIS-1","L-DIS-2","L-REOPEN-1","L-REOPEN-2","L-CLR-2"]) {
      sharedStore.dispatch({ type: "InjectLoan", loan: stubLoanForStore(loanId) });
    }
  }
});

afterAll(async () => {
  await cleanupAll();
  await closePool();
});

describe("predict-conditions service — run() happy path", () => {
  it("emits 3 predictions for a seed resolver with 2 minimum + 1 income doc", async () => {
    const kbId = await seedActiveKbWithMinimalResolver();
    await seedResolverHappyPath(kbId);

    const r = await run(T, "L-RUN-1", loanContextFullDocW2(), "system:loan-ingest");

    expect(r.predictionCount).toBe(3);
    expect(r.alertCount).toBe(0);
    expect(r.reused).toBe(false);
    expect(r.runId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("infers PTF for the Final HOI item, PTD for the others", async () => {
    const kbId = await seedActiveKbWithMinimalResolver();
    await seedResolverHappyPath(kbId);

    await run(T, "L-RUN-2", loanContextFullDocW2(), "system:loan-ingest");

    const rows = await withDb(async (c) =>
      c.query<{ description: string; category: string; source_list: string }>(
        `SELECT description, category, source_list FROM predicted_conditions
          WHERE tenant_id = $1 AND loan_id = $2 ORDER BY source_list, source_order`,
        [T, "L-RUN-2"],
      ),
    );
    const byName = new Map(rows.rows.map((r) => [r.description, r]));
    expect(byName.get("Initial Loan Application (1003)")!.category).toBe("PTD");
    expect(byName.get("Final HOI with effective date ≥ closing")!.category).toBe("PTF");
    expect(byName.get("Most recent paystub(s) reflecting 30 days of pay")!.category).toBe("PTD");
  });

  it("populates predicted_by from the source argument", async () => {
    const kbId = await seedActiveKbWithMinimalResolver();
    await seedResolverHappyPath(kbId);
    await run(T, "L-RUN-3", loanContextFullDocW2(), "system:manual-rerun:user-abc");

    const rows = await withDb(async (c) =>
      c.query<{ predicted_by: string }>(
        `SELECT predicted_by FROM predicted_conditions WHERE tenant_id = $1 AND loan_id = $2 LIMIT 1`,
        [T, "L-RUN-3"],
      ),
    );
    expect(rows.rows[0]!.predicted_by).toBe("system:manual-rerun:user-abc");
  });
});

describe("predict-conditions service — alert paths", () => {
  it("emits NoActiveKbVersionError alert when no active KB exists", async () => {
    // Seed tenant but no kb_versions row.
    const r = await run(T, "L-ALERT-1", loanContextFullDocW2(), "system:loan-ingest");
    expect(r.predictionCount).toBe(0);
    expect(r.alertCount).toBe(1);

    const alerts = await withDb(async (c) =>
      c.query<{ error_class: string; remediation_hint: string }>(
        `SELECT error_class, remediation_hint FROM prediction_alerts
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, "L-ALERT-1"],
      ),
    );
    expect(alerts.rows).toHaveLength(1);
    expect(alerts.rows[0]!.error_class).toBe("NoActiveKbVersionError");
    expect(alerts.rows[0]!.remediation_hint).toContain("approve-kb.ts");
  });

  it("emits IncomeTypeUnresolvedError alert when resolver row missing", async () => {
    const kbId = await seedActiveKbWithMinimalResolver();
    // Don't seed income_type_resolver — resolver will throw.
    const r = await run(T, "L-ALERT-2", loanContextFullDocW2(), "system:loan-ingest");
    expect(r.alertCount).toBe(1);

    const alerts = await withDb(async (c) =>
      c.query<{ error_class: string; error_payload: Record<string, unknown> }>(
        `SELECT error_class, error_payload FROM prediction_alerts
          WHERE tenant_id = $1 AND loan_id = $2`,
        [T, "L-ALERT-2"],
      ),
    );
    expect(alerts.rows[0]!.error_class).toBe("IncomeTypeUnresolvedError");
    expect(alerts.rows[0]!.error_payload.kbVersionId).toBe(kbId);
  });
});

describe("predict-conditions service — idempotency", () => {
  it("reuses an existing pending batch when source_input_hash + kb_version_id match", async () => {
    const kbId = await seedActiveKbWithMinimalResolver();
    await seedResolverHappyPath(kbId);

    const first = await run(T, "L-IDEM-1", loanContextFullDocW2(), "system:loan-ingest");
    const second = await run(T, "L-IDEM-1", loanContextFullDocW2(), "system:manual-rerun:user-x");

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.runId).toBe(first.runId);
    expect(second.predictionCount).toBe(first.predictionCount);
  });

  it("replaces pending batch when LoanContext changes", async () => {
    const kbId = await seedActiveKbWithMinimalResolver();
    await seedResolverHappyPath(kbId);

    const first = await run(T, "L-IDEM-2", loanContextFullDocW2(), "system:loan-ingest");
    // Mutate one field; same resolver row applies (still Full Doc / W2 / US Citizen / not-itin),
    // so resolution succeeds — but the hash differs.
    const mutated = { ...loanContextFullDocW2(), occupancy: "investment" as const };
    const second = await run(T, "L-IDEM-2", mutated, "system:manual-rerun:user-y");

    expect(second.reused).toBe(false);
    expect(second.runId).not.toBe(first.runId);
    // Old pending rows are gone.
    const rows = await withDb(async (c) =>
      c.query<{ count: string }>(
        `SELECT COUNT(*)::text FROM predicted_conditions WHERE tenant_id = $1 AND loan_id = $2 AND prediction_run_id = $3`,
        [T, "L-IDEM-2", first.runId],
      ),
    );
    expect(parseInt(rows.rows[0]!.count, 10)).toBe(0);
  });

  it("preserves accepted/dismissed predictions across re-runs", async () => {
    const kbId = await seedActiveKbWithMinimalResolver();
    await seedResolverHappyPath(kbId);

    const first = await run(T, "L-IDEM-3", loanContextFullDocW2(), "system:loan-ingest");
    // Flip one prediction to 'accepted' to simulate operator action.
    await withDb(async (c) =>
      c.query(
        `UPDATE predicted_conditions
            SET status = 'accepted',
                acted_by = 'op-1', acted_at = now(), acted_role = 'operator',
                accepted_condition_id = 'fake-cond-id'
          WHERE tenant_id = $1 AND loan_id = $2 AND source_order = 1 AND source_list = 'minimum'`,
        [T, "L-IDEM-3"],
      ),
    );

    // Re-run with different hash so it triggers a replace.
    const mutated = { ...loanContextFullDocW2(), state: "TX" };
    await run(T, "L-IDEM-3", mutated, "system:manual-rerun:user-z");

    const accepted = await withDb(async (c) =>
      c.query<{ count: string }>(
        `SELECT COUNT(*)::text FROM predicted_conditions
          WHERE tenant_id = $1 AND loan_id = $2 AND status = 'accepted'`,
        [T, "L-IDEM-3"],
      ),
    );
    expect(parseInt(accepted.rows[0]!.count, 10)).toBe(1);
  });
});

describe("predict-conditions service — auto-clear alerts on successful re-run", () => {
  it("clears active alerts and writes one audit row per cleared alert", async () => {
    // First run with no KB → produces alert.
    await run(T, "L-CLR-1", loanContextFullDocW2(), "system:loan-ingest");
    const before = await withDb(async (c) =>
      c.query<{ count: string }>(
        `SELECT COUNT(*)::text FROM prediction_alerts
          WHERE tenant_id = $1 AND loan_id = $2 AND cleared_at IS NULL`,
        [T, "L-CLR-1"],
      ),
    );
    expect(parseInt(before.rows[0]!.count, 10)).toBe(1);

    // Now seed the KB; re-run succeeds → alert auto-clears.
    const kbId = await seedActiveKbWithMinimalResolver();
    await seedResolverHappyPath(kbId);
    const r = await run(T, "L-CLR-1", loanContextFullDocW2(), "system:manual-rerun:user-clr");
    expect(r.predictionCount).toBeGreaterThan(0);
    expect(r.alertCount).toBe(0);

    const after = await withDb(async (c) =>
      c.query<{ cleared_by: string }>(
        `SELECT cleared_by FROM prediction_alerts
          WHERE tenant_id = $1 AND loan_id = $2 AND cleared_at IS NOT NULL`,
        [T, "L-CLR-1"],
      ),
    );
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]!.cleared_by).toBe("system:successful-rerun");

    // Audit row exists with actor_id = the rerun-triggering source.
    const audit = await withDb(async (c) =>
      c.query<{ actor_id: string; metadata: Record<string, unknown> }>(
        `SELECT actor_id, metadata FROM tenant_audit_log
          WHERE target_tenant_id = $1 AND action = 'predict_conditions.alert_clear'
          ORDER BY created_at DESC LIMIT 1`,
        [T],
      ),
    );
    expect(audit.rows[0]!.actor_id).toBe("system:manual-rerun:user-clr");
    expect(audit.rows[0]!.metadata.cleared_by).toBe("system:successful-rerun");
    expect(audit.rows[0]!.metadata.triggered_by_run_id).toBe(r.runId);
  });
});

describe("predict-conditions service — concurrency", () => {
  it("concurrent run() calls on the same loan serialize via advisory lock", async () => {
    const kbId = await seedActiveKbWithMinimalResolver();
    await seedResolverHappyPath(kbId);

    const [a, b] = await Promise.all([
      run(T, "L-CONC-1", loanContextFullDocW2(), "system:loan-ingest"),
      run(T, "L-CONC-1", loanContextFullDocW2(), "system:manual-rerun:user-conc"),
    ]);
    // One inserted, one reused — exact order is unspecified but the union should be one batch.
    const total = await withDb(async (c) =>
      c.query<{ count: string }>(
        `SELECT COUNT(DISTINCT prediction_run_id)::text FROM predicted_conditions
          WHERE tenant_id = $1 AND loan_id = $2 AND status = 'pending'`,
        [T, "L-CONC-1"],
      ),
    );
    expect(parseInt(total.rows[0]!.count, 10)).toBe(1);
    const reusedCount = [a, b].filter((x) => x.reused).length;
    expect(reusedCount).toBe(1);
  });
});

// ── Helpers used by mutation tests ───────────────────────────────────────────

async function seedAndRun(loanId: string): Promise<{ predictionIds: string[] }> {
  const kbId = await seedActiveKbWithMinimalResolver();
  await seedResolverHappyPath(kbId);
  await run(T, loanId, loanContextFullDocW2(), "system:loan-ingest");
  const rows = await withDb(async (c) =>
    c.query<{ id: string }>(
      `SELECT id FROM predicted_conditions WHERE tenant_id = $1 AND loan_id = $2 ORDER BY source_list, source_order`,
      [T, loanId],
    ),
  );
  return { predictionIds: rows.rows.map((r) => r.id) };
}

describe("predict-conditions service — accept()", () => {
  it("flips status to accepted, creates a Condition, and links via accepted_condition_id", async () => {
    const { predictionIds } = await seedAndRun("L-ACC-1");
    const r = await accept(T, predictionIds[0]!, "op-1", "operator");
    expect(r.conditionId).toMatch(/^c\d+$/);
    expect(r.predictionId).toBe(predictionIds[0]);

    const after = await withDb(async (c) =>
      c.query<{ status: string; acted_role: string; accepted_condition_id: string }>(
        `SELECT status, acted_role, accepted_condition_id FROM predicted_conditions WHERE id = $1`,
        [predictionIds[0]],
      ),
    );
    expect(after.rows[0]!.status).toBe("accepted");
    expect(after.rows[0]!.acted_role).toBe("operator");
    expect(after.rows[0]!.accepted_condition_id).toBe(r.conditionId);
  });

  it("rejects non-pending predictions with PredictionNotPendingError", async () => {
    const { predictionIds } = await seedAndRun("L-ACC-2");
    await accept(T, predictionIds[0]!, "op-1", "operator");
    await expect(accept(T, predictionIds[0]!, "op-2", "operator")).rejects.toBeInstanceOf(PredictionNotPendingError);
  });

  it("rejects missing prediction id with PredictionNotFoundError", async () => {
    await expect(accept(T, "00000000-0000-0000-0000-000000000000", "op-x", "operator")).rejects.toBeInstanceOf(PredictionNotFoundError);
  });
});

describe("predict-conditions service — dismiss()", () => {
  it("flips status to dismissed and records reason + actor + role", async () => {
    const { predictionIds } = await seedAndRun("L-DIS-1");
    await dismiss(T, predictionIds[0]!, "op-1", "operator", "LO already has this doc on file from prior intake");

    const after = await withDb(async (c) =>
      c.query<{ status: string; dismissal_reason: string; acted_role: string }>(
        `SELECT status, dismissal_reason, acted_role FROM predicted_conditions WHERE id = $1`,
        [predictionIds[0]],
      ),
    );
    expect(after.rows[0]!.status).toBe("dismissed");
    expect(after.rows[0]!.dismissal_reason).toMatch(/LO already has/);
    expect(after.rows[0]!.acted_role).toBe("operator");
  });

  it("rejects dismissal reasons shorter than 10 chars", async () => {
    const { predictionIds } = await seedAndRun("L-DIS-2");
    await expect(dismiss(T, predictionIds[0]!, "op-1", "operator", "too short")).rejects.toBeInstanceOf(DismissalReasonTooShortError);
  });
});

describe("predict-conditions service — reopenAndAccept()", () => {
  it("flips dismissed → accepted, clears dismissal_reason, creates Condition, captures prior_dismissal_audit_id", async () => {
    const { predictionIds } = await seedAndRun("L-REOPEN-1");
    await dismiss(T, predictionIds[0]!, "op-1", "operator", "LO already has this doc on file from prior intake");
    const r = await reopenAndAccept(T, predictionIds[0]!, "va-7", "va");
    expect(r.conditionId).toMatch(/^c\d+$/);

    const after = await withDb(async (c) =>
      c.query<{ status: string; dismissal_reason: string | null; acted_role: string }>(
        `SELECT status, dismissal_reason, acted_role FROM predicted_conditions WHERE id = $1`,
        [predictionIds[0]],
      ),
    );
    expect(after.rows[0]!.status).toBe("accepted");
    expect(after.rows[0]!.dismissal_reason).toBeNull();
    expect(after.rows[0]!.acted_role).toBe("va");

    // Reopen audit row carries prior_dismissal_audit_id.
    const audit = await withDb(async (c) =>
      c.query<{ metadata: Record<string, unknown> }>(
        `SELECT metadata FROM tenant_audit_log
          WHERE target_tenant_id = $1 AND action = 'predict_conditions.reopen_and_accept'
            AND (metadata->>'prediction_id') = $2
          ORDER BY created_at DESC LIMIT 1`,
        [T, predictionIds[0]],
      ),
    );
    expect(audit.rows[0]!.metadata.prior_dismissal_audit_id).toBeTruthy();
  });

  it("rejects non-dismissed predictions with PredictionNotDismissedError", async () => {
    const { predictionIds } = await seedAndRun("L-REOPEN-2");
    await expect(reopenAndAccept(T, predictionIds[0]!, "va-7", "va")).rejects.toBeInstanceOf(PredictionNotDismissedError);
  });
});

describe("predict-conditions service — clearAlert()", () => {
  it("flips cleared_at/by on the alert", async () => {
    // Produce an alert.
    await run(T, "L-CLR-2", loanContextFullDocW2(), "system:loan-ingest");
    const alertRow = await withDb(async (c) =>
      c.query<{ id: string }>(
        `SELECT id FROM prediction_alerts WHERE tenant_id = $1 AND loan_id = $2`,
        [T, "L-CLR-2"],
      ),
    );
    await clearAlert(T, alertRow.rows[0]!.id, "op-clr");
    const after = await withDb(async (c) =>
      c.query<{ cleared_by: string; cleared_at: string | null }>(
        `SELECT cleared_by, cleared_at FROM prediction_alerts WHERE id = $1`,
        [alertRow.rows[0]!.id],
      ),
    );
    expect(after.rows[0]!.cleared_by).toBe("op-clr");
    expect(after.rows[0]!.cleared_at).not.toBeNull();
  });

  it("rejects missing alert id with AlertNotFoundError", async () => {
    await expect(clearAlert(T, "00000000-0000-0000-0000-000000000000", "op-x")).rejects.toBeInstanceOf(AlertNotFoundError);
  });
});
