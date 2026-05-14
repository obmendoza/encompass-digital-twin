# PC v2 Pre-Underwriter Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Predictive Conditions service to validate loans against the program matrices, program requirements, and geographic restrictions ingested by migration 012 — three data sources that PC v1 didn't consume. Output is a single consolidated `predicted_conditions` batch per loan representing the full pre-underwriter sweep.

**Architecture:** A new orchestrator `runPreUnderwriter` calls four resolvers in sequence (doc-checklist, matrix, geographic, requirements) and aggregates their findings. PC v1's `service.ts run()` becomes a thin shim over the orchestrator — HTTP routes, advisory locks, store-snapshot wrap, idempotency hash, audit-log writes all stay where they are. New resolvers are deterministic; the requirements resolver also has an LLM backstop for rows the deterministic core can't pattern-match, with a five-step post-call validation pipeline (schema → existence → confidence ≥0.7 → source-text grounding ≥50% → output cap).

**Tech Stack:** TypeScript (Fastify routes + Vitest), Postgres via existing `withTenantTx` helper, Anthropic SDK with tool_use + prompt caching (reuses `learning/insight-generator.ts` pattern), `@twin/core` store + reducer.

**Spec:** [`docs/superpowers/specs/2026-05-14-pc-v2-pre-underwriter-design.md`](../specs/2026-05-14-pc-v2-pre-underwriter-design.md) (signed off at commit `cf9cc74`).

---

## Plan-level reviewer notes (thread through implementer awareness)

1. **Phase A includes a reducer migration.** The `normalizeConditionDescription` helper extraction in §3.3 of the spec means the reducer's existing inline normalization (`packages/core/src/reduce.ts:111-114`) is replaced by an import from the new helper. Phase A's first task does the extraction; later phases assume the helper is in place. Behavioral parity with the prior inline normalization is verified by a corpus test.

2. **Each LLM validation step is unit-testable in isolation.** Phase D's tests inject tool_use responses that violate exactly one invariant per test (schema, source-rule existence, confidence floor, source-text grounding, output cap). Five focused tests + one integration test that exercises the full chain.

3. **`hardcoded_fields` audit-log surfacing has no UI/alert path in this plan.** §4.4 of the spec adds the field to audit metadata. Visibility requires someone to look. A weekly operator-alert path is deferred to a follow-up plan; this plan ships the data, not the UI.

4. **Phase A ships orchestrator-without-new-resolvers.** The orchestrator is built first (Phase A), wraps the existing doc-checklist call, and the existing 50+ tests continue to pass. Phases B/C/D plug new resolvers into a stable orchestrator. This lets us stop at any phase with main still green.

---

## Conventions used in this plan

- **Quality gates.** Every commit keeps `pnpm --filter @twin/api test` AND `pnpm --filter @twin/api build` clean.
- **Tenant context.** All tenant-scoped DB access through `withTenantTx(tenantId, fn)`. Every query adds explicit `WHERE tenant_id = $N` filter (BYPASSRLS pooler defense per project memory).
- **TDD.** Tests first; see them fail; implement; see them pass; commit.
- **One commit per task.** Each task is reviewable in isolation.
- **No emojis.** Use `pnpm` not `npm`.

---

## File structure (locked at plan time)

| Status | Path | Responsibility |
|---|---|---|
| Create | `packages/api/src/services/predict-conditions/normalize.ts` | Shared `normalizeConditionDescription()` consumed by reducer + orchestrator dedup |
| Modify | `packages/core/src/reduce.ts:111-114` | AddCondition collision detector imports the new helper |
| Create | `packages/api/src/db/migrations/019-pc-v2-pre-underwriter.sql` | Schema: source_list CHECK widening, source_rule_table + source_rule_id + emission_kind columns, provenance index |
| Modify | `packages/api/src/services/doc-requirements.ts:20-31` | Extend `LoanContext` with seven optional v2 fields |
| Modify | `packages/api/src/routes/predict-conditions-context-builder.ts` | Populate v2 fields from `loan.transaction.*`, `loan.credit.repScore`, etc. |
| Create | `packages/api/src/services/predict-conditions/pre-underwriter.ts` | `runPreUnderwriter()` orchestrator + `KbVersionContext` type + dedup ladder |
| Modify | `packages/api/src/services/predict-conditions/service.ts` | `run()` delegates to `runPreUnderwriter` |
| Create | `packages/api/src/services/predict-conditions/resolvers/matrix-resolver.ts` | `program_matrix_tiers` — four deterministic checks |
| Create | `packages/api/src/services/predict-conditions/resolvers/geographic-resolver.ts` | `geographic_restrictions` — per-row applicability filter |
| Create | `packages/api/src/services/predict-conditions/resolvers/requirements-resolver.ts` | `program_requirements` — 7-handler deterministic core + LLM dispatch |
| Create | `packages/api/src/services/predict-conditions/llm/requirements-backstop.ts` | Anthropic tool_use + 5-step post-call validation pipeline |
| Create | `packages/api/test/normalize.test.ts` | Corpus parity test for the shared helper |
| Create | `packages/api/test/pre-underwriter-orchestrator.test.ts` | Orchestrator unit tests (dedup ladder, R3 Stage-A-wins property) |
| Create | `packages/api/test/matrix-resolver.test.ts` | Table-driven tests for the 4 matrix checks + graceful-degradation rows |
| Create | `packages/api/test/geographic-resolver.test.ts` | Table-driven tests for restriction filtering |
| Create | `packages/api/test/requirements-resolver.test.ts` | Per-handler tests for the 7 deterministic patterns |
| Create | `packages/api/test/requirements-llm-backstop.test.ts` | Mocked Anthropic SDK + each of the 5 validation steps in isolation + full-chain integration |
| Modify | `packages/api/test/predict-conditions-service.test.ts` | Existing tests still pass; new orchestrator delegation verified |
| Modify | `scripts/e2e-harness/workflows/W10-predicted-conditions.ts` | `EXPECTED_PENDING` widens to a range; new assertions on source_list distribution |

---

## Task 1: Extract `normalizeConditionDescription` shared helper

**Phase:** A · **Files:** `packages/api/src/services/predict-conditions/normalize.ts` (new), `packages/api/test/normalize.test.ts` (new), `packages/core/src/reduce.ts` (modify)

**Rationale:** Spec §3.3 and §5.4 require the dedup key normalization to be identical to the reducer's `AddCondition` collision-detector normalization. Today the reducer has the algorithm inline at lines 111-114. We extract once, both consumers import. Single source of truth, no "must match" invariant.

- [ ] **Step 1: Write the corpus parity test**

Create `packages/api/test/normalize.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { normalizeConditionDescription } from "../src/services/predict-conditions/normalize.js";

describe("normalizeConditionDescription", () => {
  // Algorithm: .toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30)
  // Must match packages/core/src/reduce.ts AddCondition collision detector.
  const cases: Array<[string, string]> = [
    ["Initial Loan Application (1003)", "initialloanapplication1003"],
    ["Final HOI with effective date ≥ closing", "finalhoiwitheffectivedateclos"],
    ["Most recent paystub(s) reflecting 30 days of pay", "mostrecentpaystubsreflecting3"],
    ["", ""],
    ["UPPER CASE only", "uppercaseonly"],
    ["spaces and punctuation, oh my!", "spacesandpunctuationohmy"],
    ["digits 12345 stay", "digits12345stay"],
    ["unicode é and emoji 🔥 strip", "unicodeandemojistrip"],
    ["truncates after thirty characters which is the cap", "truncatesafterthirtycharacter"],
  ];

  it.each(cases)("normalizes %j → %j", (input, expected) => {
    expect(normalizeConditionDescription(input)).toBe(expected);
  });

  it("output is at most 30 chars", () => {
    expect(normalizeConditionDescription("a".repeat(100)).length).toBeLessThanOrEqual(30);
  });

  it("output is lowercase alphanumeric only", () => {
    expect(normalizeConditionDescription("Mixed Case! @#$%")).toMatch(/^[a-z0-9]*$/);
  });
});
```

- [ ] **Step 2: Run the test, see it fail (module not found)**

```bash
pnpm --filter @twin/api exec vitest run test/normalize.test.ts
```

Expected: failures because `normalize.ts` doesn't exist yet.

- [ ] **Step 3: Implement the helper**

Create `packages/api/src/services/predict-conditions/normalize.ts`:

```typescript
/**
 * Normalize a Condition description for collision/dedup comparison. Consumed
 * by both:
 *   - packages/core/src/reduce.ts AddCondition collision detector (silent
 *     reducer dedup on near-duplicate descriptions).
 *   - packages/api/src/services/predict-conditions/pre-underwriter.ts
 *     orchestrator dedup-key construction (so cross-resolver duplicates
 *     collapse before they become predicted_conditions rows).
 *
 * One function, two consumers. Changes to the normalization rule propagate
 * to both call sites automatically — no "must match" invariant to police.
 *
 * Algorithm (preserves the historical reducer behavior):
 *   1. Lowercase.
 *   2. Drop any character that isn't [a-z0-9].
 *   3. Truncate to 30 characters.
 */
export function normalizeConditionDescription(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
}
```

- [ ] **Step 4: Run the test, see it pass**

```bash
pnpm --filter @twin/api exec vitest run test/normalize.test.ts
pnpm --filter @twin/api build
```

Expected: 9 cases pass (the 9-tuple `it.each`) plus 2 invariant tests = 11 passing. Build clean.

- [ ] **Step 5: Update the reducer to import the helper**

Find the existing collision detector in `packages/core/src/reduce.ts`. The current code (around line 110-114) is approximately:

```typescript
// Dedup: skip if a similar condition already exists (normalize + first 30 chars)
const normDesc = action.condition.description.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
const isDupe = l0.conditions.some((existing) => {
  const normExisting = existing.description.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
  return normDesc === normExisting || (normDesc.length > 10 && normExisting.includes(normDesc.slice(0, 20)));
});
```

Note: the helper covers the first `.toLowerCase().replace(...).slice(0,30)` chain. The fuzzy substring check (`normDesc.length > 10 && normExisting.includes(...)`) is reducer-specific behavior NOT covered by the helper — it stays inline in the reducer. The helper extraction only DRYs the normalization step.

`@twin/core` cannot import from `@twin/api`. The helper lives in `@twin/api`. To share, we need to relocate the helper to `@twin/core` and re-export from the api-side path. Adjust:

1. Move the helper file: create `packages/core/src/normalize-condition-description.ts` with the same content as Step 3.
2. Export it from `packages/core/src/index.ts` (add `export { normalizeConditionDescription } from "./normalize-condition-description.js";` to the existing index re-exports — find the file and append).
3. Replace `packages/api/src/services/predict-conditions/normalize.ts` with a single re-export line:

```typescript
// Re-export the shared normalizer from @twin/core for ergonomic imports
// inside the predict-conditions module. Single source of truth lives in
// @twin/core because the reducer also depends on it.
export { normalizeConditionDescription } from "@twin/core";
```

4. Update the reducer (`packages/core/src/reduce.ts`) — change the inline `normDesc` and `normExisting` constructions to use the helper:

```typescript
import { normalizeConditionDescription } from "./normalize-condition-description.js";
// ... (existing imports unchanged) ...

// In the AddCondition case:
const normDesc = normalizeConditionDescription(action.condition.description);
const isDupe = l0.conditions.some((existing) => {
  const normExisting = normalizeConditionDescription(existing.description);
  return normDesc === normExisting || (normDesc.length > 10 && normExisting.includes(normDesc.slice(0, 20)));
});
```

- [ ] **Step 6: Build @twin/core and run regression tests**

```bash
pnpm --filter @twin/core build
pnpm --filter @twin/core test
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/normalize.test.ts test/predict-conditions-service.test.ts
```

