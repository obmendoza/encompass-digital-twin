# Portal Analysis Output Ingestion (Spec 1.5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consume the NPNQM portal's analyzed output (`<loan>_output.json`) and persist portal-LLM predictions alongside PC v2's second-opinion predictions, with cross-endpoint PII middleware backfilling protection into Spec 1's already-shipped loan + document channels.

**Architecture:** New endpoint `POST /api/ingest/:tenantSlug/analysis-output` accepts the portal's analyzed payload, dispatches via `LenderAdapter.transformAnalysisOutput`, persists portal predictions with `source_list='portal-llm'`, persists per-program eligibility verdicts, and triggers PC v2 as a second opinion. Two-opinion data architecture: no cross-source dedup at insert time; UI groups by normalized description; portal eligibility verdict is authoritative; disagreements emit audit-log rows for future drift detection. Cross-spec backfill: `redactPayload` is promoted to a Fastify `preHandler` middleware applied to every `/api/ingest/*` route — closes a PII gap in Spec 1 that real samples revealed.

**Tech Stack:** Fastify 4, Zod, pg session pooler with explicit `WHERE tenant_id` filters, pino structured logs with `redact` config, Vitest, existing reducer + `withStoreSnapshot` + PC v2 PII redactor.

**Spec:** [docs/superpowers/specs/2026-05-15-portal-analysis-output-ingestion.md](../specs/2026-05-15-portal-analysis-output-ingestion.md) commit `6df56a7`.

---

## File Structure

### Created

| Path | Responsibility |
|------|----------------|
| `packages/api/src/ingestion/pii-middleware.ts` | `redactPayloadMiddleware` Fastify preHandler — applied to `/api/ingest/*` |
| `packages/api/src/routes/analysis-output-ingest.ts` | `POST /api/ingest/:tenantSlug/analysis-output` route |
| `packages/api/src/db/migrations/023-portal-analysis-output.sql` | Schema (predicted_conditions widening + columns + portal_eligibility_verdicts + ingested_loans.analysis_hash) |
| `packages/api/test/fixtures/portal-analysis/aubrey_output.json` | Real sample loan 1 (SSN-stripped) |
| `packages/api/test/fixtures/portal-analysis/montes_output.json` | Real sample loan 2 (SSN-stripped) |
| `packages/api/test/fixtures/portal-analysis/niccum_output.json` | Real sample loan 3 (SSN-stripped) |
| `packages/api/test/fixtures/portal-analysis/nyarko_output.json` | Real sample loan 4 (SSN-stripped) |
| `packages/api/test/fixtures/portal-analysis/weingarten_output.json` | Real sample loan 5 (SSN-stripped) |
| `packages/api/test/fixtures/portal-analysis/batch_summary.json` | Cross-loan reference |
| `packages/api/test/fixtures/portal-analysis/explicit-ssn-sample.json` | Adversarial — contains a known SSN for redaction tests |
| `packages/api/test/pii-middleware.test.ts` | Middleware unit + perf tests |
| `packages/api/test/analysis-output-ingest.integration.test.ts` | HTTP end-to-end + supersede flow + disagreement audit |
| `packages/api/test/adapter-npnqm-portal-analysis.test.ts` | Golden-file tests against 5 real samples |
| `scripts/e2e-harness/workflows/W12-portal-analysis.ts` | Full harness path |

### Modified

| Path | Change |
|------|--------|
| `packages/core/src/adapter-config.ts` | Expand `LoanContextExtrasSchema` from 11 → 32 optional fields; drop `"NOO"` from occupancy enum |
| `packages/api/src/ingestion/lender-adapter.ts` | Add `PortalPrediction`, `PortalDocCategory`, `EligibilityVerdict`, `PortalAnalysisStats`, `TransformAnalysisOutput` types; add optional `transformAnalysisOutput` method with throw default; add `MissingExternalIdError` |
| `packages/api/src/ingestion/adapters/npnqm-portal.ts` | Add `transformAnalysisOutput` against real samples; rewrite `transformLoan` + `deriveContextFields` to read `scenario_summary.*` (with back-compat fallback); occupancy normalization; throw `MissingExternalIdError` in `extractExternalLoanId` |
| `packages/api/src/server.ts` | Register `redactPayloadMiddleware` as preHandler on `/api/ingest/*`; register analysis-output route; pino redact config |
| `packages/api/src/db/pool.ts` *(maybe)* | Pino redact config — actually lives in the Fastify logger init, not pool. Verify location at implementation time. |
| `packages/api/src/routes/system-check.ts` | Add `eligibility_disagreements_total` metric to `/system/doc-fetch-metrics` (or a new `/system/portal-metrics` endpoint) |
| `docs/superpowers/specs/2026-05-14-ingestion-framework-design.md` | §11 risks table: add cross-reference to Spec 1.5 §6 as PII handling owner |

---

## Phase A — Foundation

3 tasks. Schemas, types, migration. No behavior change to existing routes.

### Task 0: Commit real-sample fixtures (SSN-stripped)

The adapter and integration tests require real portal-output samples. The synthetic fixtures from Spec 1's Task 0 are obsolete; these replace them. **Strip SSNs before committing** — replace with `xxx-xx-NNNN` (preserving last 4 digits for plausibility).

**Files:**
- Create: `packages/api/test/fixtures/portal-analysis/{aubrey,montes,niccum,nyarko,weingarten}_output.json`
- Create: `packages/api/test/fixtures/portal-analysis/batch_summary.json`
- Create: `packages/api/test/fixtures/portal-analysis/explicit-ssn-sample.json`

- [ ] **Step 1: Source the real samples**

Five sample outputs exist at `/tmp/npnqm-portal-samples/test_results/{aubrey,montes,niccum,nyarko,weingarten}/<loan>_output.json` (extracted earlier from `/Users/omarmendoza/Downloads/test_results 1.zip`). Plus `batch_summary.json`. The `final_state.json` files are NOT consumed by UAS v1 (out of scope per spec §10) — don't commit them.

- [ ] **Step 2: Strip SSNs from each sample**

