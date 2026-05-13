# Pre-Underwriter Validation — PC v2 (Guidelines + Matrices extension)

**Date:** 2026-05-14
**Status:** Spec
**Scope:** API layer — extend the Predictive Conditions feature to validate loans against the ingested Guidelines and Matrices (in addition to the Doc Checklist that PC v1 already consumes). The result is a single consolidated `predicted_conditions` batch per loan, representing the work an underwriter would do at intake.
**Predecessor work:** PC v1 (PR #2, merged) + F1 Store-DB Consistency (PR #2) + Item 1/2/3 follow-ups (PR #3, open).

---

## 1. Problem

PC v1 ships a Predictive Conditions service that resolves a loan against the active Doc Checklist KB (the `Document_Requirements_All_Income_Types.md` source) and emits a batch of `predicted_conditions` rows representing missing documents. Operators and VAs review the predictions; accepted ones become real `Condition` rows on the loan.

**The gap:** that's only half of what an underwriter actually does. Real underwriting also evaluates the loan against:

- **Program Matrix tiers** — eligibility grids (program × occupancy × FICO band) defining LTV caps, loan-amount maxima, and allowed property types.
- **Program Requirements** — rules tied to programs and categories (DTI maxes, FICO mins, reserve months, interest-only constraints, loan-purpose lists).
- **Geographic Restrictions** — state-level rules that gate or modify program eligibility.

All three data sources are already ingested for the demo tenant (migration 012 created the tables; 216 matrix rows + 293 requirement rows + 20 geographic rows are populated). PC v1 doesn't consume them. As a result the predictions surface only the baseline doc-checklist requirements, not the additional documents an underwriter would catch when reviewing a specific loan's profile.

**PC v2** wires these three sources into the prediction pipeline, producing a single consolidated batch that represents the full pre-underwriter sweep. The 3rd-party LOS / broker-portal integration pushes documents into the e-Folder; PC v2 validates completeness against the full set of rules an underwriter would apply.

## 2. Affected sites

| Status | Path | Responsibility |
|---|---|---|
| Modify | `packages/api/src/db/migrations/019-pc-v2-pre-underwriter.sql` (new) | Schema: widen source_list CHECK; add source_rule_table/source_rule_id columns; add emission_kind; add provenance index |
| Modify | `packages/api/src/services/doc-requirements.ts` | Extend `LoanContext` interface with PC v2 fields (repFico, ltv, loanAmount, loanPurpose, propertyType, dti, reservesMonths, noteRate) |
| Modify | `packages/api/src/routes/predict-conditions-context-builder.ts` | Populate the new LoanContext fields from `loan.transaction.*`, `loan.credit.repScore`, `loan.qualifying.totalDti`, `loan.assets.reservesMonths` |
| Create | `packages/api/src/services/predict-conditions/pre-underwriter.ts` | New orchestrator `runPreUnderwriter()` — calls all resolvers, aggregates, dedups, emits |
| Create | `packages/api/src/services/predict-conditions/resolvers/matrix-resolver.ts` | `program_matrix_tiers` resolver (deterministic) |
| Create | `packages/api/src/services/predict-conditions/resolvers/geographic-resolver.ts` | `geographic_restrictions` resolver (deterministic) |
| Create | `packages/api/src/services/predict-conditions/resolvers/requirements-resolver.ts` | `program_requirements` resolver — deterministic core + LLM backstop dispatch |
| Create | `packages/api/src/services/predict-conditions/llm/requirements-backstop.ts` | LLM evaluator for unhandled program_requirements rows (Anthropic tool_use; reuses pii-redactor + compliance-checker + budget patterns from `learning/insight-generator.ts`) |
| Modify | `packages/api/src/services/predict-conditions/service.ts` | `run()` switches from direct `resolveRequiredDocs` call to `runPreUnderwriter` |
| Modify | `packages/api/test/predict-conditions-service.test.ts` | Existing tests still pass (50/50); new orchestrator + per-resolver tests added |
| Create | `packages/api/test/pre-underwriter-orchestrator.test.ts` | Orchestrator unit tests (dedup ladder, phase composition) |
| Create | `packages/api/test/matrix-resolver.test.ts` | Table-driven per-check tests |
| Create | `packages/api/test/geographic-resolver.test.ts` | Table-driven per-restriction tests |
| Create | `packages/api/test/requirements-resolver.test.ts` | Per-handler tests for the seven initial patterns |
| Create | `packages/api/test/requirements-llm-backstop.test.ts` | Mocked Anthropic SDK + one gated live-call test |

Web UI panels are **not modified in this spec.** The new findings flow into the same `predicted_conditions` table the existing operator/VA panels already render; `source_list` extensions are tolerated by the panels' generic table rendering. UI work that distinguishes finding kinds visually is a separate cycle if and when needed.

## 3. Architecture

```
                          ┌─ resolveRequiredDocs       (doc-checklist)        — existing, deterministic
                          ├─ resolveMatrixFindings     (program_matrix_tiers) — new, deterministic
runPreUnderwriter(loan) ──┼─ resolveGeographicFindings (geographic_restrictions) — new, deterministic
                          ├─ resolveRequirementFindings (program_requirements) — new, deterministic core
                          └─ requirementsLlmBackstop   (program_requirements)  — new, LLM
                                       │
                                       ▼
                          aggregate + dedup + emit predicted_conditions
```

PC v1's `run()` becomes a thin shim that delegates to `runPreUnderwriter`. HTTP routes, auto-fire integration, advisory locks (`predict:<loanId>` and `predict-accept:<loanId>`), `withStoreSnapshot`, idempotency hash, and audit-log writes all remain in `service.ts` — the new intelligence lives one level below.

### 3.1 Module layout

```
packages/api/src/services/predict-conditions/
├── service.ts                       ← unchanged shell (run/accept/dismiss/reopen/clearAlert)
├── pre-underwriter.ts               ← NEW: runPreUnderwriter() orchestrator + KbVersionContext
├── resolvers/
│   ├── matrix-resolver.ts           ← NEW (deterministic)
│   ├── geographic-resolver.ts       ← NEW (deterministic)
│   └── requirements-resolver.ts     ← NEW (deterministic core + LLM dispatch)
├── llm/
│   └── requirements-backstop.ts     ← NEW (Anthropic tool_use; reuses learning/ infrastructure)
└── (existing: types, errors, category-inference, audit-helpers, store-snapshot)
```

### 3.2 `KbVersionContext` — disambiguates the two `kb_version` semantics

A foot-gun: `predicted_conditions.kb_version_id INT REFERENCES kb_versions(id)` (migration 018) holds the **row id** of the active `kb_versions` row, while `program_matrix_tiers.kb_version INT` / `program_requirements.kb_version INT` / `geographic_restrictions.kb_version INT` (migration 012) hold the **version number** field on that same row. The two are not the same — `kb_versions.id` is an auto-incrementing surrogate; `kb_versions.version` is a tenant-scoped semantic version number. They happen to be equal on tenants with one KB; they diverge as soon as a tenant has multiple versions or a re-ingest creates a gap.

To prevent silent mis-lookups (a fresh tenant where `id = version` works in tests but production has the gap), the orchestrator resolves the active KB row once at the top of `runPreUnderwriter` and constructs a typed `KbVersionContext`:

```typescript
export interface KbVersionContext {
  /** kb_versions.id — used for predicted_conditions.kb_version_id FK. */
  readonly rowId: number;
  /** kb_versions.version — used for program_matrix_tiers.kb_version,
   *  program_requirements.kb_version, geographic_restrictions.kb_version lookups. */
  readonly versionNumber: number;
}
```

Every resolver function takes `KbVersionContext` as a parameter (not a bare integer). The type system catches misuse: passing `rowId` to a function expecting `versionNumber` is a compile error. Test fixtures construct `KbVersionContext` literals like `{ rowId: 7, versionNumber: 70 }` so the distinction is forced on the author.

### 3.3 Finding shape + shared description normalization

Each resolver returns `Finding[]`:

```typescript
interface Finding {
  description: string;                    // user-visible doc/action description
  note: string | null;                    // additional context. For LLM findings: prefixed
                                          // "AI-suggested: " + rationale (see §5.3) so the
                                          // rationale is queryable from predicted_conditions.
  category: "PTA" | "PTD" | "PTF" | "PTP"; // existing PC v1 union
  sourceList: "matrix" | "requirements" | "geographic";
  sourceRuleTable: "program_matrix_tiers" | "program_requirements" | "geographic_restrictions";
  sourceRuleId: string;                   // UUID of the originating row
  emissionKind: "deterministic" | "llm";
  // The orchestrator assigns source_order at emit time after dedup.
}
```

The doc-checklist resolver (`resolveRequiredDocs`) returns the existing `DocItem[]` shape; the orchestrator adapts those to `Finding`-equivalent rows with `sourceList ∈ ('minimum', 'income')` and `sourceRuleTable: null`, `sourceRuleId: null`, `emissionKind: 'deterministic'`.

**Description normalization is shared with the reducer's collision detector.** A new file `packages/api/src/services/predict-conditions/normalize.ts` exports `normalizeConditionDescription(s: string): string` matching the algorithm in `packages/core/src/reduce.ts` (the `AddCondition` collision detector's `.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30)`). Both the reducer (via re-export) and the PC v2 orchestrator dedup-key construction import the same function. There is no "must match" duplicate-logic invariant — there is one function consumed by both call sites. If the normalization rule ever changes, both consumers track the change automatically.