Expected: core tests still green (the helper's behavior is identical to the prior inline algorithm). API tests still green (the existing PC v1 collision-detection test in `predict-conditions-service.test.ts` is the cross-check that the reducer still works).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/normalize-condition-description.ts \
        packages/core/src/index.ts \
        packages/core/src/reduce.ts \
        packages/api/src/services/predict-conditions/normalize.ts \
        packages/api/test/normalize.test.ts
git commit -m "refactor(core,api): extract normalizeConditionDescription shared helper

Per PC v2 spec §3.3: the reducer's AddCondition collision detector and the
forthcoming pre-underwriter orchestrator's dedup-key construction must use
identical normalization. Extracting to one function eliminates the 'must
match' duplicate-logic invariant.

Helper lives in @twin/core (packages/core/src/normalize-condition-description.ts)
because the reducer is the canonical consumer; the api side re-exports for
import ergonomics inside the predict-conditions module.

Algorithm preserved verbatim from the reducer (lowercase, strip non-alphanumeric,
truncate to 30 chars). 11 corpus + invariant tests assert parity."
```

---

## Task 2: Migration 019 — schema for PC v2

**Phase:** A · **Files:** `packages/api/src/db/migrations/019-pc-v2-pre-underwriter.sql` (new)

**Rationale:** Spec §4.1. Widens `predicted_conditions.source_list` CHECK, adds source-rule provenance columns and `emission_kind` column, adds index for traceback queries. Backward-compatible: existing rows get NULL provenance + `'deterministic'` emission_kind by default.

- [ ] **Step 1: Write the migration SQL**

Create `packages/api/src/db/migrations/019-pc-v2-pre-underwriter.sql`:

```sql
-- 019-pc-v2-pre-underwriter.sql
--
-- PC v2 Pre-Underwriter Validation (spec 2026-05-14). Extends
-- predicted_conditions to support findings from matrix, requirements,
-- and geographic resolvers (in addition to PC v1's minimum/income from
-- the doc-checklist).
--
-- CROSS-MIGRATION DEPENDENCIES: predicted_conditions owned by migration
-- 018; this migration extends its source_list CHECK and adds three columns
-- + one index. Backward-compatible for existing rows (NULL provenance +
-- 'deterministic' emission_kind by default).

-- ── 1. Widen source_list CHECK ──────────────────────────────────────────
-- PC v1's CHECK admitted only ('minimum','income'). PC v2 adds three.
ALTER TABLE predicted_conditions
  DROP CONSTRAINT IF EXISTS predicted_conditions_source_list_check;
ALTER TABLE predicted_conditions
  ADD CONSTRAINT predicted_conditions_source_list_check
  CHECK (source_list IN ('minimum', 'income', 'matrix', 'requirements', 'geographic'));

-- ── 2. Source-rule provenance ───────────────────────────────────────────
-- NULL for PC v1 rows (minimum/income don't carry rule-level provenance —
-- the doc-checklist resolver returns DocItems, not rule references).
-- Populated for matrix/requirements/geographic findings.
ALTER TABLE predicted_conditions
  ADD COLUMN IF NOT EXISTS source_rule_table TEXT
    CHECK (source_rule_table IS NULL OR source_rule_table IN
           ('program_matrix_tiers', 'program_requirements', 'geographic_restrictions'));
ALTER TABLE predicted_conditions
  ADD COLUMN IF NOT EXISTS source_rule_id UUID;

-- ── 3. Emission provenance ─────────────────────────────────────────────
-- Distinguishes deterministic resolver output from LLM-backstop output.
-- Required for audit, cost tracking, and the §5.4 dedup-ladder R3 property
-- ("Stage A always wins over Stage B with semantically-similar descriptions").
ALTER TABLE predicted_conditions
  ADD COLUMN IF NOT EXISTS emission_kind TEXT NOT NULL DEFAULT 'deterministic'
    CHECK (emission_kind IN ('deterministic', 'llm'));

-- ── 4. Provenance index for traceback queries ──────────────────────────
-- Supports "show me all predictions emitted from this matrix tier" lookups
-- for spec/operator debugging.
CREATE INDEX IF NOT EXISTS idx_pc_source_rule
  ON predicted_conditions (tenant_id, source_rule_table, source_rule_id);
```

- [ ] **Step 2: Apply the migration**

```bash
cd packages/api && pnpm exec tsx -e "import('./src/db/migrations.ts').then(m => m.runMigrations()).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })"
```

Expected: `[migrations] Applied 019-pc-v2-pre-underwriter.sql`.

- [ ] **Step 3: Verify schema with a throwaway probe**

Create `packages/api/check-019.mjs` (throwaway — delete before commit):

```javascript
import pg from "pg";
import { readFileSync } from "node:fs";
if (!process.env.DATABASE_URL) {
  const env = readFileSync(new URL("./.env", import.meta.url), "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2];
  }
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
// 1. Check source_list CHECK accepts all five values.
const constraint = await c.query(`
  SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
   WHERE conname = 'predicted_conditions_source_list_check'`);
console.log("source_list CHECK:", constraint.rows[0]?.def);
// 2. Check new columns exist.
const cols = await c.query(`
  SELECT column_name, data_type, column_default
    FROM information_schema.columns
   WHERE table_name = 'predicted_conditions'
     AND column_name IN ('source_rule_table', 'source_rule_id', 'emission_kind')
   ORDER BY column_name`);
console.log("new columns:");
for (const r of cols.rows) console.log(" ", r.column_name, r.data_type, "default:", r.column_default);
// 3. Check the new index exists.
const idx = await c.query(`SELECT indexname FROM pg_indexes WHERE indexname = 'idx_pc_source_rule'`);
console.log("idx_pc_source_rule present:", idx.rows.length === 1);
await c.end();
```

Run from `packages/api/`:

```bash
cd packages/api && node check-019.mjs && rm check-019.mjs
```

Expected output:
```
source_list CHECK: CHECK ((source_list = ANY (ARRAY['minimum'::text, 'income'::text, 'matrix'::text, 'requirements'::text, 'geographic'::text])))
new columns:
  emission_kind text default: 'deterministic'::text
  source_rule_id uuid default: null
  source_rule_table text default: null
idx_pc_source_rule present: true
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/db/migrations/019-pc-v2-pre-underwriter.sql
git commit -m "feat(db): migration 019 — PC v2 source_list widen + provenance columns

Per PC v2 spec §4.1:
  - Widens predicted_conditions.source_list CHECK to admit 'matrix',
    'requirements', and 'geographic' (in addition to PC v1's 'minimum'
    and 'income').
  - Adds source_rule_table TEXT CHECK and source_rule_id UUID for
    per-finding provenance back to the originating program_matrix_tiers /
    program_requirements / geographic_restrictions row.
  - Adds emission_kind TEXT NOT NULL DEFAULT 'deterministic' CHECK
    ('deterministic' | 'llm') so audit/dedup can distinguish LLM-backstop
    output from deterministic resolver output (R3 dedup ladder dependency).
  - Adds idx_pc_source_rule (tenant_id, source_rule_table, source_rule_id)
    for source-rule traceback queries.

Backward-compatible: existing PC v1 rows get NULL source_rule_table /
source_rule_id and emission_kind = 'deterministic' by default."
```

---

## Task 3: Extend `LoanContext` with PC v2 fields + context-builder population

**Phase:** A · **Files:** `packages/api/src/services/doc-requirements.ts` (modify), `packages/api/src/routes/predict-conditions-context-builder.ts` (modify), `packages/api/test/predict-conditions-context-builder.test.ts` (new)

**Rationale:** Spec §4.2. PC v1's LoanContext only carried doc-checklist-relevant fields. PC v2 resolvers need the loan's actual numeric profile (FICO, LTV, loan amount, DTI, reserves, etc.). Fields are optional on the type so existing callers compile unchanged; resolvers that need a field check presence and skip+warn when absent.

- [ ] **Step 1: Write the context-builder test**

Create `packages/api/test/predict-conditions-context-builder.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildLoanContextFromLoan } from "../src/routes/predict-conditions-context-builder.js";
import type { Loan } from "@twin/core";

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: "L-CTX-1",
    tenantId: "00000000-0000-0000-0000-000000000000",
    nqmProgram: "Flex Select",
    qualifyingMethod: "TraditionalDocs",
    borrower: { fullName: "Test", ssnMasked: "x", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "1", city: "LA", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 500000, salesPrice: 500000, appraisedValue: 500000,
      ltv: 75, cltv: 75, hcltv: 75, noteRate: 7.5, term: 360, amortType: "Fixed",
      lienPosition: 1, occupancy: "Primary", isInvestmentProperty: false, piti: 3500,
    },
    qualifying: { housingRatio: 25, totalDti: 42, piPayment: 3000, qualifyingRate: 7.5 },
    qualifyingWorksheet: { method: "TraditionalDocs", derivedMonthlyIncome: 10000 },
    income: { totalMonthlyIncome: 10000 },
    assets: { totalLiquid: 50000, totalRetirement: 100000, reservesMonths: 6 },
    credit: {
      repScore: 720, tradelinesOpen: 3, tradelinesTotal: 5, tradelines: [],
      liabilities: { totalMonthlyPayments: 1000, revolvingBalance: 5000, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 5000 },
    },
    appraisal: {
      appraisalDate: "2026-01-01", appraiserName: "T", appraisalType: "Full", appraisedValue: 500000,
      marketCondition: "Stable", neighborhoodRating: "Average", siteArea: "N/A", grossLivingArea: 2000,
      roomCount: 6, bedroomCount: 3, bathroomCount: 2, garageSpaces: 2, condition: "Average", comparables: [],
    },
    conditions: [], documents: [], decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "t", at: "2026-01-01T00:00:00.000Z" }],
    compliance: { qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false, higherPricedCoveredTransaction: false, stateLicenseRequired: false, stateHighCostTest: "Pass", tridToleranceCure: "None", totalPointsAndFees: 0, pointsAndFeesThreshold: 0, pointsAndFeesPass: true, flags: [] },
    overlay: { programName: "Flex Select", investorName: "T", maxLTV: 100, minFICO: 600, maxDTI: 50, minDSCR: null, minReserves: 0, checks: [] },
    ...overrides,
  };
}