For each `<loan>_output.json`, replace every value matching the unmasked-SSN pattern with the masked form. Use this script (don't commit it):

```bash
mkdir -p packages/api/test/fixtures/portal-analysis
for loan in aubrey montes niccum nyarko weingarten; do
  src="/tmp/npnqm-portal-samples/test_results/${loan}/${loan}_output.json"
  dst="packages/api/test/fixtures/portal-analysis/${loan}_output.json"
  # Replace any 9-digit numeric string in an "ssn" key with xxx-xx-NNNN preserving last 4.
  python3 -c "
import json, re, sys
p = json.load(open('$src'))
def walk(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == 'ssn' and isinstance(v, str) and re.fullmatch(r'\d{9}', v):
                o[k] = 'xxx-xx-' + v[-4:]
            else:
                walk(v)
    elif isinstance(o, list):
        for x in o: walk(x)
walk(p)
json.dump(p, open('$dst', 'w'), indent=2)
"
done
cp /tmp/npnqm-portal-samples/test_results/batch_summary.json packages/api/test/fixtures/portal-analysis/
```

Expected: each output file has SSN replaced with `xxx-xx-<last4>`. Verify with `grep -E '\b[0-9]{9}\b' packages/api/test/fixtures/portal-analysis/*.json` — should return zero lines.

- [ ] **Step 3: Write the adversarial explicit-SSN fixture**

Create `packages/api/test/fixtures/portal-analysis/explicit-ssn-sample.json` by hand — a tiny payload that includes a known SSN to verify the middleware redacts it:

```json
{
  "source": "npnqm-portal",
  "externalId": "TEST-SSN-001",
  "analysisOutput": {
    "document_requests": [],
    "scenario_summary": {
      "loan_number": "TEST-SSN-001",
      "borrowers": [
        {
          "name": "Test Borrower",
          "ssn": "123456789",
          "dob": "1985-01-01",
          "role": "primary"
        }
      ]
    },
    "seen_conflicts": [],
    "stats": {
      "total_document_requests": 0,
      "hard_stop_documents": 0,
      "elapsed_seconds": 0,
      "tool_calls": 0,
      "by_category": {},
      "by_priority": {},
      "by_status": {}
    }
  }
}
```

The `"123456789"` SSN must round-trip to `"xxx-xx-6789"` after middleware redaction.

- [ ] **Step 4: Verify all files parse as JSON**

```bash
for f in packages/api/test/fixtures/portal-analysis/*.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "OK: $f"
done
```

Expected: 7 OK lines (5 loan outputs + batch_summary + explicit-ssn), no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/test/fixtures/portal-analysis/
git commit -m "test(fixtures): real NPNQM portal analysis samples (SSN-stripped)

Five real sample outputs (aubrey, montes, niccum, nyarko, weingarten)
from the 2026-05-15 sample drop, with unmasked SSNs replaced by
xxx-xx-<last4>. Plus batch_summary.json for cross-loan reference and
an adversarial explicit-ssn-sample.json that carries a known SSN to
verify the redaction middleware works end-to-end."
```

---

### Task 1: Adapter types + LoanContextExtras schema expansion

**Files:**
- Modify: `packages/core/src/adapter-config.ts`
- Modify: `packages/api/src/ingestion/lender-adapter.ts`
- Test: `packages/core/test/adapter-config.test.ts`
- Test: `packages/api/test/lender-adapter.test.ts`

- [ ] **Step 1: Write failing tests for the expanded LoanContextExtras**

Append to `packages/core/test/adapter-config.test.ts`:

```ts
describe("LoanContextExtrasSchema — Spec 1.5 expansion", () => {
  it("accepts all 32 new optional fields", () => {
    const r = LoanContextExtrasSchema.safeParse({
      repFico: 720, ltv: 80, loanAmount: 500000,
      loanPurpose: "Cash-Out Refinance",
      propertyType: "SFR Det.", dti: 38, reservesMonths: 6,
      noteRate: 7.5, county: "King County",
      isItin: false, llcOrLegalEntity: false,
      // amendment additions:
      occupancy: "Investment",
      state: "CA",
      units: 1,
      cltv: 80, hcltv: 80,
      ownedPropertiesCount: 2,
      reoTotalLienBalance: 350000,
      subjectRentalIncome: 2800,
      isFirstTimeHomebuyer: false,
      borrowerType: "Long Term Rentals",
      channel: "Wholesale",
      productVariant: "Conventional",
      interestOnly: false, prepayPenalty: true, balloon: false,
      isUsCredit: true, citizenship: "US Citizen",
      selfEmployed: false,
      primaryIncomeType: "DSCR",
      bankruptcyHistory: false,
      foreclosureHistory: false,
      shortSaleHistory: false,
      presentlyDelinquent: false,
      outstandingJudgments: false,
    });
    expect(r.success).toBe(true);
  });

  it("rejects 'NOO' on occupancy (canonicalized to 'Investment' at adapter)", () => {
    const r = LoanContextExtrasSchema.safeParse({ occupancy: "NOO" });
    expect(r.success).toBe(false);
  });

  it("accepts canonical occupancy values only", () => {
    expect(LoanContextExtrasSchema.safeParse({ occupancy: "Primary" }).success).toBe(true);
    expect(LoanContextExtrasSchema.safeParse({ occupancy: "Secondary" }).success).toBe(true);
    expect(LoanContextExtrasSchema.safeParse({ occupancy: "Investment" }).success).toBe(true);
  });

  it("rejects state codes that aren't 2 chars", () => {
    expect(LoanContextExtrasSchema.safeParse({ state: "CAL" }).success).toBe(false);
    expect(LoanContextExtrasSchema.safeParse({ state: "C" }).success).toBe(false);
    expect(LoanContextExtrasSchema.safeParse({ state: "CA" }).success).toBe(true);
  });

  it("rejects unknown keys even with all new fields valid (.strict() preserved)", () => {
    const r = LoanContextExtrasSchema.safeParse({ repFico: 720, occupancy: "Investment", mysteryField: "x" });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/core test adapter-config.test
```

Expected: FAIL — new fields not in schema, occupancy enum still includes "NOO".

- [ ] **Step 3: Update `LoanContextExtrasSchema`**

Open `packages/core/src/adapter-config.ts`. Replace the `LoanContextExtrasSchema` definition with:

```ts
export const LoanContextExtrasSchema = z.object({
  // PC v2 v2 fields (Spec 1)
  repFico: z.number().int().min(300).max(900).optional(),
  ltv: z.number().min(0).max(200).optional(),
  loanAmount: z.number().nonnegative().optional(),
  loanPurpose: z.enum(["Purchase", "Rate & Term Refinance", "Cash-Out Refinance"]).optional(),
  propertyType: z.string().optional(),
  dti: z.number().min(0).max(100).optional(),
  reservesMonths: z.number().nonnegative().optional(),
  noteRate: z.number().min(0).max(30).optional(),
  county: z.string().optional(),
  isItin: z.boolean().optional(),
  llcOrLegalEntity: z.boolean().optional(),

  // Spec 1.5 amendment additions — all optional
  occupancy: z.enum(["Primary", "Secondary", "Investment"]).optional(),  // "NOO" canonicalized to "Investment" at adapter
  state: z.string().length(2).optional(),
  units: z.number().int().min(1).max(8).optional(),
  cltv: z.number().min(0).max(200).optional(),
  hcltv: z.number().min(0).max(200).optional(),
  ownedPropertiesCount: z.number().int().nonnegative().optional(),
  reoTotalLienBalance: z.number().nonnegative().optional(),
  subjectRentalIncome: z.number().nonnegative().optional(),
  isFirstTimeHomebuyer: z.boolean().optional(),
  borrowerType: z.string().optional(),
  channel: z.string().optional(),
  productVariant: z.string().optional(),
  interestOnly: z.boolean().optional(),
  prepayPenalty: z.boolean().optional(),
  balloon: z.boolean().optional(),
  isUsCredit: z.boolean().optional(),
  citizenship: z.string().optional(),
  selfEmployed: z.boolean().optional(),
  primaryIncomeType: z.string().optional(),
  bankruptcyHistory: z.boolean().optional(),
  foreclosureHistory: z.boolean().optional(),
  shortSaleHistory: z.boolean().optional(),
  presentlyDelinquent: z.boolean().optional(),
  outstandingJudgments: z.boolean().optional(),
}).strict();
```

- [ ] **Step 4: Write failing test for new adapter types**

Append to `packages/api/test/lender-adapter.test.ts`:

```ts
import {
  type PortalPrediction,
  type PortalDocCategory,
  type EligibilityVerdict,
  type PortalAnalysisStats,
  type TransformAnalysisOutput,
  MissingExternalIdError,
} from "../src/ingestion/lender-adapter.js";

describe("Spec 1.5 adapter types", () => {
  it("PortalPrediction shape is well-typed", () => {
    const p: PortalPrediction = {
      documentType: "Credit Report",
      documentCategory: "Credit",
      priority: "P0",
      appliesTo: "all_borrowers",
      specifications: ["Must be tri-merge"],
      reasonsNeeded: ["FICO validation"],
      conditions: [],
      sourceReferences: ["NQMF Guidelines"],
      severity: "SOFT-STOP",
      portalStatus: "needed",
      tags: ["credit"],
      sourceModule: "04",
    };
    expect(p.priority).toBe("P0");
  });

  it("base LenderAdapter.transformAnalysisOutput throws by default", () => {
    class StubAdapter extends LenderAdapter {
      readonly adapterType = "stub-test";
      extractExternalLoanId() { return ""; }
      transformLoan() { return {}; }
      validateLoan() { return { valid: true, errors: [] }; }
      extractExternalDocId() { return ""; }
      transformDocument() { return { externalDocId: "x", docType: "Other" as const, fileName: "f", sourceUrl: "https://h.example.com/x" }; }
      validateDocument() { return { valid: true, errors: [] }; }
      deriveContextFields() { return {}; }
    }
    const a = new StubAdapter();
    expect(() => a.transformAnalysisOutput({}, { allowedFetchHosts: [], maxFileBytes: 50_000_000, identityPrefix: "QL-" })).toThrow(/not supported/);
  });

  it("MissingExternalIdError exists and is throwable", () => {
    expect(() => { throw new MissingExternalIdError("test"); }).toThrow(MissingExternalIdError);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

```bash
pnpm --filter @twin/api test lender-adapter.test
```

Expected: FAIL — types don't exist, `transformAnalysisOutput` not on base class, `MissingExternalIdError` not exported.

- [ ] **Step 6: Add types + base-class method + error**

Append to `packages/api/src/ingestion/lender-adapter.ts`:

```ts
// ─── Spec 1.5: analysis-output channel ────────────────────────────────────

export type PortalDocCategory =
  | "Credit" | "Cross-Cutting" | "Compliance"
  | "Income" | "Assets" | "Property" | "Title";

export interface PortalPrediction {
  documentType: string;
  documentCategory: PortalDocCategory;
  priority: "P0" | "P1" | "P2";
  appliesTo: string;
  specifications: string[];
  reasonsNeeded: string[];
  conditions: string[];
  sourceReferences: string[];
  severity: "HARD-STOP" | "SOFT-STOP";
  portalStatus: string;             // "needed" | "satisfied" | "waived" | "deferred" — portal-specific
  tags: string[];
  sourceModule: string;
}

export interface EligibilityVerdict {
  eligiblePrograms: string[];
  ineligiblePrograms: string[];
  perProgram: Array<{
    program: string;
    status: "PASS" | "FAIL";
    passedCount: number;
    failedCount: number;
    failedRules: Array<{ requirement: string; message: string }>;
  }>;
}

export interface PortalAnalysisStats {
  totalDocumentRequests: number;
  hardStopDocuments: number;
  elapsedSeconds: number;
  toolCalls: number;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  byStatus: Record<string, number>;
}

export interface TransformAnalysisOutput {
  loan: Partial<Loan>;
  extras: Partial<LoanContextExtras>;
  portalPredictions: PortalPrediction[];
  eligibilityVerdict: EligibilityVerdict;
  seenConflicts: string[];
  stats: PortalAnalysisStats;
}

export class MissingExternalIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingExternalIdError";
  }
}
```

Update the `LenderAdapter` abstract class to add the new optional method (NOT abstract — base provides a throw default):

```ts
// Inside the existing `export abstract class LenderAdapter { ... }` body, after deriveContextFields:

  /**
   * Spec 1.5: optional. Adapters serving lenders whose portal runs its own
   * analysis implement this to convert the analyzed output into our domain shape.
   * Base default throws so non-analysis adapters fail loudly if routed here.
   */
  transformAnalysisOutput(_raw: unknown, _config: AdapterConfig): TransformAnalysisOutput {
    throw new Error(`adapter '${this.adapterType}': analysis-output channel not supported`);
  }
```

Add the required import for `LoanContextExtras` if not already present:

```ts
import type { Loan, LoanContextExtras, DocumentType, AdapterConfig } from "@twin/core";
```

- [ ] **Step 7: Verify tests pass**

```bash
pnpm --filter @twin/core build && pnpm --filter @twin/api build && pnpm --filter @twin/core test adapter-config.test && pnpm --filter @twin/api test lender-adapter.test
```

Expected: 0 build errors. New tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/adapter-config.ts packages/core/test/adapter-config.test.ts packages/api/src/ingestion/lender-adapter.ts packages/api/test/lender-adapter.test.ts
git commit -m "feat(core,api): Spec 1.5 — adapter types + LoanContextExtras expansion

LoanContextExtras grows from 11 → 32 optional fields covering the portal's
scenario_summary surface area. Occupancy enum drops 'NOO' — adapter
canonicalizes upstream. New types in @twin/api/ingestion/lender-adapter:
PortalPrediction, PortalDocCategory, EligibilityVerdict, PortalAnalysisStats,
TransformAnalysisOutput. Base class adds optional transformAnalysisOutput
(throws default). MissingExternalIdError exported for adapter use."
```

---

### Task 2: Migration 023 — schema

**Files:**
- Create: `packages/api/src/db/migrations/023-portal-analysis-output.sql`

- [ ] **Step 1: Write the migration**

```sql
-- packages/api/src/db/migrations/023-portal-analysis-output.sql
-- Spec 1.5: Portal Analysis Output Ingestion
--
-- Adds:
--   1. predicted_conditions.source_list CHECK widens to include 'portal-llm'
--   2. predicted_conditions.portal_metadata JSONB (per-row portal detail)
--   3. predicted_conditions.analysis_hash TEXT + superseded_at TIMESTAMPTZ
--      (re-analysis supersede flow per spec §4.2 step 4)
--   4. ingested_loans.analysis_hash TEXT (content-hash idempotency)
--   5. portal_eligibility_verdicts table (per-program PASS/FAIL with versioning)

-- ── 1. Widen predicted_conditions.source_list CHECK ──────────────────────
ALTER TABLE predicted_conditions DROP CONSTRAINT IF EXISTS predicted_conditions_source_list_check;
ALTER TABLE predicted_conditions ADD CONSTRAINT predicted_conditions_source_list_check
  CHECK (source_list IN (
    'minimum', 'income', 'matrix', 'geographic', 'requirements',
    'portal-llm'
  ));

-- ── 2. Portal-specific metadata + supersede provenance ───────────────────
ALTER TABLE predicted_conditions ADD COLUMN IF NOT EXISTS portal_metadata JSONB;
ALTER TABLE predicted_conditions ADD COLUMN IF NOT EXISTS analysis_hash TEXT;
ALTER TABLE predicted_conditions ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
-- portal_metadata shape (when source_list='portal-llm'):
--   { priority, severity, document_category, document_type, specifications[],
--     reasons_needed[], source_references[], tags[], source_module,
--     applies_to, portal_status }

-- ── 3. Content-hash idempotency on ingested_loans ────────────────────────
ALTER TABLE ingested_loans ADD COLUMN IF NOT EXISTS analysis_hash TEXT;
-- Nullable for loans ingested via loan-channel (no portal analysis attached);
-- required on new portal-source ingests by application logic.

-- ── 4. portal_eligibility_verdicts table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_eligibility_verdicts (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL CHECK (length(loan_id) BETWEEN 1 AND 200),
  program TEXT NOT NULL CHECK (length(program) BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL')),
  passed_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  failed_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  analysis_hash TEXT NOT NULL,
  superseded_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Composite PK includes recorded_at so historical rows can coexist.
  PRIMARY KEY (tenant_id, loan_id, program, recorded_at)
);

-- Partial unique index: at most one active row per (tenant, loan, program).
CREATE UNIQUE INDEX IF NOT EXISTS portal_eligibility_active_per_program
  ON portal_eligibility_verdicts (tenant_id, loan_id, program)
  WHERE superseded_at IS NULL;

ALTER TABLE portal_eligibility_verdicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_eligibility_verdicts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON portal_eligibility_verdicts;
CREATE POLICY tenant_isolation ON portal_eligibility_verdicts
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

- [ ] **Step 2: Boot the API to apply the migration**

```bash
pnpm --filter @twin/api dev
```

Expected log lines:
```
[migrations] Applying 023-portal-analysis-output.sql...
[migrations] Applied 023-portal-analysis-output.sql
Server listening at http://0.0.0.0:4000
```

Kill the dev server (Ctrl-C).

- [ ] **Step 3: Sanity-check the new constraints**

```bash
# Verify the source_list widening
psql "$DATABASE_URL" -c "INSERT INTO predicted_conditions (id, tenant_id, loan_id, prediction_run_id, source_list, description, category, status, source_input_hash, kb_version_id, source_rule_table, source_rule_id, emission_kind) VALUES (gen_random_uuid(), (SELECT id FROM tenants WHERE type='demo' LIMIT 1), 'TEST-LOAN', gen_random_uuid(), 'portal-llm', 'test', 'PTA', 'pending', 'hash', 1, null, null, 'deterministic') RETURNING source_list;" 2>&1 | grep portal-llm
```

(If `psql` isn't directly available, skip this and let the integration tests catch it.)

Expected: the INSERT succeeds. If `DATABASE_URL` isn't accessible from your shell, this step is informational; integration tests cover the constraint.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/db/migrations/023-portal-analysis-output.sql
git commit -m "feat(db): migration 023 — portal analysis output schema

Additive only:
  - predicted_conditions.source_list CHECK widens to include 'portal-llm'
  - predicted_conditions gains portal_metadata JSONB + analysis_hash +
    superseded_at (re-analysis supersede flow)
  - ingested_loans gains analysis_hash (content-hash idempotency)
  - portal_eligibility_verdicts table with composite PK (tenant, loan,
    program, recorded_at), analysis_hash, superseded_at, and a partial
    unique index enforcing at-most-one-active row per (tenant, loan, program)

RLS on the new table. transformer_type retained for backwards-compat."
```

---

## Phase A complete — checkpoint

After tasks 0-2: fixtures committed, schemas + types in place, migration applied. Existing routes still work.

Verify:
```bash
pnpm --filter @twin/core build && pnpm --filter @twin/api build && pnpm --filter @twin/api test
```

Expected: 0 build errors. All prior tests pass + new schema/type tests pass.

---

## Phase B — PII Middleware (cross-spec backfill)

2 tasks. Promotes redactPayload to a Fastify preHandler applied across all `/api/ingest/*` routes, including Spec 1's existing loan and document endpoints. Adds pino redact config.

### Task 3: `pii-middleware.ts` + redactPayload + tests

**Files:**
- Create: `packages/api/src/ingestion/pii-middleware.ts`
- Test: `packages/api/test/pii-middleware.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/test/pii-middleware.test.ts
import { describe, it, expect } from "vitest";
import { redactPayload, redactPayloadMiddleware } from "../src/ingestion/pii-middleware.js";

describe("redactPayload", () => {
  it("masks 9-digit SSN values keeping last 4 digits", () => {
    const input = { borrower: { ssn: "605827691", name: "Test User" } };
    const out = redactPayload(input) as typeof input;
    expect(out.borrower.ssn).toBe("xxx-xx-7691");
    expect(out.borrower.name).toBe("Test User");
  });

  it("masks dashed SSN (123-45-6789)", () => {
    const input = { borrower: { ssn: "123-45-6789" } };
    const out = redactPayload(input) as typeof input;
    expect(out.borrower.ssn).toBe("xxx-xx-6789");
  });

  it("recurses into nested arrays", () => {
    const input = {
      analysisOutput: {
        scenario_summary: {
          borrowers: [
            { ssn: "123456789", name: "A" },
            { ssn: "987654321", name: "B" },
          ],
        },
      },
    };
    const out = redactPayload(input) as typeof input;
    expect(out.analysisOutput.scenario_summary.borrowers[0]!.ssn).toBe("xxx-xx-6789");
    expect(out.analysisOutput.scenario_summary.borrowers[1]!.ssn).toBe("xxx-xx-4321");
  });

  it("preserves non-SSN strings unchanged", () => {
    const input = { property: { county: "King County", zip: "98004" } };
    const out = redactPayload(input) as typeof input;
    expect(out.property.county).toBe("King County");
    expect(out.property.zip).toBe("98004");
  });

  it("doesn't mutate the input object", () => {
    const input = { borrower: { ssn: "605827691" } };
    const _out = redactPayload(input);
    expect(input.borrower.ssn).toBe("605827691");
  });

  it("performance: <50ms for a 100KB payload", () => {
    const large = {
      analysisOutput: {
        scenario_summary: {
          borrowers: Array.from({ length: 100 }, (_, i) => ({
            ssn: `${String(i).padStart(9, "0")}`,
            name: `Borrower ${i}`,
            address: `${i} Main St`,
          })),
          extra: "x".repeat(50_000),
        },
      },
    };
    const json = JSON.stringify(large);
    expect(json.length).toBeGreaterThan(50_000);
    const t0 = performance.now();
    redactPayload(large);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });
});

describe("redactPayloadMiddleware", () => {
  it("calls redactPayload on req.body for /api/ingest/* requests", async () => {
    const req = {
      url: "/api/ingest/test-tenant/analysis-output",
      body: { borrower: { ssn: "123456789" } },
    } as never;
    const reply = {} as never;
    await redactPayloadMiddleware(req, reply);
    expect((req as { body: { borrower: { ssn: string } } }).body.borrower.ssn).toBe("xxx-xx-6789");
  });

  it("skips non-/api/ingest paths", async () => {
    const req = {
      url: "/loans/X/predictions/run",
      body: { borrower: { ssn: "123456789" } },
    } as never;
    const reply = {} as never;
    await redactPayloadMiddleware(req, reply);
    expect((req as { body: { borrower: { ssn: string } } }).body.borrower.ssn).toBe("123456789");
  });

  it("no-op when body is absent or non-object", async () => {
    const req1 = { url: "/api/ingest/x/loans", body: undefined } as never;
    await redactPayloadMiddleware(req1, {} as never);
    expect((req1 as { body: unknown }).body).toBeUndefined();

    const req2 = { url: "/api/ingest/x/loans", body: "raw" } as never;
    await redactPayloadMiddleware(req2, {} as never);
    expect((req2 as { body: unknown }).body).toBe("raw");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test pii-middleware.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
// packages/api/src/ingestion/pii-middleware.ts
import type { FastifyRequest, FastifyReply } from "fastify";

const SSN_DASHED = /^\d{3}-\d{2}-(\d{4})$/;
const SSN_RAW = /^\d{9}$/;
const SSN_DASHED_INLINE = /\b\d{3}-\d{2}-(\d{4})\b/g;
const SSN_RAW_INLINE = /\b\d{9}\b/g;

function maskValue(s: string): string {
  let m = s.match(SSN_DASHED);
  if (m) return `xxx-xx-${m[1]}`;
  m = s.match(SSN_RAW);
  if (m) return `xxx-xx-${s.slice(-4)}`;
  // Inline match (e.g., embedded in a longer string).
  let out = s.replace(SSN_DASHED_INLINE, (_, last4) => `xxx-xx-${last4}`);
  out = out.replace(SSN_RAW_INLINE, (match) => `xxx-xx-${match.slice(-4)}`);
  return out;
}

function walk(node: unknown): unknown {
  if (node === null || typeof node !== "object") {
    return typeof node === "string" ? maskValue(node) : node;
  }
  if (Array.isArray(node)) {
    return node.map(walk);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out[k] = walk(v);
  }
  return out;
}

/** Deep-clones + redacts SSN-shaped strings. Non-mutating. */
export function redactPayload(input: unknown): unknown {
  return walk(input);
}

/**
 * Fastify preHandler — applies redactPayload to req.body for /api/ingest/* paths.
 * Other routes pass through unchanged.
 */
export async function redactPayloadMiddleware(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!req.url.startsWith("/api/ingest/")) return;
  if (!req.body || typeof req.body !== "object") return;
  // Cast through unknown — we mutate req.body in place via reassignment.
  (req as unknown as { body: unknown }).body = redactPayload(req.body);
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @twin/api build && pnpm --filter @twin/api test pii-middleware.test
```

Expected: 0 build errors. 9 tests pass (6 redactPayload + 3 middleware).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/pii-middleware.ts packages/api/test/pii-middleware.test.ts
git commit -m "feat(api/ingestion): pii-middleware — cross-endpoint SSN redaction

Spec 1.5 R1 backfill. redactPayload walks an object tree masking 9-digit
and dashed-SSN strings to xxx-xx-NNNN (preserving last 4). Non-mutating
deep clone. redactPayloadMiddleware applies the redaction to req.body for
all /api/ingest/* paths. Closes the Spec 1 PII gap surfaced by real
sample payloads carrying unmasked SSN."
```

---

### Task 4: Wire middleware + pino redact config

**Files:**
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Locate the existing Fastify init**

```bash
grep -n "fastify\|buildServer\|registerXxx\|app.addHook" packages/api/src/server.ts | head -20
```

Note where Fastify is constructed (`fastify({...})`), where `logger` options live, and where `app.addHook` patterns appear (look at the JWT tenant-resolver pattern for reference).

- [ ] **Step 2: Configure pino redact paths**

In `packages/api/src/server.ts`, find where the Fastify instance is created. Update the logger config to include redact:

```ts
import Fastify from "fastify";

const app = Fastify({
  logger: {
    redact: {
      paths: [
        "req.body.*.ssn",
        "req.body.*.*.ssn",
        "req.body.borrowers[*].ssn",
        "req.body.loanData.borrower.ssnMasked",          // defensive — also mask already-masked
        "req.body.analysisOutput.scenario_summary.borrowers[*].ssn",
        "req.body.analysisOutput.scenario_summary.borrowers[*].dob",  // DOB paired with name is PII
      ],
      censor: "[REDACTED]",
    },
    // ... preserve any other existing logger options (level, transport, etc.)
  },
});
```

Note: pino's `redact.paths` accepts a bracket-array syntax (`borrowers[*].ssn`) — this is pino-specific, not standard JSONPath.

- [ ] **Step 3: Register the middleware**

Find where other addHook calls live (e.g., `registerJwtTenantResolver`). Add at the top of `buildServer` BEFORE route registrations:

```ts
import { redactPayloadMiddleware } from "./ingestion/pii-middleware.js";
// ... inside buildServer, before any route registration:
app.addHook("preHandler", redactPayloadMiddleware);
```

Order matters: this hook must run BEFORE per-route preHandlers (like `apiKeyAuthHook`). Fastify runs hooks in registration order, so register `redactPayloadMiddleware` first.

- [ ] **Step 4: Add an end-to-end test that proves the middleware fires on Spec 1's endpoints too**

Append to `packages/api/test/pii-middleware.test.ts`:

```ts
import { describe as describe2, it as it2, expect as expect2, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { withDb, closePool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";
import { createHash } from "node:crypto";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee08";
const KEY = "piimid_abcdef0123456789abcdef0123456789";
const KEY_HASH = createHash("sha256").update(KEY).digest("hex");

let app: FastifyInstance;

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(`INSERT INTO tenants (id, name, slug, status, type) VALUES ($1, 'PII Test', 'pii-mid-test', 'active', 'demo') ON CONFLICT (id) DO NOTHING`, [T]);
    await c.query(`INSERT INTO tenant_api_keys (tenant_id, key_hash, key_prefix, name, rate_limit_per_minute) VALUES ($1, $2, 'piimid_a', 'test', 1000) ON CONFLICT DO NOTHING`, [T, KEY_HASH]);
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id=$1`, [T]);
    await c.query(
      `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
       VALUES ($1, 'encompass-los', 'encompass-los', 'encompass-los', $2::jsonb, '{}'::jsonb, true)`,
      [T, JSON.stringify({ identityPrefix: "PII-", allowedFetchHosts: [], maxFileBytes: 50_000_000 })],
    );
  });
  app = buildServer({}).app;
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await withDb(async (c) => {
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM tenant_api_keys WHERE tenant_id=$1`, [T]);
  });
  await closePool();
});

describe2("redactPayloadMiddleware applied to Spec 1's loan endpoint", () => {
  it2("strips SSN from /loans payload before adapter dispatch", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ingest/pii-mid-test/loans",
      headers: { authorization: `Bearer ${KEY}` },
      payload: {
        source: "encompass-los",
        externalId: "PII-LOAN-1",
        loanData: {
          loanNumber: "PII-LOAN-1",
          borrower: { fullName: "Test", ssn: "987654321", dob: "1990-01-01", ssnMasked: "xxx-xx-0000", maritalStatus: "Unmarried" },
          transaction: { loanAmount: 100, salesPrice: 100, appraisedValue: 100, ltv: 50, noteRate: 7, term: 360, amortType: "Fixed", occupancy: "Primary", loanPurpose: "Purchase", piti: 1 },
        },
      },
    });
    expect2(res.statusCode).toBe(201);
    // Verify the stored loan in the DB doesn't carry the raw SSN.
    const { rows } = await withDb(async (c) => c.query<{ external_id: string }>(
      `SELECT external_id FROM ingested_loans WHERE tenant_id=$1 AND loan_id='PII-PII-LOAN-1'`, [T]));
    expect2(rows.length).toBe(1);
    // The raw SSN must NEVER appear anywhere in the stored loan. Search the in-memory store explicitly.
    // (If the adapter wrote SSN into loan.borrower somewhere, this test catches it.)
    const loanRes = await app.inject({
      method: "GET",
      url: "/loans/PII-PII-LOAN-1",
      headers: { "x-user-id": "test", "x-tenant-id": T, "x-user-role": "operator" },
    });
    expect2(loanRes.statusCode).toBe(200);
    expect2(loanRes.body).not.toContain("987654321");
  });
});
```

- [ ] **Step 5: Verify the test passes**

```bash
pnpm --filter @twin/api build && pnpm --filter @twin/api test pii-middleware.test
```

Expected: 0 build errors. All tests pass including the new cross-endpoint integration test.

- [ ] **Step 6: Boot the API and confirm pino doesn't log raw SSN**

```bash
timeout 10 pnpm --filter @twin/api dev 2>&1 | grep -c "987654321" || echo "OK: no raw SSN in logs"
```

(This is informational — pino redact applies to any future log that captures `req.body.*.ssn`. Confirming no SSN appears in the boot logs is a coarse check.)

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/server.ts packages/api/test/pii-middleware.test.ts
git commit -m "feat(api): wire pii-middleware at boot + pino redact config

redactPayloadMiddleware registered as a top-level preHandler — runs
BEFORE per-route hooks like apiKeyAuthHook so SSN gets stripped before
the route handler ever sees it. pino logger.redact paths cover SSN +
DOB in both loanData and analysisOutput shapes. Closes the cross-spec
PII gap for /api/ingest/* endpoints (Spec 1 + Spec 1.5)."
```

---

## Phase B complete — checkpoint

After tasks 3-4: PII middleware live on all `/api/ingest/*` routes. Spec 1's `/loans` and `/documents` endpoints now benefit from the same redaction the new analysis-output endpoint will use.

Verify:
```bash
pnpm --filter @twin/api test
```

Expected: full API test suite passes.

---

## Phase C — `NPNQMPortalAdapter` rewrite

2 tasks. Add `transformAnalysisOutput` against real samples; rewrite existing methods for the real `scenario_summary` shape with back-compat.

### Task 5: `NPNQMPortalAdapter.transformAnalysisOutput` + golden tests

**Files:**
- Modify: `packages/api/src/ingestion/adapters/npnqm-portal.ts`
- Test: `packages/api/test/adapter-npnqm-portal-analysis.test.ts`

- [ ] **Step 1: Write the failing golden-file tests against the 5 real samples**

```ts
// packages/api/test/adapter-npnqm-portal-analysis.test.ts
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { NPNQMPortalAdapter } from "../src/ingestion/adapters/npnqm-portal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "fixtures/portal-analysis");

function loadSample(loan: string): unknown {
  return JSON.parse(readFileSync(join(FIX, `${loan}_output.json`), "utf8"));
}

describe("NPNQMPortalAdapter.transformAnalysisOutput — real samples", () => {
  const adapter = new NPNQMPortalAdapter();
  const config = {
    allowedFetchHosts: ["docs.npnqm-portal.example.com"],
    maxFileBytes: 50_000_000,
    identityPrefix: "NPNQM-" as const,
  };

  it.each([
    ["aubrey", 17],
    ["montes", 17],
    ["niccum", 17],
    ["nyarko", 18],
    ["weingarten", 16],
  ])("transforms %s sample with %d predictions", (loan, expectedCount) => {
    const sample = loadSample(loan);
    const result = adapter.transformAnalysisOutput(sample, config);
    expect(result.portalPredictions.length).toBe(expectedCount);
    expect(result.loan.transaction?.loanAmount).toBeGreaterThan(0);
    expect(result.eligibilityVerdict.eligiblePrograms.length).toBeGreaterThan(0);
    expect(result.stats.totalDocumentRequests).toBe(expectedCount);
    expect(result.stats.elapsedSeconds).toBeGreaterThan(0);
    expect(result.stats.toolCalls).toBeGreaterThan(0);
  });

  it("aubrey: extracts FICO 800, county King/Sacramento, DSCR income type", () => {
    const result = adapter.transformAnalysisOutput(loadSample("aubrey"), config);
    expect(result.extras.repFico).toBe(800);
    // aubrey is in Sacramento County (per sample data)
    expect(result.extras.county).toBe("Sacramento");
    expect(result.extras.primaryIncomeType).toBe("DSCR");
  });

  it("aubrey: PortalPrediction shape carries spec'd fields", () => {
    const result = adapter.transformAnalysisOutput(loadSample("aubrey"), config);
    const cred = result.portalPredictions.find((p) => p.documentType === "Credit Report");
    expect(cred).toBeDefined();
    expect(cred!.documentCategory).toBe("Credit");
    expect(cred!.priority).toBe("P0");
    expect(cred!.severity).toBe("SOFT-STOP");
    expect(cred!.portalStatus).toBe("needed");
    expect(cred!.specifications.length).toBeGreaterThan(0);
    expect(cred!.reasonsNeeded.length).toBeGreaterThan(0);
  });

  it("eligibility verdict captures eligible + ineligible programs", () => {
    const result = adapter.transformAnalysisOutput(loadSample("aubrey"), config);
    expect(result.eligibilityVerdict.eligiblePrograms).toContain("Investor DSCR");
    expect(result.eligibilityVerdict.ineligiblePrograms.length).toBeGreaterThan(0);
    const dscr = result.eligibilityVerdict.perProgram.find((p) => p.program === "Investor DSCR");
    expect(dscr).toBeDefined();
    expect(dscr!.status).toBe("PASS");
  });

  it("occupancy 'NOO' is canonicalized to 'Investment'", () => {
    const result = adapter.transformAnalysisOutput(loadSample("aubrey"), config);
    // aubrey is NOO in the sample
    expect(result.extras.occupancy).toBe("Investment");
  });

  it("loan purpose 'Delayed Financing' is canonicalized to 'Cash-Out Refinance'", () => {
    const result = adapter.transformAnalysisOutput(loadSample("aubrey"), config);
    // aubrey purpose is Delayed Financing
    expect(result.extras.loanPurpose).toBe("Cash-Out Refinance");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test adapter-npnqm-portal-analysis.test
```

Expected: FAIL — `transformAnalysisOutput` not implemented on `NPNQMPortalAdapter`.

- [ ] **Step 3: Implement `transformAnalysisOutput`**

Open `packages/api/src/ingestion/adapters/npnqm-portal.ts`. Add at the bottom of the class (before the final closing brace) plus the required types at the top of the file:

```ts
// At top of file, expand imports:
import type { Loan, LoanContextExtras, NqmProgram, AdapterConfig } from "@twin/core";
import {
  LenderAdapter,
  MissingExternalIdError,
  type DocumentMetadataInput,
  type ValidationResult,
  type PortalPrediction,
  type PortalDocCategory,
  type EligibilityVerdict,
  type PortalAnalysisStats,
  type TransformAnalysisOutput,
} from "../lender-adapter.js";

// Inside the class:
  transformAnalysisOutput(raw: unknown, config: AdapterConfig): TransformAnalysisOutput {
    const r = raw as Record<string, unknown>;
    const ao = (r.analysisOutput ?? r) as Record<string, unknown>;  // accept either {analysisOutput:...} envelope or raw output
    const scenario = (ao.scenario_summary ?? {}) as Record<string, unknown>;
    const docRequests = (ao.document_requests ?? []) as Array<Record<string, unknown>>;
    const stats = (ao.stats ?? {}) as Record<string, unknown>;
    const seenConflicts = (ao.seen_conflicts ?? []) as string[];

    const loanPartial = this.scenarioToLoan(scenario, config);
    const extras = this.scenarioToExtras(scenario);
    const portalPredictions = docRequests.map((dr) => this.docRequestToPortalPrediction(dr));
    const eligibilityVerdict = this.scenarioToEligibilityVerdict(scenario);
    const statsTyped: PortalAnalysisStats = {
      totalDocumentRequests: (stats.total_document_requests as number) ?? 0,
      hardStopDocuments: (stats.hard_stop_documents as number) ?? 0,
      elapsedSeconds: (stats.elapsed_seconds as number) ?? 0,
      toolCalls: (stats.tool_calls as number) ?? 0,
      byCategory: (stats.by_category ?? {}) as Record<string, number>,
      byPriority: (stats.by_priority ?? {}) as Record<string, number>,
      byStatus: (stats.by_status ?? {}) as Record<string, number>,
    };
    return {
      loan: loanPartial,
      extras,
      portalPredictions,
      eligibilityVerdict,
      seenConflicts,
      stats: statsTyped,
    };
  }

  private scenarioToLoan(scenario: Record<string, unknown>, config: AdapterConfig): Partial<Loan> {
    const lenderProgram = scenario.program as string | undefined;
    const program = (lenderProgram && config.programMapping?.[lenderProgram]) ?? lenderProgram ?? undefined;
    const property = (scenario.property ?? {}) as Record<string, unknown>;
    const numbers = (scenario.numbers ?? {}) as Record<string, unknown>;
    const loanTerms = (scenario.loan_terms ?? {}) as Record<string, unknown>;
    const borrowers = (scenario.borrowers ?? []) as Array<Record<string, unknown>>;
    const primary = borrowers[0] ?? {};
    return {
      nqmProgram: program as NqmProgram | undefined,
      borrower: {
        fullName: (primary.name as string) ?? "Unknown",
        ssnMasked: (primary.ssn as string) ?? "xxx-xx-0000",  // already redacted by middleware
        dob: (primary.dob as string) ?? "1990-01-01",
        maritalStatus: "Unmarried",  // not in scenario_summary; default
      },
      transaction: {
        loanPurpose: (this.canonicalizeLoanPurpose(scenario.purpose as string | undefined) ?? "Purchase") as never,
        loanAmount: (numbers.loan_amount as number) ?? 0,
        salesPrice: (numbers.purchase_price as number) ?? 0,
        appraisedValue: (numbers.appraised_value as number) ?? 0,
        ltv: (numbers.LTV as number) ?? 0,
        cltv: (numbers.CLTV as number) ?? 0,
        hcltv: (numbers.CLTV as number) ?? 0,  // hcltv often equals cltv when no HELOC
        noteRate: (numbers.note_rate as number) ?? 7,
        term: (loanTerms.term_months as number) ?? 360,
        amortType: (loanTerms.amortization_type as string) === "Fixed" ? "Fixed" : "ARM" as never,
        lienPosition: 1 as 1 | 2,
        occupancy: (this.canonicalizeOccupancy(scenario.occupancy as string | undefined) ?? "Primary") as never,
        isInvestmentProperty: this.canonicalizeOccupancy(scenario.occupancy as string | undefined) === "Investment",
        piti: 0,
      },
    };
  }

  private scenarioToExtras(scenario: Record<string, unknown>): Partial<LoanContextExtras> {
    const numbers = (scenario.numbers ?? {}) as Record<string, unknown>;
    const credit = (scenario.credit ?? {}) as Record<string, unknown>;
    const property = (scenario.property ?? {}) as Record<string, unknown>;
    const loanTerms = (scenario.loan_terms ?? {}) as Record<string, unknown>;
    const borrowers = (scenario.borrowers ?? []) as Array<Record<string, unknown>>;
    const primary = borrowers[0] ?? {};
    const assetProfile = (scenario.asset_profile ?? {}) as Record<string, unknown>;
    const reoSummary = (scenario.reo_summary ?? {}) as Record<string, unknown>;
    const incomeProfile = (scenario.income_profile ?? {}) as Record<string, unknown>;
    const declarations = (credit.declarations ?? {}) as Record<string, unknown>;
    const ownedProperties = (scenario.owned_properties ?? []) as unknown[];

    const out: Partial<LoanContextExtras> = {};
    const fico = credit.fico as number | undefined;
    if (typeof fico === "number" && fico >= 300 && fico <= 900) out.repFico = fico;
    if (typeof numbers.LTV === "number") out.ltv = numbers.LTV;
    if (typeof numbers.CLTV === "number") out.cltv = numbers.CLTV;
    if (typeof numbers.loan_amount === "number") out.loanAmount = numbers.loan_amount;
    const purpose = this.canonicalizeLoanPurpose(scenario.purpose as string | undefined);
    if (purpose) out.loanPurpose = purpose;
    if (typeof property.property_type === "string") out.propertyType = property.property_type;
    if (typeof numbers.DTI === "number") out.dti = numbers.DTI;
    if (typeof assetProfile.months_reserves === "number") out.reservesMonths = assetProfile.months_reserves;
    if (typeof numbers.note_rate === "number") out.noteRate = numbers.note_rate;
    if (typeof property.county === "string") out.county = property.county;
    const citizenship = primary.citizenship as string | undefined;
    out.isItin = citizenship === "ITIN";
    out.llcOrLegalEntity = scenario.borrower_type !== undefined && scenario.borrower_type !== "Individual" && scenario.borrower_type !== "Wage Earner";
    const occ = this.canonicalizeOccupancy(scenario.occupancy as string | undefined);
    if (occ) out.occupancy = occ;
    if (typeof property.state === "string" && property.state.length === 2) out.state = property.state;
    if (typeof property.units === "number") out.units = property.units;
    if (ownedProperties.length > 0) out.ownedPropertiesCount = ownedProperties.length;
    if (typeof reoSummary.total_lien_balance === "number") out.reoTotalLienBalance = reoSummary.total_lien_balance;
    if (typeof reoSummary.subject_property_rental_income === "number") out.subjectRentalIncome = reoSummary.subject_property_rental_income;
    if (typeof scenario.is_fthb === "boolean") out.isFirstTimeHomebuyer = scenario.is_fthb;
    if (typeof scenario.borrower_type === "string") out.borrowerType = scenario.borrower_type;
    if (typeof scenario.channel === "string") out.channel = scenario.channel;
    if (typeof scenario.product_variant === "string") out.productVariant = scenario.product_variant;
    if (typeof loanTerms.interest_only === "boolean") out.interestOnly = loanTerms.interest_only;
    if (typeof loanTerms.prepay_penalty === "boolean") out.prepayPenalty = loanTerms.prepay_penalty;
    if (typeof loanTerms.balloon === "boolean") out.balloon = loanTerms.balloon;
    if (typeof credit.is_us_credit === "boolean") out.isUsCredit = credit.is_us_credit;
    if (typeof citizenship === "string") out.citizenship = citizenship;
    if (typeof primary.self_employed === "boolean") out.selfEmployed = primary.self_employed;
    if (typeof incomeProfile.primary_income_type === "string") out.primaryIncomeType = incomeProfile.primary_income_type;
    if (typeof declarations.BankruptcyIndicator === "boolean") out.bankruptcyHistory = declarations.BankruptcyIndicator;
    if (typeof declarations.PriorPropertyForeclosureCompletedIndicator === "boolean") out.foreclosureHistory = declarations.PriorPropertyForeclosureCompletedIndicator;
    if (typeof declarations.PriorPropertyShortSaleCompletedIndicator === "boolean") out.shortSaleHistory = declarations.PriorPropertyShortSaleCompletedIndicator;
    if (typeof declarations.PresentlyDelinquentIndicator === "boolean") out.presentlyDelinquent = declarations.PresentlyDelinquentIndicator;
    if (typeof declarations.OutstandingJudgmentsIndicator === "boolean") out.outstandingJudgments = declarations.OutstandingJudgmentsIndicator;
    return out;
  }

  private docRequestToPortalPrediction(dr: Record<string, unknown>): PortalPrediction {
    const portalStatus = (dr.status as string) ?? "needed";
    const KNOWN_STATUSES = new Set(["needed", "satisfied", "waived", "deferred"]);
    if (!KNOWN_STATUSES.has(portalStatus)) {
      console.warn(`[npnqm-portal] unknown portalStatus value "${portalStatus}" — passing through`);
    }
    return {
      documentType: (dr.document_type as string) ?? "Other",
      documentCategory: (dr.document_category as PortalDocCategory) ?? "Cross-Cutting",
      priority: (dr.priority as "P0" | "P1" | "P2") ?? "P1",
      appliesTo: (dr.applies_to as string) ?? "all_borrowers",
      specifications: (dr.specifications as string[]) ?? [],
      reasonsNeeded: (dr.reasons_needed as string[]) ?? [],
      conditions: (dr.conditions as string[]) ?? [],
      sourceReferences: (dr.source_references as string[]) ?? [],
      severity: (dr.severity as "HARD-STOP" | "SOFT-STOP") ?? "SOFT-STOP",
      portalStatus,
      tags: (dr.tags as string[]) ?? [],
      sourceModule: (dr.source_module as string) ?? "",
    };
  }

  private scenarioToEligibilityVerdict(scenario: Record<string, unknown>): EligibilityVerdict {
    const detail = (scenario.program_eligibility_detail ?? {}) as Record<string, Record<string, unknown>>;
    return {
      eligiblePrograms: (scenario.eligible_programs as string[]) ?? [],
      ineligiblePrograms: (scenario.ineligible_programs as string[]) ?? [],
      perProgram: Object.entries(detail).map(([program, d]) => ({
        program,
        status: (d.status as "PASS" | "FAIL") ?? "FAIL",
        passedCount: (d.passed_count as number) ?? 0,
        failedCount: (d.failed_count as number) ?? 0,
        failedRules: ((d.failed_rules as Array<Record<string, string>>) ?? []).map((fr) => ({
          requirement: fr.requirement ?? "",
          message: fr.message ?? "",
        })),
      })),
    };
  }

  private canonicalizeOccupancy(value: string | undefined): "Primary" | "Secondary" | "Investment" | undefined {
    if (!value) return undefined;
    const v = value.trim();
    if (v === "Primary Residence" || v === "Owner Occupied" || v === "Primary") return "Primary";
    if (v === "Second Home" || v === "Secondary") return "Secondary";
    if (v === "NOO" || v === "Investment Property" || v === "Non-Owner Occupied" || v === "Investment") return "Investment";
    return undefined;
  }

  private canonicalizeLoanPurpose(value: string | undefined): "Purchase" | "Rate & Term Refinance" | "Cash-Out Refinance" | undefined {
    if (!value) return undefined;
    const v = value.trim();
    if (v === "Purchase") return "Purchase";
    if (v === "Rate and Term" || v === "Rate/Term" || v === "Rate/Term Refinance" || v === "Rate-Term") return "Rate & Term Refinance";
    if (v === "Cash-Out Refinance" || v === "Delayed Financing" || v === "Cash Out") return "Cash-Out Refinance";
    return undefined;
  }
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @twin/api build && pnpm --filter @twin/api test adapter-npnqm-portal-analysis.test
```

Expected: 0 build errors. 9 tests pass.

If any field-path assertion fails because the real sample has a different shape than this code assumes (e.g., the `aubrey` county is "Sacramento" but I wrote `expect(extras.county).toBe("King County")` somewhere), adjust either the test assertion or the field-path in the implementation. The fixtures are the ground truth.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/adapters/npnqm-portal.ts packages/api/test/adapter-npnqm-portal-analysis.test.ts
git commit -m "feat(api/ingestion): NPNQMPortalAdapter.transformAnalysisOutput

Converts the portal's analyzed <loan>_output.json into our domain shape.
Reads document_requests → PortalPrediction[], scenario_summary →
Partial<Loan> + LoanContextExtras (32-field expansion), program_eligibility_detail
→ EligibilityVerdict. Canonicalizes occupancy ('NOO' → 'Investment') and
loan purpose ('Delayed Financing' → 'Cash-Out Refinance') at the adapter.
Logs warn on unknown portalStatus values (forward-compat)."
```

---

### Task 6: NPNQMPortalAdapter — back-compat for transformLoan + MissingExternalIdError

**Files:**
- Modify: `packages/api/src/ingestion/adapters/npnqm-portal.ts`
- Test: `packages/api/test/adapter-npnqm-portal.test.ts`

This task closes the gap so the existing loan-channel path still works after the adapter is rewritten. Real portal payloads to `/api/ingest/.../loans` (vs the new `/analysis-output`) should also be handled. Plus: throw `MissingExternalIdError` when external_id can't be extracted.

- [ ] **Step 1: Update the existing tests + add MissingExternalIdError test**

Edit `packages/api/test/adapter-npnqm-portal.test.ts`. Append:

```ts
import { MissingExternalIdError } from "../src/ingestion/lender-adapter.js";

describe("NPNQMPortalAdapter — Spec 1.5 back-compat + error handling", () => {
  const adapter = new NPNQMPortalAdapter();
  const config = {
    allowedFetchHosts: ["docs.npnqm-portal.example.com"],
    maxFileBytes: 50_000_000,
    identityPrefix: "NPNQM-" as const,
  };

  it("transformLoan reads from scenario_summary when present (new shape)", () => {
    const raw = {
      scenario_summary: {
        loan_number: "NEW-SHAPE-1",
        program: "Investor DSCR",
        numbers: { loan_amount: 350000, LTV: 65, note_rate: 7.5 },
        borrowers: [{ name: "Test", ssn: "xxx-xx-1234", dob: "1980-01-01" }],
        property: { state: "WA", property_type: "SFR", county: "King" },
        occupancy: "NOO",
        purpose: "Purchase",
      },
    };
    const partial = adapter.transformLoan(raw, config);
    expect(partial.transaction?.loanAmount).toBe(350000);
    expect(partial.borrower?.fullName).toBe("Test");
  });

  it("transformLoan falls back to top-level fields when scenario_summary is absent (old shape)", () => {
    const raw = {
      borrowerCaseId: "OLD-SHAPE-1",
      selectedProgram: "Flex Select",
      loanAmount: 500000,
      ltv: 80,
      borrower: { fullName: "Old", ssnMasked: "x", dob: "1980-01-01" },
    };
    const partial = adapter.transformLoan(raw, config);
    expect(partial.transaction?.loanAmount).toBe(500000);
  });

  it("extractExternalLoanId throws MissingExternalIdError when no identifier is present", () => {
    expect(() => adapter.extractExternalLoanId({})).toThrow(MissingExternalIdError);
  });

  it("extractExternalLoanId prefers scenario_summary.loan_number > borrowerCaseId > externalId", () => {
    expect(adapter.extractExternalLoanId({ scenario_summary: { loan_number: "NEW-1" }, borrowerCaseId: "OLD-1", externalId: "ENV-1" }))
      .toBe("NEW-1");
    expect(adapter.extractExternalLoanId({ borrowerCaseId: "OLD-2", externalId: "ENV-2" }))
      .toBe("OLD-2");
    expect(adapter.extractExternalLoanId({ externalId: "ENV-3" }))
      .toBe("ENV-3");
  });
});
```

- [ ] **Step 2: Run test to verify failures**

```bash
pnpm --filter @twin/api test adapter-npnqm-portal.test
```

Expected: FAILs on the new-shape transformLoan test, the MissingExternalIdError test (currently returns "" or throws plain Error), and the preference-order test.

- [ ] **Step 3: Update `transformLoan` + `deriveContextFields` + `extractExternalLoanId`**

In `packages/api/src/ingestion/adapters/npnqm-portal.ts`, replace the existing implementations of those three methods. The `scenarioToLoan` / `scenarioToExtras` private helpers from Task 5 are reused:

```ts
  extractExternalLoanId(raw: unknown): string {
    const r = raw as Record<string, unknown>;
    const scenario = r.scenario_summary as Record<string, unknown> | undefined;
    const fromScenario = scenario?.loan_number as string | undefined;
    const fromCase = r.borrowerCaseId as string | undefined;
    const fromEnvelope = r.externalId as string | undefined;
    const id = fromScenario || fromCase || fromEnvelope;
    if (!id) {
      throw new MissingExternalIdError(
        `npnqm-portal: payload missing scenario_summary.loan_number, borrowerCaseId, and externalId`,
      );
    }
    return id;
  }

  transformLoan(raw: unknown, config: AdapterConfig): Partial<Loan> {
    const r = raw as Record<string, unknown>;
    const scenario = r.scenario_summary as Record<string, unknown> | undefined;
    if (scenario) return this.scenarioToLoan(scenario, config);
    // Back-compat: legacy shape with flat top-level fields.
    return this.legacyTopLevelToLoan(r, config);
  }

  deriveContextFields(loan: Loan, raw: unknown, _config: AdapterConfig): Partial<LoanContextExtras> {
    const r = raw as Record<string, unknown>;
    const scenario = r.scenario_summary as Record<string, unknown> | undefined;
    if (scenario) return this.scenarioToExtras(scenario);
    // Back-compat: derive from already-built Loan + flat top-level fields.
    return this.legacyTopLevelToExtras(loan, r);
  }

  // Preserve the prior implementations under the legacy-* names:
  private legacyTopLevelToLoan(raw: Record<string, unknown>, config: AdapterConfig): Partial<Loan> {
    // (Move the body of the previous transformLoan implementation here unchanged.)
    // ... existing pre-Spec-1.5 implementation reading top-level loanAmount, ltv, etc.
  }

  private legacyTopLevelToExtras(loan: Loan, raw: Record<string, unknown>): Partial<LoanContextExtras> {
    // (Move the body of the previous deriveContextFields implementation here unchanged.)
  }
```

If `MissingExternalIdError` isn't already imported, add it to the existing imports.

- [ ] **Step 4: Verify all NPNQMPortalAdapter tests pass**

```bash
pnpm --filter @twin/api build && pnpm --filter @twin/api test adapter-npnqm-portal
```

Expected: 0 build errors. All tests in both `adapter-npnqm-portal.test.ts` AND `adapter-npnqm-portal-analysis.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/adapters/npnqm-portal.ts packages/api/test/adapter-npnqm-portal.test.ts
git commit -m "feat(api/ingestion): NPNQMPortalAdapter — back-compat + MissingExternalIdError

transformLoan/deriveContextFields prefer scenario_summary.* when present
(new portal shape from Spec 1.5) and fall back to legacy top-level fields
for back-compat with synthetic fixtures and any non-portal-source NPNQM
push. extractExternalLoanId throws MissingExternalIdError when none of
scenario_summary.loan_number, borrowerCaseId, or externalId is present —
prevents the 'NPNQM-undefined' collision bug."
```

---

## Phase C complete — checkpoint

After tasks 5-6: `NPNQMPortalAdapter` consumes real portal samples via `transformAnalysisOutput`; loan-channel back-compat preserved.

Verify:
```bash
pnpm --filter @twin/api test -- adapter-npnqm-portal
```

Expected: all NPNQMPortalAdapter tests pass.

---

## Phase D — Endpoint + persistence

2 tasks. New `/analysis-output` endpoint with three-branch idempotency; portal prediction + eligibility verdict persistence; PC v2 second-opinion auto-fire; eligibility-disagreement audit.

### Task 7: `POST /api/ingest/:tenantSlug/analysis-output` route + idempotency

**Files:**
- Create: `packages/api/src/routes/analysis-output-ingest.ts`
- Modify: `packages/api/src/server.ts` (register the route)
- Test: `packages/api/test/analysis-output-ingest.integration.test.ts`

- [ ] **Step 1: Write the failing integration test (focus on idempotency + error contracts)**

```ts
// packages/api/test/analysis-output-ingest.integration.test.ts
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath, join } from "node:path";
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
import type { FastifyInstance } from "fastify";
import { withDb, closePool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";
import { createHash } from "node:crypto";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee09";
const KEY = "aotest_abcdef0123456789abcdef0123456789";
const KEY_HASH = createHash("sha256").update(KEY).digest("hex");

let app: FastifyInstance;

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(`INSERT INTO tenants (id, name, slug, status, type) VALUES ($1, 'AO Test', 'ao-test', 'active', 'demo') ON CONFLICT (id) DO NOTHING`, [T]);
    await c.query(`INSERT INTO tenant_api_keys (tenant_id, key_hash, key_prefix, name, rate_limit_per_minute) VALUES ($1, $2, 'aotest_a', 'test', 1000) ON CONFLICT DO NOTHING`, [T, KEY_HASH]);
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id=$1`, [T]);
    await c.query(
      `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
       VALUES ($1, 'npnqm-portal', 'npnqm-portal', 'npnqm-portal', $2::jsonb, '{}'::jsonb, true)`,
      [T, JSON.stringify({ identityPrefix: "NPNQM-", allowedFetchHosts: ["docs.npnqm-portal.example.com"], maxFileBytes: 50_000_000 })],
    );
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM predicted_conditions WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM portal_eligibility_verdicts WHERE tenant_id=$1`, [T]);
  });
  app = buildServer({}).app;
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await withDb(async (c) => {
    await c.query(`DELETE FROM portal_eligibility_verdicts WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM predicted_conditions WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM tenant_api_keys WHERE tenant_id=$1`, [T]);
  });
  await closePool();
});

function loadSample(name: string): unknown {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(__dirname, "fixtures/portal-analysis", name), "utf8"));
}

describe("POST /api/ingest/:tenantSlug/analysis-output", () => {
  it("accepts a real sample and returns 201 with portalPredictionCount", async () => {
    const sample = loadSample("aubrey_output.json");
    const res = await app.inject({
      method: "POST",
      url: "/api/ingest/ao-test/analysis-output",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "npnqm-portal", externalId: "AUBREY-001", analysisOutput: sample },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { loanId: string; portalPredictionCount: number };
    expect(body.loanId).toBe("NPNQM-AUBREY-001");
    expect(body.portalPredictionCount).toBe(17);
  });

  it("idempotency: re-POSTing same content returns 200 duplicate", async () => {
    const sample = loadSample("aubrey_output.json");
    const res = await app.inject({
      method: "POST",
      url: "/api/ingest/ao-test/analysis-output",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "npnqm-portal", externalId: "AUBREY-001", analysisOutput: sample },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).duplicate).toBe(true);
  });

  it("idempotency: re-POSTing with different content supersedes and inserts fresh", async () => {
    // Mutate the sample subtly so the hash differs.
    const sample = loadSample("aubrey_output.json") as { analysisOutput: { document_requests: unknown[] } };
    (sample as { document_requests?: unknown[]; analysisOutput: { document_requests: unknown[] } }).analysisOutput.document_requests =
      sample.analysisOutput.document_requests.slice(0, 5);
    const res = await app.inject({
      method: "POST",
      url: "/api/ingest/ao-test/analysis-output",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "npnqm-portal", externalId: "AUBREY-001", analysisOutput: sample },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body) as { portalPredictionCount: number };
    expect(body.portalPredictionCount).toBe(5);
    // Old portal-llm rows should be superseded.
    const { rows } = await withDb(async (c) => c.query<{ active: number; superseded: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE superseded_at IS NULL)::int AS active,
         COUNT(*) FILTER (WHERE superseded_at IS NOT NULL)::int AS superseded
       FROM predicted_conditions WHERE tenant_id=$1 AND loan_id='NPNQM-AUBREY-001' AND source_list='portal-llm'`,
      [T],
    ));
    expect(rows[0]!.active).toBe(5);
    expect(rows[0]!.superseded).toBeGreaterThanOrEqual(17);
  });

  it("PII redaction: SSN never lands in the store or DB", async () => {
    const sample = {
      document_requests: [], scenario_summary: {
        loan_number: "PII-AO-1", program: "Investor DSCR", borrowers: [{ name: "Test", ssn: "555443333", dob: "1990-01-01" }],
        numbers: { loan_amount: 100000, LTV: 50, note_rate: 7 }, property: { state: "CA", property_type: "SFR" }, occupancy: "NOO", purpose: "Purchase",
      },
      seen_conflicts: [], stats: { total_document_requests: 0, hard_stop_documents: 0, elapsed_seconds: 0, tool_calls: 0, by_category: {}, by_priority: {}, by_status: {} },
    };
    const res = await app.inject({
      method: "POST",
      url: "/api/ingest/ao-test/analysis-output",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "npnqm-portal", externalId: "PII-AO-1", analysisOutput: sample },
    });
    expect(res.statusCode).toBe(201);
    // Now verify no raw SSN is in any persisted artifact.
    const loanRes = await app.inject({
      method: "GET", url: `/loans/NPNQM-PII-AO-1`,
      headers: { "x-user-id": "test", "x-tenant-id": T, "x-user-role": "operator" },
    });
    expect(loanRes.body).not.toContain("555443333");
  });

  it("404 when unknown adapter_type in mapping", async () => {
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
         VALUES ($1, 'bogus-source', 'no-such-adapter', 'no-such-adapter', '{}'::jsonb, '{}'::jsonb, true)
         ON CONFLICT DO NOTHING`,
        [T],
      );
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/ingest/ao-test/analysis-output",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "bogus-source", externalId: "BAD-1", analysisOutput: { document_requests: [], scenario_summary: { loan_number: "BAD-1" }, seen_conflicts: [], stats: {} } },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error_class).toBe("unknown_adapter_type");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test analysis-output-ingest.integration.test
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement the route**

```ts
// packages/api/src/routes/analysis-output-ingest.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { withTenantTx, withDb } from "../db/pool.js";
import { apiKeyAuthHook } from "../middleware/api-key-auth.js";
import { runInTenantContext } from "../tenant-context.js";
import { getAdapter } from "../ingestion/adapter-registry.js";
import { AdapterConfigSchema, type EligibilityVerdict } from "@twin/core";
import { writeExtrasFirstWriteWins } from "../ingestion/loan-context-extras.js";
import { MissingExternalIdError } from "../ingestion/lender-adapter.js";

const BodySchema = z.object({
  source: z.string().min(1),
  externalId: z.string().min(1),
  borrowerName: z.string().optional(),
  analysisOutput: z.unknown(),  // adapter validates the inner shape
});

export function registerAnalysisOutputIngestRoutes(app: FastifyInstance, store: import("@twin/core").Store): void {
  app.post<{ Params: { tenantSlug: string } }>(
    "/api/ingest/:tenantSlug/analysis-output",
    { preHandler: apiKeyAuthHook },
    async (req, reply) => {
      const tenantId = (req as unknown as { tenantId?: string }).tenantId;
      if (!tenantId) return reply.code(401).send({ error_class: "missing_tenant_context" });

      const parsed = BodySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error_class: "validation_failed", details: parsed.error.flatten() });

      const { source, externalId, analysisOutput } = parsed.data;
      const errorId = randomUUID();
      const analysisHash = createHash("sha256").update(JSON.stringify(analysisOutput)).digest("hex");

      return runInTenantContext(
        { tenantId, userId: "api-ingest", isSuperAdmin: false, role: "operator" },
        async () => {
          // Three-branch idempotency.
          const existing = await withTenantTx(tenantId, async (c) => {
            const { rows } = await c.query<{ loan_id: string; status: string; analysis_hash: string | null }>(
              `SELECT loan_id, status, analysis_hash FROM ingested_loans
                WHERE tenant_id = $1 AND external_id = $2 LIMIT 1`,
              [tenantId, externalId],
            );
            return rows[0] ?? null;
          });

          let replayed = false;
          if (existing && existing.analysis_hash === analysisHash) {
            return reply.code(200).send({ loanId: existing.loan_id, tenantId, status: existing.status, duplicate: true });
          }
          if (existing && existing.analysis_hash !== analysisHash) {
            // Supersede prior portal-llm rows + verdicts.
            await withTenantTx(tenantId, async (c) => {
              await c.query(
                `UPDATE predicted_conditions SET superseded_at = NOW()
                  WHERE tenant_id=$1 AND loan_id=$2 AND source_list='portal-llm' AND superseded_at IS NULL`,
                [tenantId, existing.loan_id],
              );
              await c.query(
                `UPDATE portal_eligibility_verdicts SET superseded_at = NOW()
                  WHERE tenant_id=$1 AND loan_id=$2 AND superseded_at IS NULL`,
                [tenantId, existing.loan_id],
              );
            });
            replayed = true;
          }

          // Resolve mapping + adapter.
          const mapping = await withTenantTx(tenantId, async (c) => {
            const { rows } = await c.query<{ adapter_type: string; adapter_config: unknown }>(
              `SELECT adapter_type, adapter_config FROM ingestion_mappings
                WHERE tenant_id = $1 AND source_name = $2 AND active = true LIMIT 1`,
              [tenantId, source],
            );
            return rows[0] ?? null;
          });
          const adapterType = mapping?.adapter_type;
          if (!adapterType) return reply.code(400).send({ error_id: errorId, error_class: "no_active_mapping" });
          const adapter = getAdapter(adapterType);
          if (!adapter) return reply.code(400).send({ error_id: errorId, error_class: "unknown_adapter_type" });
          const config = AdapterConfigSchema.parse(mapping?.adapter_config ?? {});

          // Adapter dispatch.
          let result;
          try {
            result = adapter.transformAnalysisOutput(analysisOutput, config);
          } catch (e) {
            if (e instanceof MissingExternalIdError) {
              return reply.code(400).send({ error_id: errorId, error_class: "missing_external_id", adapter_type: adapterType });
            }
            req.log?.error?.({ err: e, tenantId, adapterType, errorId }, "[analysis-output] transform failed");
            return reply.code(500).send({ error_id: errorId, error_class: "transform_failed", adapter_type: adapterType });
          }

          const loanId = existing?.loan_id ?? `${config.identityPrefix}${externalId}`;
          const buildLoanFromPartial = (await import("./ingestion.js")).buildLoanFromPartial as (id: string, p: Partial<import("@twin/core").Loan>, t: string) => import("@twin/core").Loan;
          const loan = buildLoanFromPartial(loanId, result.loan, tenantId);
          store.dispatch({ type: "InjectLoan", loan });

          // Write extras (first-write-wins on initial, no-op on supersede).
          const cleanedExtras = Object.fromEntries(
            Object.entries(result.extras).filter(([, v]) => v !== undefined),
          );
          if (Object.keys(cleanedExtras).length > 0) {
            await writeExtrasFirstWriteWins(tenantId, loanId, cleanedExtras as never);
          }

          // Insert portal predictions.
          for (const p of result.portalPredictions) {
            await withTenantTx(tenantId, async (c) => {
              await c.query(
                `INSERT INTO predicted_conditions
                   (id, tenant_id, loan_id, prediction_run_id, source_list, description, category, status,
                    source_input_hash, kb_version_id, source_rule_table, source_rule_id, emission_kind,
                    portal_metadata, analysis_hash)
                 VALUES (gen_random_uuid(), $1, $2, gen_random_uuid(), 'portal-llm', $3, 'PTA', 'pending',
                         $4, NULL, NULL, NULL, 'deterministic',
                         $5::jsonb, $6)`,
                [
                  tenantId, loanId, p.documentType, analysisHash,
                  JSON.stringify({
                    priority: p.priority, severity: p.severity, document_category: p.documentCategory,
                    document_type: p.documentType, specifications: p.specifications,
                    reasons_needed: p.reasonsNeeded, source_references: p.sourceReferences,
                    tags: p.tags, source_module: p.sourceModule, applies_to: p.appliesTo,
                    portal_status: p.portalStatus,
                  }),
                  analysisHash,
                ],
              );
            });
          }

          // Insert portal eligibility verdicts.
          for (const ev of result.eligibilityVerdict.perProgram) {
            await withTenantTx(tenantId, async (c) => {
              await c.query(
                `INSERT INTO portal_eligibility_verdicts
                   (tenant_id, loan_id, program, status, passed_count, failed_count, failed_rules, analysis_hash)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
                [tenantId, loanId, ev.program, ev.status, ev.passedCount, ev.failedCount,
                 JSON.stringify(ev.failedRules), analysisHash],
              );
            });
          }

          // Upsert ingested_loans with analysis_hash.
          await withTenantTx(tenantId, async (c) => {
            await c.query(
              `INSERT INTO ingested_loans (tenant_id, external_id, loan_id, status, analysis_hash)
               VALUES ($1, $2, $3, 'queued', $4)
               ON CONFLICT (tenant_id, external_id)
                 DO UPDATE SET analysis_hash = EXCLUDED.analysis_hash`,
              [tenantId, externalId, loanId, analysisHash],
            );
          });

          // Audit row.
          await withDb(async (c) => {
            await c.query(
              `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
               VALUES ($1, 'api-ingest', $2, $3, $4::jsonb)`,
              [
                tenantId,
                replayed ? "ingest.analysis_output.replayed" : "ingest.analysis_output",
                `analysis output ingested for loan ${loanId}`,
                JSON.stringify({
                  adapter_type: adapterType, source_name: source, external_id: externalId,
                  hard_stops: result.stats.hardStopDocuments,
                  total_docs: result.stats.totalDocumentRequests,
                  elapsed_seconds: result.stats.elapsedSeconds,
                  tool_calls: result.stats.toolCalls,
                  eligible_count: result.eligibilityVerdict.eligiblePrograms.length,
                  ineligible_count: result.eligibilityVerdict.ineligiblePrograms.length,
                  analysis_hash: analysisHash, replayed,
                }),
              ],
            );
          });

          // PC v2 second-opinion auto-fire (best-effort).
          let pcV2Triggered = false;
          try {
            const { run: runPredictions } = await import("../services/predict-conditions/index.js");
            const { buildLoanContextFromLoan } = await import("./predict-conditions-context-builder.js");
            const ctx = await buildLoanContextFromLoan(loan);
            await runPredictions(tenantId, loanId, ctx, "system:loan-ingest");
            pcV2Triggered = true;
          } catch (err) {
            req.log?.error?.({ err, tenantId, loanId, errorId }, "[predict-conditions] auto-fire after analysis-output failed");
          }

          // Emit eligibility-disagreement audit rows where portal verdict and PC v2 matrix-resolver disagree.
          // Defer to Task 8 (next task) — split for size; this task is the request path + persistence.

          return reply.code(201).send({
            loanId, tenantId, status: "queued",
            portalPredictionCount: result.portalPredictions.length,
            eligibilityPrograms: {
              eligible: result.eligibilityVerdict.eligiblePrograms,
              ineligible: result.eligibilityVerdict.ineligiblePrograms,
            },
            pcV2Triggered, replayed,
          });
        },
      );
    },
  );
}
```

Note: `buildLoanFromPartial` is currently a local function in `routes/ingestion.ts`. Either export it from there (one-line export change) OR move it to a shared module. For this plan, just export it:

```bash
# in routes/ingestion.ts, change:
function buildLoanFromPartial(...
# to:
export function buildLoanFromPartial(...
```

- [ ] **Step 4: Register the route in `server.ts`**

In `buildServer`, near where other ingest routes register:

```ts
import { registerAnalysisOutputIngestRoutes } from "./routes/analysis-output-ingest.js";
// ...
registerAnalysisOutputIngestRoutes(app, store);
```

Also: ensure the `buildLoanFromPartial` export exists in `routes/ingestion.ts` per the note above.

- [ ] **Step 5: Verify tests pass**

```bash
pnpm --filter @twin/api build && pnpm --filter @twin/api test analysis-output-ingest.integration.test
```

Expected: 0 build errors. 5 tests pass (first ingest, idempotency dup, idempotency replay, PII redaction, unknown adapter type).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/analysis-output-ingest.ts packages/api/src/routes/ingestion.ts packages/api/src/server.ts packages/api/test/analysis-output-ingest.integration.test.ts
git commit -m "feat(api/routes): POST /api/ingest/:tenantSlug/analysis-output

Accepts the portal's <loan>_output.json shape. Three-branch idempotency
(no-op | supersede + insert fresh | new ingest) keyed on
sha256(analysisOutput). Persists portal predictions with source_list=
'portal-llm' + portal_metadata. Persists portal_eligibility_verdicts.
Writes extras first-write-wins. Triggers PC v2 second-opinion auto-fire.
Per-ingest audit row distinguishes 'ingest.analysis_output' from
'ingest.analysis_output.replayed'."
```

---

### Task 8: Eligibility-disagreement audit + Prometheus metric

**Files:**
- Modify: `packages/api/src/routes/analysis-output-ingest.ts`
- Modify: `packages/api/src/routes/system-check.ts`
- Test: extend `packages/api/test/analysis-output-ingest.integration.test.ts`

- [ ] **Step 1: Write the failing assertion**

Append to the existing integration test:

```ts
describe("POST /analysis-output — eligibility disagreement audit", () => {
  it("emits action='eligibility.disagreement' when portal and PC v2 disagree", async () => {
    // The PC v2 matrix-resolver needs a seeded program_matrix_tiers row to
    // produce a verdict. Without it, PC v2 emits no matrix findings and no
    // disagreement is detectable. Seed one tier that DISAGREES with the
    // portal — e.g., the portal says "Investor DSCR: PASS" for aubrey;
    // we seed a matrix tier that would make Investor DSCR fail (max_ltv = 50).
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO program_matrix_tiers
           (tenant_id, kb_version, program, occupancy, min_fico, max_fico,
            max_loan_amount, max_ltv_purchase, max_ltv_cashout, max_ltv_rate_term,
            property_types, source_doc_hash, extraction_run_id)
         VALUES ($1, 1, 'Investor DSCR', 'investment', 700, 800,
                 999999, 50, 50, 50, ARRAY['SFR'], 'h', gen_random_uuid())
         ON CONFLICT DO NOTHING`,
        [T],
      );
    });
    const sample = loadSample("aubrey_output.json");
    await app.inject({
      method: "POST", url: "/api/ingest/ao-test/analysis-output",
      headers: { authorization: `Bearer ${KEY}` },
      payload: { source: "npnqm-portal", externalId: "DISAGREE-1", analysisOutput: sample },
    });

    const { rows } = await withDb(async (c) => c.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM tenant_audit_log
        WHERE target_tenant_id=$1 AND action='eligibility.disagreement'
          AND metadata->>'loan_id' = 'NPNQM-DISAGREE-1'`,
      [T],
    ));
    expect(rows[0]!.count).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test analysis-output-ingest.integration.test
```

Expected: FAIL — disagreement audit not emitted.

- [ ] **Step 3: Add disagreement emission to the route**

In `packages/api/src/routes/analysis-output-ingest.ts`, after the PC v2 auto-fire block (which writes PC v2 predictions to `predicted_conditions`), add:

```ts
          // Eligibility-disagreement detection.
          // Compare portal eligibility verdict against PC v2's matrix-resolver predictions.
          // PC v2 matrix predictions have source_list='matrix' and category='PTA' with
          // description matching '*not eligible*' or '*FAIL*' on failed programs.
          // For each portal program with status='PASS', check if PC v2 emitted a matrix
          // finding indicating FAIL for the same program — that's a disagreement.
          try {
            const pcMatrixFindings = await withTenantTx(tenantId, async (c) => {
              const { rows } = await c.query<{ description: string }>(
                `SELECT description FROM predicted_conditions
                  WHERE tenant_id=$1 AND loan_id=$2 AND source_list='matrix'
                    AND status='pending' AND superseded_at IS NULL`,
                [tenantId, loanId],
              );
              return rows;
            });
            for (const portalProgram of result.eligibilityVerdict.perProgram) {
              // PC v2 doesn't emit a row when the program PASSES the matrix check.
              // A row indicates failure on that program.
              const pcSaidFail = pcMatrixFindings.some((f) =>
                f.description.includes(portalProgram.program),
              );
              const pcStatus = pcSaidFail ? "FAIL" : "PASS";
              if (pcStatus !== portalProgram.status) {
                await withDb(async (c) => {
                  await c.query(
                    `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
                     VALUES ($1, 'system:eligibility-comparator', 'eligibility.disagreement', $2, $3::jsonb)`,
                    [
                      tenantId,
                      `portal ${portalProgram.status} vs pc_v2 ${pcStatus} on ${portalProgram.program}`,
                      JSON.stringify({
                        program: portalProgram.program,
                        portal_status: portalProgram.status,
                        pc_v2_status: pcStatus,
                        loan_id: loanId,
                        analysis_hash: analysisHash,
                      }),
                    ],
                  );
                });
                // Increment Prometheus-shaped metric counter.
                incrementEligibilityDisagreement(portalProgram.program, portalProgram.status, pcStatus);
              }
            }
          } catch (err) {
            req.log?.error?.({ err, tenantId, loanId }, "[eligibility-disagreement] failed to compute");
          }
```

Add the counter helper at the top of the file:

```ts
// In-memory Prometheus-shaped counter. Surfaced via /system/portal-metrics (Task 8 step 4).
export const portalMetrics = {
  eligibility_disagreements_total: new Map<string, number>(),  // key = "program|portal_status|pc_v2_status"
};

function incrementEligibilityDisagreement(program: string, portalStatus: string, pcV2Status: string): void {
  const key = `${program}|${portalStatus}|${pcV2Status}`;
  portalMetrics.eligibility_disagreements_total.set(
    key,
    (portalMetrics.eligibility_disagreements_total.get(key) ?? 0) + 1,
  );
}
```

- [ ] **Step 4: Add the `/system/portal-metrics` endpoint**

In `packages/api/src/routes/system-check.ts` (or whatever houses the existing `/system/doc-fetch-metrics`), add:

```ts
import { portalMetrics } from "./analysis-output-ingest.js";
// ...
app.get("/system/portal-metrics", async () => ({
  eligibility_disagreements_total: Object.fromEntries(portalMetrics.eligibility_disagreements_total),
}));
```

- [ ] **Step 5: Verify tests pass**

```bash
pnpm --filter @twin/api build && pnpm --filter @twin/api test analysis-output-ingest.integration.test
```

Expected: 0 build errors. All 6 integration tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/analysis-output-ingest.ts packages/api/src/routes/system-check.ts packages/api/test/analysis-output-ingest.integration.test.ts
git commit -m "feat(api/routes): eligibility-disagreement audit + Prometheus metric

After PC v2 second-opinion runs, compare portal eligibility verdict
against PC v2 matrix-resolver findings. Emit tenant_audit_log entry
with action='eligibility.disagreement' for each program where the two
disagree. Track per-(program, portal_status, pc_v2_status) counter
surfaced via /system/portal-metrics for ops visibility. Future drift-
detection spec mines this signal."
```

---

## Phase D complete — checkpoint

After tasks 7-8: analysis-output endpoint live; portal predictions persisted alongside PC v2 second opinion; eligibility disagreements audited and counted.

Verify:
```bash
pnpm --filter @twin/api test
```

Expected: full API test suite passes.

---

## Phase E — E2E + polish

2 tasks. W12 harness + Spec 1 risks-table cross-reference + final polish.

### Task 9: W12 harness workflow + Spec 1 risks cross-reference

**Files:**
- Create: `scripts/e2e-harness/workflows/W12-portal-analysis.ts`
- Modify: `scripts/e2e-harness/run.ts` (register W12)
- Modify: `docs/superpowers/specs/2026-05-14-ingestion-framework-design.md` (§11 risks cross-reference)

- [ ] **Step 1: Implement W12**

```ts
// scripts/e2e-harness/workflows/W12-portal-analysis.ts
//
// W12 — portal analysis-output ingest full path.
// Asserts: analysis-output POST → portal predictions + eligibility verdict
// persisted → PC v2 second opinion fires → eligibility disagreement detection.

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
    for (const line of readFileSync(resolvePath(here, "../../../packages/api/.env"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* */ }
}

function computeKeyPrefix(apiKey: string): string {
  const m = apiKey.match(/^([a-z0-9]+)_([0-9a-f]+)/);
  if (!m) throw new Error("bad key format");
  return `${m[1]}_${m[2].slice(0, 8)}`;
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
    const apiKey = `w12test_${randomUUID().replace(/-/g, "")}`;
    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
    const apiKeyPrefix = computeKeyPrefix(apiKey);

    if (process.env.DATABASE_URL) {
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        await client.query(`INSERT INTO tenants (id, name, slug, status, type) VALUES ($1, 'Harness W12', $2, 'active', 'demo') ON CONFLICT (id) DO NOTHING`, [HARNESS_TENANT_ID, HARNESS_TENANT_SLUG]);
        await client.query(`INSERT INTO tenant_api_keys (tenant_id, key_hash, key_prefix, name, rate_limit_per_minute) VALUES ($1, $2, $3, 'w12', 1000) ON CONFLICT DO NOTHING`, [HARNESS_TENANT_ID, apiKeyHash, apiKeyPrefix]);
        // Wipe prior W12 state inside a tenant-scoped tx.
        await client.query("BEGIN");
        await client.query(`SET LOCAL app.current_tenant = $1::uuid`, [HARNESS_TENANT_ID]);
        await client.query(`DELETE FROM predicted_conditions WHERE tenant_id=$1`, [HARNESS_TENANT_ID]);
        await client.query(`DELETE FROM portal_eligibility_verdicts WHERE tenant_id=$1`, [HARNESS_TENANT_ID]);
        await client.query(`DELETE FROM ingested_loans WHERE tenant_id=$1`, [HARNESS_TENANT_ID]);
        await client.query(`DELETE FROM loan_context_extras WHERE tenant_id=$1`, [HARNESS_TENANT_ID]);
        await client.query("COMMIT");
        await client.query(`DELETE FROM ingestion_mappings WHERE tenant_id=$1`, [HARNESS_TENANT_ID]);
        await client.query(
          `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
           VALUES ($1, 'npnqm-portal', 'npnqm-portal', 'npnqm-portal', $2::jsonb, '{}'::jsonb, true)`,
          [HARNESS_TENANT_ID, JSON.stringify({ identityPrefix: "NPNQM-", allowedFetchHosts: ["docs.npnqm-portal.example.com"], maxFileBytes: 50_000_000 })],
        );
      } finally {
        await client.end();
      }
    }

    const fixturesDir = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../../packages/api/test/fixtures/portal-analysis");
    const sample = JSON.parse(readFileSync(join(fixturesDir, "aubrey_output.json"), "utf8"));

    // POST analysis-output.
    const res = await fetch(`${ctx.apiUrl}/api/ingest/${HARNESS_TENANT_SLUG}/analysis-output`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ source: "npnqm-portal", externalId: "W12-AUBREY", analysisOutput: sample }),
    });
    const body = (await res.json()) as { loanId?: string; portalPredictionCount?: number; pcV2Triggered?: boolean };

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

    // Verify portal_eligibility_verdicts has rows.
    if (process.env.DATABASE_URL && body.loanId) {
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        const { rows } = await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM portal_eligibility_verdicts WHERE tenant_id=$1 AND loan_id=$2 AND superseded_at IS NULL`,
          [HARNESS_TENANT_ID, body.loanId],
        );
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
      loanId: body.loanId ?? "",
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
```

- [ ] **Step 2: Register W12 in the harness**

```bash
grep -n "ALL_WORKFLOWS\|W11" scripts/e2e-harness/run.ts | head -5
```

Add:
```ts
import { W12 } from "./workflows/W12-portal-analysis.js";
// In the ALL_WORKFLOWS array, append W12.
```

- [ ] **Step 3: Verify W12 compiles**

```bash
pnpm tsx --eval "import('./scripts/e2e-harness/workflows/W12-portal-analysis.ts').then(()=>{console.log('ok');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
```

Expected: `ok`.

- [ ] **Step 4: Update Spec 1's risks table cross-reference**

Open `docs/superpowers/specs/2026-05-14-ingestion-framework-design.md`. In §11 "Risks & Mitigations", add a new row (or append to an existing PII-related row) explicitly cross-referencing Spec 1.5:

```markdown
| PII redaction owner — assumption invalidated by real samples | The original Spec 1 §6 assumed pre-redacted inputs. Real NPNQM portal payloads carry unmasked SSN. **Mitigation owner moved to Spec 1.5 §6**: `redactPayloadMiddleware` is a Fastify `preHandler` applied to all `/api/ingest/*` endpoints (loan + documents + analysis-output). Pino redact config covers SSN + DOB paths. See `2026-05-15-portal-analysis-output-ingestion.md` §6. |
```

- [ ] **Step 5: Commit**

```bash
git add scripts/e2e-harness/workflows/W12-portal-analysis.ts scripts/e2e-harness/run.ts docs/superpowers/specs/2026-05-14-ingestion-framework-design.md
git commit -m "test(e2e): W12 — portal analysis-output full path + Spec 1 cross-ref

W12 harness exercises POST /analysis-output end-to-end against the aubrey
fixture: asserts 201 status, portal predictions persisted, PC v2 second
opinion triggered, portal_eligibility_verdicts populated. Spec 1's §11
risks table now explicitly points at Spec 1.5 §6 as the PII handling
owner — future readers of Spec 1 find the protection."
```

---

### Task 10: Final integration polish + memory update

**Files:**
- Modify: `packages/api/test/predict-conditions.integration.test.ts` (assert two-source coexistence)

- [ ] **Step 1: Add one two-source coexistence assertion**

Append to `packages/api/test/predict-conditions.integration.test.ts`:

```ts
describe("predict-conditions HTTP integration — two-source coexistence (Spec 1.5)", () => {
  it("portal-llm rows and PC v2 rows coexist with distinct source_list values", async () => {
    // Insert a portal-llm row directly (simulating an analysis-output ingest).
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO predicted_conditions
           (id, tenant_id, loan_id, prediction_run_id, source_list, description, category, status,
            source_input_hash, kb_version_id, source_rule_table, source_rule_id, emission_kind,
            portal_metadata, analysis_hash)
         VALUES (gen_random_uuid(), $1, 'INT-1', gen_random_uuid(), 'portal-llm',
                 'Credit Report — portal-emitted', 'PTA', 'pending',
                 'hash', NULL, NULL, NULL, 'deterministic',
                 '{"priority":"P0","severity":"SOFT-STOP","document_category":"Credit"}'::jsonb,
                 'test-hash')`,
        [T],
      );
    });
    // Now run PC v2 — it should emit its own rows alongside.
    await app.inject({ method: "POST", url: "/loans/INT-1/predictions/run", headers: headers("operator"), payload: {} });

    // Query distinct source_list values for this loan.
    const { rows } = await withDb(async (c) => c.query<{ source_list: string; count: number }>(
      `SELECT source_list, COUNT(*)::int AS count FROM predicted_conditions
        WHERE tenant_id=$1 AND loan_id='INT-1' AND superseded_at IS NULL
        GROUP BY source_list`,
      [T],
    ));
    const sourceMap = Object.fromEntries(rows.map((r) => [r.source_list, r.count]));
    expect(sourceMap["portal-llm"]).toBeGreaterThan(0);
    // At least one non-portal source should also be present (matrix/geographic/requirements/minimum/income).
    const pcSources = Object.keys(sourceMap).filter((s) => s !== "portal-llm");
    expect(pcSources.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run full test suite**

```bash
pnpm --filter @twin/core build && pnpm --filter @twin/api build && pnpm --filter @twin/api test 2>&1 | tail -20
```

Expected: 0 build errors. All tests pass (note any pre-existing flakes unrelated to this work).

- [ ] **Step 3: Update memory note**

Append to `~/.claude/projects/-Users-omarmendoza-Projects-encompass-digital-twin/memory/project_ingestion_framework_operational.md` (or create a new project memory note `project_portal_analysis_output_operational.md`) describing:

- Two-opinion architecture is live as of Spec 1.5
- `redactPayloadMiddleware` is the cross-spec PII primitive
- `portal_eligibility_verdicts` and the partial unique index pattern
- `eligibility.disagreement` audit + `/system/portal-metrics` is the operator signal

- [ ] **Step 4: Commit**

```bash
git add packages/api/test/predict-conditions.integration.test.ts
git commit -m "test(api): two-source coexistence assertion + memory note

Final integration check for Spec 1.5: portal-llm rows and PC v2 rows
coexist on the same loan with distinct source_list values; no cross-
source dedup at insert time. Memory updated with the two-opinion
operational invariants."
```

---

## Phase E complete — final verification

Verify acceptance criteria from spec §13:

1. ✓ `POST /api/ingest/:tenantSlug/analysis-output` accepts a real sample and returns 201 with `portalPredictionCount` matching the sample (Task 7)
2. ✓ SSN never appears in DB or logs (Tasks 3, 4, 7)
3. ✓ `predicted_conditions` has N portal-llm rows + M PC v2 rows; no cross-source dedup (Tasks 7, 10)
4. ✓ `portal_eligibility_verdicts` has one row per program (Tasks 7, 9)
5. ✓ `loan_context_extras` populated (Tasks 1, 7)
6. ✓ Re-POSTing same `externalId` with same content returns 200 duplicate; different content supersedes + inserts fresh (Task 7)
7. ✓ Migration 023 applies cleanly (Task 2)
8. ✓ Adapter unit tests pass against 5 real samples (Tasks 5, 6)
9. ✓ W12 e2e passes (Task 9)
10. ✓ Build clean across packages (Task 10)

Full verification:

```bash
pnpm --filter @twin/core build && pnpm --filter @twin/api build && pnpm --filter @twin/web build && pnpm --filter @twin/api test
```

Expected: 0 build errors. All tests pass.

---

## Self-Review

**Spec coverage** — every spec section maps to tasks:

| Spec § | Plan task |
|--------|-----------|
| §1 Why amendment, §1.1 Non-goals | Implicit; scope reflected throughout |
| §2 Architecture (amended) | Task 7 endpoint + Task 8 disagreement + Task 5 adapter |
| §3.1 New types + base-class method | Task 1 |
| §3.2 Mapping table | Task 5 |
| §3.3 Loan purpose mapping | Task 5 (`canonicalizeLoanPurpose`) |
| §4 New endpoint flow (steps 1-17) | Task 7 |
| §4.3 Errors | Task 7 |
| §5 Schema migration 023 | Task 2 |
| §5.1 LoanContextExtras expansion | Task 1 |
| §6 PII redaction middleware | Tasks 3, 4 |
| §6.4 Pino log redaction | Task 4 |
| §7 PC v2 second opinion | Task 7 (auto-fire) |
| §7.1 Coexistence rules | Tasks 7, 8, 10 |
| §8 NPNQMPortalAdapter rewrite checklist | Tasks 5, 6 |
| §9 Testing strategy + W12 | Tasks 5-10 |
| §10 Out of scope (deferred) | Implicit; no task |
| §11 Out of scope (non-goals) | Implicit; no task |
| §12 Risks & mitigations | Cross-spec backfill addressed in Task 9 |
| §13 Acceptance criteria | Verified at Phase E close |
| §14 Sequencing | This plan |
| §15 Open items | C1 resolved in Task 7 |

**Placeholder scan:** no TBD / TODO / "implement later" patterns.

**Type consistency:** `PortalPrediction`, `EligibilityVerdict`, `PortalAnalysisStats`, `TransformAnalysisOutput`, `MissingExternalIdError` referenced consistently across Tasks 1, 5, 6, 7. `LoanContextExtrasSchema` field names match between Tasks 1, 5. `analysis_hash` column referenced consistently across Tasks 2, 7.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-portal-analysis-output-ingestion.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration in this session.

**2. Inline Execution** — Batch execution in this session with checkpoints for review.

Which approach?