## 4. Data model

### 4.1 Migration 019

> Migration numbers are first-come-first-served at PR merge. `019` is the next available slot at spec close (last applied is `018-predictive-conditions.sql`). If a concurrent PR consumes `019` first, this spec renumbers without redesign.

```sql
-- 019-pc-v2-pre-underwriter.sql

-- 1. Widen source_list CHECK to admit matrix/requirements/geographic.
ALTER TABLE predicted_conditions DROP CONSTRAINT predicted_conditions_source_list_check;
ALTER TABLE predicted_conditions ADD CONSTRAINT predicted_conditions_source_list_check
  CHECK (source_list IN ('minimum', 'income', 'matrix', 'requirements', 'geographic'));

-- 2. Source-rule provenance. NULL for PC v1 rows (minimum/income).
ALTER TABLE predicted_conditions
  ADD COLUMN source_rule_table TEXT
    CHECK (source_rule_table IS NULL OR source_rule_table IN
           ('program_matrix_tiers', 'program_requirements', 'geographic_restrictions'));
ALTER TABLE predicted_conditions ADD COLUMN source_rule_id UUID;

-- 3. Emission provenance: which engine generated this row.
ALTER TABLE predicted_conditions
  ADD COLUMN emission_kind TEXT NOT NULL DEFAULT 'deterministic'
    CHECK (emission_kind IN ('deterministic', 'llm'));

-- 4. Provenance index for traceback queries.
CREATE INDEX IF NOT EXISTS idx_pc_source_rule
  ON predicted_conditions (tenant_id, source_rule_table, source_rule_id);
```