describe("buildLoanContextFromLoan — PC v2 field population", () => {
  it("populates the v2 numeric fields from loan.transaction / credit / qualifying / assets", () => {
    const ctx = buildLoanContextFromLoan(makeLoan());
    expect(ctx.repFico).toBe(720);
    expect(ctx.ltv).toBe(75);
    expect(ctx.loanAmount).toBe(500000);
    expect(ctx.loanPurpose).toBe("Purchase");
    expect(ctx.propertyType).toBe("SFR Det.");
    expect(ctx.dti).toBe(42);
    expect(ctx.reservesMonths).toBe(6);
    expect(ctx.noteRate).toBe(7.5);
  });

  it("preserves PC v1 fields unchanged", () => {
    const ctx = buildLoanContextFromLoan(makeLoan());
    expect(ctx.program).toBe("Flex Select");
    expect(ctx.occupancy).toBe("primary");
    expect(ctx.state).toBe("CA");
    expect(ctx.borrowerType).toBe("W2");
    expect(ctx.citizenship).toBe("US Citizen");
  });

  it("leaves repFico undefined when loan.credit.repScore is null", () => {
    const loan = makeLoan();
    loan.credit = { ...loan.credit, repScore: null };
    const ctx = buildLoanContextFromLoan(loan);
    expect(ctx.repFico).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test, see it fail**

```bash
pnpm --filter @twin/api exec vitest run test/predict-conditions-context-builder.test.ts
```

Expected: 3 failures — the v2 fields don't exist yet on the LoanContext type and the builder doesn't populate them.

- [ ] **Step 3: Extend the LoanContext interface**

Find `packages/api/src/services/doc-requirements.ts`. The current `LoanContext` (around lines 20-31) ends with `program: string;`. Add seven optional fields immediately before the closing brace:

```typescript
export interface LoanContext {
  incomeDocType: string;
  borrowerType: "W2" | "Self-Employed";
  citizenship: "US Citizen" | "Foreign Nationals";
  isItin: boolean;
  llcOrLegalEntity: boolean;
  occupancy: "primary" | "second_home" | "investment";
  state: string;
  county: string;
  usCredit: boolean;
  program: string;
  // ── PC v2 additions (optional; resolvers skip+warn when absent) ──
  repFico?: number;
  ltv?: number;
  loanAmount?: number;
  loanPurpose?: "Purchase" | "Rate & Term Refinance" | "Cash-Out Refinance";
  propertyType?: string;
  dti?: number;
  reservesMonths?: number;
  noteRate?: number;
}
```

- [ ] **Step 4: Update the context builder to populate v2 fields**

In `packages/api/src/routes/predict-conditions-context-builder.ts`, find the existing `buildLoanContextFromLoan` function. It currently returns an object with PC v1 fields only. Extend the return:

```typescript
import type { Loan } from "@twin/core";
import type { LoanContext } from "../services/doc-requirements.js";

export function buildLoanContextFromLoan(loan: Loan): LoanContext {
  const borrowerType = loan.qualifyingMethod === "TraditionalDocs" ? "W2" : "Self-Employed";
  const citizenship = "US Citizen";
  const incomeDocType =
    loan.qualifyingMethod === "TraditionalDocs"
      ? "Full Doc"
      : loan.qualifyingMethod === "BankStatementDeposits"
        ? "Bank Stmts: 12 Mo. Personal"
        : loan.qualifyingMethod === "DSCRCoverage"
          ? "DSCR / No Ratio DSCR"
          : "Full Doc";
  const occupancy: "primary" | "second_home" | "investment" =
    loan.transaction.occupancy === "Primary"
      ? "primary"
      : loan.transaction.occupancy === "Second"
        ? "second_home"
        : "investment";
  // Map Loan.transaction.loanPurpose (Loan-domain literal) to LoanContext's
  // narrower PC v2 union. Unrecognized values fall through to undefined so
  // resolvers skip+warn rather than emit findings against a phantom purpose.
  const loanPurpose: LoanContext["loanPurpose"] =
    loan.transaction.loanPurpose === "Purchase"
      ? "Purchase"
      : loan.transaction.loanPurpose === "Rate & Term Refinance"
        ? "Rate & Term Refinance"
        : loan.transaction.loanPurpose === "Cash-Out Refinance"
          ? "Cash-Out Refinance"
          : undefined;
  return {
    // ── PC v1 fields (unchanged) ──
    incomeDocType,
    borrowerType,
    citizenship,
    isItin: false,
    llcOrLegalEntity: false,
    occupancy,
    state: loan.property.state,
    county: "",
    usCredit: true,
    program: loan.nqmProgram,
    // ── PC v2 additions ──
    repFico: loan.credit.repScore ?? undefined,
    ltv: loan.transaction.ltv,
    loanAmount: loan.transaction.loanAmount,
    loanPurpose,
    propertyType: loan.property.propertyType,
    dti: loan.qualifying.totalDti,
    reservesMonths: loan.assets.reservesMonths,
    noteRate: loan.transaction.noteRate,
  };
}
```

- [ ] **Step 5: Run the test, see it pass**

```bash
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/predict-conditions-context-builder.test.ts
```

Expected: 3/3 pass. Build clean.

- [ ] **Step 6: Run the full PC service regression to confirm no PC v1 break**

```bash
pnpm --filter @twin/api exec vitest run test/predict-conditions-service.test.ts test/predict-conditions.integration.test.ts
```

Expected: all existing tests still pass (24 service + 2 integration = 26).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/doc-requirements.ts \
        packages/api/src/routes/predict-conditions-context-builder.ts \
        packages/api/test/predict-conditions-context-builder.test.ts
git commit -m "feat(api): LoanContext v2 fields + context-builder population

Per PC v2 spec §4.2: extend LoanContext with seven optional numeric
fields (repFico, ltv, loanAmount, loanPurpose, propertyType, dti,
reservesMonths, noteRate) for matrix/requirements/geographic resolvers
to evaluate against.

Fields are optional so existing PC v1 callers compile unchanged.
Resolvers that need a field check presence and skip+warn when absent
(spec §6.4 Risk #4 mitigation).

buildLoanContextFromLoan now maps from loan.transaction.* (ltv, loanAmount,
loanPurpose, noteRate), loan.credit.repScore, loan.qualifying.totalDti,
loan.assets.reservesMonths, loan.property.propertyType. loanPurpose is
narrowed to the three-value union the resolvers need; unrecognized
Loan-domain values fall through to undefined so resolvers skip rather
than emit findings against a phantom purpose.

3 context-builder tests pass. PC v1 service tests (24) + HTTP integration
(2) unaffected."
```

---

## Task 4: `KbVersionContext` + orchestrator skeleton + dedup ladder

**Phase:** A · **Files:** `packages/api/src/services/predict-conditions/pre-underwriter.ts` (new), `packages/api/test/pre-underwriter-orchestrator.test.ts` (new)

**Rationale:** Spec §3.2 + §5.4. The orchestrator is built first as the dedup-ladder + resolver-composition framework. It wraps only the existing doc-checklist resolver (no new resolvers yet — those plug in during Phases B/C/D). This locks the architecture before the intelligence layers on.

- [ ] **Step 1: Write the orchestrator unit tests**

Create `packages/api/test/pre-underwriter-orchestrator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { dedupFindings, type Finding } from "../src/services/predict-conditions/pre-underwriter.js";

function f(overrides: Partial<Finding> & { description: string; sourceList: Finding["sourceList"] }): Finding {
  return {
    note: null,
    category: "PTD",
    sourceRuleTable: null,
    sourceRuleId: null,
    emissionKind: "deterministic",
    ...overrides,
  };
}

describe("dedupFindings — cross-resolver priority ladder (spec §5.4)", () => {
  it("preserves single non-duplicate findings unchanged", () => {
    const input: Finding[] = [
      f({ description: "Doc A", sourceList: "minimum" }),
      f({ description: "Doc B", sourceList: "income" }),
      f({ description: "Doc C", sourceList: "matrix" }),
    ];
    const out = dedupFindings(input);
    expect(out).toHaveLength(3);
    expect(out.map(x => x.description)).toEqual(["Doc A", "Doc B", "Doc C"]);
  });

  it("collapses semantically-equal findings to the lower-priority sourceList (minimum > income > matrix > geographic > requirements)", () => {
    const input: Finding[] = [
      f({ description: "Same Doc", sourceList: "matrix", sourceRuleTable: "program_matrix_tiers", sourceRuleId: "rule-1" }),
      f({ description: "same DOC", sourceList: "minimum" }),  // normalizes equal
    ];
    const out = dedupFindings(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceList).toBe("minimum");
  });

  it("R3 — Stage A (deterministic) beats Stage B (LLM) within sourceList='requirements'", () => {
    const input: Finding[] = [
      f({
        description: "Reserves shortfall",
        sourceList: "requirements",
        emissionKind: "llm",
        sourceRuleTable: "program_requirements",
        sourceRuleId: "rule-llm",
      }),
      f({
        description: "Reserves shortfall",
        sourceList: "requirements",
        emissionKind: "deterministic",
        sourceRuleTable: "program_requirements",
        sourceRuleId: "rule-det",
      }),
    ];
    const out = dedupFindings(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.emissionKind).toBe("deterministic");
    expect(out[0]!.sourceRuleId).toBe("rule-det");
  });

  it("processes sources in the documented order (minimum, income, matrix, geographic, requirements-det, requirements-llm)", () => {
    // All findings normalize identically — only one survives. The survivor
    // tells us which step in the order won.
    const input: Finding[] = [
      f({ description: "X", sourceList: "requirements", emissionKind: "llm",            sourceRuleTable: "program_requirements", sourceRuleId: "r-llm" }),
      f({ description: "X", sourceList: "requirements", emissionKind: "deterministic",  sourceRuleTable: "program_requirements", sourceRuleId: "r-det" }),
      f({ description: "X", sourceList: "geographic",                                   sourceRuleTable: "geographic_restrictions", sourceRuleId: "g-1" }),
      f({ description: "X", sourceList: "matrix",                                       sourceRuleTable: "program_matrix_tiers", sourceRuleId: "m-1" }),
      f({ description: "X", sourceList: "income" }),
      f({ description: "X", sourceList: "minimum" }),
    ];
    const out = dedupFindings(input);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceList).toBe("minimum");
  });
});
```

- [ ] **Step 2: Run tests, see them fail**

```bash
pnpm --filter @twin/api exec vitest run test/pre-underwriter-orchestrator.test.ts
```

Expected: failures — module doesn't exist yet.

- [ ] **Step 3: Implement the orchestrator skeleton + dedup**

Create `packages/api/src/services/predict-conditions/pre-underwriter.ts`:

```typescript
// Pre-Underwriter orchestrator. Composes the doc-checklist resolver (PC v1)
// and the three new PC v2 resolvers (matrix, geographic, requirements),
// aggregates their findings, dedups by normalized description with a
// documented cross-resolver priority ladder, and returns the consolidated
// Finding[] for the service layer to emit as predicted_conditions rows.
//
// See spec docs/superpowers/specs/2026-05-14-pc-v2-pre-underwriter-design.md.

import type pg from "pg";
import { normalizeConditionDescription } from "@twin/core";

export interface KbVersionContext {
  /** kb_versions.id — used for predicted_conditions.kb_version_id FK. */
  readonly rowId: number;
  /** kb_versions.version — used for program_matrix_tiers.kb_version,
   *  program_requirements.kb_version, geographic_restrictions.kb_version lookups. */
  readonly versionNumber: number;
}

export interface Finding {
  description: string;
  note: string | null;
  category: "PTA" | "PTD" | "PTF" | "PTP";
  sourceList: "minimum" | "income" | "matrix" | "requirements" | "geographic";
  sourceRuleTable: "program_matrix_tiers" | "program_requirements" | "geographic_restrictions" | null;
  sourceRuleId: string | null;
  emissionKind: "deterministic" | "llm";
}

/**
 * Spec §5.4 priority ladder. Lower value = higher priority = survives
 * dedup. Within sourceList='requirements', Stage A (deterministic) is
 * processed before Stage B (llm) by the orchestrator so a deterministic
 * finding always wins over a semantically-similar LLM finding (R3).
 */
const PRIORITY: Record<Finding["sourceList"], number> = {
  minimum: 1,
  income: 2,
  matrix: 3,
  geographic: 4,
  requirements: 5,
};

/**
 * Within sourceList='requirements', deterministic findings come first
 * (sub-priority 0); LLM findings come last (sub-priority 1). For all
 * other sourceLists, all findings are deterministic so this doesn't
 * matter.
 */
function subPriority(f: Finding): number {
  if (f.sourceList === "requirements" && f.emissionKind === "llm") return 1;
  return 0;
}

/**
 * Dedup the merged findings from all resolvers. Returns survivors in
 * processing order (lower priority first), with stable index inside each
 * (sourceList, subPriority) bucket preserved.
 */
export function dedupFindings(findings: readonly Finding[]): Finding[] {
  // Build a stable processing order: by (priority, subPriority, original-index).
  // Then walk in order, inserting into a Map keyed by normalized description.
  // First insert wins (later inserts at the same key are dropped).
  const indexed = findings.map((f, idx) => ({ f, idx }));
  indexed.sort((a, b) => {
    const pa = PRIORITY[a.f.sourceList];
    const pb = PRIORITY[b.f.sourceList];
    if (pa !== pb) return pa - pb;
    const sa = subPriority(a.f);
    const sb = subPriority(b.f);
    if (sa !== sb) return sa - sb;
    return a.idx - b.idx;
  });

  const seen = new Map<string, Finding>();
  for (const { f } of indexed) {
    const key = `${f.sourceList}::${normalizeConditionDescription(f.description)}`;
    // Also try cross-sourceList dedup: a finding in 'matrix' that normalizes
    // to the same description as one already accepted from 'minimum' should
    // be dropped (matrix loses).
    const crossKey = normalizeConditionDescription(f.description);
    let isDuplicate = false;
    for (const [existingKey] of seen) {
      if (existingKey.endsWith(`::${crossKey}`)) {
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) {
      console.warn("[pre-underwriter] dedup dropped finding", {
        description: f.description,
        sourceList: f.sourceList,
        emissionKind: f.emissionKind,
      });
      continue;
    }
    seen.set(key, f);
  }
  return Array.from(seen.values());
}

/**
 * Stub for runPreUnderwriter — wired in Task 5 once the resolvers ship.
 * For now it's an internal placeholder so the orchestrator module exists
 * and the dedup helper is exported and tested.
 */
export async function runPreUnderwriter(
  _c: pg.PoolClient,
  _tenantId: string,
  _kbCtx: KbVersionContext,
  _findings: readonly Finding[],
): Promise<Finding[]> {
  // Phase A: identity wrap — return the input findings deduped. Phases
  // B/C/D will compose actual resolver calls into this function.
  return dedupFindings(_findings);
}
```

- [ ] **Step 4: Run tests, see them pass**

```bash
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/pre-underwriter-orchestrator.test.ts
```

Expected: 4/4 pass. Build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/predict-conditions/pre-underwriter.ts \
        packages/api/test/pre-underwriter-orchestrator.test.ts
git commit -m "feat(api/services): pre-underwriter orchestrator skeleton + dedup ladder

Per PC v2 spec §3.2 + §5.4. Establishes the architecture before the
intelligence layers on (Phases B/C/D plug resolver calls into this
orchestrator).

  - KbVersionContext typed context: { rowId, versionNumber } — disambiguates
    kb_versions.id (predicted_conditions FK) from kb_versions.version
    (matrix/requirements/geographic lookups). Compile-time prevents the
    fresh-tenant id==version foot-gun (spec R2).
  - Finding interface: shared shape for all four resolvers' outputs.
  - dedupFindings(findings): processes in the documented 6-step order
    (minimum → income → matrix → geographic → requirements-det →
    requirements-llm). First insertion into the dedup map wins; later
    inserts at the same normalized-description key are dropped with
    console.warn. R3 property: within sourceList='requirements',
    deterministic findings always win over semantically-similar LLM
    findings.

Uses normalizeConditionDescription from @twin/core (Task 1) for the
dedup key, so the orchestrator's normalization is bit-exact identical
to the reducer's AddCondition collision detector.

Four unit tests verify: no-op for non-duplicates, cross-sourceList
priority, R3 Stage-A-wins, full 6-step ordering."
```

---

## Task 5: Wire orchestrator into `service.ts run()`

**Phase:** A · **Files:** `packages/api/src/services/predict-conditions/service.ts` (modify), `packages/api/test/predict-conditions-service.test.ts` (modify)

**Rationale:** Spec §3. PC v1's `run()` calls `resolveRequiredDocs` directly. Switch it to call `runPreUnderwriter` with the doc-checklist findings adapted to `Finding` shape. No new resolvers are called yet — but the call site is now extensible. Existing 24 service tests continue to pass because the orchestrator is an identity wrap over the doc-checklist resolver in Phase A.

- [ ] **Step 1: Read the current resolver-call block in service.ts**

The current `run()` (around line 113-122 in `packages/api/src/services/predict-conditions/service.ts`) does:

```typescript
const result = await resolveRequiredDocs(tenantId, null, loan);
docs = {
  minimum: result.minimum,
  income: result.income,
  resolvedIncomeType: result.resolvedIncomeType,
  kbVersionId: result.kbVersionId,
};
```

And the `items` array (around line 169-178) is:

```typescript
const items: Array<{ list: "minimum" | "income"; doc: DocItem }> = [
  ...docs.minimum.map((d) => ({ list: "minimum" as const, doc: d })),
  ...docs.income.map((d) => ({ list: "income" as const, doc: d })),
];
```

The INSERT inside the items-loop binds `source_list` from `list` and other PC v1 fields.

- [ ] **Step 2: Adapt the resolver result into Finding[] and route through the orchestrator**

In `service.ts`, after the `docs = { ... }` assignment but before the items-loop, add:

```typescript
// Phase A: adapt doc-checklist output to Finding[] and route through the
// orchestrator. Phases B/C/D will append matrix/geographic/requirements
// findings here before the dedup pass.
const { runPreUnderwriter, type Finding, type KbVersionContext } = await import("./pre-underwriter.js");

const docChecklistFindings: Finding[] = [
  ...docs.minimum.map((d) => ({
    description: d.name,
    note: d.note,
    category: categoryInference(d) as "PTA" | "PTD" | "PTF" | "PTP",
    sourceList: "minimum" as const,
    sourceRuleTable: null,
    sourceRuleId: null,
    emissionKind: "deterministic" as const,
  })),
  ...docs.income.map((d) => ({
    description: d.name,
    note: d.note,
    category: categoryInference(d) as "PTA" | "PTD" | "PTF" | "PTP",
    sourceList: "income" as const,
    sourceRuleTable: null,
    sourceRuleId: null,
    emissionKind: "deterministic" as const,
  })),
];

// Resolve KbVersionContext once. activeKbId was looked up earlier in run().
// Fetch the version number to pair with it.
const { rows: kbVersionRows } = await c.query<{ version: number }>(
  `SELECT version FROM kb_versions WHERE id = $1 AND tenant_id = $2`,
  [docs.kbVersionId, tenantId],
);
const kbCtx: KbVersionContext = {
  rowId: docs.kbVersionId,
  versionNumber: kbVersionRows[0]?.version ?? 0,
};

const findings = await runPreUnderwriter(c, tenantId, kbCtx, docChecklistFindings);
```

Then replace the existing items-loop with a Finding-aware loop. Find the items-loop (currently iterates `items`) and replace it with:

```typescript
// Skip already-acted predictions (Codex round-4 fix preserved).
const { rows: actedRows } = await c.query<{ source_list: string; description: string }>(
  `SELECT source_list, description
     FROM predicted_conditions
    WHERE tenant_id = $1 AND loan_id = $2 AND status IN ('accepted', 'dismissed')`,
  [tenantId, loanId],
);
const actedKeys = new Set(actedRows.map((r) => `${r.source_list}::${r.description}`));

let skippedActed = 0;
let insertedCount = 0;
for (let idx = 0; idx < findings.length; idx++) {
  const finding = findings[idx]!;
  if (actedKeys.has(`${finding.sourceList}::${finding.description}`)) {
    skippedActed++;
    continue;
  }
  await c.query(
    `INSERT INTO predicted_conditions
       (tenant_id, loan_id, prediction_run_id, source_input_hash, predicted_by,
        kb_version_id, resolved_income_type, category, description, note,
        source_list, source_order, status,
        source_rule_table, source_rule_id, emission_kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13, $14, $15)`,
    [
      tenantId, loanId, runId, sourceInputHash, source,
      docs.kbVersionId, docs.resolvedIncomeType,
      finding.category, finding.description, finding.note,
      finding.sourceList, idx,
      finding.sourceRuleTable, finding.sourceRuleId, finding.emissionKind,
    ],
  );
  insertedCount++;
}
```

(The auto-clear-alerts block, the run audit-log insert, and the return statement below this loop remain unchanged.)

- [ ] **Step 3: Update the run audit metadata to include the new by_source breakdown**

Find the run audit-log insert (around line 240 in service.ts). Replace its metadata JSON.stringify body with:

```typescript
JSON.stringify({
  run_id: runId,
  source,
  kb_version_id: docs.kbVersionId,
  outcome: "predictions_emitted",
  count: insertedCount,
  skipped_acted: skippedActed,
  reused: false,
  by_source: {
    minimum: findings.filter((f) => f.sourceList === "minimum").length,
    income: findings.filter((f) => f.sourceList === "income").length,
    matrix: findings.filter((f) => f.sourceList === "matrix").length,
    requirements_deterministic: findings.filter((f) => f.sourceList === "requirements" && f.emissionKind === "deterministic").length,
    requirements_llm: findings.filter((f) => f.sourceList === "requirements" && f.emissionKind === "llm").length,
    geographic: findings.filter((f) => f.sourceList === "geographic").length,
  },
}),
```

- [ ] **Step 4: Build + run service tests**

```bash
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/predict-conditions-service.test.ts test/predict-conditions.integration.test.ts test/pre-underwriter-orchestrator.test.ts
```

Expected: all existing tests (24 service + 2 integration) continue to pass. The 4 orchestrator tests still pass. Build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/predict-conditions/service.ts
git commit -m "feat(api/services): service.ts run() delegates to pre-underwriter orchestrator

Per PC v2 spec §3. Phase A wiring — service.ts's run() now:
  1. Calls resolveRequiredDocs (PC v1 doc-checklist) as before.
  2. Adapts the minimum + income DocItems to Finding[] (Phase A
     identity adapter).
  3. Looks up the kb_versions.version number to pair with the row id
     (KbVersionContext disambiguation).
  4. Routes the Finding[] through runPreUnderwriter (currently an
     identity wrap; Phases B/C/D will append matrix/geographic/
     requirements findings into the input list).
  5. Iterates the deduped Finding[] to INSERT predicted_conditions rows,
     populating the new source_rule_table / source_rule_id / emission_kind
     columns (migration 019).
  6. Records per-resolver counts in the run audit metadata's by_source
     object.

The HTTP routes, advisory locks, withStoreSnapshot wrap, idempotency
hash, and Codex round-4 already-acted skip path all remain unchanged.
Architecture is extensible without surgery on the surface.

Existing 24 service tests + 2 HTTP integration tests pass."
```

---

## Task 6: Matrix resolver (4 deterministic checks)

**Phase:** B · **Files:** `packages/api/src/services/predict-conditions/resolvers/matrix-resolver.ts` (new), `packages/api/test/matrix-resolver.test.ts` (new)

**Rationale:** Spec §5.1. Four checks against `program_matrix_tiers`: no-matching-tier, loan-amount-exceeds-max, LTV-exceeds-cap, property-type-not-allowed. Each emits a finding with `sourceList='matrix'`, `sourceRuleTable='program_matrix_tiers'`, `category='PTA'`. Field-availability guard per spec §6.4 Risk #4.

- [ ] **Step 1: Write the unit tests**

Create `packages/api/test/matrix-resolver.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { resolveMatrixFindings } from "../src/services/predict-conditions/resolvers/matrix-resolver.js";
import type { LoanContext } from "../src/services/doc-requirements.js";
import type { KbVersionContext } from "../src/services/predict-conditions/pre-underwriter.js";

function mockClient(rows: Array<Record<string, unknown>>): { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const KB: KbVersionContext = { rowId: 1, versionNumber: 1 };
const T = "00000000-0000-0000-0000-000000000000";

function baseLoan(overrides: Partial<LoanContext> = {}): LoanContext {
  return {
    incomeDocType: "Full Doc",
    borrowerType: "W2",
    citizenship: "US Citizen",
    isItin: false,
    llcOrLegalEntity: false,
    occupancy: "primary",
    state: "CA",
    county: "",
    usCredit: true,
    program: "Flex Select",
    repFico: 720,
    ltv: 75,
    loanAmount: 500000,
    loanPurpose: "Purchase",
    propertyType: "SFR Det.",
    dti: 42,
    reservesMonths: 6,
    noteRate: 7.5,
    ...overrides,
  };
}

describe("resolveMatrixFindings (spec §5.1)", () => {
  it("returns no findings when the loan fits the matrix tier exactly", async () => {
    const c = mockClient([{
      id: "tier-1", max_loan_amount: 1000000, max_ltv_purchase: 80,
      max_ltv_cashout: 75, max_ltv_rate_term: 80, property_types: ["SFR Det.", "Condo"],
    }]);
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan());
    expect(out).toEqual([]);
  });

  it("emits a no-matching-tier finding when no tier covers the FICO band", async () => {
    const c = mockClient([]);
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan({ repFico: 580 }));
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceList).toBe("matrix");
    expect(out[0]!.category).toBe("PTA");
    expect(out[0]!.description).toMatch(/FICO 580 outside published matrix tiers/);
    expect(out[0]!.sourceRuleTable).toBe("program_matrix_tiers");
  });

  it("emits a loan-amount-exceeds-max finding", async () => {
    const c = mockClient([{
      id: "tier-1", max_loan_amount: 300000, max_ltv_purchase: 80,
      max_ltv_cashout: 75, max_ltv_rate_term: 80, property_types: ["SFR Det."],
    }]);
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan({ loanAmount: 500000 }));
    expect(out.some(f => f.description.includes("exceeds tier max"))).toBe(true);
    expect(out.find(f => f.description.includes("exceeds tier max"))!.sourceRuleId).toBe("tier-1");
  });

  it("emits an LTV-exceeds-cap finding using max_ltv_purchase for Purchase loans", async () => {
    const c = mockClient([{
      id: "tier-1", max_loan_amount: 1000000, max_ltv_purchase: 70,
      max_ltv_cashout: 65, max_ltv_rate_term: 75, property_types: ["SFR Det."],
    }]);
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan({ ltv: 85, loanPurpose: "Purchase" }));
    const ltvFinding = out.find(f => f.description.includes("LTV 85% exceeds"));
    expect(ltvFinding).toBeDefined();
    expect(ltvFinding!.description).toMatch(/70%/);
  });

  it("emits a property-type-not-allowed finding when propertyType isn't in tier's allowed list", async () => {
    const c = mockClient([{
      id: "tier-1", max_loan_amount: 1000000, max_ltv_purchase: 80,
      max_ltv_cashout: 75, max_ltv_rate_term: 80, property_types: ["SFR Det.", "Condo"],
    }]);
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan({ propertyType: "Manufactured" }));
    expect(out.some(f => f.description.includes("Property-type exception"))).toBe(true);
  });

  it("returns no findings when repFico is undefined (graceful degradation per §6.4 Risk #4)", async () => {
    const c = mockClient([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan({ repFico: undefined }));
    expect(out).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[matrix-resolver]"), expect.objectContaining({ missingField: "repFico" }));
    warn.mockRestore();
  });

  it("returns no findings when ltv is undefined", async () => {
    const c = mockClient([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await resolveMatrixFindings(c as never, T, KB, baseLoan({ ltv: undefined }));
    expect(out).toEqual([]);
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run tests, see them fail**

```bash
pnpm --filter @twin/api exec vitest run test/matrix-resolver.test.ts
```

Expected: 7 failures — module doesn't exist.

- [ ] **Step 3: Implement the resolver**

Create `packages/api/src/services/predict-conditions/resolvers/matrix-resolver.ts`:

```typescript
import type pg from "pg";
import type { LoanContext } from "../../doc-requirements.js";
import type { Finding, KbVersionContext } from "../pre-underwriter.js";

interface MatrixTierRow {
  id: string;
  max_loan_amount: number | null;
  max_ltv_purchase: number | null;
  max_ltv_cashout: number | null;
  max_ltv_rate_term: number | null;
  property_types: string[] | null;
}

function ltvCapColumnFor(purpose: LoanContext["loanPurpose"]): keyof Pick<MatrixTierRow, "max_ltv_purchase" | "max_ltv_cashout" | "max_ltv_rate_term"> | null {
  if (purpose === "Purchase") return "max_ltv_purchase";
  if (purpose === "Cash-Out Refinance") return "max_ltv_cashout";
  if (purpose === "Rate & Term Refinance") return "max_ltv_rate_term";
  return null;
}

/**
 * Resolver: program_matrix_tiers — eligibility checks against the
 * program × occupancy × FICO band matrix. Emits findings as predicted
 * conditions per spec §5.1.
 *
 * Graceful degradation: any required v2 LoanContext field that is
 * undefined causes the resolver to return [] for that check (or all
 * checks if the field is needed for the tier lookup itself) and emit
 * a console.warn capturing the missing field. See spec §6.4 Risk #4.
 */
export async function resolveMatrixFindings(
  c: pg.PoolClient,
  tenantId: string,
  kbCtx: KbVersionContext,
  loan: LoanContext,
): Promise<Finding[]> {
  // The tier lookup needs repFico and occupancy and program. If repFico is
  // missing we can't even find the tier — skip with warn.
  if (loan.repFico === undefined) {
    console.warn("[matrix-resolver] skipped — missing field", { missingField: "repFico" });
    return [];
  }
  const findings: Finding[] = [];

  const { rows } = await c.query<MatrixTierRow>(
    `SELECT id, max_loan_amount, max_ltv_purchase, max_ltv_cashout, max_ltv_rate_term, property_types
       FROM program_matrix_tiers
      WHERE tenant_id = $1 AND kb_version = $2
        AND program = $3 AND occupancy = $4
        AND $5 BETWEEN min_fico AND max_fico
      LIMIT 1`,
    [tenantId, kbCtx.versionNumber, loan.program, loan.occupancy, loan.repFico],
  );

  // Check 1: no matching tier
  if (rows.length === 0) {
    findings.push({
      description: `Manual underwriter review required — FICO ${loan.repFico} outside published matrix tiers for ${loan.program} / ${loan.occupancy}`,
      note: null,
      category: "PTA",
      sourceList: "matrix",
      sourceRuleTable: "program_matrix_tiers",
      sourceRuleId: "",  // no tier matched; surface as a synthetic finding
      emissionKind: "deterministic",
    });
    return findings;
  }

  const tier = rows[0]!;

  // Check 2: loan amount exceeds tier max
  if (loan.loanAmount !== undefined && tier.max_loan_amount !== null && loan.loanAmount > tier.max_loan_amount) {
    findings.push({
      description: `Program-change request or exception documentation — loan amount $${loan.loanAmount.toLocaleString()} exceeds tier max $${tier.max_loan_amount.toLocaleString()}`,
      note: null,
      category: "PTA",
      sourceList: "matrix",
      sourceRuleTable: "program_matrix_tiers",
      sourceRuleId: tier.id,
      emissionKind: "deterministic",
    });
  } else if (loan.loanAmount === undefined) {
    console.warn("[matrix-resolver] skipped loan-amount check — missing field", { missingField: "loanAmount" });
  }

  // Check 3: LTV exceeds tier cap (purpose-selected column)
  const ltvColumn = ltvCapColumnFor(loan.loanPurpose);
  if (loan.ltv !== undefined && ltvColumn !== null) {
    const cap = tier[ltvColumn];
    if (cap !== null && loan.ltv > cap) {
      findings.push({
        description: `Mortgage insurance binder + MI disclosures — LTV ${loan.ltv}% exceeds tier max ${cap}% for ${loan.loanPurpose}`,
        note: null,
        category: "PTA",
        sourceList: "matrix",
        sourceRuleTable: "program_matrix_tiers",
        sourceRuleId: tier.id,
        emissionKind: "deterministic",
      });
    }
  } else if (loan.ltv === undefined) {
    console.warn("[matrix-resolver] skipped LTV check — missing field", { missingField: "ltv" });
  } else if (ltvColumn === null) {
    console.warn("[matrix-resolver] skipped LTV check — missing field", { missingField: "loanPurpose" });
  }

  // Check 4: property type not in tier's allowed list
  if (loan.propertyType !== undefined && tier.property_types !== null && tier.property_types.length > 0) {
    if (!tier.property_types.includes(loan.propertyType)) {
      findings.push({
        description: `Property-type exception documentation — ${loan.propertyType} not in tier's allowed list (${tier.property_types.join(", ")})`,
        note: null,
        category: "PTA",
        sourceList: "matrix",
        sourceRuleTable: "program_matrix_tiers",
        sourceRuleId: tier.id,
        emissionKind: "deterministic",
      });
    }
  } else if (loan.propertyType === undefined) {
    console.warn("[matrix-resolver] skipped property-type check — missing field", { missingField: "propertyType" });
  }

  return findings;
}
```

- [ ] **Step 4: Run tests, see them pass**

```bash
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/matrix-resolver.test.ts
```

Expected: 7/7 pass. Build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/predict-conditions/resolvers/matrix-resolver.ts \
        packages/api/test/matrix-resolver.test.ts
git commit -m "feat(api/services): matrix-resolver — 4 deterministic eligibility checks

Per PC v2 spec §5.1. Queries program_matrix_tiers by (tenant, kb_version_number,
program, occupancy, FICO band) and emits findings for the four published
checks:

  1. No matching tier (FICO outside all bands for this program+occupancy)
     → 'Manual underwriter review required' (PTA).
  2. Loan amount exceeds tier.max_loan_amount → program-change /
     exception-doc finding (PTA).
  3. LTV exceeds tier.max_ltv_<purpose> (column selected by loan.loanPurpose)
     → MI binder + disclosures finding (PTA).
  4. propertyType not in tier.property_types[] → property-type exception
     finding (PTA).

Graceful degradation per §6.4 Risk #4: missing v2 fields cause the
relevant check to skip with a structured console.warn (no false-positive
findings). 7 unit tests cover all four checks plus the field-absence
guards for repFico/ltv/loanPurpose/loanAmount/propertyType."
```

---

## Task 7: Geographic resolver

**Phase:** B · **Files:** `packages/api/src/services/predict-conditions/resolvers/geographic-resolver.ts` (new), `packages/api/test/geographic-resolver.test.ts` (new)

**Rationale:** Spec §5.2. Filter `geographic_restrictions` by state + program-applies + occupancy-applies. Emit one finding per applying row.

- [ ] **Step 1: Write the tests**

Create `packages/api/test/geographic-resolver.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { resolveGeographicFindings } from "../src/services/predict-conditions/resolvers/geographic-resolver.js";
import type { LoanContext } from "../src/services/doc-requirements.js";
import type { KbVersionContext } from "../src/services/predict-conditions/pre-underwriter.js";

function mockClient(rows: Array<Record<string, unknown>>) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const KB: KbVersionContext = { rowId: 1, versionNumber: 1 };
const T = "00000000-0000-0000-0000-000000000000";

function baseLoan(overrides: Partial<LoanContext> = {}): LoanContext {
  return {
    incomeDocType: "Full Doc", borrowerType: "W2", citizenship: "US Citizen",
    isItin: false, llcOrLegalEntity: false, occupancy: "primary",
    state: "CA", county: "", usCredit: true, program: "Flex Select",
    ...overrides,
  };
}

describe("resolveGeographicFindings (spec §5.2)", () => {
  it("returns no findings when there are no rows for the state", async () => {
    const c = mockClient([]);
    const out = await resolveGeographicFindings(c as never, T, KB, baseLoan());
    expect(out).toEqual([]);
  });

  it("emits one finding per row that applies (no program/occupancy filter)", async () => {
    const c = mockClient([
      { id: "g-1", restriction: "Disclosure A", occupancy_affected: null, programs_affected: null, notes: null },
      { id: "g-2", restriction: "Disclosure B", occupancy_affected: null, programs_affected: null, notes: "see manual" },
    ]);
    const out = await resolveGeographicFindings(c as never, T, KB, baseLoan());
    expect(out).toHaveLength(2);
    expect(out[0]!.sourceList).toBe("geographic");
    expect(out[0]!.category).toBe("PTF");
    expect(out[0]!.description).toContain("CA-specific compliance documentation");
    expect(out[0]!.description).toContain("Disclosure A");
    expect(out[1]!.note).toBe("see manual");
  });

  it("skips a row whose programs_affected excludes the loan's program", async () => {
    const c = mockClient([
      { id: "g-1", restriction: "Flex-only disclosure", occupancy_affected: null, programs_affected: ["Flex Supreme"], notes: null },
    ]);
    const out = await resolveGeographicFindings(c as never, T, KB, baseLoan({ program: "Flex Select" }));
    expect(out).toEqual([]);
  });

  it("includes a row whose programs_affected contains the loan's program", async () => {
    const c = mockClient([
      { id: "g-1", restriction: "Flex-only disclosure", occupancy_affected: null, programs_affected: ["Flex Select", "Flex Supreme"], notes: null },
    ]);
    const out = await resolveGeographicFindings(c as never, T, KB, baseLoan({ program: "Flex Select" }));
    expect(out).toHaveLength(1);
  });

  it("skips a row whose occupancy_affected differs from the loan's occupancy", async () => {
    const c = mockClient([
      { id: "g-1", restriction: "Investment-only", occupancy_affected: "investment", programs_affected: null, notes: null },
    ]);
    const out = await resolveGeographicFindings(c as never, T, KB, baseLoan({ occupancy: "primary" }));
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, see them fail**

```bash
pnpm --filter @twin/api exec vitest run test/geographic-resolver.test.ts
```

- [ ] **Step 3: Implement**

Create `packages/api/src/services/predict-conditions/resolvers/geographic-resolver.ts`:

```typescript
import type pg from "pg";
import type { LoanContext } from "../../doc-requirements.js";
import type { Finding, KbVersionContext } from "../pre-underwriter.js";

interface GeographicRestrictionRow {
  id: string;
  restriction: string;
  occupancy_affected: string | null;
  programs_affected: string[] | null;
  notes: string | null;
}

/**
 * Resolver: geographic_restrictions — state-level rules per spec §5.2.
 * Returns one Finding per applying row. A row "applies" when:
 *   - state matches (already covered by the WHERE clause), AND
 *   - programs_affected is null OR contains the loan's program, AND
 *   - occupancy_affected is null OR equals the loan's occupancy.
 *
 * No graceful-degradation guards: state, program, and occupancy are PC v1
 * LoanContext fields and always present.
 */
export async function resolveGeographicFindings(
  c: pg.PoolClient,
  tenantId: string,
  kbCtx: KbVersionContext,
  loan: LoanContext,
): Promise<Finding[]> {
  const { rows } = await c.query<GeographicRestrictionRow>(
    `SELECT id, restriction, occupancy_affected, programs_affected, notes
       FROM geographic_restrictions
      WHERE tenant_id = $1 AND kb_version = $2 AND state = $3`,
    [tenantId, kbCtx.versionNumber, loan.state],
  );

  const findings: Finding[] = [];
  for (const row of rows) {
    const programOk = row.programs_affected === null || row.programs_affected.includes(loan.program);
    const occupancyOk = row.occupancy_affected === null || row.occupancy_affected === loan.occupancy;
    if (!programOk || !occupancyOk) continue;
    findings.push({
      description: `${loan.state}-specific compliance documentation — ${row.restriction}`,
      note: row.notes,
      category: "PTF",
      sourceList: "geographic",
      sourceRuleTable: "geographic_restrictions",
      sourceRuleId: row.id,
      emissionKind: "deterministic",
    });
  }
  return findings;
}
```

- [ ] **Step 4: Run, see them pass**

```bash
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/geographic-resolver.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/predict-conditions/resolvers/geographic-resolver.ts \
        packages/api/test/geographic-resolver.test.ts
git commit -m "feat(api/services): geographic-resolver — state-level compliance findings

Per PC v2 spec §5.2. Queries geographic_restrictions by (tenant,
kb_version_number, state) and emits one finding per row that applies.

A row applies when:
  - programs_affected is null OR contains the loan's program, AND
  - occupancy_affected is null OR equals the loan's occupancy.

Findings carry sourceList='geographic', category='PTF' (recording /
disclosure documents), and sourceRuleId = the matching row's UUID.

Five unit tests cover empty results, no-filter applicability, program
filter inclusion + exclusion, and occupancy filter exclusion."
```

---

## Task 8: Wire matrix + geographic into orchestrator + integration test

**Phase:** B · **Files:** `packages/api/src/services/predict-conditions/pre-underwriter.ts` (modify), `packages/api/test/pre-underwriter-orchestrator.test.ts` (modify), `packages/api/test/predict-conditions-service.test.ts` (modify)

**Rationale:** Connect the two new deterministic resolvers into the orchestrator. After this task, the orchestrator's `runPreUnderwriter` actually calls matrix and geographic resolvers and merges their findings with the doc-checklist input.

- [ ] **Step 1: Update the orchestrator to call the two new resolvers**

Replace the `runPreUnderwriter` stub in `packages/api/src/services/predict-conditions/pre-underwriter.ts` (current body just returns `dedupFindings(_findings)`) with:

```typescript
import type pg from "pg";
import { normalizeConditionDescription } from "@twin/core";
import type { LoanContext } from "../doc-requirements.js";
import { resolveMatrixFindings } from "./resolvers/matrix-resolver.js";
import { resolveGeographicFindings } from "./resolvers/geographic-resolver.js";

// ... (KbVersionContext, Finding, PRIORITY, subPriority, dedupFindings all unchanged) ...

/**
 * Orchestrator. Takes the doc-checklist findings (PC v1 output, adapted
 * to Finding[] by the service layer) and appends matrix + geographic
 * findings (Phase B; requirements lands in Phase C/D). Returns the
 * deduped, priority-ordered Finding[] for the service layer to emit
 * as predicted_conditions rows.
 */
export async function runPreUnderwriter(
  c: pg.PoolClient,
  tenantId: string,
  kbCtx: KbVersionContext,
  docChecklistFindings: readonly Finding[],
  loan: LoanContext,
): Promise<Finding[]> {
  const matrixFindings = await resolveMatrixFindings(c, tenantId, kbCtx, loan);
  const geoFindings = await resolveGeographicFindings(c, tenantId, kbCtx, loan);
  return dedupFindings([
    ...docChecklistFindings,
    ...matrixFindings,
    ...geoFindings,
  ]);
}
```

Note: the orchestrator's signature now takes `loan: LoanContext`, not just findings. Update the call site in `service.ts`:

```typescript
const findings = await runPreUnderwriter(c, tenantId, kbCtx, docChecklistFindings, loan);
```

- [ ] **Step 2: Build + run the existing orchestrator tests (they should still pass)**

```bash
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/pre-underwriter-orchestrator.test.ts test/matrix-resolver.test.ts test/geographic-resolver.test.ts
```

Expected: 4 + 7 + 5 = 16 pass.

- [ ] **Step 3: Add an integration test that exercises matrix + geographic against real Supabase**

Append to `packages/api/test/predict-conditions-service.test.ts`. The existing `T`, `withDb`, `seedActiveKbWithMinimalResolver`, `seedResolverHappyPath`, and `cleanupAll` helpers are reused; add a new helper to seed matrix + geographic rows:

```typescript
async function seedMatrixAndGeoFor(kbId: number, kbVersion: number): Promise<void> {
  await withTenantTx(T, async (c) => {
    // One matrix tier covering FICO 700-740, Flex Select / primary, with a
    // strict $300K max so a $500K loan triggers the loan-amount finding.
    await c.query(
      `INSERT INTO program_matrix_tiers
         (tenant_id, kb_version, program, occupancy, min_fico, max_fico,
          max_loan_amount, max_ltv_purchase, max_ltv_cashout, max_ltv_rate_term,
          property_types, source_doc_hash, extraction_run_id)
       VALUES ($1, $2, 'Flex Select', 'primary', 700, 740,
               300000, 80, 75, 80, ARRAY['SFR Det.'], 'hash', '00000000-0000-0000-0000-000000000099')
       ON CONFLICT DO NOTHING`,
      [T, kbVersion],
    );
    // One geographic restriction for CA that always applies (no filters).
    await c.query(
      `INSERT INTO geographic_restrictions
         (tenant_id, kb_version, state, restriction, source_doc_hash, extraction_run_id)
       VALUES ($1, $2, 'CA', 'Per-Diem Interest Disclosure', 'hash', '00000000-0000-0000-0000-000000000099')
       ON CONFLICT DO NOTHING`,
      [T, kbVersion],
    );
  });
}
```

Then add a test in the existing service describe block (or a new one):

```typescript
describe("predict-conditions service — pre-underwriter Phase B (matrix + geographic)", () => {
  it("emits matrix + geographic findings alongside doc-checklist for an over-cap loan", async () => {
    const kbId = await seedActiveKbWithMinimalResolver();
    await seedResolverHappyPath(kbId);
    // kbVersion was set to MAX(version)+1 inside the helper; re-query.
    const { rows: kbRow } = await withDb((c) =>
      c.query<{ version: number }>(`SELECT version FROM kb_versions WHERE id = $1`, [kbId]),
    );
    await seedMatrixAndGeoFor(kbId, kbRow[0]!.version);

    // Run with a loanContext whose ltv/loanAmount trip multiple checks.
    const loanCtx = loanContextFullDocW2();
    loanCtx.repFico = 720;
    loanCtx.ltv = 85;
    loanCtx.loanAmount = 500000;
    loanCtx.loanPurpose = "Purchase";
    loanCtx.propertyType = "SFR Det.";

    await run(T, "L-PHASE-B", loanCtx, "system:loan-ingest");

    const rows = await withDb((c) =>
      c.query<{ source_list: string; description: string; source_rule_table: string | null; emission_kind: string }>(
        `SELECT source_list, description, source_rule_table, emission_kind
           FROM predicted_conditions
          WHERE tenant_id = $1 AND loan_id = $2
          ORDER BY source_list, source_order`,
        [T, "L-PHASE-B"],
      ),
    );
    const bySource = new Map<string, typeof rows.rows>();
    for (const r of rows.rows) {
      if (!bySource.has(r.source_list)) bySource.set(r.source_list, []);
      bySource.get(r.source_list)!.push(r);
    }
    expect(bySource.get("minimum")!.length).toBeGreaterThan(0);     // PC v1 still works
    expect(bySource.get("matrix")!.length).toBeGreaterThan(0);      // PC v2 matrix fires
    expect(bySource.get("geographic")!.length).toBeGreaterThan(0);  // PC v2 geo fires
    // Matrix findings carry source-rule provenance.
    expect(bySource.get("matrix")![0]!.source_rule_table).toBe("program_matrix_tiers");
    // All deterministic at this phase.
    expect(rows.rows.every(r => r.emission_kind === "deterministic")).toBe(true);
  });
});
```

- [ ] **Step 4: Update cleanupAll to also purge matrix + geographic rows for the test tenant**

Find `cleanupAll` in `predict-conditions-service.test.ts` (around line 145). Add two DELETE statements before the existing kb_versions delete:

```typescript
    await c.query(`DELETE FROM program_matrix_tiers      WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM geographic_restrictions   WHERE tenant_id = $1`, [T]);
```

- [ ] **Step 5: Build + run**

```bash
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/predict-conditions-service.test.ts test/pre-underwriter-orchestrator.test.ts test/matrix-resolver.test.ts test/geographic-resolver.test.ts
```

Expected: 25 (service) + 4 (orchestrator) + 7 (matrix) + 5 (geo) = 41 pass.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/predict-conditions/pre-underwriter.ts \
        packages/api/src/services/predict-conditions/service.ts \
        packages/api/test/predict-conditions-service.test.ts
git commit -m "feat(api/services): wire matrix + geographic resolvers into pre-underwriter

Per PC v2 spec §3 + §5.4. runPreUnderwriter now composes:
  1. Doc-checklist findings (PC v1, passed in adapted form by service.ts)
  2. Matrix findings (Phase B, this commit)
  3. Geographic findings (Phase B, this commit)

All three are merged + deduped through the §5.4 priority ladder. Requirements
will plug in at Phase C/D.

Service-layer signature widens to pass LoanContext into the orchestrator
(matrix + geographic need it). The existing PC v1 idempotency hash already
covers the v2 LoanContext fields (spec §4.3); no hash-shape change needed.

One new integration test seeds a strict matrix tier + a CA geographic
restriction, runs an over-cap loan, asserts predicted_conditions has
rows in minimum, matrix, and geographic sourceLists with correct
source_rule_table provenance and emission_kind='deterministic'."
```

---

## Task 9: Requirements resolver — deterministic core (7 handlers)

**Phase:** C · **Files:** `packages/api/src/services/predict-conditions/resolvers/requirements-resolver.ts` (new), `packages/api/test/requirements-resolver.test.ts` (new)

**Rationale:** Spec §5.3 Stage A. Seven handlers dispatched by `requirement_key`: DTI Max, FICO Min, Reserves Min, Loan Amounts, Interest Only, Exceptions, Loan Purpose. Each is a pure function returning 0..n findings; a "couldn't parse" return collects the row into the LLM backstop bucket (Phase D wires that bucket).

- [ ] **Step 1: Write the per-handler tests**

Create `packages/api/test/requirements-resolver.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleRequirement } from "../src/services/predict-conditions/resolvers/requirements-resolver.js";
import type { LoanContext } from "../src/services/doc-requirements.js";

function loan(overrides: Partial<LoanContext> = {}): LoanContext {
  return {
    incomeDocType: "Full Doc", borrowerType: "W2", citizenship: "US Citizen",
    isItin: false, llcOrLegalEntity: false, occupancy: "primary",
    state: "CA", county: "", usCredit: true, program: "Flex Select",
    repFico: 720, ltv: 75, loanAmount: 500000, loanPurpose: "Purchase",
    propertyType: "SFR Det.", dti: 42, reservesMonths: 6, noteRate: 7.5,
    ...overrides,
  };
}

const RULE_ID = "00000000-0000-0000-0000-000000001234";

describe("handleRequirement — DTI Max", () => {
  it("fires when loan.dti exceeds parsed cap", () => {
    const out = handleRequirement(loan({ dti: 55 }),
      { id: RULE_ID, requirement_key: "DTI Max", requirement_value: "50%" });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.description).toMatch(/DTI 55%.*exceeds program max 50%/);
    expect(out.unhandled).toBe(false);
  });
  it("does not fire when loan.dti is within cap", () => {
    const out = handleRequirement(loan({ dti: 42 }),
      { id: RULE_ID, requirement_key: "DTI Max", requirement_value: "50%" });
    expect(out.findings).toEqual([]);
    expect(out.unhandled).toBe(false);
  });
  it("falls to backstop when value is unparseable", () => {
    const out = handleRequirement(loan(),
      { id: RULE_ID, requirement_key: "DTI Max", requirement_value: "case by case" });
    expect(out.unhandled).toBe(true);
  });
});

describe("handleRequirement — FICO Min", () => {
  it("fires when loan.repFico is below parsed min", () => {
    const out = handleRequirement(loan({ repFico: 600 }),
      { id: RULE_ID, requirement_key: "FICO Min", requirement_value: "660" });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.description).toMatch(/FICO 600.*below program min 660/);
  });
  it("does not fire when loan.repFico is at or above min", () => {
    const out = handleRequirement(loan({ repFico: 720 }),
      { id: RULE_ID, requirement_key: "FICO Min", requirement_value: "660" });
    expect(out.findings).toEqual([]);
  });
});

describe("handleRequirement — Reserves Min", () => {
  it("fires when reservesMonths is below parsed min", () => {
    const out = handleRequirement(loan({ reservesMonths: 3 }),
      { id: RULE_ID, requirement_key: "Reserves Min", requirement_value: "6 months" });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.category).toBe("PTD");
  });
  it("does not fire when reserves are sufficient", () => {
    const out = handleRequirement(loan({ reservesMonths: 12 }),
      { id: RULE_ID, requirement_key: "Reserves Min", requirement_value: "6 months" });
    expect(out.findings).toEqual([]);
  });
});

describe("handleRequirement — Loan Amounts", () => {
  it("fires when loan.loanAmount is below parsed minimum", () => {
    const out = handleRequirement(loan({ loanAmount: 50000 }),
      { id: RULE_ID, requirement_key: "Loan Amounts", requirement_value: "Minimum $100,000 and Max $3,000,000" });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.description).toMatch(/outside program range/);
  });
  it("fires when loan.loanAmount is above parsed max", () => {
    const out = handleRequirement(loan({ loanAmount: 4000000 }),
      { id: RULE_ID, requirement_key: "Loan Amounts", requirement_value: "Minimum $100,000 and Max $3,000,000" });
    expect(out.findings).toHaveLength(1);
  });
  it("falls to backstop when value has no parseable min/max", () => {
    const out = handleRequirement(loan(),
      { id: RULE_ID, requirement_key: "Loan Amounts", requirement_value: "see attached supplement" });
    expect(out.unhandled).toBe(true);
  });
});

describe("handleRequirement — Exceptions / Loan Purpose / Interest Only", () => {
  it("Exceptions=Ineligible always fires a UW-review finding", () => {
    const out = handleRequirement(loan(),
      { id: RULE_ID, requirement_key: "Exceptions", requirement_value: "Ineligible" });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.description).toMatch(/does not permit exceptions/);
  });
  it("Loan Purpose: fires when loan.loanPurpose isn't in the permitted prose", () => {
    const out = handleRequirement(loan({ loanPurpose: "Cash-Out Refinance" }),
      { id: RULE_ID, requirement_key: "Loan Purpose", requirement_value: "Purchase, Rate & Term Refinance" });
    expect(out.findings).toHaveLength(1);
  });
  it("Loan Purpose: does not fire when purpose appears in prose", () => {
    const out = handleRequirement(loan({ loanPurpose: "Purchase" }),
      { id: RULE_ID, requirement_key: "Loan Purpose", requirement_value: "Purchase, Rate & Term Refinance and Cash-Out" });
    expect(out.findings).toEqual([]);
  });
});

describe("handleRequirement — unknown key", () => {
  it("returns unhandled for any requirement_key not in the dispatch table", () => {
    const out = handleRequirement(loan(),
      { id: RULE_ID, requirement_key: "Some Future Rule", requirement_value: "anything" });
    expect(out.unhandled).toBe(true);
  });
});

describe("handleRequirement — graceful degradation on missing v2 fields", () => {
  it("DTI Max returns no findings + warn when loan.dti is undefined", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = handleRequirement(loan({ dti: undefined }),
      { id: RULE_ID, requirement_key: "DTI Max", requirement_value: "50%" });
    expect(out.findings).toEqual([]);
    expect(out.unhandled).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[requirements-resolver]"), expect.objectContaining({ missingField: "dti" }));
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run, see failures**

```bash
pnpm --filter @twin/api exec vitest run test/requirements-resolver.test.ts
```

- [ ] **Step 3: Implement the deterministic core**

Create `packages/api/src/services/predict-conditions/resolvers/requirements-resolver.ts`:

```typescript
import type pg from "pg";
import type { LoanContext } from "../../doc-requirements.js";
import type { Finding, KbVersionContext } from "../pre-underwriter.js";

export interface RequirementRow {
  id: string;
  requirement_key: string;
  requirement_value: string | Record<string, unknown>;
}

export interface HandlerResult {
  findings: Finding[];
  /** True if the deterministic handler couldn't parse the value; the
   *  orchestrator routes the row into the LLM backstop bucket. */
  unhandled: boolean;
}

function reqValueString(v: RequirementRow["requirement_value"]): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Parse the first integer in a string (e.g. "50%" → 50, "6 months" → 6). */
function firstInt(s: string): number | null {
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1]!, 10) : null;
}

