# HOI / Flood Validator — Design Spec

**Date:** 2026-05-16
**Status:** Brainstormed, pending user review
**Scope:** First slice of the pre-UW agentic layer (Option C from the TPO UW Job Aid assessment). One validator: HOI + Flood policy compliance against NPNQM's RM Job Aid rule set.
**Source rules:** NPNQM RM Job Aid (33 pp.), §"Taxes & Insurance / Hazard & Flood Insurance" (pp. 13-14).

---

## 1. Overview

NPNQM's Relationship Managers (RMs) currently perform 14 manual rule checks against Hazard Insurance and Flood policy documents before a loan is resubmitted to Underwriting. Each check is deterministic given the policy's extracted fields — e.g., "loss payee clause matches required text by channel", "deductible ≤ 5% of face value", "DSCR loans require 6 months PITIA rent loss coverage".

This spec introduces a **HOI/Flood Validator** that runs as a 5th source within PC v2 (`source_list = 'hoi-validator'`). It consumes structured policy fields from either (a) NPNQM portal-provided extractions or (b) our own LLM-based document parsing, applies the 14 rules deterministically, and surfaces failures as predictions in the existing Two-Source Coexistence UI.

Pass-case is silent for MVP; only failures emit predictions. RMs and UWs accept/dismiss findings through the existing curation flow.

**Out of scope for this slice:** outbound condition status updates (blocked on Spec 2), Title/CPL/E&O/Payoff/Doc-Expiration/ICD/Mavent/Lock-variance/Credit-refresh validators (planned as follow-ons under the same Option C umbrella), demo-tenant fixtures, real-LLM-call CI tests.

---

## 2. Architecture

The validator is a 5th PC v2 source with a different input shape than the existing four. Existing sources (`matrix`, `geographic`, `requirements`, `doc-checklist`) take `LoanContext` and query KB tables. The HOI validator additionally takes **cached document extractions** — structured fields parsed once per HOI/Flood document, then evaluated cheaply on every PC v2 run cycle.

Two upstream extraction paths feed a single cache:

- **`PortalProvidedHoiExtractor`** — reads from an optional new field `analysisOutput.extracted_documents[]` in the Spec 1.5 ingestion payload. NPNQM populates when they have the data; we don't pay an LLM cost. Requires a small additive schema change on their side.
- **`LlmHoiExtractor`** — fires on document upload via a new `hoi-extractor-worker`. Calls Claude with a Zod-validated tool-use schema. Writes structured fields to the cache. We control this end-to-end; works without NPNQM's involvement.

A `CompositeHoiExtractor` selects between them per the tenant's `validators.hoi.extractorMode` config (`portal-only` / `llm-only` / `auto`, default `auto`).

Tenant gating: the validator runs only when `tenant.settings.validators.hoi.enabled = true`. Initially enabled for `npnqm-twin` only; demo and other tenants remain unaffected.

---

## 3. Data Model

### 3.1 New table: `document_extractions`