Backfill: existing PC v1 rows get `source_rule_table = NULL`, `source_rule_id = NULL`, `emission_kind = 'deterministic'` automatically (NULL is the default for the first two; the third has a `DEFAULT 'deterministic'`).

### 4.2 LoanContext extension

```typescript
export interface LoanContext {
  // ── PC v1 fields (unchanged) ──
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
  // ── PC v2 additions ──
  repFico?: number;             // for matrix tier band lookup
  ltv?: number;                 // 0–100; for tier eligibility (max_ltv_*)
  loanAmount?: number;          // for tier max_loan_amount + requirements "Loan Amounts"
  loanPurpose?: "Purchase" | "Rate & Term Refinance" | "Cash-Out Refinance";
  propertyType?: string;        // matches program_matrix_tiers.property_types
  dti?: number;                 // for requirements "DTI Max"
  reservesMonths?: number;      // for requirements "Reserves Min"
  noteRate?: number;            // for HPML / higher-priced calcs (future requirements)
}
```

PC v2 fields are optional so existing doc-checklist callers compile unchanged. Resolvers that need a v2 field check presence and skip + log when absent (see §6 Risks).

`buildLoanContextFromLoan` in `predict-conditions-context-builder.ts` populates the v2 fields from `loan.transaction.loanPurpose`, `loan.transaction.loanAmount`, `loan.transaction.ltv`, `loan.transaction.noteRate`, `loan.property.propertyType`, `loan.credit.repScore`, `loan.qualifying.totalDti`, `loan.assets.reservesMonths`.

### 4.3 Idempotency

PC v1's `source_input_hash` canonicalizes the entire `LoanContext` (sorted keys, JSON serialized). Adding optional v2 fields automatically widens the hash — no code change to the hashing or the reuse-pending-batch check. A loan whose v2 fields appear (or change) after a prior run produces a different hash → triggers a fresh batch (PC v1's existing replace path).

### 4.4 Audit-log metadata

The `predict_conditions.run` audit row's metadata gains per-resolver counts, LLM-drop accounting, and coverage-transparency fields:

```json
{
  "run_id": "…",
  "source": "system:loan-ingest",
  "kb_version_id": 70,
  "outcome": "predictions_emitted",
  "count": 17,
  "skipped_acted": 0,
  "reused": false,
  "by_source": {
    "minimum": 11,
    "income": 1,
    "matrix": 2,
    "requirements_deterministic": 2,
    "requirements_llm": 1,
    "geographic": 0
  },
  "llm": {
    "input_tokens": 1240,
    "output_tokens": 187,
    "model": "claude-haiku-4-5",
    "bucket_size": 4,
    "backstop_truncated": 0,
    "dropped_hallucinated_id": 0,
    "dropped_below_confidence": 1,
    "dropped_ungrounded": 0,
    "dropped_output_cap": 0
  },
  "hardcoded_fields": ["isItin", "llcOrLegalEntity", "county"]
}
```

`llm` is omitted entirely when the backstop didn't fire (no key, no unhandled rows, or budget exceeded — in which case a separate `llm_skipped: '<reason>'` field appears instead). `hardcoded_fields` lists any `LoanContext` keys that were sourced from the F2-deferred hardcoded fallbacks rather than real loan data; it makes the coverage gap visible to compliance/operations (see §6.4 Risk #5b). Note: `requirements` is split into `requirements_deterministic` and `requirements_llm` so emission-source visibility is preserved.

## 5. Resolver details

### 5.1 `resolveMatrixFindings` (deterministic)

Signature: `(c: PoolClient, tenantId: string, kbCtx: KbVersionContext, loan: LoanContext): Promise<Finding[]>`. The `versionNumber` is what gets passed to the SQL; the `rowId` is irrelevant for this resolver.