/** Parse "Minimum $X and Max $Y" into a [min, max] pair. */
function parseLoanAmountsRange(s: string): { min: number; max: number } | null {
  const min = s.match(/Min(?:imum)?\s*\$([\d,]+)/i);
  const max = s.match(/Max(?:imum)?\s*\$([\d,]+)/i);
  if (!min || !max) return null;
  return {
    min: parseInt(min[1]!.replace(/,/g, ""), 10),
    max: parseInt(max[1]!.replace(/,/g, ""), 10),
  };
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString()}`;
}

function mkFinding(rule: RequirementRow, description: string, category: Finding["category"]): Finding {
  return {
    description,
    note: reqValueString(rule.requirement_value).slice(0, 200),
    category,
    sourceList: "requirements",
    sourceRuleTable: "program_requirements",
    sourceRuleId: rule.id,
    emissionKind: "deterministic",
  };
}

/**
 * Per-row handler dispatch. Pure function (no I/O). Returns 0..n findings
 * plus an `unhandled` flag the orchestrator uses to collect rows for the
 * LLM backstop.
 */
export function handleRequirement(loan: LoanContext, rule: RequirementRow): HandlerResult {
  const value = reqValueString(rule.requirement_value);
  switch (rule.requirement_key) {
    case "DTI Max": {
      if (loan.dti === undefined) {
        console.warn("[requirements-resolver] skipped — missing field", { missingField: "dti", ruleId: rule.id });
        return { findings: [], unhandled: false };
      }
      const cap = firstInt(value);
      if (cap === null) return { findings: [], unhandled: true };
      if (loan.dti > cap) {
        return { findings: [mkFinding(rule, `DTI ${loan.dti}% exceeds program max ${cap}% — alternate-income documentation or exception request`, "PTA")], unhandled: false };
      }
      return { findings: [], unhandled: false };
    }
    case "FICO Min": {
      if (loan.repFico === undefined) {
        console.warn("[requirements-resolver] skipped — missing field", { missingField: "repFico", ruleId: rule.id });
        return { findings: [], unhandled: false };
      }
      const min = firstInt(value);
      if (min === null) return { findings: [], unhandled: true };
      if (loan.repFico < min) {
        return { findings: [mkFinding(rule, `FICO ${loan.repFico} below program min ${min} — credit-supplement docs or exception request`, "PTA")], unhandled: false };
      }
      return { findings: [], unhandled: false };
    }
    case "Reserves Min": {
      if (loan.reservesMonths === undefined) {
        console.warn("[requirements-resolver] skipped — missing field", { missingField: "reservesMonths", ruleId: rule.id });
        return { findings: [], unhandled: false };
      }
      const min = firstInt(value);
      if (min === null) return { findings: [], unhandled: true };
      if (loan.reservesMonths < min) {
        return { findings: [mkFinding(rule, `Reserves ${loan.reservesMonths} months below program min ${min} — additional reserves documentation`, "PTD")], unhandled: false };
      }
      return { findings: [], unhandled: false };
    }
    case "Loan Amounts": {
      if (loan.loanAmount === undefined) {
        console.warn("[requirements-resolver] skipped — missing field", { missingField: "loanAmount", ruleId: rule.id });
        return { findings: [], unhandled: false };
      }
      const range = parseLoanAmountsRange(value);
      if (range === null) return { findings: [], unhandled: true };
      if (loan.loanAmount < range.min || loan.loanAmount > range.max) {
        return { findings: [mkFinding(rule, `Loan amount ${fmtUsd(loan.loanAmount)} outside program range ${fmtUsd(range.min)}–${fmtUsd(range.max)} — program-change request`, "PTA")], unhandled: false };
      }
      return { findings: [], unhandled: false };
    }
    case "Interest Only": {
      // The Loan-domain amortType isn't directly on LoanContext; we approximate
      // via a deterministic check on the value string. If the value is
      // "Ineligible" and the rule fires, the operator manually verifies whether
      // the loan is IO. Conservative — emit only on the unambiguous "Ineligible"
      // signal; anything else falls to backstop.
      if (value.trim() === "Ineligible") {
        return { findings: [mkFinding(rule, `Interest-only may not be permitted by program — confirm amortization type or seek exception`, "PTA")], unhandled: false };
      }
      return { findings: [], unhandled: true };
    }
    case "Exceptions": {
      if (value.trim() === "Ineligible") {
        return { findings: [mkFinding(rule, `Program does not permit exceptions — UW review required for any deviation`, "PTA")], unhandled: false };
      }
      return { findings: [], unhandled: false };
    }
    case "Loan Purpose": {
      if (loan.loanPurpose === undefined) {
        console.warn("[requirements-resolver] skipped — missing field", { missingField: "loanPurpose", ruleId: rule.id });
        return { findings: [], unhandled: false };
      }
      const hay = value.toLowerCase();
      if (!hay.includes(loan.loanPurpose.toLowerCase())) {
        return { findings: [mkFinding(rule, `Loan purpose '${loan.loanPurpose}' not in program's permitted list (${value}) — program-change request`, "PTA")], unhandled: false };
      }
      return { findings: [], unhandled: false };
    }
    default:
      return { findings: [], unhandled: true };
  }
}

