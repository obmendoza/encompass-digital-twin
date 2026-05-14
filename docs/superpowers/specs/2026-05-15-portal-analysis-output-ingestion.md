# Portal Analysis Output Ingestion — Spec 1.5 Amendment

**Date:** 2026-05-15
**Status:** Draft
**Amends:** [NPNQM Ingestion Framework (Spec 1)](2026-05-14-ingestion-framework-design.md)
**Predecessor:** [PC v2 Pre-Underwriter Design](2026-05-14-pc-v2-pre-underwriter-design.md)
**Successor:** Spec 2 — outbound writeback (deferred until portal API contract is in hand)

---

## 1. Why this amendment exists

Spec 1 was built assuming the portal would push **raw** loan data + **raw** document files for UAS to analyze. The real portal output samples landed on 2026-05-15 (`/Users/omarmendoza/Downloads/test_results 1.zip`) and revealed a different reality:

**The portal already runs its own LLM-driven analysis** — 80-93 tool calls per loan, ~8 minutes wall time — and ships UAS the **finished analysis**. Each `<loan>_output.json` contains:

- **`document_requests`** (16-18 rows per loan): the portal's predicted document checklist with `document_type`, `document_category` (Credit / Cross-Cutting / Compliance / Income / Assets / Property / Title), `priority` (P0/P1/P2), `applies_to`, multi-line `specifications`, `reasons_needed`, `source_references`, `severity` (HARD-STOP / SOFT-STOP), `status`, `tags`, `source_module`.
- **`scenario_summary`**: a full extracted loan profile — program, occupancy, purpose, property tree, numbers (loan_amount, LTV, CLTV, DTI), loan terms, credit (FICO, declarations bag, mortgage_history_flags, credit_events), borrowers (with **unmasked SSN**), income_profile, asset_profile, employers, housing_expenses, liabilities, REO summary, owned_properties, residences. Plus their **eligibility engine output**: `eligible_programs[]`, `ineligible_programs[]`, `program_eligibility_detail{}` (per-program PASS/FAIL with `failed_rules`).
- **`stats`**: aggregate counters (by_category, by_priority, elapsed_seconds, tool_calls).
- **`seen_conflicts`**: input contradictions detected by the portal agent.

Spec 1's `LenderAdapter.transformLoan()` and `transformDocument()` cannot consume this. Spec 1's `LoanContextExtras` schema captures ~11 fields where `scenario_summary` carries 25+. Spec 1's `PC v2` runs in milliseconds where the portal's analyzer runs in minutes — but they're complementary, not redundant.

**This amendment closes the gap** so UAS becomes a workspace + second opinion on top of the portal's analysis, not a duplicate brain.

### 1.1 Non-goals (this amendment)