```sql
SELECT id, max_loan_amount, max_ltv_purchase, max_ltv_cashout, max_ltv_rate_term, property_types
  FROM program_matrix_tiers
 WHERE tenant_id = $1 AND kb_version = $2  -- kbCtx.versionNumber
   AND program = $3 AND occupancy = $4
   AND $5 BETWEEN min_fico AND max_fico
 LIMIT 1;
```

Per-tier checks:

| Check | Fires when | Emits |
|---|---|---|
| No matching tier | FICO outside all bands for (program, occupancy) | `description: "Manual underwriter review required — FICO {repFico} outside published matrix tiers for {program} / {occupancy}"`; category `PTA` |
| Loan amount exceeds tier max | `loanAmount > max_loan_amount` (and `max_loan_amount IS NOT NULL`) | `description: "Program-change request or exception documentation — loan amount ${loanAmount} exceeds tier max ${max_loan_amount}"`; category `PTA` |
| LTV exceeds tier cap | `ltv > max_ltv_<purpose>` (purpose-selected column) | `description: "Mortgage insurance binder + MI disclosures — LTV {ltv}% exceeds tier max {max_ltv}% for {loanPurpose}"`; category `PTA` |
| Property type not allowed | `propertyType` not in tier's `property_types[]` (and array non-empty) | `description: "Property-type exception documentation — {propertyType} not in tier's allowed list ({property_types.join(', ')})"`; category `PTA` |

Each finding: `sourceList='matrix'`, `sourceRuleTable='program_matrix_tiers'`, `sourceRuleId=<tier_id>`, `emissionKind='deterministic'`. Category overrides `categoryInference` because matrix findings are eligibility-gated docs (PTA — prior to approval).

### 5.2 `resolveGeographicFindings` (deterministic)

Signature: `(c: PoolClient, tenantId: string, kbCtx: KbVersionContext, loan: LoanContext): Promise<Finding[]>`. Uses `kbCtx.versionNumber` for the lookup.

```sql
SELECT id, restriction, occupancy_affected, programs_affected, notes
  FROM geographic_restrictions
 WHERE tenant_id = $1 AND kb_version = $2  -- kbCtx.versionNumber
   AND state = $3;
```

For each row:

```typescript
const applies =
  (row.programs_affected === null || row.programs_affected.includes(loan.program)) &&
  (row.occupancy_affected === null || row.occupancy_affected === loan.occupancy);
if (!applies) continue;
findings.push({
  description: `${loan.state}-specific compliance documentation — ${row.restriction}`,
  note: row.notes,
  category: "PTF",  // recording / disclosure docs
  sourceList: "geographic",
  sourceRuleTable: "geographic_restrictions",
  sourceRuleId: row.id,
  emissionKind: "deterministic",
});
```

### 5.3 `resolveRequirementFindings` (deterministic core + LLM backstop)

Signature: `(c: PoolClient, tenantId: string, kbCtx: KbVersionContext, loan: LoanContext, alreadyEmitted: Finding[]): Promise<Finding[]>`. Uses `kbCtx.versionNumber` to query `program_requirements`. `alreadyEmitted` carries the doc-checklist + matrix + geographic findings so the LLM backstop sees the full picture.

**Stage A — deterministic patterns.** Dispatch on `requirement_key`. Seven initial handlers:

| `requirement_key` | Behavior |
|---|---|
| `"DTI Max"` | Parse `\d+` from `requirement_value` (e.g., `"43%"` → 43). If `loan.dti > parsed`, emit `"DTI {loan.dti}% exceeds program max {parsed}% — alternate-income documentation or exception request"`; category `PTA`. |
| `"FICO Min"` | Parse `\d+`. If `loan.repFico < parsed`, emit `"FICO {loan.repFico} below program min {parsed} — credit-supplement docs or exception request"`; category `PTA`. |
| `"Reserves Min"` | Parse `\d+`. If `loan.reservesMonths < parsed`, emit `"Reserves {loan.reservesMonths} months below program min {parsed} — additional reserves documentation"`; category `PTD`. |
| `"Loan Amounts"` | Parse `Minimum \$([\d,]+)` and `Max \$([\d,]+)`. If `loan.loanAmount < min` or `> max`, emit `"Loan amount ${loanAmount} outside program range ${min}-${max} — program-change request"`; category `PTA`. |
| `"Interest Only"` | If `requirement_value` contains `"Ineligible"` and `loan` indicates IO amortization (`loan.transaction.amortType === "Interest Only"`), emit `"Interest-only not permitted by program — confirm amortization or seek exception"`; category `PTA`. |
| `"Exceptions"` | If `requirement_value` is exactly `"Ineligible"`, emit a generic `"Program does not permit exceptions — UW review required for any deviation"`; category `PTA`. |
| `"Loan Purpose"` | If `loan.loanPurpose` not present in `requirement_value` prose (case-insensitive substring match), emit `"Loan purpose '{loan.loanPurpose}' not in program's permitted list ({requirement_value}) — program-change request"`; category `PTA`. |

Handler implementation: each is a pure function `(loan: LoanContext, row: ProgramRequirementRow) => Finding[]`. Returns 0..n findings (always 0 or 1 in current set; reserved for future patterns).