/**
 * Resolver: program_requirements — deterministic Stage A. Loads all rows
 * for the (tenant, kb_version_number, program) tuple and dispatches each
 * to handleRequirement. Returns deterministic findings and the set of
 * unhandled rows for Phase D's LLM backstop.
 */
export async function resolveRequirementFindings(
  c: pg.PoolClient,
  tenantId: string,
  kbCtx: KbVersionContext,
  loan: LoanContext,
): Promise<{ findings: Finding[]; unhandledRows: RequirementRow[] }> {
  const { rows } = await c.query<RequirementRow>(
    `SELECT id, requirement_key, requirement_value
       FROM program_requirements
      WHERE tenant_id = $1 AND kb_version = $2 AND program = $3`,
    [tenantId, kbCtx.versionNumber, loan.program],
  );

  const findings: Finding[] = [];
  const unhandledRows: RequirementRow[] = [];
  for (const row of rows) {
    const result = handleRequirement(loan, row);
    findings.push(...result.findings);
    if (result.unhandled) unhandledRows.push(row);
  }
  return { findings, unhandledRows };
}
```

- [ ] **Step 4: Run, see pass**

```bash
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/requirements-resolver.test.ts
```

Expected: 14 tests pass (3 DTI + 2 FICO + 2 Reserves + 3 Loan Amounts + 3 Exceptions/Loan Purpose + 1 Unknown + 1 Graceful = 15; actual count depends on the it() vs it.each() split — match the file).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/predict-conditions/resolvers/requirements-resolver.ts \
        packages/api/test/requirements-resolver.test.ts
git commit -m "feat(api/services): requirements-resolver — deterministic Stage A (7 handlers)

Per PC v2 spec §5.3 Stage A. Seven handlers dispatched on requirement_key:
  - DTI Max: parse %, fire when loan.dti > cap.
  - FICO Min: parse int, fire when loan.repFico < min.
  - Reserves Min: parse int, fire when loan.reservesMonths < min.
  - Loan Amounts: parse 'Min \$X and Max \$Y', fire when out of range.
  - Interest Only: fire when value=='Ineligible'.
  - Exceptions: fire when value=='Ineligible' (generic UW-review finding).
  - Loan Purpose: case-insensitive substring check on the prose.

Each handler is a pure function (no I/O) returning { findings, unhandled }.
Unhandled rows accumulate in the resolver's return tuple for Phase D's
LLM backstop to consume.

Graceful degradation: each handler that needs a v2 LoanContext field
checks presence and returns findings=[], unhandled=false (NOT routed to
backstop — the field is missing, not the rule unparseable) with a
structured console.warn. Spec §6.4 Risk #4.

15 unit tests across the 7 handlers + unknown-key + graceful-degradation."
```