- Outbound writeback (deferred to Spec 2; depends on NPNQM's outbound contract).
- Drift-detection UI surface (deferred; store both verdicts, compute drift on read in a future spec).
- Replacing PC v2. PC v2 still runs as a second opinion against the same `scenario_summary` data.
- MISMO XML parsing on our side. The portal does that and ships JSON.
- Document file bytes via this endpoint. File pushes still flow through Spec 1's `/api/ingest/:tenantSlug/documents`.

---

## 2. Architecture (amended)

```
┌─ NPNQM portal ─────────────────────────────────────────────────────────┐
│                                                                         │
│  Borrower submits min-docs → portal agent runs ~8min analysis →        │
│  produces <loan>_output.json + <loan>_final_state.json                 │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ HTTP POST (signed payload)
                                 ▼
┌─ UAS ──────────────────────────────────────────────────────────────────┐
│                                                                         │
│  POST /api/ingest/:tenantSlug/analysis-output   ← NEW                  │
│         │                                                               │
│         ▼                                                               │
│  apiKeyAuthHook → tenant resolved → adapter dispatch                   │
│         │                                                               │
│         ▼                                                               │
│  LenderAdapter.transformAnalysisOutput(raw, config)                    │
│  yields {                                                               │
│    loan: Partial<Loan>,                  // from scenario_summary       │
│    extras: Partial<LoanContextExtras>,   // F2 fields, expanded        │
│    portalPredictions: PortalPrediction[], // document_requests rows    │
│    eligibilityVerdict: EligibilityVerdict, // per-program PASS/FAIL    │
│    seenConflicts: string[],                                             │
│    stats: AnalysisStats,                                                │
│  }                                                                      │
│         │                                                               │
│   ┌─────┴───────────────────────┐                                       │
│   ▼                             ▼                                       │
│ store.dispatch(InjectLoan)   INSERT predicted_conditions                │
│         │                    (source='portal-llm', per row)             │
│         ▼                             │                                 │
│ loan_context_extras                   ▼                                 │
│ (first-write-wins)            INSERT portal_eligibility_verdicts        │
│         │                             │                                 │
│         ▼                             ▼                                 │
│ PC v2 auto-fire (second opinion)  audit row 'ingest.analysis_output'   │
│ (writes its own predicted_conditions                                    │
│  rows with source='matrix'|'requirements'|etc.)                         │
└────────────────────────────────────────────────────────────────────────┘
```

**Key claims:**

- A single `POST /api/ingest/:tenantSlug/analysis-output` accepts the portal's `<loan>_output.json` shape.
- The adapter contract gains one optional method, `transformAnalysisOutput`. Existing `transformLoan` / `transformDocument` survive unchanged (used by other adapters or other channels).
- Portal predictions persist with `source_list='portal-llm'` — the same `predicted_conditions` table, just a new source value. PC v2 runs alongside as a second opinion and writes its own rows. UW sees both with each row's source clearly tagged.
- A new small table `portal_eligibility_verdicts` captures the portal's per-program PASS/FAIL so the UI can compare against PC v2's matrix-resolver output.
- PII redaction at the request boundary: SSN values in the inbound payload are masked to `xxx-xx-NNNN` before any persistence. The full SSN never lands in the store or DB.
- File-byte ingest stays on the existing doc-channel (Spec 1's `documents-ingest.ts`). Borrowers upload files separately; the worker fetches; `AddDocument` ties back to the portal's predicted doc rows via doc-type matching.

---

## 3. Adapter contract changes

### 3.1 New method on `LenderAdapter`

```ts
// packages/api/src/ingestion/lender-adapter.ts (modify)

export interface PortalPrediction {
  documentType: string;             // e.g., "Credit Report"
  documentCategory: PortalDocCategory;  // Credit | Cross-Cutting | Compliance | Income | Assets | Property | Title
  priority: "P0" | "P1" | "P2";
  appliesTo: string;                // "all_borrowers" | borrower-specific
  specifications: string[];
  reasonsNeeded: string[];
  conditions: string[];
  sourceReferences: string[];
  severity: "HARD-STOP" | "SOFT-STOP";
  status: string;                   // "needed" — extensible if portal adds more
  tags: string[];
  sourceModule: string;             // portal-internal module ID
}

export type PortalDocCategory =
  | "Credit" | "Cross-Cutting" | "Compliance"
  | "Income" | "Assets" | "Property" | "Title";

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

export interface AnalysisStats {
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
  stats: AnalysisStats;
}

export abstract class LenderAdapter {
  // ... existing methods ...

  /**
   * Optional. Adapters serving lenders whose portals run their own analysis
   * implement this to convert the analyzed output into our domain shape.
   * The base class throws "not supported" so non-analysis adapters fail loudly
   * if accidentally routed here. Subclasses that DO support it override.
   */
  transformAnalysisOutput(_raw: unknown, _config: AdapterConfig): TransformAnalysisOutput {
    throw new Error(`adapter '${this.adapterType}': analysis-output channel not supported`);
  }
}
```

### 3.2 `NPNQMPortalAdapter` rewrite

Current `NPNQMPortalAdapter.transformLoan` reads top-level fields against the synthetic fixture. The real portal output is nested under `scenario_summary`. The adapter:

- Implements `transformAnalysisOutput(raw)` against the real schema (sample shape documented in §1).
- `transformLoan` is rewritten to read from `raw.scenario_summary` (so doc-channel + loan-channel still work for tenants that push raw loan data alongside analysis).
- `deriveContextFields` now populates the expanded `LoanContextExtras` (see §5).

Field-path mapping table (canonical → portal):

| `LoanContextExtras` field | Portal source path |
|---------------------------|--------------------|
| `repFico` | `scenario_summary.credit.fico` |
| `ltv` | `scenario_summary.numbers.LTV` |
| `loanAmount` | `scenario_summary.numbers.loan_amount` |
| `loanPurpose` | `scenario_summary.purpose` (mapped: `Purchase` → `Purchase`, `Delayed Financing` → `Cash-Out Refinance`, `Rate/Term` → `Rate & Term Refinance`, others as below) |
| `propertyType` | `scenario_summary.property.property_type` |
| `dti` | `scenario_summary.numbers.DTI` |
| `reservesMonths` | `scenario_summary.asset_profile.months_reserves` |
| `noteRate` | `scenario_summary.numbers.note_rate` |
| `county` | `scenario_summary.property.county` |
| `isItin` | `scenario_summary.borrowers[primary].citizenship === "ITIN"` or borrower_type indicator |
| `llcOrLegalEntity` | derived from `scenario_summary.borrower_type` (e.g., "Long Term Rentals" suggests entity, otherwise individual) |

### 3.3 Loan purpose mapping (expanded)

Portal `purpose` strings observed in samples:
- `"Purchase"` → `"Purchase"`
- `"Delayed Financing"` → `"Cash-Out Refinance"`
- `"Rate and Term"` / `"Rate/Term Refinance"` → `"Rate & Term Refinance"`
- `"Cash-Out Refinance"` → `"Cash-Out Refinance"`
- Unknown → `undefined` (PC v2 resolvers will skip with `console.warn`)

Per-tenant `programMapping` config still applies for program-name normalization.

---

## 4. New endpoint: `POST /api/ingest/:tenantSlug/analysis-output`

### 4.1 Request shape

The portal POSTs the contents of `<loan>_output.json` directly, wrapped in a thin envelope:

```ts
{
  source: string,              // matches ingestion_mappings.source_name
  externalId: string,          // portal's loan number (e.g., scenario_summary.loan_number)
  borrowerName?: string,       // optional, for audit-log readability
  analysisOutput: {            // EXACTLY the portal's output JSON
    document_requests: PortalDocumentRequest[],
    scenario_summary: {...},
    seen_conflicts: string[],
    stats: {...}
  }
}
```

`analysisOutput.scenario_summary.borrowers[].ssn` and any other SSN-shaped field is redacted at request-handler boundary (see §6) BEFORE the adapter runs.

### 4.2 Flow

1. `apiKeyAuthHook` validates the tenant.
2. Request-body Zod parse; reject 400 with `error_class='validation_failed'` if malformed.
3. **PII redaction sweep**: walk `analysisOutput` and replace SSN-shaped strings (`/\b\d{9}\b/` or `/\b\d{3}-\d{2}-\d{4}\b/`) with `xxx-xx-NNNN` keeping only the last 4 digits. Reuse `learning/pii-redactor.ts:redactText`.
4. Idempotency: check `ingested_loans` for `(tenant_id, external_id)`. If present, return 200 `{ duplicate: true, loanId, status }`. (Same first-write-wins shape as Spec 1.)
5. Resolve mapping from `ingestion_mappings` (explicit `WHERE tenant_id = $1`).
6. Resolve adapter via `getAdapter(adapter_type)`. Reject 400 with `error_class='unknown_adapter_type'` if missing.
7. Parse adapter_config via `AdapterConfigSchema`.
8. Call `adapter.transformAnalysisOutput(redactedRaw, config)`. Catch → 500 with `error_id` + `error_class='transform_failed'` + `adapter_type`. Never echo raw payload.
9. Build the `Loan` domain object from `result.loan` via existing `buildLoanFromPartial`.
10. `store.dispatch({ type: "InjectLoan", loan })`.
11. Write `loan_context_extras` first-write-wins (existing helper).
12. Insert `result.portalPredictions` into `predicted_conditions` with `source_list='portal-llm'` (one row per portal prediction). Capture `priority`, `severity`, `specifications`, `reasons_needed`, `source_references`, `tags`, `source_module` in a new `portal_metadata JSONB` column (see §5).
13. Insert `result.eligibilityVerdict` into new `portal_eligibility_verdicts` table (see §5).
14. Insert `ingested_loans` row.
15. Per-ingest `tenant_audit_log` entry (`action='ingest.analysis_output'`) with stats summary in metadata.
16. **PC v2 auto-fire** — best-effort, same as loan-channel ingest. PC v2 writes its own `predicted_conditions` rows with the existing `source_list` values (minimum/income/matrix/geographic/requirements). Two-opinion view emerges naturally from the union.
17. Return 201 with `{ loanId, tenantId, portalPredictionCount, eligibilityPrograms: { eligible, ineligible }, pcV2Triggered: true|false }`.

### 4.3 Errors

Same category-coded shape as Spec 1's loan-channel (no payload echo):
- `400 validation_failed` (bad Zod parse)
- `400 unknown_adapter_type`
- `400 no_active_mapping`
- `500 transform_failed` with `{ adapter_type, error_id }`

---

## 5. Schema changes (migration 023)

All additive. No destructive ALTER.

```sql
-- packages/api/src/db/migrations/023-portal-analysis-output.sql

-- 5.1 Widen predicted_conditions.source_list CHECK
ALTER TABLE predicted_conditions DROP CONSTRAINT IF EXISTS predicted_conditions_source_list_check;
ALTER TABLE predicted_conditions ADD CONSTRAINT predicted_conditions_source_list_check
  CHECK (source_list IN (
    'minimum', 'income', 'matrix', 'geographic', 'requirements',  -- PC v1 + v2 (existing)
    'portal-llm'                                                  -- amendment: external analyzer
  ));

-- 5.2 Portal-specific metadata on each portal-emitted prediction
ALTER TABLE predicted_conditions ADD COLUMN IF NOT EXISTS portal_metadata JSONB;
-- Shape (when source_list='portal-llm'):
--   { priority, severity, document_category, specifications[], reasons_needed[],
--     source_references[], tags[], source_module, applies_to }

-- 5.3 portal_eligibility_verdicts — capture the portal's matrix-resolver-equivalent output
CREATE TABLE IF NOT EXISTS portal_eligibility_verdicts (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL CHECK (length(loan_id) BETWEEN 1 AND 200),
  program TEXT NOT NULL CHECK (length(program) BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL')),
  passed_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  failed_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- failed_rules shape: [{ requirement: string, message: string }]
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, loan_id, program)
);

ALTER TABLE portal_eligibility_verdicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_eligibility_verdicts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON portal_eligibility_verdicts;
CREATE POLICY tenant_isolation ON portal_eligibility_verdicts
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- 5.4 Expanded LoanContextExtras (no schema change; Zod schema in @twin/core grows)
-- See §7 for the new optional fields. JSONB tolerates additions.
```

### 5.1 Expand `LoanContextExtrasSchema`

New optional fields covering the `scenario_summary` surface area PC v2 resolvers could use:

```ts
// packages/core/src/adapter-config.ts (modify)
export const LoanContextExtrasSchema = z.object({
  // existing fields (preserved)
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

  // amendment additions (all optional; .strict() preserved)
  occupancy: z.enum(["Primary", "Secondary", "Investment", "NOO"]).optional(),
  state: z.string().length(2).optional(),
  units: z.number().int().min(1).max(8).optional(),
  cltv: z.number().min(0).max(200).optional(),
  hcltv: z.number().min(0).max(200).optional(),
  ownedPropertiesCount: z.number().int().nonnegative().optional(),
  reoTotalLienBalance: z.number().nonnegative().optional(),
  subjectRentalIncome: z.number().nonnegative().optional(),
  isFirstTimeHomebuyer: z.boolean().optional(),
  borrowerType: z.string().optional(),     // "Long Term Rentals" | "Vacation Rental" | etc.
  channel: z.string().optional(),          // "Wholesale" | "Retail" | "Broker"
  productVariant: z.string().optional(),   // "Conventional" | etc.
  interestOnly: z.boolean().optional(),
  prepayPenalty: z.boolean().optional(),
  balloon: z.boolean().optional(),
  isUsCredit: z.boolean().optional(),
  citizenship: z.string().optional(),
  selfEmployed: z.boolean().optional(),
  primaryIncomeType: z.string().optional(),  // "DSCR" | "Full Doc - Wage Earner" | etc.
  bankruptcyHistory: z.boolean().optional(),
  foreclosureHistory: z.boolean().optional(),
  shortSaleHistory: z.boolean().optional(),
  presentlyDelinquent: z.boolean().optional(),
  outstandingJudgments: z.boolean().optional(),
}).strict();
```

The .strict() rejection still catches typos, but the surface grows from 11 → 32 fields. PC v2's requirements-resolver gains many more deterministic handlers.

---

## 6. PII handling

The sample `aubrey_output.json` contains `"ssn": "605827691"` — unmasked 9-digit SSN. Spec 1 had no PII handling on the loan-channel (because we assumed pre-redacted inputs); this assumption is wrong.

### 6.1 Redaction at request boundary

In the new endpoint handler, BEFORE adapter dispatch:

```ts
import { redactText } from "../learning/pii-redactor.js";

function redactPayload(raw: unknown): unknown {
  // Deep clone + walk the tree; for any string field, run redactText.
  // For numeric SSN fields (raw 9-digit numbers stored as strings without dashes),
  // explicitly mask all but the last 4 digits.
  // ...
}
```

The `learning/pii-redactor.ts:redactText` already handles SSN-dashed, SSN-spaced, SSN-undashed, email, phone, address, DOB. The endpoint runs it on every string in the payload before persisting anywhere.

### 6.2 Field-level rule for SSN

`scenario_summary.borrowers[].ssn` is the canonical SSN field. Replace with `xxx-xx-{last 4}` before further processing. The masked value flows through to `Loan.borrower.ssnMasked`. No raw SSN ever lands in the store, DB, or any log statement.

### 6.3 What's NOT redacted

- Borrower full name (already in Loan domain; not regulated as PII at this level for our purposes).
- Property address (already used for geographic resolver lookups; needs to be readable).
- Loan amounts and financial numbers.

If the team decides later to expand redaction scope, the redactor module is the single place to add rules.

---

## 7. PC v2 second-opinion semantics

When the analysis-output endpoint completes ingestion + portal-prediction insertion, the route auto-fires PC v2 against the same loan. PC v2 writes its own `predicted_conditions` rows with existing source values.

**Result:** the same loan has TWO sets of predicted conditions:
- N rows with `source_list='portal-llm'` (rich, slow, LLM-derived, with `portal_metadata` populated)
- M rows with `source_list IN ('minimum','income','matrix','geographic','requirements')` (fast, deterministic + small LLM backstop)

UI shows both with source labels. Operator/UW can see drift naturally.

**Drift detection logic is deferred** to a future spec. Storing both verdicts is enough for v1 — UI can compute drift on read with a simple union+diff over `description`.

PC v2 still uses the existing PC_SCHEMA_VERSION-based idempotency hash. If portal re-pushes the same loan with identical `scenario_summary`, PC v2 sees the cached batch and skips.

---

## 8. NPNQMPortalAdapter rewrite checklist

Updates to `packages/api/src/ingestion/adapters/npnqm-portal.ts`:

1. `transformLoan(raw, config)` reads from `raw.scenario_summary.*` instead of top-level. Maintains backwards compat with the synthetic fixture by checking `scenario_summary` presence first and falling back to top-level.
2. `extractExternalLoanId(raw)` returns `raw.scenario_summary?.loan_number ?? raw.borrowerCaseId`.
3. `transformDocument` unchanged (still used by the doc-channel for file pushes — the portal pushes file metadata separately after the analysis-output ingest).
4. `transformAnalysisOutput(raw, config)` is new — see §3.1 shape. Maps `document_requests[]` → `PortalPrediction[]`, `scenario_summary.program_eligibility_detail` → `EligibilityVerdict`, etc.
5. `deriveContextFields(loan, raw, config)` now produces the expanded extras (§5.1). Reads from `raw.scenario_summary.*` paths.

The synthetic fixtures from Task 0 of Spec 1 (`packages/api/test/fixtures/adapters/npnqm-portal-sample-*.json`) get **replaced** with the real samples that landed today. Adapter tests calibrate against real shapes.

---

## 9. Testing strategy

| Layer | What | How |
|-------|------|-----|
| Adapter unit | `NPNQMPortalAdapter.transformAnalysisOutput` | Golden-file tests against the 5 real sample loans (aubrey, montes, niccum, nyarko, weingarten). One test per loan asserts: `loan.transaction.loanAmount` matches the sample, `portalPredictions.length` matches `stats.total_document_requests`, `eligibilityVerdict.eligiblePrograms` matches the sample. |
| PII redaction | `redactPayload` strips SSN | Test with a sample containing `ssn: "605827691"`; assert output has `xxx-xx-7691`; assert no raw 9-digit pattern remains anywhere in the redacted tree. |
| Endpoint integration | `POST /api/ingest/.../analysis-output` | Seed tenant + mapping + key; POST a real sample (with SSN); assert 201, `loan_context_extras` row populated, N `predicted_conditions` rows with `source_list='portal-llm'`, eligibility verdict row inserted. |
| Idempotency | Re-POST same `externalId` | Returns 200 `{ duplicate: true }`; no new rows. |
| Drift surfacing | After ingest, PC v2 has fired | Assert `predicted_conditions` rows exist with BOTH `source_list='portal-llm'` AND non-portal sources. (Drift computation deferred.) |
| Source-list widening | Migration 023 allows `'portal-llm'` | Direct DB INSERT with `source_list='portal-llm'` succeeds; INSERT with `source_list='not-a-source'` fails the CHECK. |
| W12 e2e workflow | Full happy path | New `scripts/e2e-harness/workflows/W12-analysis-output.ts`: load real sample, POST analysis-output, assert portal + PC v2 rows present. |

### 9.1 Real samples committed as fixtures

Move the 5 sample loans from `/tmp/npnqm-portal-samples/test_results/` into the repo at `packages/api/test/fixtures/portal-analysis/`:

- `aubrey_output.json` (Investor DSCR, Delayed Financing, 17 docs)
- `montes_output.json` (17 docs, P0=2, P1=13, P2=2)
- `niccum_output.json` (17 docs)
- `nyarko_output.json` (18 docs — most complex)
- `weingarten_output.json` (16 docs)
- `batch_summary.json` (cross-loan reference)

**Strip the SSNs before committing.** Replace with `xxx-xx-NNNN` masked form. The test's PII-redaction test gets a separate fixture with an explicit SSN to verify redaction works.

---

## 10. Out of scope (deferred)

- **Drift detection UI / persistence** — store both verdicts now; build the UI surface later when UX requirements settle.
- **Document-byte ingest from the portal** — file uploads continue through Spec 1's `/api/ingest/.../documents`. The portal-analysis ingest may include doc-metadata references (filenames, etc.) but no bytes.
- **Final-state-file ingest** — `<loan>_final_state.json` (full agent trace) is not consumed by UAS v1. Future debugging/audit use case.
- **Source-reference normalization** — portal cites "NQMF Guidelines - Credit Report Requirements"; PC v2 cites `program_requirements.id` UUIDs. Storing both as-is; bridge can land in a future spec.

## 11. Out of scope (true non-goals)

- Re-running portal's 8-minute analyzer in UAS. Their analysis is authoritative; we don't duplicate it.
- Predicting eligibility from `scenario_summary` ourselves. PC v2's matrix-resolver does this, but we don't override the portal's verdict.

---

## 12. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Real portal payloads diverge from the 5 sample shapes (additional fields, missing fields) | Zod parse with `.passthrough()` on the analysis-output envelope; adapter uses defensive `pick()` lookups with `undefined` fallback (existing pattern). Schema-strict ONLY on extras. |
| SSN leaks into logs/store/DB | Single redaction sweep at request boundary BEFORE any downstream call. Test asserts no raw 9-digit pattern in redacted output. Add a `pino` redaction rule on `req.body.analysisOutput.scenario_summary.borrowers[*].ssn` as belt-and-suspenders. |
| Portal predictions and PC v2 predictions create UI clutter | Both stored with explicit `source_list`. UI filters/groups by source. Drift surfacing deferred. |
| Migration 023 breaks existing PC v2 rows | Constraint widening (drop + recreate CHECK) is the only change. Existing rows have valid source values; new constraint admits them. Tested by re-running `pnpm --filter @twin/api test predict-conditions` after migration. |
| Adapter exceptions echo payload data | Exception handler returns `{ error_id, adapter_type, error_class }` only. Stack + message logged server-side. Same pattern as Spec 1 §C1. |
| Cost: portal payloads are ~50-100KB each | One INSERT per `document_request` (≤20 rows per loan). One INSERT per eligibility program (≤8 rows). One JSONB write per extras row. Negligible vs the 8 minutes the portal spent producing this. |
| Future portal-format changes break adapter | Field-path mapping is per-tenant via `adapter_config.fieldPathOverrides` (existing); for major shape changes, bump `adapterType` (e.g., `npnqm-portal-v2`) and ship a new adapter class. |

---

## 13. Acceptance criteria

1. `POST /api/ingest/:tenantSlug/analysis-output` accepts a real sample payload (e.g., `aubrey_output.json`) and returns 201 with `portalPredictionCount` matching the sample's `stats.total_document_requests`.
2. SSN values in the payload never appear in DB rows or log statements. A grep test against the test DB confirms no 9-digit-no-dash sequence and no `xxx-xx-NNNN` pattern with the original last-4 from an explicit-SSN test fixture.
3. `predicted_conditions` for that loan has N rows with `source_list='portal-llm'` (N = sample's doc count) and M rows with PC v2 sources after auto-fire (M = whatever PC v2 emits — likely 5-15 from doc-checklist + matrix/geographic/requirements).
4. `portal_eligibility_verdicts` has one row per program in the sample's `program_eligibility_detail` with matching `status` and `failed_count`.
5. `loan_context_extras` row populated with at least 15 of the 32 extras fields from the sample (depends on which the sample carries).
6. Re-POSTing the same `externalId` returns 200 with `duplicate: true`; no additional rows inserted.
7. Migration 023 applies cleanly to a DB with existing PC v2 predicted_conditions rows; no constraint violations.
8. Adapter unit tests pass against all 5 real-sample fixtures.
9. W12 e2e workflow passes.
10. Build clean (`@twin/core`, `@twin/api`, `@twin/web`) with no TypeScript errors.

---

## 14. Sequencing for the plan

Five phases, smaller than Spec 1 because most infrastructure already exists:

- **Phase A — Foundation.** Migration 023, `LoanContextExtras` schema expansion, `PortalPrediction`/`EligibilityVerdict`/`AnalysisStats`/`TransformAnalysisOutput` types in `lender-adapter.ts`, base-class `transformAnalysisOutput` throwing default. Replace synthetic fixtures with the 5 real samples (SSN-masked).
- **Phase B — Adapter rewrite.** `NPNQMPortalAdapter.transformAnalysisOutput` against real shapes. Rewrite `transformLoan` + `deriveContextFields` for the new payload shape (preserving back-compat). Golden tests against all 5 samples.
- **Phase C — Endpoint + PII.** `POST /api/ingest/:tenantSlug/analysis-output` route, request-body Zod schema, PII redaction sweep, error contracts, audit log. Integration tests including the explicit-SSN redaction case.
- **Phase D — Persistence + PC v2 wiring.** Insert portal predictions with `source_list='portal-llm'` + `portal_metadata`; insert `portal_eligibility_verdicts`; trigger PC v2 auto-fire (existing pattern); integration test asserting both source families coexist.
- **Phase E — E2E + polish.** W12 harness workflow; final integration test; final code review; memory update.

Estimate: **8-10 plan tasks across 5 phases**. Smaller than Spec 1 (21 tasks) because the framework, registry, schemas, doc-fetch worker, and admin API are reused unchanged.

---

## 15. Open items

- Whether `transformAnalysisOutput` should be on the base `LenderAdapter` (with default throw) or on a separate `LenderAnalysisAdapter` interface. Draft uses the former (simpler; matches existing pattern of `GenericJsonAdapter` throwing on `transformDocument`). Open to revisiting.
- Whether `seen_conflicts` should be persisted in its own table or just included in the audit-log metadata. Draft: audit-log metadata only (low volume; queryable enough).
- Whether `final_state.json` should ever be ingested. Currently out of scope; reconsider if a UW workflow needs the full agent trace.
- Whether to add a `source_module` enum check on `portal_metadata.source_module` to catch portal-side renames. Draft: no — let the JSONB flex; the portal team can reshape without breaking us.
- Whether portal can re-push an analysis with NEW `document_requests` (e.g., after the borrower submits more docs). Draft: re-push hits the duplicate path (200, no change). To support re-analysis, the portal must rotate the `externalId` or send a `force: true` flag. Out of scope for this spec.

---

*End of Spec 1.5 amendment draft.*