Each handler has a "couldn't parse" branch: if the regex / lookup fails, the handler returns `{ unhandled: true }` and the orchestrator routes the row into the LLM backstop bucket. This is graceful degradation, not failure.

**Stage B — LLM backstop.** Any row whose `requirement_key` is unknown OR whose deterministic handler returned `unhandled: true` collects into a bucket. If the bucket is non-empty AND the Anthropic key is configured AND a per-tenant budget threshold is not exceeded, the resolver calls `requirementsLlmBackstop()`.

The backstop is the first place in this codebase where an LLM emission lands directly in a credit-relevant production table that operators act on. PC v1's checklist findings were fully deterministic; v2's backstop is not. Spec F (Intelligent Guideline Processing v2 §4) established the suite's discipline for LLM emission on credit decisions — precedence rules, cited-content verification, matrix cross-check, groundedness scoring, abstention threshold, and a persistent UI disclaimer. PC v2 adopts the two cheapest controls from that set: **explicit confidence + abstention** and **source-text grounding verification**. Together with the existing `source_rule_id` validation, these raise the floor without elaborate infrastructure.

**Documented control parameters** (constants in `llm/requirements-backstop.ts`):

- `MAX_LLM_FINDINGS_PER_RUN` (default `10`) — output cap. Extra findings past this are dropped (stable-sorted by `source_rule_id`) with a `console.warn` per drop.
- `MAX_BACKSTOP_BUCKET` (default `20`) — input cap. If the unhandled bucket exceeds this, the resolver truncates to the first `N` rows (stable sorted by `requirement_key, source_rule_id`) and logs each dropped row with `console.warn`. Audit metadata records `backstop_truncated: <count>` so the deterministic-coverage gap is visible.
- `LLM_CONFIDENCE_FLOOR` (default `0.7`) — minimum self-reported confidence to retain a finding. Below floor → dropped with `console.warn`; metadata records `dropped_below_confidence: <count>`.

```typescript
const backstopResult = await requirementsLlmBackstop({
  loan: redactedLoanContext,                     // PII-redacted per learning/pii-redactor
  unhandledRequirements: bucket,                 // rows the deterministic core didn't cover (truncated to MAX_BACKSTOP_BUCKET)
  activeDocChecklist: docChecklistFindings,      // so LLM doesn't re-emit covered docs
  alreadyEmitted: deterministicFindings,         // same — full visibility for dedup
  maxFindings: MAX_LLM_FINDINGS_PER_RUN,
  confidenceFloor: LLM_CONFIDENCE_FLOOR,
});
```

Prompt structure (verbatim shape):

```
You are a pre-underwriter for a non-QM lender. Given the loan profile and the
program requirement rules below, list any additional documents an underwriter
would require beyond what is already known. Be conservative — emit a prediction
ONLY when the requirement clearly implies a document the loan does not yet
satisfy. Respond via the emit_predictions tool.

LOAN (redacted): { ...redactedLoanContext... }

PROGRAM RULES (unhandled by deterministic resolver):
- rule_id: <uuid>; category: "<category>"; key: "<key>"; value: <jsonb>; raw page: <int>
- ...

DOCS ALREADY KNOWN TO BE REQUIRED:
- "Initial Loan Application (1003)" (from doc-checklist)
- "DTI {x}% exceeds program max — ..." (from deterministic Stage A)
- ...
```

Tool schema:

```typescript
{
  name: "emit_predictions",
  input_schema: {
    type: "object",
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
              description: "Probability that this finding is correct and actionable given the source rule. Below 0.7 will be discarded — prefer emitting fewer high-confidence findings than many low-confidence ones."
            },
          },
        },
      },
    },
    required: ["findings"],
  },
}
```