---

## Task 10: Wire requirements (Stage A only) into orchestrator + integration

**Phase:** C · **Files:** `packages/api/src/services/predict-conditions/pre-underwriter.ts` (modify), `packages/api/test/predict-conditions-service.test.ts` (modify)

**Rationale:** Connect the requirements resolver (deterministic only — Stage B / LLM lands in Task 11). The orchestrator now calls four resolvers; unhandledRows from requirements is collected but ignored (Phase D will use it).

- [ ] **Step 1: Update the orchestrator**

In `packages/api/src/services/predict-conditions/pre-underwriter.ts`, update `runPreUnderwriter`:

```typescript
import { resolveRequirementFindings } from "./resolvers/requirements-resolver.js";
// ... (existing imports unchanged) ...

export async function runPreUnderwriter(
  c: pg.PoolClient,
  tenantId: string,
  kbCtx: KbVersionContext,
  docChecklistFindings: readonly Finding[],
  loan: LoanContext,
): Promise<Finding[]> {
  const matrixFindings = await resolveMatrixFindings(c, tenantId, kbCtx, loan);
  const geoFindings = await resolveGeographicFindings(c, tenantId, kbCtx, loan);
  const { findings: reqFindings, unhandledRows: _unhandledForBackstop } =
    await resolveRequirementFindings(c, tenantId, kbCtx, loan);
  // _unhandledForBackstop is wired into the LLM backstop in Task 11. Until
  // then it's collected and discarded; coverage of the long-tail program_
  // requirements rows is deterministic-only.
  return dedupFindings([
    ...docChecklistFindings,
    ...matrixFindings,
    ...geoFindings,
    ...reqFindings,
  ]);
}
```

- [ ] **Step 2: Add an integration test seeding a program_requirements row that fires**

Add to `predict-conditions-service.test.ts`. Append a helper:

```typescript
async function seedRequirementsFor(_kbId: number, kbVersion: number, program: string, rows: Array<{ key: string; value: string }>): Promise<void> {
  await withTenantTx(T, async (c) => {
    for (const r of rows) {
      await c.query(
        `INSERT INTO program_requirements
           (tenant_id, kb_version, program, category, requirement_key, requirement_value,
            source_doc_hash, extraction_run_id)
         VALUES ($1, $2, $3, 'general', $4, $5::jsonb, 'hash', '00000000-0000-0000-0000-000000000099')
         ON CONFLICT DO NOTHING`,
        [T, kbVersion, program, r.key, JSON.stringify(r.value)],
      );
    }
  });
}
```

Add to cleanupAll: `await c.query(`DELETE FROM program_requirements WHERE tenant_id = $1`, [T]);`

Add a test:

```typescript
describe("predict-conditions service — pre-underwriter Phase C (requirements deterministic)", () => {
  it("emits a requirements finding when DTI Max is violated", async () => {
    const kbId = await seedActiveKbWithMinimalResolver();
    await seedResolverHappyPath(kbId);
    const { rows: kbRow } = await withDb((c) =>
      c.query<{ version: number }>(`SELECT version FROM kb_versions WHERE id = $1`, [kbId]),
    );
    await seedRequirementsFor(kbId, kbRow[0]!.version, "Flex Select", [
      { key: "DTI Max", value: "45%" },
    ]);

    const loanCtx = loanContextFullDocW2();
    loanCtx.dti = 55;

    await run(T, "L-PHASE-C", loanCtx, "system:loan-ingest");

    const rows = await withDb((c) =>
      c.query<{ source_list: string; description: string; source_rule_table: string | null }>(
        `SELECT source_list, description, source_rule_table FROM predicted_conditions
          WHERE tenant_id = $1 AND loan_id = $2 AND source_list = 'requirements'`,
        [T, "L-PHASE-C"],
      ),
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows[0]!.description).toMatch(/DTI 55%.*exceeds program max 45%/);
    expect(rows.rows[0]!.source_rule_table).toBe("program_requirements");
  });
});
```

- [ ] **Step 3: Build + run**

```bash
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/predict-conditions-service.test.ts test/pre-underwriter-orchestrator.test.ts test/matrix-resolver.test.ts test/geographic-resolver.test.ts test/requirements-resolver.test.ts
```

Expected: all tests pass; service test count grows by 1.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/services/predict-conditions/pre-underwriter.ts \
        packages/api/test/predict-conditions-service.test.ts
git commit -m "feat(api/services): wire requirements-resolver Stage A into pre-underwriter

Per PC v2 spec §5.3 Stage A. runPreUnderwriter now calls all four
resolvers — doc-checklist (PC v1), matrix, geographic, and requirements
(deterministic only, Stage B/LLM in Task 11).

unhandledRows from the requirements resolver is collected into a local
constant and discarded; coverage of the long-tail program_requirements
rows is deterministic-only until the LLM backstop ships. The variable is
named _unhandledForBackstop so the wiring intent is documented.

One new integration test seeds a DTI Max rule and asserts the requirements
finding lands with sourceList='requirements', source_rule_table=
'program_requirements'."
```

---

## Task 11: LLM backstop — Anthropic client + tool schema + 5-step validation pipeline

**Phase:** D · **Files:** `packages/api/src/services/predict-conditions/llm/requirements-backstop.ts` (new), `packages/api/test/requirements-llm-backstop.test.ts` (new)

**Rationale:** Spec §5.3 Stage B. The LLM evaluator with prompt caching + PII redaction + compliance pre-checks (reusing learning/insight-generator.ts patterns) and the 5-step post-call validation pipeline. Each validation step is independently unit-testable per the reviewer's implementation-time note.

- [ ] **Step 1: Write the tests (mock the Anthropic SDK)**

Create `packages/api/test/requirements-llm-backstop.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic SDK before importing the backstop module.
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: mockCreate };
    constructor() {}
  },
}));