```sql
CREATE TABLE document_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  loan_id TEXT NOT NULL,
  document_id UUID NOT NULL,                       -- FK semantic; documents.id
  extractor_kind TEXT NOT NULL,                    -- 'hoi-policy' | 'flood-cert' | future kinds
  schema_version INT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('portal', 'llm-extractor', 'manual')),
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  extracted_by TEXT NOT NULL,                      -- 'worker:hoi-extractor:v1' | 'portal:npnqm' | userId
  fields JSONB NOT NULL,                           -- shape per extractor_kind (see §3.2)
  extraction_confidence NUMERIC,                   -- 0-1, null when source='portal'
  extraction_error TEXT,                           -- non-null on failed extractions
  superseded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX document_extractions_active
  ON document_extractions (tenant_id, document_id, extractor_kind, schema_version)
  WHERE superseded_at IS NULL;

CREATE INDEX document_extractions_loan
  ON document_extractions (tenant_id, loan_id, extractor_kind)
  WHERE superseded_at IS NULL;

ALTER TABLE document_extractions ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_extractions_tenant_isolation ON document_extractions
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

All queries from app code MUST include explicit `WHERE tenant_id = $1` (Supabase pooler bypasses RLS — established pattern in memory).

### 3.2 `fields` JSONB shape for `extractor_kind = 'hoi-policy'`

```ts
const HoiPolicyFields = z.object({
  carrier: z.string().nullable(),
  policyNumber: z.string().nullable(),
  namedInsured: z.string().nullable(),
  propertyAddress: z.object({
    line1: z.string(),
    line2: z.string().nullable(),
    city: z.string(),
    state: z.string(),
    zip: z.string(),
  }).nullable(),
  effectiveDate: z.string().nullable(),            // ISO date
  expirationDate: z.string().nullable(),
  termMonths: z.number().int().nullable(),
  lossPayeeClause: z.string().nullable(),          // full verbatim text
  loanNumberOnPolicy: z.string().nullable(),
  coverageAmount: z.number().nullable(),
  replacementCost: z.number().nullable(),
  deductiblePct: z.number().nullable(),            // 0-1
  deductibleAmount: z.number().nullable(),
  windHailHurricane: z.object({
    included: z.boolean(),                          // LLM-derived boolean from wording
    wording: z.string().nullable(),                 // verbatim text the LLM saw
    separatePolicy: z.boolean(),
    confidence: z.number().min(0).max(1),           // per-field LLM self-reported confidence
  }).nullable(),
  rentLossCoverageMonths: z.number().int().nullable(),
  rentLossWording: z.string().nullable(),          // verbatim; flag "actual cost sustained"
  rentLossActualCostSustained: z.object({          // semantic check on the wording
    detected: z.boolean(),                          // true if "actual cost sustained" present
    confidence: z.number().min(0).max(1),
  }).nullable(),
  occupancyOnPolicy: z.string().nullable(),
  premiumPaidInFull: z.object({
    paid: z.boolean(),
    confidence: z.number().min(0).max(1),
  }).nullable(),
  premiumDueDays: z.number().int().nullable(),     // days from policy date until premium due
  wallsInCoverage: z.object({                      // condo HOA master policy
    included: z.boolean(),
    confidence: z.number().min(0).max(1),
  }).nullable(),
  ho6Policy: z.object({                            // separate condo unit-owner policy
    present: z.boolean(),
    deductiblePct: z.number().nullable(),
    coverageAmount: z.number().nullable(),
  }).nullable(),
  evidence: z.array(z.object({
    fieldPath: z.string(),
    documentPage: z.number().int(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
  })),
});
```

### 3.3 `fields` JSONB shape for `extractor_kind = 'flood-cert'`

```ts
const FloodCertFields = z.object({
  carrier: z.string().nullable(),
  policyNumber: z.string().nullable(),
  namedInsured: z.string().nullable(),
  propertyAddress: z.object({/* same shape as HOI */}).nullable(),
  effectiveDate: z.string().nullable(),
  expirationDate: z.string().nullable(),
  termMonths: z.number().int().nullable(),
  floodZone: z.string().nullable(),                // FEMA zone code (e.g., "AE", "X")
  floodCoverage: z.number().nullable(),
  floodDeductible: z.number().nullable(),
  isNfip: z.boolean().nullable(),
  nfipMaxApplied: z.boolean().nullable(),
  evidence: z.array(/* same */),
});
```

### 3.4 `portal_metadata.validationFindings` shape on predictions

```ts
const ValidationFinding = z.object({
  ruleId: z.string(),                              // e.g., "hoi.loss-payee.match"
  severity: z.enum(["fail", "warn"]),
  currentValue: z.string().nullable(),
  expectedValue: z.string().nullable(),
  evidence: z.object({
    documentId: z.string().uuid(),
    extractionId: z.string().uuid(),
    fieldPath: z.string(),
    documentPage: z.number().int().nullable(),
  }),
});

// Appended to existing portal_metadata schema:
portal_metadata: {
  // ...existing fields...
  validationFindings?: ValidationFinding[];
}
```

### 3.5 Tenant config

```json
{
  "validators": {
    "hoi": {
      "enabled": true,
      "extractorMode": "auto",
      "schemaVersion": 1
    }
  }
}
```

`extractorMode`:
- `auto` (default) — prefer portal-provided extraction; fall back to LLM when portal didn't supply
- `portal-only` — never invoke LLM extractor; rules skip if portal didn't supply
- `llm-only` — always invoke LLM extractor; ignore portal extractions

### 3.6 Advisory lock

`hoi-extractor-worker` uses advisory lock **46** (next in the sequence: sla-monitor=42, learning-worker=43, doc-fetch=45).

### 3.7 Migration ordering

This is the first migration after Spec 1.5's migration 024. Migration filename: `025_document_extractions.sql`.

---

## 4. Components

### 4.1 `HoiFieldExtractor` interface

Location: `packages/api/src/services/validators/hoi/extractor.ts`

```ts
export interface DocumentRef {
  tenantId: string;
  loanId: string;
  documentId: string;
  category: "hoi-policy" | "flood-cert";
  storageUrl: string;
}

export interface HoiExtractionResult {
  fields: HoiPolicyFields | FloodCertFields;
  source: "portal" | "llm-extractor";
  confidence: number | null;       // null when source='portal'
  extractedBy: string;
}

export interface HoiFieldExtractor {
  canExtract(doc: DocumentRef): Promise<boolean>;
  extract(doc: DocumentRef): Promise<HoiExtractionResult>;
}
```

Three implementations:

- `PortalProvidedHoiExtractor` — checks for an existing `document_extractions` row with `source = 'portal'` and `superseded_at IS NULL`. `canExtract` returns true if found; `extract` returns the cached row.
- `LlmHoiExtractor` — calls Anthropic Claude with a tool-use schema matching `HoiPolicyFields` / `FloodCertFields`. Uses prompt caching (existing pattern from learning-worker). Returns structured fields + per-field confidence on prose-derived booleans.

  **Grounding-pass (R1):** After the tool-use call returns and passes Zod validation, the extractor runs a per-field grounding check on each prose-derived boolean field (`windHailHurricane.included`, `rentLossActualCostSustained.detected`, `wallsInCoverage.included`, `premiumPaidInFull.paid`). The check confirms the boolean's truthiness is consistent with the captured verbatim `wording` field via stem-matched content-word presence:

  - For `windHailHurricane.included = true` — wording must contain at least one of: `included`, `covered`, `all perils`, `special form`, `comprehensive`, `windstorm`, `hail`, `hurricane`
  - For `windHailHurricane.included = false` — wording must contain at least one of: `excluded`, `not covered`, `exclusion`, `excludes`
  - For `rentLossActualCostSustained.detected = true` — wording must contain `actual cost sustained` or `actual loss sustained` (substring match)
  - For `wallsInCoverage.included = true` — wording must contain `walls-in`, `walls in`, `unit interior`, `bare walls` (any)
  - For `premiumPaidInFull.paid = true` — wording must contain `paid in full`, `paid receipt`, `premium paid`, `payment in full` (any)

  On mismatch (boolean asserts a conclusion the wording doesn't support), the extractor overrides the field's `confidence` to `0.3` and logs a structured warn. Downstream rule evaluation per §6.3 will then skip the rule via the per-field threshold. This is the equivalent of PC v2 §5.3's source-text grounding step for this validator's inverse pattern (LLM extracts → rule judges).

  Grounding-pass failures are recorded in `extraction_error` as a JSON array of `{ field, conclusion, reason }` entries so operators can audit extraction quality post-hoc.

- `CompositeHoiExtractor` — composes the two per `extractorMode` config.

### 4.2 `hoi-extractor-worker`

Location: `packages/api/src/workers/hoi-extractor-worker.ts`

Pattern: advisory-lock-guarded polling worker, same shape as `doc-fetch-dispatcher` (Spec 1).

- Lock 46, poll interval 5000ms
- Queries `ingested_documents` (not `documents` — corrected per C3) rows where `doc_type IN ('Hazard Insurance', 'Homeowner Insurance', 'Flood Certificate', 'Flood Cert')` that have no active `document_extractions` row at the current `schema_version`. The set of matching `doc_type` strings is centralized in a constant `HOI_FLOOD_DOC_TYPES` for symmetry with the NPNQM adapter's classification map (`packages/api/src/ingestion/adapters/npnqm-portal.ts:94` — `classification → docType` mapping).
- For each: invokes `LlmHoiExtractor` (skip if `extractorMode = 'portal-only'`)
- Writes result to `document_extractions`
- Retry policy: 1m → 5m → 30m → 2h → 12h, dead-letter after 5 attempts
- Dead-lettered extractions emit a `prediction_alerts` row visible in the UI

**Cost observability (P4):** Each successful LLM extraction call emits a Prometheus gauge `hoi_extraction_cost_dollars{tenant_id, extractor_kind, doc_type}` populated from Anthropic's response `usage` object (input tokens × input rate + output tokens × output rate, using the current pricing constants from `packages/api/src/services/predict-conditions/llm/cost.ts` or equivalent). A counter `hoi_extraction_calls_total{tenant_id, extractor_kind, outcome}` (`outcome ∈ {success, malformed, rate_limited, dead_lettered}`) supports cost-per-outcome analysis. Operators can chart per-tenant extraction cost; future budget caps can read from these signals. Pattern mirrors PC v2 §4.4's `dropped_*` counters.

**`ingested_documents.doc_type` provenance (C3):** The `doc_type` column was added in migration 021 (`021-ingested-documents-doc-type.sql`) as `TEXT NOT NULL DEFAULT 'Other'`. Values are free-form strings populated by `LenderAdapter.transformDocumentRequest` from the lender's classification field. The NPNQM adapter at `packages/api/src/ingestion/adapters/npnqm-portal.ts:94` maps the portal's `classification` field to canonical doc-type strings. If the column is empty (only happens on legacy rows pre-migration-021), the worker logs a structured warn and processes zero documents — non-fatal, operator-noticeable.

Starts in `server.ts` when `isDbEnabled()`, mirroring `startSlaMonitor()`.

### 4.3 Spec 1.5 adapter extension

Location: `packages/api/src/ingestion/adapters/npnqm-portal.ts`

Extend `transformAnalysisOutput` to accept an optional `analysisOutput.extracted_documents[]` array:

```ts
interface ExtractedDocumentPayload {
  documentExternalId: string;       // maps to documents.external_id
  extractorKind: "hoi-policy" | "flood-cert";
  schemaVersion: number;
  fields: HoiPolicyFields | FloodCertFields;
  extractedAt: string;              // ISO timestamp
}
```

For each entry, insert a `document_extractions` row with `source = 'portal'`. Idempotency: re-pushing the same `(document_id, extractor_kind, schema_version)` is a no-op via partial unique index.

This is an **optional** schema additive on NPNQM's side; missing field means we fall through to LLM extraction.

### 4.4 `hoi-validator-resolver`

Location: `packages/api/src/services/predict-conditions/resolvers/hoi-validator-resolver.ts`

```ts
export async function resolveHoiValidatorFindings(
  c: pg.PoolClient,
  tenantId: string,
  kbCtx: KbVersionContext,
  loan: LoanContext,
  extractions: DocumentExtractionMap,
): Promise<Finding[]>
```

Behavior:

1. Check tenant config — if `validators.hoi.enabled !== true`, return `[]`.
2. For each cached extraction matching the loan, evaluate all applicable rules (see §5).
3. Emit one `Finding` per fired rule with:
   - `description` per rule template
   - `note` describing the specific failure
   - `category: "PTD"` (matches HOI condition behavior in NPNQM workflow)
   - `sourceList: "hoi-validator"`
   - `sourceRuleId: <ruleId>` (e.g., `"hoi.loss-payee.match"`)
   - `sourceRuleTable: "hoi_validator_rules"` (virtual identifier; not a real table)
   - `emissionKind: "deterministic"`
   - `metadata.validationFindings` populated per §3.4

### 4.5 PC v2 service wiring

Location: `packages/api/src/services/predict-conditions/service.ts`

Add `resolveHoiValidatorFindings` to the resolver invocation list within `run()`. New input: fetch `document_extractions` for the loan and pass as a map keyed by `extractor_kind`.

**R2 — `hoi-validator` rows are idempotent, not delete-and-reinsert.** The existing DELETE-pending-rows step (`AND source_list != 'portal-llm'` per Spec 1.5 Task 7) is extended to also exclude `source_list = 'hoi-validator'`:

```sql
DELETE FROM predicted_conditions
WHERE tenant_id = $1 AND loan_id = $2 AND status = 'pending'
  AND source_list NOT IN ('portal-llm', 'hoi-validator');
```

Inserts of `hoi-validator` rows use `ON CONFLICT DO NOTHING` against a new partial unique index:

```sql
CREATE UNIQUE INDEX predicted_conditions_hoi_validator_active
  ON predicted_conditions (tenant_id, loan_id, source_list, source_rule_id, ((portal_metadata->>'extractionId')))
  WHERE source_list = 'hoi-validator' AND status = 'pending' AND superseded_at IS NULL;
```

The `extractionId` (stored in `portal_metadata.extractionId`) is stable across PC v2 re-runs because the upstream `document_extractions` cache is keyed by `(document_id, extractor_kind, schema_version)`. A given extraction produces the same rule-fired output every time, so re-running PC v2 with an unchanged extraction is a no-op on the index. When a document is re-uploaded and the extraction supersedes, the new extraction has a new `extractionId`, and a fresh PC v2 run inserts a new row with a different UUID (the old row's status remains until manually dismissed; the operator sees both rows transiently, which is the correct behavior — the old finding is genuinely stale).

**Why this matters:** the Two-Source UI's partial-failure cleanup banner (PR #7) tracks failed dismiss calls by row UUID. Under the prior delete-and-reinsert semantics, a transient dismiss failure would race with a concurrent PC v2 re-fire that wiped the row, leaving the banner referencing a stale UUID. The idempotent-insert pattern preserves row UUIDs across re-runs, so the Retry-cleanup affordance always targets a live row. This mirrors the established Spec 1.5 portal-llm pattern (versioned via `superseded_at`, not DELETE).

Bump `PC_SCHEMA_VERSION` (memory says: bump on every new source).

### 4.6 Rule engine

Location: `packages/api/src/services/validators/hoi/rules.ts`

One function per rule, exported as a registry:

```ts
export interface RuleContext {
  hoi: HoiPolicyFields | null;
  flood: FloodCertFields | null;
  loan: LoanContext;
  documents: { hoi: DocumentRef | null; floodCert: DocumentRef | null };
}

export interface RuleResult {
  ruleId: string;
  fired: boolean;
  finding: ValidationFinding | null;
}

export type Rule = (ctx: RuleContext) => RuleResult;

export const HOI_RULES: Rule[] = [
  H1_lossPayeeMatch,
  H2_namedInsuredMatch,
  // ... H3-H12, F1-F2
];
```

Each rule:
- Returns `{ fired: false, finding: null }` if inputs are missing (skip) or rule passes
- Returns `{ fired: true, finding: { ruleId, severity, currentValue, expectedValue, evidence } }` on failure
- Pure function — no DB, no IO; testable as units

### 4.7 UI rendering branch

Location: `packages/web/components/encompass/GroupedConditionCard.tsx`

When any prediction in the group has non-empty `portal_metadata.validationFindings`, render an additional "Validation Findings" section inside the card. Per finding, show:

- Severity badge (`fail` red, `warn` yellow)
- Rule description (one line)
- `currentValue` → `expectedValue` diff line
- Optional "View evidence" disclosure showing the page reference

Existing accept/dismiss controls work unchanged. The card title remains the canonical condition name (`Property: Hazard Insurance (TPO)` via `normalizeConditionDescription`).

### 4.8 API surface

No new REST endpoints. Existing `GET /loans/:loanId/predictions` returns the new `source_list = 'hoi-validator'` rows with `portal_metadata.validationFindings` populated. UI already widened in PR #7 to consume `portal_metadata`.

---

## 5. Rule Set (14 rules)

All rules are deterministic given their inputs. LLM judgment is confined to extraction (e.g., interpreting "all perils included" wording as `windHailHurricane.included = true`); rule evaluation runs on the boolean.

**Naming convention (P1):** Every rule ID is exactly three dot-separated levels: `<validator>.<rule-category>.<rule-name>`. Future validators (Title, CPL, etc.) follow the same convention.

| # | ruleId | Logic | Severity on fail | Severity on low-confidence | Conditional on |
|---|---|---|---|---|---|
| H1 | `hoi.loss-payee.match` | Exact text match by channel (Wholesale = NQM Funding LLC; NDC = lender name + lender loan number; NY = Great Home Mortgage of New York) | fail | — (deterministic) | always |
| H2 | `hoi.named-insured.match` | `namedInsured` equals borrower full name (or entity name when entity-vested) | fail | — | always |
| H3 | `hoi.property-address.match` | `propertyAddress` equals subject property | fail | — | always |
| H4 | `hoi.effective-date.window` | Purchase: effectiveDate ≥ noteDate − 15d; Refi: effectiveDate ≤ noteDate | fail | — | always |
| H5 | `hoi.term.12-months` | `termMonths` ≥ 12 | fail | — | always |
| H6 | `hoi.premium.paid-in-full` | `premiumPaidInFull.paid = true` OR (paid at closing with invoice in ICD placeholder); Refi: premiums due within 60d of closing must be paid prior/at closing | fail | warn if `premiumPaidInFull.confidence < 0.7` | always |
| H7 | `hoi.deductible.cap` | `deductiblePct ≤ 0.05` | fail | — | always |
| H8 | `hoi.wind-hail-hurricane.included` | `windHailHurricane.included = true` | fail | warn if `windHailHurricane.confidence < 0.7` | always |
| H9 | `hoi.coverage.minimum` | `coverageAmount ≥ min(loanAmount, replacementCost)` | fail | — | always |
| H10 | `hoi.dscr.rent-loss-coverage` | `rentLossCoverageMonths ≥ 6` AND `rentLossActualCostSustained.detected = false` | fail | warn if `rentLossActualCostSustained.confidence < 0.7` | `productKind = DSCR` |
| H11 | `hoi.condo.walls-in-or-ho6` | `wallsInCoverage.included = true` OR (`ho6Policy.present = true` AND `ho6Policy.deductiblePct ≤ 0.05`) | fail | warn if `wallsInCoverage.confidence < 0.7` | `propertyType = Condo` |
| H12 | `hoi.occupancy.match` | `occupancyOnPolicy` aligns with transaction occupancy; DSCR ≠ Primary | fail | — | always |
| F1 | `flood.deductible.cap` | `floodDeductible ≤ $10,000` (or ≤ $25,000 for Condo/PUD) | fail | — | flood-cert document present on loan |
| F2 | `flood.coverage.minimum` | `floodCoverage ≥ min(unpaidPrincipalBalance, replacementCost, NFIP max)` | fail | — | flood-cert document present on loan |

**Severity discipline (C4):** Rules whose underlying field is LLM-derived from prose (H6, H8, H10, H11) escalate to `warn` instead of `fail` when the per-field confidence drops below 0.7 (R1 / §6.3). The `warn` severity is reserved for two purposes in this validator: (a) the R1 grounding-fallback case above; (b) future rules where soft compliance hints are appropriate (e.g., "effective date is 14 days out — close to the 15-day limit"). The other 10 rules emit only `fail` because their inputs are either numeric, ISO-date, or verbatim-text extractions with structurally lower hallucination risk.

**Channel handling for H1:**

Expected loss payee text by channel:
- Wholesale + non-NY: `NQM Funding, LLC ISAOA/ATIMA, 4800 N Federal Hwy, Bldg. E, Suite 200, Boca Raton, FL 33431` + NQMF loan number
- Wholesale + NY: `Great Home Mortgage of New York, in lieu of true name NP, Inc. ISAOA/ATIMA, 4800 N Federal Hwy, Bldg. E, Suite 200, Boca Raton, FL 33431` + NQMF loan number
- Wholesale + TX: same as non-NY, ISAOA/ATIMA clause skipped
- NDC: lender name (from `loan.lenderName`) + lender loan number; no ISAOA/ATIMA

Match logic: case-insensitive substring match on the canonical entity name + loan number presence check. Whitespace/punctuation normalization before comparison.

**Channel handling for H10/H11/H12 conditional firing:**

`productKind = DSCR` derived from `loan.documentationType.toUpperCase().includes("DSCR")` (substring match; existing field values include `DSCR > 1.15%`, `DSCR No Ratio`, etc.). New DSCR-family product names introduced by NPNQM (e.g., `DSCR Lite`, `Investor DSCR Premium`) are picked up automatically. If NPNQM introduces a documentation type containing `DSCR` that should NOT trigger H10/H12 (rent loss, occupancy), add an explicit exclusion list under tenant config (`validators.hoi.dscrProductExclusions`); not anticipated for v1.

`propertyType = Condo` derived from `loan.subjectProperty.propertyType` exact match against `"Condo"`. Other condo-like types (e.g., `"Condotel"`, `"Site Condo"`) would need explicit allow-listing — out of scope for v1.

**H1 channel mapping source (P3):** Channel inference uses `loan.channel` (Wholesale / NDC / Retail) and `loan.subjectProperty.state` for the state-variant text selection.

**NDC precondition:** The NDC branch of H1 requires `LoanContext.lenderName` and `LoanContext.lenderLoanNumber`. These fields are not currently in `LoanContext`. If absent at evaluation time, the H1 NDC branch no-ops with a structured warn (`"NDC channel not supported until LoanContext widened with lenderName/lenderLoanNumber"`) — the rule treats this as `skip`, not `fail`, so NDC tenants don't receive false-positive H1 failures during the gap. Widening `LoanContext` is tracked as a v1.1 prerequisite for full NDC channel support.

---

## 6. Error Handling

### 6.1 Extraction failures

- **Malformed LLM output** — `LlmHoiExtractor` validates against Zod; write extraction row with `fields = {}`, `extraction_confidence = 0`, `extraction_error = <reason>`. Worker retries.
- **LLM rate limit / outage** — retryable backoff (1m → 5m → 30m → 2h → 12h, dead-letter after 5 attempts).
- **Dead-lettered extractions** — emit a `prediction_alerts` row (`error_class = "HoiExtractionFailed"`) following the existing pattern.
- **Unreadable document** (encrypted PDF, image-only without OCR) — `extraction_error = "unreadable"`; rules don't fire; `requirements-resolver` continues to predict the document need; RM handles manually.

### 6.2 Missing fields

- Each rule checks input presence first. Missing required input → rule does not fire (no false positives).
- Trade-off: incomplete extraction produces fewer findings, not noisy findings. Mitigation deferred to v1.1: a "partial extraction — N rules skipped" badge.

### 6.3 Ambiguous policy text (per-field confidence + grounding)

This validator inherits PC v2 §5.3's `LLM_CONFIDENCE_FLOOR = 0.7` discipline but applies it **per-field** on prose-derived booleans rather than aggregate. The R1 grounding-pass (§4.1) catches hallucinations where the LLM asserts a boolean conclusion unsupported by the wording it captured.

**Per-field thresholds (applied at rule evaluation, not at extraction):**

- For prose-derived booleans (`windHailHurricane`, `rentLossActualCostSustained`, `wallsInCoverage`, `premiumPaidInFull`) — if `<field>.confidence < 0.7`, the corresponding rule (H8, H10, H11, H6) emits with `severity = "warn"` instead of `severity = "fail"`. The warn variant uses the same `ruleId` but carries the low-confidence signal forward to the UI. Rules whose underlying field has `confidence < 0.4` are skipped entirely (no emission).
- For deterministic fields (`coverageAmount`, `effectiveDate`, `lossPayeeClause`, etc.) — no per-field threshold; rules fire on presence/absence of the value, since LLM hallucination risk on a numeric or verbatim-text extraction is structurally lower.

**Threshold rationale:** The `0.7` floor mirrors PC v2 §5.3's `LLM_CONFIDENCE_FLOOR` so the suite shares one discipline. Calibration deferred to Layer 4 tests when real-LLM fixtures land; adjust based on observed false-positive/false-negative rates in pilot.

**Low aggregate-confidence escape hatch** (`extraction_confidence < 0.4` aggregate, OR ≥3 prose-derived fields fall below 0.4): emit a `Misc: HOI Policy Review` prediction asking RM to verify the policy manually. Specific emission shape:

```ts
{
  description: "HOI Policy: Manual Review Required",
  note: `Automated extraction confidence ${aggConfidence.toFixed(2)}. ${reason}. Verify per-field details manually before clearing the Hazard Insurance condition.`,
  category: "PTD",
  sourceList: "hoi-validator",
  sourceRuleId: "hoi.review.low-confidence",
  sourceRuleTable: "hoi_validator_rules",
  emissionKind: "deterministic",
  metadata: {
    validationFindings: [{
      ruleId: "hoi.review.low-confidence",
      severity: "warn",
      currentValue: `aggregate_confidence=${aggConfidence.toFixed(2)}`,
      expectedValue: null,
      evidence: { documentId, extractionId, fieldPath: "<aggregate>", documentPage: null }
    }]
  }
}
```

Accepting the prediction creates an "HOI Policy Review" condition that the RM clears after manual verification. The cached extraction remains; the RM can force re-extraction via a future UI control (deferred) or trigger re-extraction by re-uploading the document.

Individual high-confidence fields can still fire their respective rules even when the aggregate hatch fires — the review prediction is **additive**, not a stop-the-world signal.

### 6.4 Document re-uploads

- New document version → worker re-extracts → new `document_extractions` row → old row marked `superseded_at` via partial unique index.
- PC v2 reads only active extractions (`superseded_at IS NULL`).
- Predictions from prior extractions remain in history via existing supersede pattern (Spec 1.5).

### 6.5 Schema version bumps

- `schema_version` constant in `packages/api/src/services/validators/hoi/extractor.ts`
- Worker detects extractions with `schema_version < CURRENT` and re-processes
- No migration script needed; cache rebuilds lazily

### 6.6 Extractor precedence (`extractorMode = 'auto'`)

- Portal-provided extraction wins when present. LLM extraction skipped.
- Portal extractions are never auto-superseded by LLM. RM can force re-extract via a future UI control (deferred).
- Future enhancement: TTL-based fallback when portal extraction is stale.

**Cross-source supersede audit (C2):** When a new extraction supersedes an existing one with a *different `source`* (e.g., portal supersedes LLM via re-push, or LLM supersedes portal via future force-refresh control), the cache writer emits a `tenant_audit_log` row:

```ts
{
  target_tenant_id: tenantId,
  actor_id: extractedBy,                                  // 'portal:npnqm' | 'worker:hoi-extractor:v1' | userId
  action: 'document_extraction.superseded',
  reason: `extraction source change: ${fromSource} → ${toSource}`,
  metadata: {
    document_id: documentId,
    extractor_kind: extractorKind,
    schema_version: schemaVersion,
    from_source: fromSource,
    to_source: toSource,
    superseded_extraction_id: priorExtractionId,
    new_extraction_id: newExtractionId,
  }
}
```

Same-source supersedes (LLM re-runs after schema version bump, portal re-pushes same source) do **not** emit an audit row — they're routine. Cross-source transitions are the interesting signal for future drift-detection or operator UI surfacing, paralleling the `eligibility.disagreement` pattern from Spec 1.5 §7.1.

### 6.7 Multiple policies on one loan

- Worker extracts each document independently.
- Validator resolver groups extractions by `extractor_kind` and treats the most recent active row as canonical.
- Future: support multiple HOI policies (e.g., separate windstorm rider) — out of scope for MVP.

### 6.8 Tenant safety

- All cache queries include explicit `WHERE tenant_id = $1`.
- Validator resolver no-ops when `validators.hoi.enabled !== true`.

---

## 7. Testing Strategy

Four layers, three required for MVP.

### Layer 1: Deterministic rule tests (required)

Location: `packages/api/test/hoi-validator-rules.test.ts`

Pure unit tests, no DB, no LLM. Table-driven cases per rule. Target ≥4 cases per rule (pass / fail / NY-or-NDC-variant / missing-input-skip). ~60 cases total across 14 rules.

### Layer 2: Extractor + cache integration tests (required)

Location: `packages/api/test/hoi-extraction.integration.test.ts`

DB-backed, mocked LLM. Validates:

- Worker picks up uncategorized docs and writes extraction rows
- Portal-provided extraction blocks LLM in `extractorMode = 'auto'`
- Schema version bump triggers re-extraction
- Document supersede → new extraction → old extraction `superseded_at`
- Extraction failure path writes `extraction_error` and dead-letters after 5 retries
- Tenant isolation (extraction in tenant A not visible from tenant B)

### Layer 3: End-to-end PC v2 integration tests (required)

Extends `packages/api/test/predict-conditions.integration.test.ts`. Three scenarios:

1. **Clean policy** — all 14 rules pass; zero new predictions emitted by validator
2. **Wholesale TX with wrong loss payee** — H1 fires; one prediction with H1 finding in metadata
3. **DSCR loan with missing rent loss coverage** — H10 fires; verifies DSCR-conditional rule firing

### Layer 4: Real-LLM extraction fixture tests (deferred to v1.1)

Real Anthropic calls against 3-4 anonymized HOI policy PDFs. Gated behind `RUN_LLM_TESTS=1` env flag. Run manually when prompt or schema changes. Out of scope for MVP.

### Test data

- Hand-crafted `HoiPolicyFields` / `FloodCertFields` JSONs for Layers 1-3
- Synthetic `LoanContext` fixtures derived from existing 20 NQM scenarios in `@twin/fixtures`
- 3-4 anonymized HOI/Flood PDFs from NPNQM during the §4.1 sync (Layer 4, deferred)

### Quality gates

- All tests in Layers 1-3 must pass for merge → adds ~30-40 tests to `pnpm --filter @twin/api test` (currently 98)
- `pnpm --filter @twin/api build` clean (tsc strict)
- Behavioral test count unchanged (this validator does not touch the 10 workflow tests)
- No `@twin/fixtures` changes required

---

## 8. Open questions

### 8.1 H8 wind/hail wording fuzz — quality bar

The LLM decides `windHailHurricane.included` by interpreting policy wording ("all perils included", "special coverage form", explicit windstorm rider, etc.). MVP relies on LLM judgment + verbatim-wording preservation in the extraction. Risk: false-positive `included=true` on policies that exclude wind via fine print.

**Mitigation:** preserve the verbatim wording in `windHailHurricane.wording` so the UI can show it for human verification. Flag for early production review.

### 8.2 H1 loss-payee text matching aggressiveness

NPNQM allows minor wording variations (e.g., "Bldg E" vs "Building E"). MVP uses normalized substring match on the canonical entity name + loan number presence. Risk: false negative on substantive structural change (e.g., wrong street address).

**Mitigation:** validate the address line independently of the entity name; both must match for H1 to pass.

### 8.3 Flood-zone detection without FEMA cert

F1/F2 currently fire only when a flood-cert document exists. Risk: borrower in flood zone uploads HOI but no flood cert → validator silently skips flood checks; relies on `requirements-resolver` to predict the missing flood cert.

**Mitigation:** the existing flow already requests flood certs via `requirements-resolver`. The validator running silently is a feature, not a bug — we don't double-predict.

### 8.4 Premium-paid-in-full evidence

H6 requires evidence "paid receipt OR invoice in ICD placeholder". Detecting "invoice in ICD placeholder" requires checking other documents on the loan. MVP scope: check only `premiumPaidInFull.paid` from extraction (with grounding-pass per R1); defer the cross-document invoice check to v1.1.

---

## 9. NPNQM-side asks

The following are additive requests for the NPNQM team, none of which block MVP:

1. **Optional `analysisOutput.extracted_documents[]`** — extend the Spec 1.5 payload with structured HOI/Flood field extractions when available. Schema in §4.3 of this doc.
2. **3-4 anonymized HOI/Flood policy PDFs** — for Layer 4 fixture testing (deferred to v1.1, but useful for manual verification before MVP merge).
3. **Mavent permitted-fail spreadsheet** — already in §4.1.1 of the 2026-05-16-job-aid-followup note; not a blocker for HOI/Flood specifically but unblocks the next validator (Mavent).

These are added to the existing `docs/npnqm-source/2026-05-16-job-aid-followup.md` follow-up note for the next sync.

---

## 10. Sequencing within this slice

Suggested order for the implementation plan (writing-plans skill will produce the bite-sized task breakdown):

1. Migration 025 (`document_extractions` table + RLS)
2. Tenant config schema (`validators.hoi.enabled`)
3. `HoiPolicyFields` / `FloodCertFields` Zod schemas (in `@twin/core`)
4. Rule engine (14 pure rules in `packages/api/src/services/validators/hoi/rules.ts`) — Layer 1 tests
5. `PortalProvidedHoiExtractor` (no LLM required)
6. Spec 1.5 adapter extension (`extracted_documents[]` → cache write)
7. `LlmHoiExtractor` (Anthropic tool-use schema)
8. `CompositeHoiExtractor`
9. `hoi-extractor-worker` — Layer 2 tests
10. `hoi-validator-resolver` — wire into PC v2 service — Layer 3 tests
11. UI rendering branch (`GroupedConditionCard.tsx` validationFindings section)
12. Tenant config enable for `npnqm-twin`; smoke test on a real loan
13. Memory update + post-deploy notes

Estimated effort: 3 weeks per the assessment recommendation.

---

*This spec ships the first slice of Option C (pre-UW agentic layer) end-to-end against NPNQM's real RM workflow. Failures surface through the existing Two-Source UI; humans take action. No money movement, no Encompass writeback, no legal-entity decisions automated. Earns the right to expand scope.*