**Post-call validation pipeline** (applied in order; each step logs `console.warn` per drop with the dropped finding's `source_rule_id`):

1. **Schema validation** — drop any finding missing a required field or with wrong types.
2. **Source-rule existence** — drop any finding whose `source_rule_id` is not in the unhandled bucket (the LLM hallucinated a UUID). Metadata: `dropped_hallucinated_id`.
3. **Confidence floor** — drop any finding with `confidence < LLM_CONFIDENCE_FLOOR`. Metadata: `dropped_below_confidence`.
4. **Source-text grounding** — Spec F §4.4 (citation faithfulness) adapted to PC v2's narrower surface. For each remaining finding, verify that the finding's `description` content words appear in the source rule's `requirement_value` text. Concrete check: extract content words from `description` (strip punctuation, lowercase, remove stopwords, ≥4 chars, stem to a simple root), require that **≥50% of the description's content words** appear (stem-matched) in the concatenation of `requirement_key + requirement_value`. Findings that fail this check are dropped. Metadata: `dropped_ungrounded`. This is the cheapest hallucination guard — it doesn't prevent the LLM from being wrong, but it does prevent it from emitting a finding whose surface text isn't anchored in the source rule.
5. **Output cap** — truncate to `MAX_LLM_FINDINGS_PER_RUN`. Stable sort by `(source_rule_id, description)` before truncation so the cut is deterministic across re-runs. Metadata: `dropped_output_cap`.

**Model selection:** default `claude-haiku-4-5`; promote to `claude-sonnet-4-6` when the unhandled bucket size > 5 OR loan complexity (a simple scoring heuristic on LoanContext) exceeds a threshold. Reuses the model-selection helper pattern from `learning/insight-generator.ts:selectModel`.

**Prompt caching:** Anthropic prompt caching is content-addressed — any change to the cached prefix invalidates the cache. Only the **static prefix** (system instructions + tool schema definition) is cache-marked. The **dynamic suffix** (`LOAN (redacted)`, `PROGRAM RULES`, `DOCS ALREADY KNOWN`) sits outside the cache boundary and is recomputed per call. Reuses the existing `cache_control` pattern from `learning/insight-generator.ts`.

**Cost tracking:** writes one `kb_cost_events` row per LLM call with `event_type='predict_conditions.requirements_backstop'`, `model`, `input_tokens`, `output_tokens`, `tenant_id`.

**Compliance + ZDR:** reuses `runComplianceChecks` from `learning/compliance-checker.ts` on the redacted prompt; sets `anthropic-ddr` headers (same pattern as `insight-generator.ts`).

**Failure modes:**
- LLM call fails (network/timeout/rate-limit/parse error): log + skip backstop. Deterministic findings still emit. Audit metadata records `requirements_llm: 0, requirements_llm_error: '<class>'`.
- Anthropic key absent: skip backstop entirely. One-time startup warn.
- Budget exceeded: skip backstop with audit metadata `requirements_llm_skipped: 'budget'`.

### 5.4 Aggregation + dedup

After all four resolvers return their findings (doc-checklist findings adapted to `Finding` shape too), the orchestrator dedups in a **deterministic processing order** so the outcome is reproducible across runs.

**Normalization.** Dedup key is `(sourceList, normalizeDescription(description))` where `normalizeDescription` is the shared helper exported from `packages/api/src/services/predict-conditions/normalize.ts` (see §3.3 reducer-collision interaction below). The reducer's `AddCondition` collision detector imports the same helper. There is no "must match" maintenance burden — the two consumers use one function.

**Processing order** (the dedup map fills in this sequence; the first finding to land at a given key wins; later findings with the same key are dropped with `console.warn`):

1. `minimum` (doc-checklist)
2. `income` (doc-checklist)
3. `matrix`
4. `geographic`
5. `requirements` — Stage A (deterministic) first
6. `requirements` — Stage B (LLM) last

Note steps 5 and 6: within `requirements`, Stage A's deterministic findings are inserted into the dedup map BEFORE Stage B's LLM findings. This guarantees deterministic findings always win over semantically-similar LLM findings (R3 — explicit, not order-of-array-iteration dependent). A unit test in `pre-underwriter-orchestrator.test.ts` asserts the property: when Stage A and Stage B emit findings whose descriptions normalize identically, the surviving row has `emissionKind: 'deterministic'`.

**Cross-resolver priority rationale.** Doc-checklist findings (`minimum`, `income`) come first because they're directly tied to the borrower's profile and are the most operator-actionable. Matrix findings (eligibility constraints) come next because they're tied to the loan's specific numeric parameters. Geographic restrictions come third because they're usually well-known state-level rules that operators have working knowledge of. Requirements (deterministic, then LLM) come last because the program_requirements layer is the most heterogeneous and the LLM-derived findings are the lowest-confidence source.

**`source_order` assignment.** A finding that survives dedup gets `source_order` assigned in stable order: first by processing-order position (1-6 above), then by the finding's original index within its resolver's output.

## 6. Phasing, testing, non-goals, risks

### 6.1 Phasing (implementation plan, not spec)

Each phase is a self-contained commit cluster. Main stays green after every phase. Stop-points: any phase can be the last shipped.

| Phase | Scope | Estimated days |
|---|---|---|
| **A** | Migration 019, LoanContext extension, context-builder fields, `pre-underwriter.ts` orchestrator skeleton (only wraps existing doc-checklist), `service.ts run()` switches to orchestrator, dedup ladder logic + tests | ~3 |
| **B** | `matrix-resolver.ts` + `geographic-resolver.ts` + per-resolver unit tests + integration tests | ~3 |
| **C** | `requirements-resolver.ts` deterministic core (7 handlers) + per-handler unit tests + integration test exercising multiple handlers | ~4 |
| **D** | `llm/requirements-backstop.ts` + Anthropic SDK mock + golden-fixture tests + one gated live-call test + cost-event writing | ~5 |

After D: extend W10 E2E to verify the expanded prediction set against the canonical fixture (count assertion widens from `=== 15` to a range like `>= 15 && <= 35`).

### 6.2 Testing strategy

**Unit tests** (no DB, no Fastify): each resolver gets table-driven cases. Each requirements handler in §5.3 gets ~3 cases (fires / doesn't fire / unparseable falls to backstop bucket). Each resolver additionally gets a **graceful-degradation row per v2 LoanContext field**: with that field absent (e.g., `repFico: undefined`), the resolver returns zero findings for rules that would otherwise fire on it, and emits a structured `console.warn` capturing the `loanId + missingField`. This prevents the regression where a resolver compares `undefined !== "Single Family Detached"` (truthy) and floods the operator queue with bogus findings.

**Integration tests** (live Supabase, via existing harness pattern): use an **ephemeral test tenant** matching the harness `e2e-test-*` pattern (same convention W10 follows for the canonical fixture; cleanup via `--purge-test-data`). Seed rows in `program_matrix_tiers` / `program_requirements` / `geographic_restrictions` for that tenant, run a loan through `runPreUnderwriter`, assert the right `predicted_conditions` rows land with correct `source_list` / `source_rule_table` / `source_rule_id` / `emission_kind`.

**Dedup invariant tests**: assert that under identical inputs, two consecutive runs produce identical (or reused — see §4.3) `predicted_conditions` rows. AND: when both Stage A and Stage B emit findings whose `normalizeConditionDescription(description)` keys are identical, the surviving row has `emissionKind: 'deterministic'` (R3 explicit ordering).

**LLM tests** (Phase D): mock the Anthropic SDK with `vi.mock` per the pattern in `learning/insight-generator.test.ts` (if present) or build the mock locally. Assert: prompt shape, handler dispatch for a known tool_use response, the five-step post-call validation pipeline (schema/source-rule-existence/confidence/grounding/output-cap drops). One live-call integration test gated behind `RUN_LIVE_LLM=1` for periodic verification.

**E2E test**: extend W10 to assert the broader prediction count. The "15 pending" assertion becomes a range. Add an assertion that a sampling of new predictions carry the expected `source_list` and `source_rule_table` values.

**Property check**: idempotency invariant — two consecutive `runPreUnderwriter` calls produce identical `predicted_conditions` rows. Already covered by PC v1's hash-based idempotency now that the hash widens with the v2 LoanContext fields.

### 6.3 Non-goals

- **Eligibility decisions.** PC v2 surfaces findings as predicted conditions; never marks a loan ineligible. A "matrix tier mismatch" asks the operator/UW to seek an exception or change program; PC v2 doesn't auto-reject.
- **Alternative-product recommendations.** No "this loan fits Flex Select better." Out of scope.
- **Pricing or rate-sheet evaluation.** Not in `program_requirements`; not consumed.
- **Automatic doc-pull triggering.** PC v2 emits the predictions; docs arrive via the existing 3rd-party push into the e-Folder. No VA outbox integration. No originator-facing requests. (The earlier brainstorm framing of "wire into VA outbox" was deprecated when the 3rd-party push model was clarified.)
- **Operator-edit propagation.** `program_*` tables have `operator_edited` / `operator_edit_diff` columns from migration 012. Consuming those edits (vs. the original extracted values) is a separate concern; PC v2 reads only the active (current) values.
- **Web UI changes** to differentiate source kinds visually. The existing panels render `source_list` generically; PC v2 ships UI-transparent. Visual differentiation is a follow-up cycle if and when it's needed.

### 6.4 Risks

- **Deterministic-pattern brittleness.** Each `requirement_key` handler in §5.3 parses prose from `requirement_value` (e.g., `"Minimum $100,000 and Max $3,000,000"`). NPNQM document edits could shift wording and break the regex. **Mitigation:** every handler has a "couldn't parse" branch that routes the row into the LLM backstop bucket — so a regex miss becomes graceful degradation, not a crash. A metrics counter for unparseable rows lets operators see when the deterministic core's coverage is degrading.

- **LLM cost variance.** Per-loan token cost depends on how many `program_requirements` rows fall through to Stage B. **Mitigation:** `MAX_LLM_FINDINGS_PER_RUN` cap (default 10) + per-tenant daily budget tracked via existing `kb_cost_events`. Run-level audit metadata exposes cost so it's visible. Anthropic prompt caching for the system instructions + tool schema reduces marginal cost on subsequent calls.

- **Cross-resolver finding overlap.** Matrix "loan amount exceeds tier max" and Requirements "Loan Amounts" can both fire for the same out-of-range loan. **Mitigation:** the aggregator's dedup ladder collapses them to one row in priority order. Audit metadata records which sources contributed.

- **LoanContext field availability.** Existing fixtures and ingested loans may have `null` `repFico`, `dti`, or `reservesMonths`. **Mitigation:** resolvers treat missing v2 fields as "can't evaluate" — emit no finding and log a structured warning (`console.warn` with `loanId` and `missingField`). Operators see PC v1 predictions plus whatever v2 resolvers could evaluate. Coverage shrinks where data is missing; nothing breaks.

- **Hardcoded LoanContext fields → silent under-coverage.** `LoanContext.isItin`, `llcOrLegalEntity`, and `county` are hardcoded fail-closed (`false`, `false`, `""`) pending the F2 ingestion work that wires real values through. Any matrix or requirements rule whose firing depends on `isItin === true` (or `llcOrLegalEntity === true`, or a non-empty county) will not fire for borrowers whose real values differ from the hardcoded defaults — operator queues under-count and could miss a real underwriting concern. **Mitigation:** the orchestrator records `hardcoded_fields: string[]` in the run's audit metadata (see §4.4) listing which fields were sourced from the F2-deferred fallbacks rather than real loan data. Operations + compliance can query the audit log to surface the coverage class so PC v2 is not mistaken for comprehensive coverage. F2 closes the gap; until then, the gap is visible.

- **KB version skew between tables.** `program_matrix_tiers.kb_version`, `program_requirements.kb_version`, and `geographic_restrictions.kb_version` use `INT` (the raw version number, from migration 012). `predicted_conditions.kb_version_id` uses `INT REFERENCES kb_versions(id)` (FK to the row id, from migration 018). The two are identically named but semantically different (surrogate vs. tenant-scoped version number) and happen to be equal on tenants with one KB. **Mitigation:** the orchestrator constructs a `KbVersionContext` (see §3.2) once per run with `{ rowId, versionNumber }` — every resolver signature requires this typed context, so the type checker catches misuse. Test fixtures construct `KbVersionContext` literals where `rowId !== versionNumber` to force the distinction.

- **LLM hallucination of finding content.** The tool schema requires structured output, but doesn't prevent the model from:
  1. **Inventing a `source_rule_id`** that wasn't in the unhandled bucket → caught by post-call source-rule-existence drop.
  2. **Paraphrasing the source rule incorrectly** in `description` (e.g., dropping a "with FICO < 680" qualifier) → caught by source-text grounding: ≥50% of the description's content words must appear (stem-matched) in the source rule's `key + value` text. Findings without textual anchor are dropped (§5.3 post-call validation step 4).
  3. **Choosing wrong `category`** (PTA vs PTD) → not caught by automated validation. Operator sees the wrong category in their queue. Acceptable risk for v1 since category is a hint not a hard gate; future work could add a deterministic category-inference cross-check.
  4. **Emitting low-confidence "maybe" findings** → caught by `LLM_CONFIDENCE_FLOOR = 0.7`. Findings below floor dropped.
  **Net mitigation strategy:** confidence floor + source-text grounding + source-rule existence form a three-step filter. The audit row records each drop class so operators see the LLM emission quality over time and can tune the floor / add deterministic handlers when patterns emerge. The model is asked in the prompt to "prefer emitting fewer high-confidence findings than many low-confidence ones" so abstention is the encouraged behavior under uncertainty.

- **Aggregator non-determinism under LLM emission.** Same loan, same KB, different LLM call → potentially different findings. **Mitigation:** idempotency hash widens with v2 LoanContext, so a re-run with unchanged inputs reuses the prior batch (no LLM call). Fresh-batch runs do re-invoke the LLM and may produce different results — this is expected and documented; the audit log records the model + tokens so the variance is traceable. Within a single fresh-batch run, processing order (§5.4) is deterministic so Stage A dominates Stage B reliably.

## 7. Open items

None blocking. The following are deliberate deferrals tracked outside this spec:

- **F2** — `LoanContext` fields `isItin`, `llcOrLegalEntity`, `county` are still hardcoded / fail-closed. Real ingestion plumbing is a separate spec.
- **API-wide audit for additional store-dispatch + DB sites** (deferred from F1). Separate cycle.
- **Operator-edit propagation** from `program_*` tables. Separate cycle if/when operators start editing extracted rules.
- **Web UI differentiation** of finding kinds. Cycle after operators start using PC v2 in real flows and we learn what visual cues matter.

## 8. Reviewer notes

Issues anticipated for a technical review:

1. **Per-resolver handler set size.** Seven initial requirement handlers may miss high-frequency patterns. The LLM backstop covers the gap, but if a specific pattern recurs often we should hand-craft a deterministic handler for it. Plan §C lists the initial seven; the plan should explicitly note that "add another handler" is the right response to recurring backstop emissions.

2. **LLM cost predictability.** Per-loan token cost is bounded by `MAX_LLM_FINDINGS_PER_RUN` × (avg description + rationale length) + bucket-input size. Worst case for the demo seed: 293 requirement rows minus 7 deterministically-handled patterns = up to ~286 rows fed to the model. The prompt cap should also bound input rows (e.g., `MAX_BACKSTOP_BUCKET = 20`); rows beyond the cap get logged as "unhandled, exceeded backstop bucket" and surfaced for operator attention so we don't silently drop coverage.

3. **Cross-tenant rule pollution.** All resolvers query with `tenant_id = $1` filters as required by the BYPASSRLS pooler pattern (per project memory `feedback_supabase_pooler_bypassrls`). No exception.

4. **Idempotency dovetailing with Codex round-4 fix.** The existing PC v1 fix to skip already-acted docs across re-runs applies the same way to PC v2 findings — accepted/dismissed matrix or requirements predictions don't get re-emitted as new pending rows. The orchestrator's emit-loop passes through the existing skip path.