// Mock the redactor + compliance-checker.
vi.mock("../src/learning/pii-redactor.js", () => ({
  redactSamples: (s: unknown[]) => ({ redacted: s, manifests: [] }),
}));
vi.mock("../src/learning/compliance-checker.js", () => ({
  runComplianceChecks: () => ({ ok: true, blockers: [] }),
  determineVisibility: () => "tenant",
}));

import { requirementsLlmBackstop } from "../src/services/predict-conditions/llm/requirements-backstop.js";
import type { RequirementRow } from "../src/services/predict-conditions/resolvers/requirements-resolver.js";
import type { LoanContext } from "../src/services/doc-requirements.js";

function toolUseResponse(findings: unknown[]) {
  return {
    content: [{ type: "tool_use", name: "emit_predictions", input: { findings } }],
    usage: { input_tokens: 100, output_tokens: 50 },
    model: "claude-haiku-4-5",
  };
}

const baseLoan: LoanContext = {
  incomeDocType: "Full Doc", borrowerType: "W2", citizenship: "US Citizen",
  isItin: false, llcOrLegalEntity: false, occupancy: "primary",
  state: "CA", county: "", usCredit: true, program: "Flex Select",
  repFico: 720, ltv: 75, loanAmount: 500000, loanPurpose: "Purchase",
};

const bucketRow: RequirementRow = {
  id: "00000000-0000-0000-0000-0000000000aa",
  requirement_key: "Future Rule",
  requirement_value: "Borrower must provide CPA-signed P&L statement when self-employed",
};

describe("requirementsLlmBackstop — post-call validation pipeline (spec §5.3 Stage B)", () => {
  beforeEach(() => mockCreate.mockReset());

  it("returns empty findings when ANTHROPIC_API_KEY is absent", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toEqual([]);
    expect(out.skipReason).toBe("no_api_key");
    process.env.ANTHROPIC_API_KEY = prev;
  });

  it("step 1 — schema: drops findings missing required fields", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(toolUseResponse([
      { description: "x", source_rule_id: bucketRow.id, category: "PTA", rationale: "y" },  // missing confidence
    ]));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toEqual([]);
    expect(out.dropCounters.schema).toBe(1);
  });

  it("step 2 — source-rule existence: drops findings with hallucinated UUIDs", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(toolUseResponse([
      { description: "CPA-signed P&L statement required", source_rule_id: "00000000-0000-0000-0000-deadbeefdead", category: "PTA", rationale: "borrower self-employed; rule requires CPA-signed P&L", confidence: 0.9 },
    ]));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toEqual([]);
    expect(out.dropCounters.hallucinatedId).toBe(1);
  });

  it("step 3 — confidence floor: drops findings below 0.7", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(toolUseResponse([
      { description: "CPA-signed P&L statement required", source_rule_id: bucketRow.id, category: "PTA", rationale: "y", confidence: 0.5 },
    ]));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toEqual([]);
    expect(out.dropCounters.belowConfidence).toBe(1);
  });

  it("step 4 — source-text grounding: drops findings whose content words don't appear in source rule's key+value", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(toolUseResponse([
      // Description has no overlap with the rule's "CPA-signed P&L statement" content.
      { description: "Need flood insurance certificate", source_rule_id: bucketRow.id, category: "PTA", rationale: "y", confidence: 0.9 },
    ]));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toEqual([]);
    expect(out.dropCounters.ungrounded).toBe(1);
  });

  it("step 5 — output cap: truncates to MAX_LLM_FINDINGS_PER_RUN with deterministic ordering", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    // 15 valid findings — all pass steps 1-4. Cap should be 10.
    const findings = Array.from({ length: 15 }, (_, i) => ({
      description: `CPA-signed P&L statement variant ${i}`,
      source_rule_id: bucketRow.id, category: "PTA" as const, rationale: "y", confidence: 0.9,
    }));
    mockCreate.mockResolvedValue(toolUseResponse(findings));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toHaveLength(10);
    expect(out.dropCounters.outputCap).toBe(5);
  });

  it("full chain: a single valid finding survives all 5 steps", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(toolUseResponse([
      { description: "CPA-signed P&L statement required for self-employed borrower",
        source_rule_id: bucketRow.id, category: "PTA",
        rationale: "rule requires CPA-signed P&L for self-employed borrowers", confidence: 0.9 },
    ]));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.emissionKind).toBe("llm");
    expect(out.findings[0]!.note).toContain("AI-suggested:");
    expect(out.findings[0]!.note).toContain("CPA-signed P&L");
    expect(out.dropCounters.schema).toBe(0);
  });

  it("truncates bucket to MAX_BACKSTOP_BUCKET when over the cap", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(toolUseResponse([]));
    const bigBucket = Array.from({ length: 30 }, (_, i): RequirementRow => ({
      id: `00000000-0000-0000-0000-${(i + 1).toString().padStart(12, "0")}`,
      requirement_key: `Rule ${i}`,
      requirement_value: `content for rule ${i}`,
    }));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: bigBucket,
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.backstopTruncated).toBe(10);  // 30 - 20 cap
  });
});
```

- [ ] **Step 2: Run, see failures**

```bash
pnpm --filter @twin/api exec vitest run test/requirements-llm-backstop.test.ts
```

- [ ] **Step 3: Implement the backstop**

Create `packages/api/src/services/predict-conditions/llm/requirements-backstop.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { LoanContext } from "../../doc-requirements.js";
import type { Finding } from "../pre-underwriter.js";
import type { RequirementRow } from "../resolvers/requirements-resolver.js";

const MAX_LLM_FINDINGS_PER_RUN = 10;
const MAX_BACKSTOP_BUCKET = 20;
const LLM_CONFIDENCE_FLOOR = 0.7;
const MODEL_DEFAULT = "claude-haiku-4-5";

export interface BackstopInput {
  loan: LoanContext;
  unhandledRequirements: readonly RequirementRow[];
  activeDocChecklist: readonly Finding[];
  alreadyEmitted: readonly Finding[];
}

export interface BackstopResult {
  findings: Finding[];
  /** Why the backstop produced no findings (only set when findings is empty for a non-emission reason). */
  skipReason?: "no_api_key" | "empty_bucket" | "compliance_blocker" | "llm_error";
  /** Per-step drop counters for audit metadata. */
  dropCounters: {
    schema: number;
    hallucinatedId: number;
    belowConfidence: number;
    ungrounded: number;
    outputCap: number;
  };
  /** Number of rows truncated from the bucket when it exceeded MAX_BACKSTOP_BUCKET. */
  backstopTruncated: number;
  /** Optional cost metadata. */
  cost?: { input_tokens: number; output_tokens: number; model: string };
}

interface RawLlmFinding {
  description?: unknown;
  category?: unknown;
  source_rule_id?: unknown;
  rationale?: unknown;
  confidence?: unknown;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "at", "by",
  "with", "from", "as", "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its", "if", "than", "then",
]);

function contentWordsOf(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOPWORDS.has(w))
    .map(w => w.replace(/(ing|ed|s)$/, ""));  // simple stem
}

function isGrounded(description: string, rule: RequirementRow): boolean {
  const haystackText = `${rule.requirement_key} ${typeof rule.requirement_value === "string" ? rule.requirement_value : JSON.stringify(rule.requirement_value)}`;
  const haystackWords = new Set(contentWordsOf(haystackText));
  const descWords = contentWordsOf(description);
  if (descWords.length === 0) return false;
  const hits = descWords.filter(w => haystackWords.has(w)).length;
  return hits / descWords.length >= 0.5;
}

const TOOL_SCHEMA = {
  name: "emit_predictions",
  description: "Emit predicted conditions for the loan based on the program rules provided.",
  input_schema: {
    type: "object",
    required: ["findings"],
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          required: ["description", "category", "source_rule_id", "rationale", "confidence"],
          properties: {
            description: { type: "string", minLength: 8, maxLength: 240 },
            category: { type: "string", enum: ["PTA", "PTD", "PTF", "PTP"] },
            source_rule_id: { type: "string", pattern: "^[0-9a-f-]{36}$" },
            rationale: { type: "string", maxLength: 480 },
            confidence: {
              type: "number", minimum: 0, maximum: 1,
              description: "Probability that this finding is correct and actionable. Prefer emitting fewer high-confidence findings than many low-confidence ones.",
            },
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are a pre-underwriter for a non-QM lender. Given the loan profile and the
program requirement rules below, list any additional documents an underwriter
would require beyond what is already known. Be conservative — emit a prediction
ONLY when the requirement clearly implies a document the loan does not yet
satisfy. Prefer emitting fewer high-confidence findings than many low-confidence
ones. Respond via the emit_predictions tool.`;

function validateRawFinding(raw: RawLlmFinding): { ok: true; finding: Required<RawLlmFinding> } | { ok: false } {
  if (typeof raw.description !== "string" || raw.description.length < 8 || raw.description.length > 240) return { ok: false };
  if (raw.category !== "PTA" && raw.category !== "PTD" && raw.category !== "PTF" && raw.category !== "PTP") return { ok: false };
  if (typeof raw.source_rule_id !== "string" || !/^[0-9a-f-]{36}$/.test(raw.source_rule_id)) return { ok: false };
  if (typeof raw.rationale !== "string" || raw.rationale.length > 480) return { ok: false };
  if (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) return { ok: false };
  return { ok: true, finding: raw as Required<RawLlmFinding> };
}

export async function requirementsLlmBackstop(input: BackstopInput): Promise<BackstopResult> {
  const dropCounters = { schema: 0, hallucinatedId: 0, belowConfidence: 0, ungrounded: 0, outputCap: 0 };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { findings: [], skipReason: "no_api_key", dropCounters, backstopTruncated: 0 };
  }
  if (input.unhandledRequirements.length === 0) {
    return { findings: [], skipReason: "empty_bucket", dropCounters, backstopTruncated: 0 };
  }

  // Bucket truncation (spec §5.3 MAX_BACKSTOP_BUCKET).
  const sortedBucket = [...input.unhandledRequirements].sort((a, b) =>
    a.requirement_key.localeCompare(b.requirement_key) || a.id.localeCompare(b.id),
  );
  const bucket = sortedBucket.slice(0, MAX_BACKSTOP_BUCKET);
  const backstopTruncated = sortedBucket.length - bucket.length;
  if (backstopTruncated > 0) {
    for (const dropped of sortedBucket.slice(MAX_BACKSTOP_BUCKET)) {
      console.warn("[requirements-backstop] bucket-truncated row", { ruleId: dropped.id, ruleKey: dropped.requirement_key });
    }
  }

  // Construct the dynamic prompt suffix.
  const userMessage = [
    `LOAN (redacted): ${JSON.stringify(input.loan)}`,
    "",
    "PROGRAM RULES (unhandled by deterministic resolver):",
    ...bucket.map(r => `- rule_id: ${r.id}; key: "${r.requirement_key}"; value: ${typeof r.requirement_value === "string" ? JSON.stringify(r.requirement_value) : JSON.stringify(r.requirement_value)}`),
    "",
    "DOCS ALREADY KNOWN TO BE REQUIRED:",
    ...input.activeDocChecklist.map(f => `- "${f.description}" (from doc-checklist)`),
    ...input.alreadyEmitted.map(f => `- "${f.description}" (from ${f.sourceList})`),
  ].join("\n");

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let resp;
  try {
    resp = await client.messages.create({
      model: MODEL_DEFAULT,
      max_tokens: 2048,
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools: [TOOL_SCHEMA as never],
      tool_choice: { type: "tool", name: "emit_predictions" },
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    console.warn("[requirements-backstop] llm call failed", { err: err instanceof Error ? err.message : String(err) });
    return { findings: [], skipReason: "llm_error", dropCounters, backstopTruncated };
  }

  // Extract tool_use block.
  type AnthropicContentBlock = { type: string; name?: string; input?: { findings?: RawLlmFinding[] } };
  const toolUse = (resp.content as AnthropicContentBlock[]).find((b) => b.type === "tool_use" && b.name === "emit_predictions");
  if (!toolUse) {
    return { findings: [], skipReason: "llm_error", dropCounters, backstopTruncated };
  }
  const rawFindings: RawLlmFinding[] = Array.isArray(toolUse.input?.findings) ? toolUse.input!.findings! : [];

  // Step 1 — schema validation.
  const schemaPass: Required<RawLlmFinding>[] = [];
  for (const r of rawFindings) {
    const v = validateRawFinding(r);
    if (!v.ok) { dropCounters.schema++; console.warn("[requirements-backstop] schema drop", { raw: r }); continue; }
    schemaPass.push(v.finding);
  }

  // Step 2 — source-rule existence.
  const bucketIds = new Set(bucket.map(r => r.id));
  const existencePass = schemaPass.filter(f => {
    if (!bucketIds.has(f.source_rule_id)) {
      dropCounters.hallucinatedId++;
      console.warn("[requirements-backstop] hallucinated source_rule_id drop", { id: f.source_rule_id });
      return false;
    }
    return true;
  });

  // Step 3 — confidence floor.
  const confidencePass = existencePass.filter(f => {
    if (f.confidence < LLM_CONFIDENCE_FLOOR) {
      dropCounters.belowConfidence++;
      console.warn("[requirements-backstop] below-confidence drop", { id: f.source_rule_id, confidence: f.confidence });
      return false;
    }
    return true;
  });

  // Step 4 — source-text grounding.
  const bucketById = new Map(bucket.map(r => [r.id, r]));
  const groundedPass = confidencePass.filter(f => {
    const rule = bucketById.get(f.source_rule_id)!;
    if (!isGrounded(f.description, rule)) {
      dropCounters.ungrounded++;
      console.warn("[requirements-backstop] ungrounded drop", { id: f.source_rule_id, description: f.description });
      return false;
    }
    return true;
  });

  // Step 5 — output cap. Stable sort then truncate.
  groundedPass.sort((a, b) => a.source_rule_id.localeCompare(b.source_rule_id) || a.description.localeCompare(b.description));
  const dropped = Math.max(0, groundedPass.length - MAX_LLM_FINDINGS_PER_RUN);
  if (dropped > 0) {
    dropCounters.outputCap = dropped;
    for (const f of groundedPass.slice(MAX_LLM_FINDINGS_PER_RUN)) {
      console.warn("[requirements-backstop] output-cap drop", { id: f.source_rule_id });
    }
  }
  const capped = groundedPass.slice(0, MAX_LLM_FINDINGS_PER_RUN);

  const findings: Finding[] = capped.map(f => ({
    description: f.description,
    note: `AI-suggested: ${f.rationale}`,
    category: f.category as Finding["category"],
    sourceList: "requirements",
    sourceRuleTable: "program_requirements",
    sourceRuleId: f.source_rule_id,
    emissionKind: "llm",
  }));

  return {
    findings,
    dropCounters,
    backstopTruncated,
    cost: {
      input_tokens: resp.usage?.input_tokens ?? 0,
      output_tokens: resp.usage?.output_tokens ?? 0,
      model: resp.model ?? MODEL_DEFAULT,
    },
  };
}
```

- [ ] **Step 4: Run, see pass**

```bash
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/requirements-llm-backstop.test.ts
```

Expected: 8/8 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/predict-conditions/llm/requirements-backstop.ts \
        packages/api/test/requirements-llm-backstop.test.ts
git commit -m "feat(api/services): requirements LLM backstop — Anthropic + 5-step validation pipeline

Per PC v2 spec §5.3 Stage B. Anthropic tool_use call with the
emit_predictions tool schema. Static system prompt is cache-marked
(spec §5.3 P3 — only the static prefix is cached; dynamic suffix
recomputed per call).

Five-step post-call validation pipeline, each step's drop counted in
dropCounters for audit metadata:
  1. Schema validation — drop findings missing/wrong-typed required fields.
  2. Source-rule existence — drop findings whose UUID isn't in the
     unhandled bucket (LLM hallucinated).
  3. Confidence floor — drop findings with confidence < 0.7 (LLM
     self-reported abstention signal).
  4. Source-text grounding — drop findings where <50% of the description's
     content words appear (stem-matched) in the source rule's key+value
     text (cheapest hallucination guard; spec §5.3 step 4).
  5. Output cap — truncate to MAX_LLM_FINDINGS_PER_RUN=10 with stable
     ordering.

Backstop bucket is itself capped at MAX_BACKSTOP_BUCKET=20; excess rows
truncated with structured console.warn (audit metadata records
backstop_truncated count). Failure modes: no API key → skipReason='no_api_key';
empty bucket → skipReason='empty_bucket'; LLM call/parse error →
skipReason='llm_error' with deterministic findings still emitting.

8 unit tests cover each validation step in isolation + the full chain +
bucket truncation."
```

---

## Task 12: Wire LLM backstop into orchestrator + audit metadata + run audit cost write

**Phase:** D · **Files:** `packages/api/src/services/predict-conditions/pre-underwriter.ts` (modify), `packages/api/src/services/predict-conditions/service.ts` (modify)

**Rationale:** Connect the backstop into the orchestrator pipeline. Update the run audit-log metadata to include LLM drop counters + cost. The "hardcoded_fields" field is also surfaced here.

- [ ] **Step 1: Update the orchestrator to invoke the backstop**

In `pre-underwriter.ts`, extend `runPreUnderwriter`:

```typescript
import { requirementsLlmBackstop, type BackstopResult } from "./llm/requirements-backstop.js";

export interface OrchestratorResult {
  findings: Finding[];
  llm: BackstopResult | null;
  hardcodedFields: string[];
}

export async function runPreUnderwriter(
  c: pg.PoolClient,
  tenantId: string,
  kbCtx: KbVersionContext,
  docChecklistFindings: readonly Finding[],
  loan: LoanContext,
): Promise<OrchestratorResult> {
  const matrixFindings = await resolveMatrixFindings(c, tenantId, kbCtx, loan);
  const geoFindings = await resolveGeographicFindings(c, tenantId, kbCtx, loan);
  const { findings: reqDeterministicFindings, unhandledRows } =
    await resolveRequirementFindings(c, tenantId, kbCtx, loan);

  // LLM backstop (Stage B). May return empty findings if disabled / no bucket / error.
  const backstop = await requirementsLlmBackstop({
    loan,
    unhandledRequirements: unhandledRows,
    activeDocChecklist: docChecklistFindings,
    alreadyEmitted: [...matrixFindings, ...geoFindings, ...reqDeterministicFindings],
  });

  // Hardcoded-fields surfacing for audit (spec §4.4 + §6.4 Risk #5b). Any
  // field still wired to the F2-deferred fallback is surfaced so ops/compliance
  // can see PC v2's coverage gap.
  const hardcodedFields: string[] = [];
  if (loan.isItin === false) hardcodedFields.push("isItin");
  if (loan.llcOrLegalEntity === false) hardcodedFields.push("llcOrLegalEntity");
  if (loan.county === "") hardcodedFields.push("county");

  return {
    findings: dedupFindings([
      ...docChecklistFindings,
      ...matrixFindings,
      ...geoFindings,
      ...reqDeterministicFindings,
      ...backstop.findings,
    ]),
    llm: backstop,
    hardcodedFields,
  };
}
```

- [ ] **Step 2: Update service.ts to consume the new orchestrator return shape**

In `packages/api/src/services/predict-conditions/service.ts`, where `runPreUnderwriter` is called (added in Task 5):

```typescript
const orchestratorResult = await runPreUnderwriter(c, tenantId, kbCtx, docChecklistFindings, loan);
const findings = orchestratorResult.findings;
```

Update the run audit-log metadata block (the JSON.stringify body from Task 5) to add `llm` and `hardcoded_fields`:

```typescript
JSON.stringify({
  run_id: runId,
  source,
  kb_version_id: docs.kbVersionId,
  outcome: "predictions_emitted",
  count: insertedCount,
  skipped_acted: skippedActed,
  reused: false,
  by_source: {
    minimum: findings.filter((f) => f.sourceList === "minimum").length,
    income: findings.filter((f) => f.sourceList === "income").length,
    matrix: findings.filter((f) => f.sourceList === "matrix").length,
    requirements_deterministic: findings.filter((f) => f.sourceList === "requirements" && f.emissionKind === "deterministic").length,
    requirements_llm: findings.filter((f) => f.sourceList === "requirements" && f.emissionKind === "llm").length,
    geographic: findings.filter((f) => f.sourceList === "geographic").length,
  },
  ...(orchestratorResult.llm && orchestratorResult.llm.findings.length > 0
    ? {
        llm: {
          input_tokens: orchestratorResult.llm.cost?.input_tokens,
          output_tokens: orchestratorResult.llm.cost?.output_tokens,
          model: orchestratorResult.llm.cost?.model,
          bucket_size: orchestratorResult.llm.findings.length,
          backstop_truncated: orchestratorResult.llm.backstopTruncated,
          dropped_schema: orchestratorResult.llm.dropCounters.schema,
          dropped_hallucinated_id: orchestratorResult.llm.dropCounters.hallucinatedId,
          dropped_below_confidence: orchestratorResult.llm.dropCounters.belowConfidence,
          dropped_ungrounded: orchestratorResult.llm.dropCounters.ungrounded,
          dropped_output_cap: orchestratorResult.llm.dropCounters.outputCap,
        },
      }
    : orchestratorResult.llm?.skipReason
      ? { llm_skipped: orchestratorResult.llm.skipReason }
      : {}),
  hardcoded_fields: orchestratorResult.hardcodedFields,
}),
```

- [ ] **Step 3: Build + run**

```bash
pnpm --filter @twin/api build
pnpm --filter @twin/api exec vitest run test/predict-conditions-service.test.ts test/pre-underwriter-orchestrator.test.ts test/matrix-resolver.test.ts test/geographic-resolver.test.ts test/requirements-resolver.test.ts test/requirements-llm-backstop.test.ts
```

Expected: all green. Service tests still pass (the LLM is gated by `ANTHROPIC_API_KEY` which the test env doesn't have, so backstop short-circuits to `skipReason: "no_api_key"`).

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/services/predict-conditions/pre-underwriter.ts \
        packages/api/src/services/predict-conditions/service.ts
git commit -m "feat(api/services): wire LLM backstop into orchestrator + expanded run audit metadata

Per PC v2 spec §5.3 Stage B + §4.4. The orchestrator now returns
{ findings, llm, hardcodedFields }:
  - findings: the deduped Finding[] (same as before, plus LLM additions).
  - llm: BackstopResult with cost + 5-step drop counters + truncation count;
    null only when the backstop was never invoked.
  - hardcodedFields: list of LoanContext keys sourced from F2-deferred
    fallbacks (currently isItin, llcOrLegalEntity, county) — surfaced in
    audit metadata so ops/compliance can see PC v2's coverage gap.

service.ts run() now writes the expanded metadata: by_source per-resolver
counts, optional llm sub-object with all five drop counters + token cost,
optional llm_skipped reason, and hardcoded_fields list.

LLM is short-circuited to skipReason='no_api_key' in test environments
that don't set ANTHROPIC_API_KEY; existing PC v1/v2 service tests pass
unchanged."
```

---

## Task 13: Extend W10 E2E for PC v2 prediction coverage

**Phase:** D · **Files:** `scripts/e2e-harness/workflows/W10-predicted-conditions.ts` (modify)

**Rationale:** W10's `EXPECTED_PENDING = 15` was calibrated against PC v1's doc-checklist-only output. PC v2 will add matrix + geographic + requirements findings, widening the expected count. Change to a range assertion + add a source_list distribution assertion.

- [ ] **Step 1: Update W10's expected counts**

In `scripts/e2e-harness/workflows/W10-predicted-conditions.ts`, find the `EXPECTED_PENDING` constant (currently `= 15`) and replace:

```typescript
const EXPECTED_PENDING_MIN = 15;
const EXPECTED_PENDING_MAX = 35;  // PC v2 adds matrix + geo + requirements findings on top of doc-checklist
```

Find the assertion `name: "pending_count", expected: String(EXPECTED_PENDING), ...` and replace:

```typescript
    assertions.push({
      name: "pending_count_in_range",
      expected: `${EXPECTED_PENDING_MIN}-${EXPECTED_PENDING_MAX}`,
      actual: String(pending.length),
      ok: pending.length >= EXPECTED_PENDING_MIN && pending.length <= EXPECTED_PENDING_MAX,
    });
```

The downstream check `if (pending.length < 9)` also gates the accept-loop on the pending count. Leave that as-is (still applies: we need at least 9 pending to exercise the 8-accept + 1-dismiss flow).

Append after the pending-count assertion, before the accept-loop:

```typescript
    // PC v2: assert that predictions include rows from multiple sources.
    // Doc-checklist (minimum/income) should still be present from PC v1.
    // Matrix/geographic/requirements rows depend on the demo tenant's
    // ingested rules, but the canonical fixture's profile should trigger
    // at least one PC v2 source.
    type ListResp2 = { predictions: Array<{ id: string; status: string; source_list?: string }>; alerts: unknown[] };
    const listV2 = await http.get<ListResp2>(apiOpts, `/loans/${fixture.loanId}/predictions`);
    const sources = new Set(listV2.predictions.map((p) => p.source_list ?? "unknown"));
    assertions.push({
      name: "pc_v2_sources_present",
      expected: "at least one of: matrix, geographic, requirements",
      actual: Array.from(sources).join(","),
      ok: sources.has("matrix") || sources.has("geographic") || sources.has("requirements"),
    });
```

- [ ] **Step 2: Verify W10 compiles**

```bash
pnpm tsx --eval "import('./scripts/e2e-harness/workflows/W10-predicted-conditions.ts').then(()=>{console.log('ok');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
```

Expected: `ok`.

- [ ] **Step 3: Run W10 against demo to confirm the assertions pass**

(Manual step — depends on demo state. Skip if the dev API isn't running.)

```bash
DEMO_TENANT_ID=5d175193-6ee2-4d6a-b16e-f1777f7e18ad pnpm tsx scripts/e2e-harness/run.ts --workflow W10_predicted_conditions --fixture nqm-bankstmt-12mo-clean --skip-canary --repeat 1
```

Expected: 1/1 pass with the new range + source-distribution assertions. If pending count exceeds 35 the upper bound needs widening; if no PC v2 sources fire the canonical fixture needs a closer look at the seeded matrix/requirements/geographic rules.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-harness/workflows/W10-predicted-conditions.ts
git commit -m "test(e2e): W10 widens EXPECTED_PENDING + asserts PC v2 source distribution

Per PC v2 spec §6.2. W10's hardcoded =15 pending assertion was calibrated
against PC v1's doc-checklist-only output. PC v2 adds matrix + geographic
+ requirements findings on top, widening the expected count.

  - EXPECTED_PENDING_MIN = 15, EXPECTED_PENDING_MAX = 35 (range assertion).
  - New 'pc_v2_sources_present' assertion: pending predictions must include
    at least one of matrix / geographic / requirements (not just minimum/
    income from the doc-checklist).

If the demo tenant's canonical fixture profile doesn't trigger any PC v2
source, the assertion fails — signal to either (a) widen the canonical
fixture's profile to exercise a known rule, or (b) seed a tighter rule
that the fixture violates."
```

---

## Spec coverage check (self-review)

| Spec section | Task(s) |
|---|---|
| §1 Problem | Implicit — every task contributes |
| §2 Affected sites | Tasks 1-13 cover every row in the affected-sites table |
| §3.1 Module layout | Tasks 4, 6, 7, 9, 11 create the named files |
| §3.2 KbVersionContext | Task 4 |
| §3.3 Finding shape + shared normalize.ts | Tasks 1, 4 |
| §4.1 Migration 019 | Task 2 |
| §4.2 LoanContext extension | Task 3 |
| §4.3 Idempotency-by-hash-widening | Implicit (no code change needed; PC v1 hashing covers it) |
| §4.4 Audit-log metadata expansion | Tasks 5, 12 |
| §5.1 Matrix resolver | Task 6 |
| §5.2 Geographic resolver | Task 7 |
| §5.3 Requirements resolver (deterministic + LLM) | Tasks 9, 11 |
| §5.4 Aggregation + dedup processing order | Tasks 4, 8, 10, 12 |
| §6.1 Phasing | Tasks grouped by Phase A (1-5), B (6-8), C (9-10), D (11-13) |
| §6.2 Testing strategy | Tasks 1, 4, 6, 7, 9, 11 (unit) + Tasks 8, 10 (integration) + Task 13 (E2E) |
| §6.3 Non-goals | (No tasks needed — explicit non-goals) |
| §6.4 Risks | Field-availability guards (Tasks 6, 9); KbVersionContext (Task 4); LLM hallucination pipeline (Task 11); hardcoded_fields surfacing (Task 12) |
| §7 Open items | Deferred per spec |
| §8 Reviewer notes | Plan-level reviewer notes block at top of plan |

✅ All spec sections map to at least one task. No gaps.

---

## Placeholder scan (self-review)

Searched for: TBD, TODO, "implement later", "fill in details", "Add appropriate error handling", "Similar to Task N", references to undefined symbols.

✅ None present. Every step contains concrete code or a concrete command with expected output. Type references (`Finding`, `KbVersionContext`, `LoanContext`, `RequirementRow`, `BackstopInput`, `BackstopResult`, `OrchestratorResult`, `normalizeConditionDescription`) are all defined in earlier tasks before they're used.

---

## Type consistency check (self-review)

| Symbol | Defined in | Used in |
|---|---|---|
| `normalizeConditionDescription` | Task 1 | Task 4 (orchestrator dedup), Task 1 (reducer) |
| `LoanContext` (v2 fields) | Task 3 | Tasks 6, 7, 9, 11 |
| `KbVersionContext` | Task 4 | Tasks 6, 7, 9, 11 |
| `Finding` | Task 4 | Tasks 5, 6, 7, 9, 11 |
| `dedupFindings` | Task 4 | Task 4 (own tests), Task 8 (orchestrator wires) |
| `resolveMatrixFindings` | Task 6 | Task 8 |
| `resolveGeographicFindings` | Task 7 | Task 8 |
| `RequirementRow`, `handleRequirement`, `resolveRequirementFindings` | Task 9 | Tasks 10, 11 |
| `requirementsLlmBackstop`, `BackstopResult`, `BackstopInput` | Task 11 | Task 12 |
| `OrchestratorResult` (new return shape) | Task 12 | Task 12 (service consumes) |

✅ Consistent across tasks. Names locked at definition.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-14-pc-v2-pre-underwriter.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review between (spec compliance → code quality), fast iteration. Same approach that shipped PC v1 cleanly across 32 commits.

**2. Inline Execution** — Execute tasks in this session via `executing-plans`, batch with checkpoints.

**Which approach?**
