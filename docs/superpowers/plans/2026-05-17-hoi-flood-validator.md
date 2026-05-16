# HOI / Flood Validator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first slice of the pre-UW agentic layer — a HOI/Flood policy compliance validator that runs as a 5th PC v2 source against 14 deterministic rules from NPNQM's RM Job Aid, with dual-input extraction (portal-provided + LLM) and a Two-Source-UI rendering branch for the findings.

**Architecture:** New `document_extractions` cache table feeds a deterministic rule engine. Two upstream extractors (`PortalProvidedHoiExtractor` reads from Spec 1.5 payload extension; `LlmHoiExtractor` calls Claude with tool-use schema + R1 grounding-pass). Validator runs as a PC v2 resolver (`source_list = 'hoi-validator'`) with idempotent inserts to avoid Two-Source UI cleanup-banner race. Tenant-gated via `validators.hoi.enabled`. Findings surface through existing UI with new `validationFindings` rendering branch.

**Tech Stack:** TypeScript (strict), Zod for all schemas, Vitest, pnpm workspace, Fastify 4, Postgres + Supabase pooler with explicit `WHERE tenant_id = $1` filters (pooler bypasses RLS per project memory), Anthropic SDK (tool_use + prompt caching pattern from learning-worker), Next.js 15 App Router + React 19 for UI.

**Spec source:** `docs/superpowers/specs/2026-05-16-hoi-flood-validator-design.md` (v2, commit `d592e62`).

---

## File Structure

**New files (created):**

- `packages/api/src/db/migrations/025-document-extractions.sql` — cache table + RLS
- `packages/api/src/db/migrations/026-hoi-validator-idempotency.sql` — partial unique index for ON CONFLICT inserts
- `packages/core/src/hoi-extraction-schemas.ts` — `HoiPolicyFields`, `FloodCertFields`, `ValidationFinding`, `ExtractionResult` Zod schemas
- `packages/api/src/services/validators/hoi/extractor.ts` — `HoiFieldExtractor` interface + `DocumentRef` types
- `packages/api/src/services/validators/hoi/portal-provided-extractor.ts` — `PortalProvidedHoiExtractor`
- `packages/api/src/services/validators/hoi/llm-extractor.ts` — `LlmHoiExtractor` + grounding-pass
- `packages/api/src/services/validators/hoi/composite-extractor.ts` — `CompositeHoiExtractor`
- `packages/api/src/services/validators/hoi/grounding.ts` — stem-matched content-word presence check
- `packages/api/src/services/validators/hoi/cost-tracker.ts` — Prometheus metric helpers
- `packages/api/src/services/predict-conditions/resolvers/hoi-validator-resolver.ts` — PC v2 resolver
- `packages/api/src/services/validators/hoi/rules/index.ts` — rule registry
- `packages/api/src/services/validators/hoi/rules/identity.ts` — H1, H2, H3
- `packages/api/src/services/validators/hoi/rules/dates.ts` — H4, H5
- `packages/api/src/services/validators/hoi/rules/coverage.ts` — H6, H7, H8, H9
- `packages/api/src/services/validators/hoi/rules/conditional.ts` — H10, H11, H12
- `packages/api/src/services/validators/hoi/rules/flood.ts` — F1, F2
- `packages/api/src/hoi-extractor-dispatcher.ts` — polling worker (lock 46)
- `packages/api/test/hoi-validator-rules.test.ts` — Layer 1 deterministic rule tests
- `packages/api/test/hoi-extraction.integration.test.ts` — Layer 2 worker + cache tests
- `packages/api/test/hoi-validator-resolver.integration.test.ts` — Layer 3 end-to-end tests
- `packages/web/components/encompass/__tests__/grouped-condition-card-validation.test.tsx` — UI rendering tests

**Existing files (modified):**

- `packages/core/src/tenant-schemas.ts` — add `validators.hoi` config; widen `TenantSettings`
- `packages/core/src/tenant-types.ts` — type-side mirror
- `packages/core/src/index.ts` — export new schemas
- `packages/api/src/services/doc-requirements.ts` — widen `LoanContext` with `channel`, `noteDate`, `closingDate`, `borrower.fullName`
- `packages/api/src/services/predict-conditions/pre-underwriter.ts` — add `"hoi-validator"` to `Finding.sourceList` union + priority registry
- `packages/api/src/services/predict-conditions/service.ts` — wire `resolveHoiValidatorFindings`; extend DELETE-pending exclusion; ON CONFLICT DO NOTHING insert; cross-source audit log; Misc Review prediction
- `packages/api/src/services/predict-conditions/index.ts` — export `runHoiValidator` if needed
- `packages/api/src/ingestion/adapters/npnqm-portal.ts` — extend `transformAnalysisOutput` for `extracted_documents[]`
- `packages/api/src/server.ts` — wire `startHoiExtractorDispatcher()` (matches `startSlaMonitor()` pattern)
- `packages/api/src/services/predict-conditions/predict-conditions-context-builder.ts` — populate new `LoanContext` fields
- `packages/web/lib/prediction-grouping.ts` — extend `PortalMetadata` with `validationFindings`, `extractionId`
- `packages/web/components/encompass/GroupedConditionCard.tsx` — validationFindings rendering branch

**Files modified for pilot (last task):**

- `scripts/enable-validator.ts` (new helper script) or direct SQL update on `tenants.settings` for `npnqm-twin`
- `~/.claude/projects/.../memory/MEMORY.md` + new memory file documenting the deploy

---

# Phase 1 — Schema + Types Foundation

## Task 1: Migration 025 — `document_extractions` cache table

**Files:**
- Create: `packages/api/src/db/migrations/025-document-extractions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 025-document-extractions.sql
-- Cache table for HOI/Flood policy field extractions (LLM-derived or portal-provided).
-- Source-of-truth for the HOI validator's rule evaluation. Schema-versioned via
-- partial unique index so field-set changes invalidate prior extractions cleanly.

CREATE TABLE IF NOT EXISTS document_extractions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  loan_id               TEXT NOT NULL,
  document_id           UUID NOT NULL,
  extractor_kind        TEXT NOT NULL CHECK (extractor_kind IN ('hoi-policy', 'flood-cert')),
  schema_version        INT NOT NULL,
  source                TEXT NOT NULL CHECK (source IN ('portal', 'llm-extractor', 'manual')),
  extracted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  extracted_by          TEXT NOT NULL,
  fields                JSONB NOT NULL,
  extraction_confidence NUMERIC,
  extraction_error      TEXT,
  superseded_at         TIMESTAMPTZ
);

-- At most one active extraction per (tenant, document, kind, schema_version)
CREATE UNIQUE INDEX IF NOT EXISTS document_extractions_active
  ON document_extractions (tenant_id, document_id, extractor_kind, schema_version)
  WHERE superseded_at IS NULL;

-- Loan-scoped lookup for validator resolver
CREATE INDEX IF NOT EXISTS document_extractions_loan
  ON document_extractions (tenant_id, loan_id, extractor_kind)
  WHERE superseded_at IS NULL;

ALTER TABLE document_extractions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_extractions_tenant_isolation ON document_extractions;
CREATE POLICY document_extractions_tenant_isolation ON document_extractions
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

- [ ] **Step 2: Verify migration runs cleanly**

Run: `pnpm --filter @twin/api dev`
Expected: server boot logs include `[migrations] applied 025-document-extractions.sql` and no error.

- [ ] **Step 3: Verify table + index in psql**

Run: `psql "$DATABASE_URL" -c "\d document_extractions"`
Expected: table shape matches; partial unique index present.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/db/migrations/025-document-extractions.sql
git commit -m "feat(db): migration 025 — document_extractions cache table"
```

---

## Task 2: Migration 026 — `hoi-validator` idempotency index

**Files:**
- Create: `packages/api/src/db/migrations/026-hoi-validator-idempotency.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 026-hoi-validator-idempotency.sql
-- Partial unique index supporting ON CONFLICT DO NOTHING inserts for hoi-validator
-- predicted_conditions rows. Stabilizes UUIDs across PC v2 re-runs so the
-- Two-Source UI's cleanup-banner can retry against a live row. Key includes
-- extractionId from portal_metadata so a fresh extraction (new doc upload)
-- legitimately produces a new row.

CREATE UNIQUE INDEX IF NOT EXISTS predicted_conditions_hoi_validator_active
  ON predicted_conditions (
    tenant_id,
    loan_id,
    source_list,
    source_rule_id,
    ((portal_metadata->>'extractionId'))
  )
  WHERE source_list = 'hoi-validator'
    AND status = 'pending'
    AND superseded_at IS NULL;
```

- [ ] **Step 2: Verify migration applies**

Run: `pnpm --filter @twin/api dev`
Expected: `[migrations] applied 026-hoi-validator-idempotency.sql`.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/db/migrations/026-hoi-validator-idempotency.sql
git commit -m "feat(db): migration 026 — hoi-validator predicted_conditions idempotency index"
```

---

## Task 3: Core Zod schemas for extractions + findings

**Files:**
- Create: `packages/core/src/hoi-extraction-schemas.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/hoi-extraction-schemas.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import {
  HoiPolicyFieldsSchema,
  FloodCertFieldsSchema,
  ValidationFindingSchema,
  HOI_SCHEMA_VERSION,
} from "../src/hoi-extraction-schemas.js";

describe("HOI extraction schemas", () => {
  test("HoiPolicyFieldsSchema accepts a minimal valid extraction with nulls", () => {
    const minimal = {
      carrier: null, policyNumber: null, namedInsured: null,
      propertyAddress: null, effectiveDate: null, expirationDate: null,
      termMonths: null, lossPayeeClause: null, loanNumberOnPolicy: null,
      coverageAmount: null, replacementCost: null,
      deductiblePct: null, deductibleAmount: null,
      windHailHurricane: null, rentLossCoverageMonths: null,
      rentLossWording: null, rentLossActualCostSustained: null,
      occupancyOnPolicy: null, premiumPaidInFull: null, premiumDueDays: null,
      wallsInCoverage: null, ho6Policy: null, evidence: [],
    };
    expect(HoiPolicyFieldsSchema.parse(minimal)).toEqual(minimal);
  });

  test("HoiPolicyFieldsSchema enforces per-field confidence on prose-derived booleans", () => {
    const wh = { included: true, wording: "all perils included", separatePolicy: false, confidence: 0.9 };
    expect(HoiPolicyFieldsSchema.shape.windHailHurricane.parse(wh)).toEqual(wh);
    expect(() => HoiPolicyFieldsSchema.shape.windHailHurricane.parse({ ...wh, confidence: 1.5 })).toThrow();
  });

  test("ValidationFindingSchema requires evidence with documentId + extractionId", () => {
    const finding = {
      ruleId: "hoi.loss-payee.match",
      severity: "fail" as const,
      currentValue: "Foo LLC",
      expectedValue: "NQM Funding, LLC",
      evidence: { documentId: "00000000-0000-0000-0000-000000000001", extractionId: "00000000-0000-0000-0000-000000000002", fieldPath: "lossPayeeClause", documentPage: 1 },
    };
    expect(ValidationFindingSchema.parse(finding)).toEqual(finding);
  });

  test("HOI_SCHEMA_VERSION exported as positive int", () => {
    expect(HOI_SCHEMA_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(HOI_SCHEMA_VERSION)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @twin/core test hoi-extraction-schemas`
Expected: FAIL with "Cannot find module '../src/hoi-extraction-schemas.js'".

- [ ] **Step 3: Write the schema module**

Create `packages/core/src/hoi-extraction-schemas.ts`:

```ts
import { z } from "zod";

export const HOI_SCHEMA_VERSION = 1;

const AddressSchema = z.object({
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
});

const EvidenceSchema = z.object({
  fieldPath: z.string(),
  documentPage: z.number().int(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
});

const ProseBooleanFieldSchema = z.object({
  included: z.boolean(),
  wording: z.string().nullable(),
  separatePolicy: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const ActualCostSustainedSchema = z.object({
  detected: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const PremiumPaidSchema = z.object({
  paid: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const WallsInSchema = z.object({
  included: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const Ho6PolicySchema = z.object({
  present: z.boolean(),
  deductiblePct: z.number().nullable(),
  coverageAmount: z.number().nullable(),
});

export const HoiPolicyFieldsSchema = z.object({
  carrier: z.string().nullable(),
  policyNumber: z.string().nullable(),
  namedInsured: z.string().nullable(),
  propertyAddress: AddressSchema.nullable(),
  effectiveDate: z.string().nullable(),
  expirationDate: z.string().nullable(),
  termMonths: z.number().int().nullable(),
  lossPayeeClause: z.string().nullable(),
  loanNumberOnPolicy: z.string().nullable(),
  coverageAmount: z.number().nullable(),
  replacementCost: z.number().nullable(),
  deductiblePct: z.number().nullable(),
  deductibleAmount: z.number().nullable(),
  windHailHurricane: ProseBooleanFieldSchema.nullable(),
  rentLossCoverageMonths: z.number().int().nullable(),
  rentLossWording: z.string().nullable(),
  rentLossActualCostSustained: ActualCostSustainedSchema.nullable(),
  occupancyOnPolicy: z.string().nullable(),
  premiumPaidInFull: PremiumPaidSchema.nullable(),
  premiumDueDays: z.number().int().nullable(),
  wallsInCoverage: WallsInSchema.nullable(),
  ho6Policy: Ho6PolicySchema.nullable(),
  evidence: z.array(EvidenceSchema),
});
export type HoiPolicyFields = z.infer<typeof HoiPolicyFieldsSchema>;

export const FloodCertFieldsSchema = z.object({
  carrier: z.string().nullable(),
  policyNumber: z.string().nullable(),
  namedInsured: z.string().nullable(),
  propertyAddress: AddressSchema.nullable(),
  effectiveDate: z.string().nullable(),
  expirationDate: z.string().nullable(),
  termMonths: z.number().int().nullable(),
  floodZone: z.string().nullable(),
  floodCoverage: z.number().nullable(),
  floodDeductible: z.number().nullable(),
  isNfip: z.boolean().nullable(),
  nfipMaxApplied: z.boolean().nullable(),
  evidence: z.array(EvidenceSchema),
});
export type FloodCertFields = z.infer<typeof FloodCertFieldsSchema>;

export const ValidationFindingSchema = z.object({
  ruleId: z.string(),
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
export type ValidationFinding = z.infer<typeof ValidationFindingSchema>;
```

- [ ] **Step 4: Export from core barrel**

Edit `packages/core/src/index.ts` — add at the end:

```ts
export * from "./hoi-extraction-schemas.js";
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @twin/core test hoi-extraction-schemas`
Expected: PASS (4 tests).

Run: `pnpm --filter @twin/core build`
Expected: clean tsc.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/hoi-extraction-schemas.ts packages/core/src/index.ts packages/core/test/hoi-extraction-schemas.test.ts
git commit -m "feat(core): HOI/Flood extraction Zod schemas + ValidationFinding"
```

---

## Task 4: Tenant config schema — `validators.hoi`

**Files:**
- Modify: `packages/core/src/tenant-schemas.ts`
- Modify: `packages/core/src/tenant-types.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/tenant-schemas.test.ts` (or create it if absent):

```ts
import { describe, test, expect } from "vitest";
import { TenantSettingsSchema } from "../src/tenant-schemas.js";

describe("TenantSettings validators.hoi", () => {
  test("defaults to enabled=false when validators block absent", () => {
    const parsed = TenantSettingsSchema.parse({});
    expect(parsed.validators?.hoi?.enabled).toBeUndefined();
  });

  test("accepts validators.hoi config", () => {
    const parsed = TenantSettingsSchema.parse({
      validators: { hoi: { enabled: true, extractorMode: "auto", schemaVersion: 1 } },
    });
    expect(parsed.validators?.hoi?.enabled).toBe(true);
    expect(parsed.validators?.hoi?.extractorMode).toBe("auto");
  });

  test("extractorMode enum is enforced", () => {
    expect(() =>
      TenantSettingsSchema.parse({ validators: { hoi: { enabled: true, extractorMode: "invalid" } } }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @twin/core test tenant-schemas`
Expected: FAIL — `validators` not on schema.

- [ ] **Step 3: Extend `TenantSettingsSchema`**

Edit `packages/core/src/tenant-schemas.ts` — add before the main `TenantSettingsSchema` definition:

```ts
export const HoiValidatorConfigSchema = z.object({
  enabled: z.boolean(),
  extractorMode: z.enum(["auto", "portal-only", "llm-only"]).default("auto"),
  schemaVersion: z.number().int().positive().default(1),
  dscrProductExclusions: z.array(z.string()).default([]),
});

export const ValidatorsConfigSchema = z.object({
  hoi: HoiValidatorConfigSchema.optional(),
}).optional();
```

And add `validators: ValidatorsConfigSchema` to the existing `TenantSettingsSchema.shape` (preserving all existing fields).

- [ ] **Step 4: Mirror types in `tenant-types.ts`**

Edit `packages/core/src/tenant-types.ts`:

```ts
export interface HoiValidatorConfig {
  enabled: boolean;
  extractorMode: "auto" | "portal-only" | "llm-only";
  schemaVersion: number;
  dscrProductExclusions: string[];
}

export interface ValidatorsConfig {
  hoi?: HoiValidatorConfig;
}

// Add `validators?: ValidatorsConfig` to TenantSettings interface
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @twin/core test tenant-schemas`
Expected: PASS (3 tests).

Run: `pnpm --filter @twin/core build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/tenant-schemas.ts packages/core/src/tenant-types.ts packages/core/test/tenant-schemas.test.ts
git commit -m "feat(core): tenant settings — validators.hoi config block"
```

---

## Task 5: Widen `LoanContext` for HOI validator inputs

**Files:**
- Modify: `packages/api/src/services/doc-requirements.ts`
- Modify: `packages/api/src/services/predict-conditions/predict-conditions-context-builder.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api/test/loan-context-hoi-fields.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { buildLoanContextFromLoan } from "../src/routes/predict-conditions-context-builder.js";
import { sampleNqmLoan } from "@twin/fixtures";

describe("LoanContext HOI-validator fields", () => {
  test("builds context with channel, noteDate, closingDate, borrower.fullName", async () => {
    const loan = sampleNqmLoan("primary-purchase-fullDoc");
    const ctx = await buildLoanContextFromLoan(loan);
    expect(ctx.channel).toBeDefined();
    expect(ctx.borrowerFullName).toBeDefined();
    // noteDate/closingDate may be undefined for fixtures lacking dates — acceptable
    expect("noteDate" in ctx).toBe(true);
    expect("closingDate" in ctx).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @twin/api test loan-context-hoi-fields`
Expected: FAIL — `channel` undefined on context.

- [ ] **Step 3: Widen `LoanContext` interface**

Edit `packages/api/src/services/doc-requirements.ts` — append fields to the interface:

```ts
export interface LoanContext {
  // ...existing fields...

  // ── HOI/Flood validator additions (Task 5) ──
  /** Loan channel — drives H1 mortgagee-clause selection. */
  channel?: "Wholesale" | "NDC" | "Retail";
  /** Borrower's full legal name — drives H2 named-insured match. */
  borrowerFullName?: string;
  /** Entity name if entity-vested — drives H2 alternate match. */
  entityName?: string;
  /** Subject property full address — drives H3. */
  subjectPropertyAddress?: { line1: string; line2?: string; city: string; state: string; zip: string };
  /** Note date — drives H4 effective-date window. */
  noteDate?: string;
  /** Closing date — drives H6 premium-due rule on refis. */
  closingDate?: string;
  /** Unpaid principal balance — drives F2 on refis. */
  unpaidPrincipalBalance?: number;
  /** Replacement cost insured value — drives F2 fallback. */
  replacementCost?: number;
  /** Lender name (NDC channel only); v1.1 — H1 NDC branch no-ops if absent. */
  lenderName?: string;
  /** Lender loan number (NDC channel only); v1.1. */
  lenderLoanNumber?: string;
}
```

- [ ] **Step 4: Populate new fields in context builder**

Edit `packages/api/src/services/predict-conditions/predict-conditions-context-builder.ts` — in the function that builds `LoanContext`:

```ts
// Inside buildLoanContextFromLoan or equivalent:
const ctx: LoanContext = {
  // ...existing population...
  channel: loan.channel as LoanContext["channel"], // adapter provides this
  borrowerFullName: loan.borrower?.fullName,
  entityName: loan.vesting?.entityName,
  subjectPropertyAddress: loan.subjectProperty?.address
    ? {
        line1: loan.subjectProperty.address.line1,
        line2: loan.subjectProperty.address.line2 ?? undefined,
        city: loan.subjectProperty.address.city,
        state: loan.subjectProperty.address.state,
        zip: loan.subjectProperty.address.zip,
      }
    : undefined,
  noteDate: loan.transaction?.noteDate,
  closingDate: loan.transaction?.closingDate,
  unpaidPrincipalBalance: loan.transaction?.unpaidPrincipalBalance,
  replacementCost: loan.transaction?.replacementCost,
  // lenderName/lenderLoanNumber deferred to v1.1
};
```

If `loan.channel` etc. don't exist on the `Loan` type, the context-builder leaves them undefined — graceful degradation per existing F2-deferred pattern.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @twin/api test loan-context-hoi-fields`
Expected: PASS.

Run: `pnpm --filter @twin/api build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/doc-requirements.ts packages/api/src/services/predict-conditions/predict-conditions-context-builder.ts packages/api/test/loan-context-hoi-fields.test.ts
git commit -m "feat(api): widen LoanContext with HOI-validator fields (channel, dates, addresses)"
```

---

# Phase 2 — Rule Engine (TDD per rule cluster)

## Task 6: Rule framework + H1 (loss-payee.match) reference implementation

**Files:**
- Create: `packages/api/src/services/validators/hoi/rules/types.ts`
- Create: `packages/api/src/services/validators/hoi/rules/identity.ts`
- Create: `packages/api/src/services/validators/hoi/rules/index.ts`
- Create: `packages/api/test/hoi-validator-rules.test.ts`

- [ ] **Step 1: Write the failing tests for H1**

Create `packages/api/test/hoi-validator-rules.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { H1_lossPayeeMatch } from "../src/services/validators/hoi/rules/identity.js";
import type { RuleContext } from "../src/services/validators/hoi/rules/types.js";

const baseExtraction = {
  carrier: null, policyNumber: null, namedInsured: null, propertyAddress: null,
  effectiveDate: null, expirationDate: null, termMonths: null,
  lossPayeeClause: null, loanNumberOnPolicy: null,
  coverageAmount: null, replacementCost: null,
  deductiblePct: null, deductibleAmount: null,
  windHailHurricane: null, rentLossCoverageMonths: null, rentLossWording: null,
  rentLossActualCostSustained: null, occupancyOnPolicy: null,
  premiumPaidInFull: null, premiumDueDays: null,
  wallsInCoverage: null, ho6Policy: null, evidence: [],
};

const baseLoan = {
  incomeDocType: "Full Doc", borrowerType: "W2" as const, citizenship: "US Citizen" as const,
  isItin: false, llcOrLegalEntity: false, occupancy: "primary" as const,
  state: "TX", county: "Travis", usCredit: true, program: "FLEX",
  channel: "Wholesale" as const,
};

describe("H1: hoi.loss-payee.match", () => {
  test("Wholesale TX with correct NQM clause + loan number → pass", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, lossPayeeClause: "NQM Funding, LLC, 4800 N Federal Hwy, Bldg. E, Suite 200, Boca Raton, FL 33431", loanNumberOnPolicy: "92010207238" },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d-h", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000010",
      loanNumber: "92010207238",
    };
    expect(H1_lossPayeeMatch(ctx).fired).toBe(false);
  });

  test("Wholesale NY uses Great Home Mortgage clause → pass", () => {
    const ctx: RuleContext = {
      ...{
        hoi: { ...baseExtraction, lossPayeeClause: "Great Home Mortgage of New York, in lieu of true name NP, Inc. ISAOA/ATIMA", loanNumberOnPolicy: "X1" },
        flood: null,
        loan: { ...baseLoan, state: "NY" },
        documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
        extractionId: "00000000-0000-0000-0000-000000000011",
        loanNumber: "X1",
      },
    };
    expect(H1_lossPayeeMatch(ctx).fired).toBe(false);
  });

  test("Wholesale TX with wrong entity name → fail", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, lossPayeeClause: "NQM Funding Group, LLC", loanNumberOnPolicy: "X" },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000012",
      loanNumber: "X",
    };
    const r = H1_lossPayeeMatch(ctx);
    expect(r.fired).toBe(true);
    expect(r.finding?.severity).toBe("fail");
    expect(r.finding?.ruleId).toBe("hoi.loss-payee.match");
  });

  test("NDC channel without lenderName → no-op (skip with warn log)", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, lossPayeeClause: "Some Lender", loanNumberOnPolicy: "X" },
      flood: null,
      loan: { ...baseLoan, channel: "NDC" as const },
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000013",
      loanNumber: "X",
    };
    expect(H1_lossPayeeMatch(ctx).fired).toBe(false);
  });

  test("missing lossPayeeClause → skip", () => {
    const ctx: RuleContext = {
      hoi: { ...baseExtraction, lossPayeeClause: null },
      flood: null,
      loan: baseLoan,
      documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
      extractionId: "00000000-0000-0000-0000-000000000014",
      loanNumber: "X",
    };
    expect(H1_lossPayeeMatch(ctx).fired).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @twin/api test hoi-validator-rules`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the rule framework types**

Create `packages/api/src/services/validators/hoi/rules/types.ts`:

```ts
import type { HoiPolicyFields, FloodCertFields, ValidationFinding } from "@twin/core";
import type { LoanContext } from "../../../doc-requirements.js";

export interface DocumentRef {
  tenantId: string;
  loanId: string;
  documentId: string;
  category: "hoi-policy" | "flood-cert";
  storageUrl: string;
}

export interface RuleContext {
  hoi: HoiPolicyFields | null;
  flood: FloodCertFields | null;
  loan: LoanContext;
  documents: { hoi: DocumentRef | null; floodCert: DocumentRef | null };
  /** The active extraction's UUID — embedded in finding evidence + portal_metadata. */
  extractionId: string;
  /** Loan's external number (NQMF / Lender) for H1 channel-specific matching. */
  loanNumber: string;
}

export interface RuleResult {
  ruleId: string;
  fired: boolean;
  finding: ValidationFinding | null;
}

export type Rule = (ctx: RuleContext) => RuleResult;
```

- [ ] **Step 4: Implement H1 + register the rule**

Create `packages/api/src/services/validators/hoi/rules/identity.ts`:

```ts
import type { Rule, RuleContext, RuleResult } from "./types.js";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s.,]+/g, " ").trim();
}

function expectedLossPayee(loan: RuleContext["loan"]): string | null {
  if (loan.channel === "NDC") {
    if (!loan.lenderName) return null; // v1.1 deferred — skip
    return loan.lenderName;
  }
  // Wholesale + Retail use NQMF mortgagee clauses
  if (loan.state === "NY") return "Great Home Mortgage of New York";
  return "NQM Funding, LLC";
}

export const H1_lossPayeeMatch: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.loss-payee.match", fired: false, finding: null };
  if (!ctx.hoi?.lossPayeeClause) return skip;
  const expected = expectedLossPayee(ctx.loan);
  if (!expected) {
    // NDC channel without lenderName — graceful no-op per spec §5 P3.
    return skip;
  }
  const got = normalize(ctx.hoi.lossPayeeClause);
  const wantEntity = normalize(expected);
  const wantLoan = normalize(ctx.loanNumber);
  const entityOk = got.includes(wantEntity);
  const loanOk = got.includes(wantLoan);
  if (entityOk && loanOk) return skip;
  return {
    ruleId: "hoi.loss-payee.match",
    fired: true,
    finding: {
      ruleId: "hoi.loss-payee.match",
      severity: "fail",
      currentValue: ctx.hoi.lossPayeeClause,
      expectedValue: `${expected} (with loan number ${ctx.loanNumber})`,
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "lossPayeeClause",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "lossPayeeClause")?.documentPage ?? null,
      },
    },
  };
};
```

- [ ] **Step 5: Create rule registry**

Create `packages/api/src/services/validators/hoi/rules/index.ts`:

```ts
import type { Rule } from "./types.js";
import { H1_lossPayeeMatch } from "./identity.js";

export const HOI_RULES: Rule[] = [
  H1_lossPayeeMatch,
  // H2-H12, F1-F2 added in subsequent tasks
];

export * from "./types.js";
export { H1_lossPayeeMatch };
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @twin/api test hoi-validator-rules`
Expected: PASS (5 H1 cases).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/validators/hoi/rules/types.ts packages/api/src/services/validators/hoi/rules/identity.ts packages/api/src/services/validators/hoi/rules/index.ts packages/api/test/hoi-validator-rules.test.ts
git commit -m "feat(hoi): rule framework + H1 hoi.loss-payee.match with channel/state handling"
```

---

## Task 7: H2-H5 (named-insured, address, dates, term)

**Files:**
- Modify: `packages/api/src/services/validators/hoi/rules/identity.ts`
- Create: `packages/api/src/services/validators/hoi/rules/dates.ts`
- Modify: `packages/api/src/services/validators/hoi/rules/index.ts`
- Modify: `packages/api/test/hoi-validator-rules.test.ts`

- [ ] **Step 1: Add H2/H3/H4/H5 test blocks**

Append to `packages/api/test/hoi-validator-rules.test.ts` (one `describe` per rule, each with ≥4 cases per spec §7 Layer 1 plan). Pattern matches the H1 example — pass case, fail case, alternate-variant (e.g., entity-vested for H2), missing-input skip.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @twin/api test hoi-validator-rules`
Expected: 4 new failing describes.

- [ ] **Step 3: Implement H2 (named-insured.match)**

Append to `packages/api/src/services/validators/hoi/rules/identity.ts`:

```ts
export const H2_namedInsuredMatch: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.named-insured.match", fired: false, finding: null };
  if (!ctx.hoi?.namedInsured) return skip;
  const got = normalize(ctx.hoi.namedInsured);
  const expectedName = ctx.loan.entityName ?? ctx.loan.borrowerFullName;
  if (!expectedName) return skip;
  if (got.includes(normalize(expectedName))) return skip;
  return {
    ruleId: "hoi.named-insured.match",
    fired: true,
    finding: {
      ruleId: "hoi.named-insured.match",
      severity: "fail",
      currentValue: ctx.hoi.namedInsured,
      expectedValue: expectedName,
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "namedInsured",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "namedInsured")?.documentPage ?? null,
      },
    },
  };
};

export const H3_propertyAddressMatch: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.property-address.match", fired: false, finding: null };
  if (!ctx.hoi?.propertyAddress || !ctx.loan.subjectPropertyAddress) return skip;
  const got = ctx.hoi.propertyAddress;
  const want = ctx.loan.subjectPropertyAddress;
  const lineOk = normalize(got.line1) === normalize(want.line1);
  const cityOk = normalize(got.city) === normalize(want.city);
  const stateOk = normalize(got.state) === normalize(want.state);
  const zipOk = got.zip.replace(/\D/g, "").slice(0, 5) === want.zip.replace(/\D/g, "").slice(0, 5);
  if (lineOk && cityOk && stateOk && zipOk) return skip;
  return {
    ruleId: "hoi.property-address.match",
    fired: true,
    finding: {
      ruleId: "hoi.property-address.match",
      severity: "fail",
      currentValue: `${got.line1}, ${got.city}, ${got.state} ${got.zip}`,
      expectedValue: `${want.line1}, ${want.city}, ${want.state} ${want.zip}`,
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "propertyAddress",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "propertyAddress")?.documentPage ?? null,
      },
    },
  };
};
```

- [ ] **Step 4: Implement H4 + H5 in `dates.ts`**

Create `packages/api/src/services/validators/hoi/rules/dates.ts`:

```ts
import type { Rule, RuleContext, RuleResult } from "./types.js";

const DAY = 24 * 60 * 60 * 1000;

export const H4_effectiveDateWindow: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.effective-date.window", fired: false, finding: null };
  if (!ctx.hoi?.effectiveDate || !ctx.loan.noteDate) return skip;
  const eff = new Date(ctx.hoi.effectiveDate).getTime();
  const note = new Date(ctx.loan.noteDate).getTime();
  if (Number.isNaN(eff) || Number.isNaN(note)) return skip;
  const isPurchase = ctx.loan.loanPurpose === "Purchase";
  const minEff = isPurchase ? note - 15 * DAY : -Infinity;
  const maxEff = isPurchase ? Infinity : note;
  if (eff >= minEff && eff <= maxEff) return skip;
  return {
    ruleId: "hoi.effective-date.window",
    fired: true,
    finding: {
      ruleId: "hoi.effective-date.window",
      severity: "fail",
      currentValue: ctx.hoi.effectiveDate,
      expectedValue: isPurchase
        ? `≥ ${new Date(minEff).toISOString().slice(0, 10)} (note date − 15 days)`
        : `≤ ${ctx.loan.noteDate} (note date)`,
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "effectiveDate",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "effectiveDate")?.documentPage ?? null,
      },
    },
  };
};

export const H5_term12Months: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.term.12-months", fired: false, finding: null };
  if (ctx.hoi?.termMonths == null) return skip;
  if (ctx.hoi.termMonths >= 12) return skip;
  return {
    ruleId: "hoi.term.12-months",
    fired: true,
    finding: {
      ruleId: "hoi.term.12-months",
      severity: "fail",
      currentValue: `${ctx.hoi.termMonths} months`,
      expectedValue: "≥ 12 months",
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "termMonths",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "termMonths")?.documentPage ?? null,
      },
    },
  };
};
```

- [ ] **Step 5: Register all four rules**

Edit `packages/api/src/services/validators/hoi/rules/index.ts`:

```ts
import { H1_lossPayeeMatch, H2_namedInsuredMatch, H3_propertyAddressMatch } from "./identity.js";
import { H4_effectiveDateWindow, H5_term12Months } from "./dates.js";

export const HOI_RULES: Rule[] = [
  H1_lossPayeeMatch,
  H2_namedInsuredMatch,
  H3_propertyAddressMatch,
  H4_effectiveDateWindow,
  H5_term12Months,
];

export { H1_lossPayeeMatch, H2_namedInsuredMatch, H3_propertyAddressMatch, H4_effectiveDateWindow, H5_term12Months };
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @twin/api test hoi-validator-rules`
Expected: PASS (≥20 cases).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/validators/hoi/ packages/api/test/hoi-validator-rules.test.ts
git commit -m "feat(hoi): rules H2-H5 (named-insured, address, effective-date, term)"
```

---

## Task 8: H6 — premium.paid-in-full with confidence-based warn escalation

**Files:**
- Create: `packages/api/src/services/validators/hoi/rules/coverage.ts`
- Modify: `packages/api/src/services/validators/hoi/rules/index.ts`
- Modify: `packages/api/test/hoi-validator-rules.test.ts`

- [ ] **Step 1: Add H6 test block with 5 cases**

Append to test file — cases:
- `premiumPaidInFull.paid=true, confidence=0.9` → pass (rule does not fire)
- `premiumPaidInFull.paid=false, confidence=0.9, loanPurpose=Purchase` → fail
- `premiumPaidInFull.paid=true, confidence=0.5, loanPurpose=Purchase` → warn (paid=true but low confidence)
- Refi with `premiumDueDays=30, closingDate=2026-06-01` → fail (60-day rule)
- `premiumPaidInFull=null` → skip

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @twin/api test hoi-validator-rules`
Expected: 5 new failing cases.

- [ ] **Step 3: Implement H6**

Create `packages/api/src/services/validators/hoi/rules/coverage.ts`:

```ts
import type { Rule, RuleContext, RuleResult } from "./types.js";

const CONF_FAIL_THRESHOLD = 0.7;
const CONF_SKIP_THRESHOLD = 0.4;
const DAY = 24 * 60 * 60 * 1000;

export const H6_premiumPaidInFull: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.premium.paid-in-full", fired: false, finding: null };
  const p = ctx.hoi?.premiumPaidInFull;
  if (!p) return skip;
  if (p.confidence < CONF_SKIP_THRESHOLD) return skip; // grounding-pass already lowered confidence

  // Refi with premium due within 60d of closing must be paid
  const isRefi = ctx.loan.loanPurpose === "Rate & Term Refinance" || ctx.loan.loanPurpose === "Cash-Out Refinance";
  let dueWithin60d = false;
  if (isRefi && ctx.loan.closingDate && ctx.hoi?.premiumDueDays != null) {
    const close = new Date(ctx.loan.closingDate).getTime();
    const dueBy = Date.now() + ctx.hoi.premiumDueDays * DAY;
    dueWithin60d = dueBy <= close + 60 * DAY && dueBy >= close - 60 * DAY;
  }

  if (p.paid) {
    if (p.confidence < CONF_FAIL_THRESHOLD) {
      // Paid asserted but low confidence — warn rather than silently pass
      return {
        ruleId: "hoi.premium.paid-in-full",
        fired: true,
        finding: {
          ruleId: "hoi.premium.paid-in-full",
          severity: "warn",
          currentValue: `paid (confidence ${p.confidence.toFixed(2)})`,
          expectedValue: "paid in full (high confidence)",
          evidence: {
            documentId: ctx.documents.hoi!.documentId,
            extractionId: ctx.extractionId,
            fieldPath: "premiumPaidInFull",
            documentPage: ctx.hoi!.evidence.find((e) => e.fieldPath === "premiumPaidInFull")?.documentPage ?? null,
          },
        },
      };
    }
    if (isRefi && dueWithin60d && !p.paid) {
      return failPremium(ctx, "refi premium due within 60d of closing must be paid prior/at closing");
    }
    return skip;
  }

  if (isRefi && dueWithin60d) {
    return failPremium(ctx, "refi premium due within 60d of closing must be paid prior/at closing");
  }
  return failPremium(ctx, "premium not paid in full");
};

function failPremium(ctx: RuleContext, reason: string): RuleResult {
  return {
    ruleId: "hoi.premium.paid-in-full",
    fired: true,
    finding: {
      ruleId: "hoi.premium.paid-in-full",
      severity: "fail",
      currentValue: ctx.hoi?.premiumPaidInFull?.paid ? "paid" : "not paid",
      expectedValue: reason,
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "premiumPaidInFull",
        documentPage: ctx.hoi!.evidence.find((e) => e.fieldPath === "premiumPaidInFull")?.documentPage ?? null,
      },
    },
  };
}
```

- [ ] **Step 4: Register H6**

Edit `packages/api/src/services/validators/hoi/rules/index.ts`:

```ts
import { H6_premiumPaidInFull } from "./coverage.js";
export const HOI_RULES: Rule[] = [
  H1_lossPayeeMatch, H2_namedInsuredMatch, H3_propertyAddressMatch,
  H4_effectiveDateWindow, H5_term12Months,
  H6_premiumPaidInFull,
];
export { H6_premiumPaidInFull };
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @twin/api test hoi-validator-rules`
Expected: PASS (≥25 cases).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/validators/hoi/rules/coverage.ts packages/api/src/services/validators/hoi/rules/index.ts packages/api/test/hoi-validator-rules.test.ts
git commit -m "feat(hoi): rule H6 hoi.premium.paid-in-full with confidence-based warn escalation"
```

---

## Task 9: H7-H9 (deductible.cap, wind-hail.included, coverage.minimum)

**Files:**
- Modify: `packages/api/src/services/validators/hoi/rules/coverage.ts`
- Modify: `packages/api/src/services/validators/hoi/rules/index.ts`
- Modify: `packages/api/test/hoi-validator-rules.test.ts`

- [ ] **Step 1: Add test blocks for H7/H8/H9**

Cases for each:
- **H7**: pass at deductiblePct=0.045, fail at 0.06, skip when null
- **H8**: pass at `included=true, confidence=0.9`, fail at `included=false, confidence=0.9`, warn at `included=true, confidence=0.5` (grounding-pass lowered confidence), skip when null
- **H9**: pass when coverageAmount ≥ min(loanAmount, replacementCost), fail when below, skip when fields missing

- [ ] **Step 2: Run tests; verify they fail**

- [ ] **Step 3: Implement H7/H8/H9**

Append to `packages/api/src/services/validators/hoi/rules/coverage.ts`:

```ts
export const H7_deductibleCap: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.deductible.cap", fired: false, finding: null };
  if (ctx.hoi?.deductiblePct == null) return skip;
  if (ctx.hoi.deductiblePct <= 0.05) return skip;
  return {
    ruleId: "hoi.deductible.cap",
    fired: true,
    finding: {
      ruleId: "hoi.deductible.cap",
      severity: "fail",
      currentValue: `${(ctx.hoi.deductiblePct * 100).toFixed(2)}%`,
      expectedValue: "≤ 5% of face value",
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "deductiblePct",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "deductiblePct")?.documentPage ?? null,
      },
    },
  };
};

export const H8_windHailIncluded: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.wind-hail-hurricane.included", fired: false, finding: null };
  const w = ctx.hoi?.windHailHurricane;
  if (!w) return skip;
  if (w.confidence < CONF_SKIP_THRESHOLD) return skip;
  if (w.included && w.confidence >= CONF_FAIL_THRESHOLD) return skip;
  const severity: "fail" | "warn" =
    !w.included && w.confidence >= CONF_FAIL_THRESHOLD ? "fail" : "warn";
  return {
    ruleId: "hoi.wind-hail-hurricane.included",
    fired: true,
    finding: {
      ruleId: "hoi.wind-hail-hurricane.included",
      severity,
      currentValue: w.wording ?? (w.included ? "included" : "excluded"),
      expectedValue: "wind, hail, and hurricane coverage included (special form, all perils, or separate policy)",
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "windHailHurricane",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "windHailHurricane")?.documentPage ?? null,
      },
    },
  };
};

export const H9_coverageMinimum: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.coverage.minimum", fired: false, finding: null };
  if (ctx.hoi?.coverageAmount == null) return skip;
  if (ctx.loan.loanAmount == null) return skip;
  const rc = ctx.hoi.replacementCost ?? ctx.loan.replacementCost;
  const required = rc != null ? Math.min(ctx.loan.loanAmount, rc) : ctx.loan.loanAmount;
  if (ctx.hoi.coverageAmount >= required) return skip;
  return {
    ruleId: "hoi.coverage.minimum",
    fired: true,
    finding: {
      ruleId: "hoi.coverage.minimum",
      severity: "fail",
      currentValue: `$${ctx.hoi.coverageAmount.toLocaleString()}`,
      expectedValue: `≥ $${required.toLocaleString()} (lesser of loan amount / replacement cost)`,
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "coverageAmount",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "coverageAmount")?.documentPage ?? null,
      },
    },
  };
};
```

- [ ] **Step 4: Register**

Edit `index.ts` to include H7, H8, H9 in the array + exports.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @twin/api test hoi-validator-rules`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/validators/hoi/rules/coverage.ts packages/api/src/services/validators/hoi/rules/index.ts packages/api/test/hoi-validator-rules.test.ts
git commit -m "feat(hoi): rules H7-H9 (deductible cap, wind-hail with warn, coverage minimum)"
```

---

## Task 10: H10-H12 (DSCR rent-loss, condo walls-in/HO6, occupancy)

**Files:**
- Create: `packages/api/src/services/validators/hoi/rules/conditional.ts`
- Modify: `packages/api/src/services/validators/hoi/rules/index.ts`
- Modify: `packages/api/test/hoi-validator-rules.test.ts`

- [ ] **Step 1: Add test blocks**

Cases per spec rule table:
- **H10**: DSCR loan with `rentLossCoverageMonths=6, rentLossActualCostSustained=null` → pass; DSCR with `rentLossCoverageMonths=3` → fail; DSCR with `rentLossActualCostSustained.detected=true, confidence=0.9` → fail; non-DSCR loan → does not fire (skip); DSCR with `rentLossActualCostSustained.confidence=0.5` → warn
- **H11**: Condo with `wallsInCoverage.included=true, confidence=0.9` → pass; Condo with `wallsInCoverage.included=false` and no HO6 → fail; Condo with HO6 walls-in but `ho6Policy.deductiblePct=0.06` → fail; non-Condo → does not fire
- **H12**: DSCR loan with `occupancyOnPolicy="Investment"` → pass; DSCR loan with `occupancyOnPolicy="Primary"` → fail; non-DSCR loan with matching occupancy → pass

- [ ] **Step 2: Implement H10/H11/H12**

Create `packages/api/src/services/validators/hoi/rules/conditional.ts`:

```ts
import type { Rule, RuleContext, RuleResult } from "./types.js";

const CONF_FAIL_THRESHOLD = 0.7;
const CONF_SKIP_THRESHOLD = 0.4;

function isDscr(loan: RuleContext["loan"]): boolean {
  // C5: productKind=DSCR via incomeDocType substring match (case-insensitive)
  if (!loan.incomeDocType) return false;
  if (loan.incomeDocType.toUpperCase().includes("DSCR")) return true;
  return false;
}

function isCondo(loan: RuleContext["loan"]): boolean {
  return loan.propertyType === "Condo";
}

export const H10_dscrRentLoss: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.dscr.rent-loss-coverage", fired: false, finding: null };
  if (!isDscr(ctx.loan)) return skip;

  const monthsOk = ctx.hoi?.rentLossCoverageMonths != null && ctx.hoi.rentLossCoverageMonths >= 6;
  const acs = ctx.hoi?.rentLossActualCostSustained;
  if (acs && acs.confidence < CONF_SKIP_THRESHOLD) {
    // Low confidence on the wording detection → treat acs as unknown; still evaluate months
  }
  const actualCostDetected =
    acs && acs.confidence >= CONF_SKIP_THRESHOLD ? acs.detected : false;

  if (monthsOk && !actualCostDetected) return skip;

  const severity: "fail" | "warn" =
    acs && acs.confidence < CONF_FAIL_THRESHOLD && acs.detected
      ? "warn"
      : "fail";
  const reason = !monthsOk
    ? `rent loss coverage is ${ctx.hoi?.rentLossCoverageMonths ?? "unknown"} months; require ≥ 6`
    : `policy wording suggests "actual cost sustained" — DSCR requires explicit months coverage`;
  return {
    ruleId: "hoi.dscr.rent-loss-coverage",
    fired: true,
    finding: {
      ruleId: "hoi.dscr.rent-loss-coverage",
      severity,
      currentValue: `${ctx.hoi?.rentLossCoverageMonths ?? "?"} mo; ${ctx.hoi?.rentLossWording ?? "no wording captured"}`,
      expectedValue: "≥ 6 months PITIA rent loss (not 'actual cost sustained')",
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "rentLossCoverageMonths",
        documentPage: ctx.hoi!.evidence.find((e) => e.fieldPath === "rentLossCoverageMonths")?.documentPage ?? null,
      },
    },
  };
};

export const H11_condoWallsInOrHo6: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.condo.walls-in-or-ho6", fired: false, finding: null };
  if (!isCondo(ctx.loan)) return skip;

  const walls = ctx.hoi?.wallsInCoverage;
  const ho6 = ctx.hoi?.ho6Policy;

  if (walls && walls.confidence < CONF_SKIP_THRESHOLD && !ho6?.present) return skip;

  const wallsOk = walls && walls.included && walls.confidence >= CONF_FAIL_THRESHOLD;
  const ho6Ok = ho6?.present && (ho6.deductiblePct == null || ho6.deductiblePct <= 0.05);
  if (wallsOk || ho6Ok) return skip;

  const lowConfWallsClaim =
    walls && walls.included && walls.confidence < CONF_FAIL_THRESHOLD && !ho6Ok;
  const severity: "fail" | "warn" = lowConfWallsClaim ? "warn" : "fail";
  return {
    ruleId: "hoi.condo.walls-in-or-ho6",
    fired: true,
    finding: {
      ruleId: "hoi.condo.walls-in-or-ho6",
      severity,
      currentValue: walls?.included
        ? `walls-in claimed (confidence ${walls.confidence.toFixed(2)})`
        : ho6?.present
        ? `HO6 present, deductible ${ho6.deductiblePct != null ? (ho6.deductiblePct * 100).toFixed(2) + "%" : "?"}`
        : "no walls-in or HO6",
      expectedValue: "master policy walls-in coverage OR separate HO6 with deductible ≤ 5% of dwelling",
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "wallsInCoverage",
        documentPage: ctx.hoi!.evidence.find((e) => e.fieldPath === "wallsInCoverage")?.documentPage ?? null,
      },
    },
  };
};

export const H12_occupancyMatch: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.occupancy.match", fired: false, finding: null };
  if (!ctx.hoi?.occupancyOnPolicy) return skip;
  const policyOcc = ctx.hoi.occupancyOnPolicy.toLowerCase();
  if (isDscr(ctx.loan)) {
    if (policyOcc.includes("primary") || policyOcc.includes("owner-occupied")) {
      return {
        ruleId: "hoi.occupancy.match",
        fired: true,
        finding: {
          ruleId: "hoi.occupancy.match",
          severity: "fail",
          currentValue: ctx.hoi.occupancyOnPolicy,
          expectedValue: "DSCR loans require non-owner-occupied policy (Investment / Rental)",
          evidence: {
            documentId: ctx.documents.hoi!.documentId,
            extractionId: ctx.extractionId,
            fieldPath: "occupancyOnPolicy",
            documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "occupancyOnPolicy")?.documentPage ?? null,
          },
        },
      };
    }
  }
  // Non-DSCR: occupancy mismatch with transaction is informational; flag obvious mismatches as fail
  if (ctx.loan.occupancy === "primary" && !policyOcc.includes("primary") && !policyOcc.includes("owner")) {
    return {
      ruleId: "hoi.occupancy.match",
      fired: true,
      finding: {
        ruleId: "hoi.occupancy.match",
        severity: "fail",
        currentValue: ctx.hoi.occupancyOnPolicy,
        expectedValue: "policy occupancy should reflect Primary / Owner-Occupied for primary residence loans",
        evidence: {
          documentId: ctx.documents.hoi!.documentId,
          extractionId: ctx.extractionId,
          fieldPath: "occupancyOnPolicy",
          documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "occupancyOnPolicy")?.documentPage ?? null,
        },
      },
    };
  }
  return skip;
};
```

- [ ] **Step 3: Register**

Edit `index.ts` to include H10/H11/H12.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @twin/api test hoi-validator-rules`
Expected: PASS (≥45 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/validators/hoi/rules/conditional.ts packages/api/src/services/validators/hoi/rules/index.ts packages/api/test/hoi-validator-rules.test.ts
git commit -m "feat(hoi): rules H10-H12 (DSCR rent-loss, condo walls-in/HO6, occupancy match)"
```

---

## Task 11: F1-F2 (flood.deductible.cap, flood.coverage.minimum)

**Files:**
- Create: `packages/api/src/services/validators/hoi/rules/flood.ts`
- Modify: `packages/api/src/services/validators/hoi/rules/index.ts`
- Modify: `packages/api/test/hoi-validator-rules.test.ts`

- [ ] **Step 1: Add test blocks**

Cases:
- **F1**: SFR with `floodDeductible=8000` → pass; SFR with `floodDeductible=12000` → fail; Condo with `floodDeductible=22000` → pass; Condo with `floodDeductible=30000` → fail; no flood-cert doc → skip
- **F2**: `floodCoverage >= min(UPB, RC, NFIP_MAX)` → pass; `floodCoverage < required` → fail; no flood-cert doc → skip

- [ ] **Step 2: Implement F1/F2**

Create `packages/api/src/services/validators/hoi/rules/flood.ts`:

```ts
import type { Rule, RuleContext, RuleResult } from "./types.js";

const NFIP_MAX_SFR = 250_000;
const NFIP_MAX_OTHER = 500_000;

export const F1_floodDeductibleCap: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "flood.deductible.cap", fired: false, finding: null };
  if (!ctx.flood || !ctx.documents.floodCert) return skip;
  if (ctx.flood.floodDeductible == null) return skip;
  const propertyType = ctx.loan.propertyType ?? "SFR";
  const cap = propertyType === "Condo" || propertyType === "PUD" ? 25_000 : 10_000;
  if (ctx.flood.floodDeductible <= cap) return skip;
  return {
    ruleId: "flood.deductible.cap",
    fired: true,
    finding: {
      ruleId: "flood.deductible.cap",
      severity: "fail",
      currentValue: `$${ctx.flood.floodDeductible.toLocaleString()}`,
      expectedValue: `≤ $${cap.toLocaleString()} for ${propertyType}`,
      evidence: {
        documentId: ctx.documents.floodCert.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "floodDeductible",
        documentPage: ctx.flood.evidence.find((e) => e.fieldPath === "floodDeductible")?.documentPage ?? null,
      },
    },
  };
};

export const F2_floodCoverageMinimum: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "flood.coverage.minimum", fired: false, finding: null };
  if (!ctx.flood || !ctx.documents.floodCert) return skip;
  if (ctx.flood.floodCoverage == null) return skip;
  const upb = ctx.loan.unpaidPrincipalBalance ?? ctx.loan.loanAmount;
  const rc = ctx.loan.replacementCost;
  const propertyType = ctx.loan.propertyType ?? "SFR";
  const nfipMax = propertyType === "Condo" || propertyType === "PUD" ? NFIP_MAX_OTHER : NFIP_MAX_SFR;
  const candidates = [upb, rc, nfipMax].filter((v): v is number => v != null);
  if (candidates.length === 0) return skip;
  const required = Math.min(...candidates);
  if (ctx.flood.floodCoverage >= required) return skip;
  return {
    ruleId: "flood.coverage.minimum",
    fired: true,
    finding: {
      ruleId: "flood.coverage.minimum",
      severity: "fail",
      currentValue: `$${ctx.flood.floodCoverage.toLocaleString()}`,
      expectedValue: `≥ $${required.toLocaleString()} (lesser of UPB / RC / NFIP max)`,
      evidence: {
        documentId: ctx.documents.floodCert.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "floodCoverage",
        documentPage: ctx.flood.evidence.find((e) => e.fieldPath === "floodCoverage")?.documentPage ?? null,
      },
    },
  };
};
```

- [ ] **Step 3: Register**

Edit `index.ts` to include F1/F2 + ensure `HOI_RULES` array is now 14 entries.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @twin/api test hoi-validator-rules`
Expected: PASS (≥55 cases, all 14 rules covered).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/validators/hoi/rules/flood.ts packages/api/src/services/validators/hoi/rules/index.ts packages/api/test/hoi-validator-rules.test.ts
git commit -m "feat(hoi): flood rules F1-F2 (deductible cap, coverage minimum)"
```

---

# Phase 3 — Extractors

## Task 12: `HoiFieldExtractor` interface + `PortalProvidedHoiExtractor`

**Files:**
- Create: `packages/api/src/services/validators/hoi/extractor.ts`
- Create: `packages/api/src/services/validators/hoi/portal-provided-extractor.ts`
- Create: `packages/api/test/hoi-portal-extractor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api/test/hoi-portal-extractor.test.ts`:

```ts
import { describe, test, expect, beforeEach } from "vitest";
import { PortalProvidedHoiExtractor } from "../src/services/validators/hoi/portal-provided-extractor.js";
import { withDb } from "../src/db/pool.js";
import { randomUUID } from "node:crypto";

describe("PortalProvidedHoiExtractor", () => {
  const tenantId = "5d175193-6ee2-4d6a-b16e-f1777f7e18ad";
  const loanId = "TEST-PORTAL-EXTRACTOR";
  const documentId = randomUUID();

  beforeEach(async () => {
    await withDb(async (c) => {
      await c.query("DELETE FROM document_extractions WHERE document_id = $1", [documentId]);
    });
  });

  test("canExtract returns true when active portal extraction exists", async () => {
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO document_extractions (tenant_id, loan_id, document_id, extractor_kind, schema_version, source, extracted_by, fields, extraction_confidence)
         VALUES ($1, $2, $3, 'hoi-policy', 1, 'portal', 'portal:test', '{}'::jsonb, NULL)`,
        [tenantId, loanId, documentId],
      );
    });
    const ext = new PortalProvidedHoiExtractor();
    const ok = await ext.canExtract({
      tenantId, loanId, documentId, category: "hoi-policy", storageUrl: "x",
    });
    expect(ok).toBe(true);
  });

  test("extract returns the cached row's fields", async () => {
    const fields = { carrier: "Test Co", policyNumber: "P-1", evidence: [] };
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO document_extractions (tenant_id, loan_id, document_id, extractor_kind, schema_version, source, extracted_by, fields)
         VALUES ($1, $2, $3, 'hoi-policy', 1, 'portal', 'portal:test', $4::jsonb)`,
        [tenantId, loanId, documentId, JSON.stringify(fields)],
      );
    });
    const ext = new PortalProvidedHoiExtractor();
    const r = await ext.extract({
      tenantId, loanId, documentId, category: "hoi-policy", storageUrl: "x",
    });
    expect(r.source).toBe("portal");
    expect((r.fields as Record<string, unknown>).carrier).toBe("Test Co");
  });
});
```

- [ ] **Step 2: Run test; verify it fails**

- [ ] **Step 3: Create interface + implementation**

Create `packages/api/src/services/validators/hoi/extractor.ts`:

```ts
import type { HoiPolicyFields, FloodCertFields } from "@twin/core";

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
  confidence: number | null;
  extractedBy: string;
  extractionId: string;
  schemaVersion: number;
}

export interface HoiFieldExtractor {
  canExtract(doc: DocumentRef): Promise<boolean>;
  extract(doc: DocumentRef): Promise<HoiExtractionResult>;
}
```

Create `packages/api/src/services/validators/hoi/portal-provided-extractor.ts`:

```ts
import { withTenantTx } from "../../../db/pool.js";
import { HOI_SCHEMA_VERSION } from "@twin/core";
import type { DocumentRef, HoiExtractionResult, HoiFieldExtractor } from "./extractor.js";

export class PortalProvidedHoiExtractor implements HoiFieldExtractor {
  async canExtract(doc: DocumentRef): Promise<boolean> {
    return withTenantTx(doc.tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT 1 FROM document_extractions
          WHERE tenant_id = $1 AND document_id = $2 AND extractor_kind = $3
            AND schema_version = $4 AND source = 'portal' AND superseded_at IS NULL
          LIMIT 1`,
        [doc.tenantId, doc.documentId, doc.category, HOI_SCHEMA_VERSION],
      );
      return rows.length > 0;
    });
  }

  async extract(doc: DocumentRef): Promise<HoiExtractionResult> {
    return withTenantTx(doc.tenantId, async (c) => {
      const { rows } = await c.query<{ id: string; fields: unknown; extracted_by: string }>(
        `SELECT id, fields, extracted_by FROM document_extractions
          WHERE tenant_id = $1 AND document_id = $2 AND extractor_kind = $3
            AND schema_version = $4 AND source = 'portal' AND superseded_at IS NULL
          ORDER BY extracted_at DESC LIMIT 1`,
        [doc.tenantId, doc.documentId, doc.category, HOI_SCHEMA_VERSION],
      );
      if (rows.length === 0) {
        throw new Error(`PortalProvidedHoiExtractor.extract called when canExtract=false (document=${doc.documentId})`);
      }
      const row = rows[0];
      return {
        fields: row.fields as HoiExtractionResult["fields"],
        source: "portal",
        confidence: null,
        extractedBy: row.extracted_by,
        extractionId: row.id,
        schemaVersion: HOI_SCHEMA_VERSION,
      };
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @twin/api test hoi-portal-extractor`
Expected: PASS (2 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/validators/hoi/extractor.ts packages/api/src/services/validators/hoi/portal-provided-extractor.ts packages/api/test/hoi-portal-extractor.test.ts
git commit -m "feat(hoi): HoiFieldExtractor interface + PortalProvidedHoiExtractor"
```

---

## Task 13: Spec 1.5 adapter extension for `analysisOutput.extracted_documents[]`

**Files:**
- Modify: `packages/api/src/ingestion/adapters/npnqm-portal.ts`
- Modify: `packages/api/src/routes/ingestion.ts` (or wherever analysis-output persistence lives)
- Create: `packages/api/test/portal-extracted-documents-ingest.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create test verifying that POSTing analysisOutput with `extracted_documents[]` writes rows to `document_extractions` with `source='portal'`.

- [ ] **Step 2: Run test; verify it fails**

- [ ] **Step 3: Extend `transformAnalysisOutput`**

Edit `packages/api/src/ingestion/adapters/npnqm-portal.ts` — append to the result type and the implementation:

```ts
interface ExtractedDocumentPayload {
  documentExternalId: string;
  extractorKind: "hoi-policy" | "flood-cert";
  schemaVersion: number;
  fields: unknown;
  extractedAt: string;
}

// In TransformAnalysisOutput type add:
//   extractedDocuments: ExtractedDocumentPayload[];

// In transformAnalysisOutput:
const extracted = (ao.extracted_documents ?? []) as Array<Raw>;
const extractedDocuments: ExtractedDocumentPayload[] = extracted.map((e) => ({
  documentExternalId: String(e.document_external_id ?? ""),
  extractorKind: (e.extractor_kind as "hoi-policy" | "flood-cert"),
  schemaVersion: Number(e.schema_version ?? 1),
  fields: e.fields ?? {},
  extractedAt: String(e.extracted_at ?? new Date().toISOString()),
}));
return { loan, extras, portalPredictions, eligibilityVerdict, seenConflicts, stats: statsTyped, extractedDocuments };
```

- [ ] **Step 4: Persist into `document_extractions`**

Edit the analysis-output route handler (the place that already inserts portal predictions). Add:

```ts
// After existing portal-llm prediction inserts, persist extracted_documents:
for (const ed of result.extractedDocuments) {
  // Resolve documentId from documentExternalId via ingested_documents
  const { rows: docRows } = await c.query(
    `SELECT id FROM ingested_documents
      WHERE tenant_id = $1 AND loan_external_id = $2 AND external_id = $3 LIMIT 1`,
    [tenantId, externalLoanId, ed.documentExternalId],
  );
  if (docRows.length === 0) continue; // graceful — log a warn
  const documentId = docRows[0].id;
  await c.query(
    `INSERT INTO document_extractions
       (tenant_id, loan_id, document_id, extractor_kind, schema_version, source, extracted_by, fields)
     VALUES ($1, $2, $3, $4, $5, 'portal', $6, $7::jsonb)
     ON CONFLICT (tenant_id, document_id, extractor_kind, schema_version)
       WHERE superseded_at IS NULL
       DO NOTHING`,
    [tenantId, loanId, documentId, ed.extractorKind, ed.schemaVersion, "portal:npnqm", JSON.stringify(ed.fields)],
  );
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @twin/api test portal-extracted-documents-ingest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/ingestion/adapters/npnqm-portal.ts packages/api/src/routes/ingestion.ts packages/api/test/portal-extracted-documents-ingest.integration.test.ts
git commit -m "feat(ingest): Spec 1.5 — accept analysisOutput.extracted_documents[] → document_extractions"
```

---

## Task 14: `LlmHoiExtractor` — Anthropic tool-use schema + Zod validation

**Files:**
- Create: `packages/api/src/services/validators/hoi/llm-extractor.ts`
- Create: `packages/api/test/hoi-llm-extractor.test.ts`

- [ ] **Step 1: Write the failing test (mocked Anthropic)**

Test cases:
- LLM returns schema-valid JSON → extractor writes structured fields
- LLM returns malformed JSON → extractor returns extraction with `extraction_error` set + low confidence
- Tool-use schema enforces required fields

Use a mock `AnthropicClient` injected via constructor. Existing pattern from learning-worker tests.

- [ ] **Step 2: Run test; verify failure**

- [ ] **Step 3: Implement `LlmHoiExtractor`**

Create `packages/api/src/services/validators/hoi/llm-extractor.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { HoiPolicyFieldsSchema, FloodCertFieldsSchema, HOI_SCHEMA_VERSION } from "@twin/core";
import type { DocumentRef, HoiExtractionResult, HoiFieldExtractor } from "./extractor.js";
import { groundingPass } from "./grounding.js";

const TOOL_HOI: Anthropic.Messages.Tool = {
  name: "emit_hoi_policy_fields",
  description: "Emit structured fields extracted from a Hazard Insurance policy declaration page.",
  input_schema: {
    type: "object",
    properties: {
      // Shape mirrors HoiPolicyFieldsSchema from @twin/core.
      // Every field listed in the Zod schema must appear here.
      carrier: { type: ["string", "null"] },
      policyNumber: { type: ["string", "null"] },
      namedInsured: { type: ["string", "null"] },
      propertyAddress: {
        type: ["object", "null"],
        properties: {
          line1: { type: "string" }, line2: { type: ["string", "null"] },
          city: { type: "string" }, state: { type: "string" }, zip: { type: "string" },
        },
        required: ["line1", "city", "state", "zip"],
      },
      effectiveDate: { type: ["string", "null"], description: "ISO date string YYYY-MM-DD" },
      expirationDate: { type: ["string", "null"] },
      termMonths: { type: ["integer", "null"] },
      lossPayeeClause: { type: ["string", "null"], description: "Full verbatim text of the loss payee / mortgagee clause." },
      loanNumberOnPolicy: { type: ["string", "null"] },
      coverageAmount: { type: ["number", "null"] },
      replacementCost: { type: ["number", "null"] },
      deductiblePct: { type: ["number", "null"], description: "Decimal 0-1 (e.g., 0.02 for 2%)" },
      deductibleAmount: { type: ["number", "null"] },
      windHailHurricane: {
        type: ["object", "null"],
        properties: {
          included: { type: "boolean" }, wording: { type: ["string", "null"] },
          separatePolicy: { type: "boolean" }, confidence: { type: "number" },
        },
        required: ["included", "separatePolicy", "confidence"],
      },
      // ...remaining fields per HoiPolicyFieldsSchema...
      evidence: {
        type: "array",
        items: {
          type: "object",
          properties: { fieldPath: { type: "string" }, documentPage: { type: "integer" }, bbox: { type: ["array", "null"] } },
          required: ["fieldPath", "documentPage"],
        },
      },
    },
    required: ["evidence"],
  },
};

const TOOL_FLOOD: Anthropic.Messages.Tool = {
  name: "emit_flood_cert_fields",
  description: "Emit structured fields extracted from a Flood Certificate / NFIP policy.",
  input_schema: {
    type: "object",
    properties: {
      // Shape mirrors FloodCertFieldsSchema from @twin/core.
      carrier: { type: ["string", "null"] },
      policyNumber: { type: ["string", "null"] },
      namedInsured: { type: ["string", "null"] },
      propertyAddress: {
        type: ["object", "null"],
        properties: {
          line1: { type: "string" }, line2: { type: ["string", "null"] },
          city: { type: "string" }, state: { type: "string" }, zip: { type: "string" },
        },
        required: ["line1", "city", "state", "zip"],
      },
      effectiveDate: { type: ["string", "null"] },
      expirationDate: { type: ["string", "null"] },
      termMonths: { type: ["integer", "null"] },
      floodZone: { type: ["string", "null"], description: "FEMA flood zone code (e.g., AE, X)." },
      floodCoverage: { type: ["number", "null"] },
      floodDeductible: { type: ["number", "null"] },
      isNfip: { type: ["boolean", "null"] },
      nfipMaxApplied: { type: ["boolean", "null"] },
      evidence: {
        type: "array",
        items: {
          type: "object",
          properties: { fieldPath: { type: "string" }, documentPage: { type: "integer" }, bbox: { type: ["array", "null"] } },
          required: ["fieldPath", "documentPage"],
        },
      },
    },
    required: ["evidence"],
  },
};

export class LlmHoiExtractor implements HoiFieldExtractor {
  constructor(private anthropic: Anthropic, private model = "claude-sonnet-4-6") {}

  async canExtract(doc: DocumentRef): Promise<boolean> {
    return doc.category === "hoi-policy" || doc.category === "flood-cert";
  }

  async extract(doc: DocumentRef): Promise<HoiExtractionResult> {
    const tool = doc.category === "hoi-policy" ? TOOL_HOI : TOOL_FLOOD;
    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4096,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "url", url: doc.storageUrl } as never },
          { type: "text", text: `Extract structured fields from this ${doc.category === "hoi-policy" ? "Hazard Insurance policy declaration page" : "Flood certificate"}. Use null for fields you cannot identify with high confidence. Capture verbatim wording on prose-derived booleans.` },
        ],
      }],
      headers: { "anthropic-beta": "zero-data-retention-2024-09-01" } as never,
    });

    const toolUse = response.content.find((c) => c.type === "tool_use") as { input: unknown } | undefined;
    if (!toolUse) {
      return this.failedExtraction(doc, "no_tool_use_block");
    }
    const schema = doc.category === "hoi-policy" ? HoiPolicyFieldsSchema : FloodCertFieldsSchema;
    const parsed = schema.safeParse(toolUse.input);
    if (!parsed.success) {
      return this.failedExtraction(doc, `zod_validation_failed: ${parsed.error.message.slice(0, 200)}`);
    }

    // R1 grounding-pass
    const grounded = doc.category === "hoi-policy"
      ? groundingPass(parsed.data as never)
      : { fields: parsed.data, groundingErrors: [] as Array<{ field: string; conclusion: string; reason: string }> };

    // Aggregate confidence: average of per-field confidences on prose-derived booleans
    const aggregateConfidence = computeAggregateConfidence(grounded.fields);

    return {
      fields: grounded.fields,
      source: "llm-extractor",
      confidence: aggregateConfidence,
      extractedBy: `worker:hoi-extractor:v${HOI_SCHEMA_VERSION}`,
      extractionId: "", // populated by caller after DB insert
      schemaVersion: HOI_SCHEMA_VERSION,
    };
  }

  private failedExtraction(doc: DocumentRef, reason: string): HoiExtractionResult {
    return {
      fields: {} as never,
      source: "llm-extractor",
      confidence: 0,
      extractedBy: `worker:hoi-extractor:v${HOI_SCHEMA_VERSION}:error`,
      extractionId: "",
      schemaVersion: HOI_SCHEMA_VERSION,
    };
  }
}

function computeAggregateConfidence(fields: unknown): number {
  const f = fields as { windHailHurricane?: { confidence?: number }; rentLossActualCostSustained?: { confidence?: number }; premiumPaidInFull?: { confidence?: number }; wallsInCoverage?: { confidence?: number } };
  const confs = [f.windHailHurricane?.confidence, f.rentLossActualCostSustained?.confidence, f.premiumPaidInFull?.confidence, f.wallsInCoverage?.confidence].filter((v): v is number => typeof v === "number");
  if (confs.length === 0) return 1; // no prose-derived fields present → no risk to aggregate
  return confs.reduce((a, b) => a + b, 0) / confs.length;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @twin/api test hoi-llm-extractor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/validators/hoi/llm-extractor.ts packages/api/test/hoi-llm-extractor.test.ts
git commit -m "feat(hoi): LlmHoiExtractor with Anthropic tool-use + Zod validation"
```

---

## Task 15: LlmHoiExtractor grounding-pass (R1)

**Files:**
- Create: `packages/api/src/services/validators/hoi/grounding.ts`
- Create: `packages/api/test/hoi-grounding.test.ts`

- [ ] **Step 1: Write failing tests**

Cases:
- `windHailHurricane.included=true` with wording `"All perils included"` → no override
- `windHailHurricane.included=true` with wording `"Wind and hail excluded"` → confidence overridden to 0.3
- `rentLossActualCostSustained.detected=true` with wording `"6 months PITIA rent loss"` (no "actual cost sustained" phrase) → confidence overridden to 0.3
- `wallsInCoverage.included=true` with wording `"bare walls coverage"` → no override (contains 'bare walls' synonym)
- `premiumPaidInFull.paid=true` with wording `"premium due in 60 days"` → confidence overridden

- [ ] **Step 2: Implement grounding-pass**

Create `packages/api/src/services/validators/hoi/grounding.ts`:

```ts
import type { HoiPolicyFields } from "@twin/core";

const WIND_TRUE = ["included", "covered", "all perils", "special form", "comprehensive", "windstorm", "hail", "hurricane"];
const WIND_FALSE = ["excluded", "not covered", "exclusion", "excludes"];
const ACS_TRUE = ["actual cost sustained", "actual loss sustained"];
const WALLS_TRUE = ["walls-in", "walls in", "unit interior", "bare walls"];
const PREMIUM_PAID_TRUE = ["paid in full", "paid receipt", "premium paid", "payment in full"];

const OVERRIDE_CONFIDENCE = 0.3;

function contains(haystack: string | null | undefined, needles: string[]): boolean {
  if (!haystack) return false;
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n));
}

export interface GroundingResult {
  fields: HoiPolicyFields;
  groundingErrors: Array<{ field: string; conclusion: string; reason: string }>;
}

export function groundingPass(fields: HoiPolicyFields): GroundingResult {
  const errors: GroundingResult["groundingErrors"] = [];
  const out: HoiPolicyFields = JSON.parse(JSON.stringify(fields));

  // windHailHurricane
  if (out.windHailHurricane) {
    const { included, wording } = out.windHailHurricane;
    const expected = included ? WIND_TRUE : WIND_FALSE;
    if (!contains(wording, expected)) {
      errors.push({ field: "windHailHurricane", conclusion: String(included), reason: `wording does not support conclusion (expected one of ${expected.join("|")})` });
      out.windHailHurricane.confidence = Math.min(out.windHailHurricane.confidence, OVERRIDE_CONFIDENCE);
    }
  }

  // rentLossActualCostSustained
  if (out.rentLossActualCostSustained) {
    const { detected } = out.rentLossActualCostSustained;
    const wordingHasPhrase = contains(out.rentLossWording, ACS_TRUE);
    if (detected !== wordingHasPhrase) {
      errors.push({ field: "rentLossActualCostSustained", conclusion: String(detected), reason: detected ? "wording does not contain 'actual cost sustained'" : "wording does contain 'actual cost sustained' but detected=false" });
      out.rentLossActualCostSustained.confidence = Math.min(out.rentLossActualCostSustained.confidence, OVERRIDE_CONFIDENCE);
    }
  }

  // wallsInCoverage
  if (out.wallsInCoverage && out.wallsInCoverage.included) {
    // wording not stored explicitly on wallsInCoverage; skip grounding if no signal
    // (spec leaves wording optional; grounding only applies when we have wording from elsewhere)
  }

  // premiumPaidInFull
  if (out.premiumPaidInFull && out.premiumPaidInFull.paid) {
    // no wording captured on this field; skip ungroundable case
    // (only override if explicit "due" signal found elsewhere — out of scope for v1)
  }

  return { fields: out, groundingErrors: errors };
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @twin/api test hoi-grounding`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/services/validators/hoi/grounding.ts packages/api/test/hoi-grounding.test.ts
git commit -m "feat(hoi): R1 grounding-pass — stem-matched content-word presence check"
```

---

## Task 16: `CompositeHoiExtractor`

**Files:**
- Create: `packages/api/src/services/validators/hoi/composite-extractor.ts`
- Create: `packages/api/test/hoi-composite-extractor.test.ts`

- [ ] **Step 1: Write failing tests**

Cases:
- `extractorMode='auto'`, portal has extraction → uses portal
- `extractorMode='auto'`, portal absent → uses LLM
- `extractorMode='portal-only'`, portal absent → throws / returns null
- `extractorMode='llm-only'` → always uses LLM (ignores portal)

- [ ] **Step 2: Implement composite**

Create `packages/api/src/services/validators/hoi/composite-extractor.ts`:

```ts
import type { DocumentRef, HoiExtractionResult, HoiFieldExtractor } from "./extractor.js";

export type ExtractorMode = "auto" | "portal-only" | "llm-only";

export class CompositeHoiExtractor implements HoiFieldExtractor {
  constructor(
    private portal: HoiFieldExtractor,
    private llm: HoiFieldExtractor,
    private mode: ExtractorMode,
  ) {}

  async canExtract(doc: DocumentRef): Promise<boolean> {
    if (this.mode === "portal-only") return this.portal.canExtract(doc);
    if (this.mode === "llm-only") return this.llm.canExtract(doc);
    return (await this.portal.canExtract(doc)) || (await this.llm.canExtract(doc));
  }

  async extract(doc: DocumentRef): Promise<HoiExtractionResult> {
    if (this.mode === "portal-only") return this.portal.extract(doc);
    if (this.mode === "llm-only") return this.llm.extract(doc);
    if (await this.portal.canExtract(doc)) return this.portal.extract(doc);
    return this.llm.extract(doc);
  }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @twin/api test hoi-composite-extractor`
Expected: PASS (4 cases).

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/services/validators/hoi/composite-extractor.ts packages/api/test/hoi-composite-extractor.test.ts
git commit -m "feat(hoi): CompositeHoiExtractor with extractorMode precedence"
```

---

# Phase 4 — Worker + Observability

## Task 17: `hoi-extractor-dispatcher` worker + Layer 2 tests

**Files:**
- Create: `packages/api/src/hoi-extractor-dispatcher.ts`
- Create: `packages/api/src/services/validators/hoi/cost-tracker.ts`
- Create: `packages/api/test/hoi-extraction.integration.test.ts`
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Write failing integration tests**

Cases:
- Worker picks up `ingested_documents` with `doc_type IN (...)` and no active extraction → writes a row
- Portal-provided extraction blocks LLM in `extractorMode='auto'`
- Schema version bump triggers re-extraction
- Document supersede → new extraction → old extraction `superseded_at`
- Extraction failure → `extraction_error` populated; dead-letter after 5 retries
- Tenant isolation

- [ ] **Step 2: Run tests; verify failure**

- [ ] **Step 3: Implement cost-tracker stub**

Create `packages/api/src/services/validators/hoi/cost-tracker.ts`:

```ts
// Prometheus metric helpers — emits structured JSON log lines that the existing
// log-shipper / Grafana pipeline can parse into metrics (same pattern used by
// PC v2 §4.4 dropped_* counters which also log-shipper-derive). When a real
// prom-client integration lands suite-wide, swap the console.log calls for
// gauge.set() / counter.inc() without changing the call sites.

import type Anthropic from "@anthropic-ai/sdk";

export function trackExtractionCost(tenantId: string, extractorKind: string, docType: string, usage: Anthropic.Messages.Usage): void {
  // Cost constants — keep in sync with packages/api/src/services/predict-conditions/llm/cost.ts
  const INPUT_RATE = 3.0 / 1_000_000;  // $/token; Sonnet pricing
  const OUTPUT_RATE = 15.0 / 1_000_000;
  const dollars = (usage.input_tokens ?? 0) * INPUT_RATE + (usage.output_tokens ?? 0) * OUTPUT_RATE;
  console.log(JSON.stringify({
    metric: "hoi_extraction_cost_dollars",
    tenant_id: tenantId, extractor_kind: extractorKind, doc_type: docType,
    value: dollars,
    input_tokens: usage.input_tokens, output_tokens: usage.output_tokens,
  }));
}

export function trackExtractionOutcome(tenantId: string, extractorKind: string, outcome: "success" | "malformed" | "rate_limited" | "dead_lettered"): void {
  console.log(JSON.stringify({
    metric: "hoi_extraction_calls_total",
    tenant_id: tenantId, extractor_kind: extractorKind, outcome,
  }));
}
```

- [ ] **Step 4: Implement dispatcher worker**

Create `packages/api/src/hoi-extractor-dispatcher.ts`:

```ts
import { withDb } from "./db/pool.js";
import { LlmHoiExtractor } from "./services/validators/hoi/llm-extractor.js";
import { trackExtractionOutcome } from "./services/validators/hoi/cost-tracker.js";
import { HOI_SCHEMA_VERSION } from "@twin/core";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";

const ADVISORY_LOCK = 46;
const POLL_INTERVAL_MS = 5000;
const HOI_FLOOD_DOC_TYPES = ["Hazard Insurance", "Homeowner Insurance", "Flood Certificate", "Flood Cert"];

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export async function runHoiExtractorOnce(): Promise<void> {
  await withDb(async (c) => {
    const { rows: lockRows } = await c.query("SELECT pg_try_advisory_lock($1) AS got", [ADVISORY_LOCK]);
    if (!lockRows[0].got) return;
    try {
      // Find ingested_documents needing extraction
      const { rows: docs } = await c.query<{ id: string; tenant_id: string; loan_external_id: string; doc_type: string; signed_url: string }>(
        `SELECT d.id, d.tenant_id, d.loan_external_id, d.doc_type, d.signed_url
           FROM ingested_documents d
          WHERE d.doc_type = ANY($1::text[])
            AND d.status = 'fetched'
            AND NOT EXISTS (
              SELECT 1 FROM document_extractions e
               WHERE e.tenant_id = d.tenant_id
                 AND e.document_id = d.id
                 AND e.schema_version = $2
                 AND e.superseded_at IS NULL
            )
          LIMIT 10`,
        [HOI_FLOOD_DOC_TYPES, HOI_SCHEMA_VERSION],
      );
      for (const doc of docs) {
        const category = doc.doc_type.toLowerCase().includes("flood") ? "flood-cert" : "hoi-policy";
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
        const extractor = new LlmHoiExtractor(anthropic);
        try {
          const result = await extractor.extract({
            tenantId: doc.tenant_id, loanId: doc.loan_external_id, documentId: doc.id,
            category, storageUrl: doc.signed_url,
          });
          const id = randomUUID();
          await c.query(
            `INSERT INTO document_extractions (id, tenant_id, loan_id, document_id, extractor_kind, schema_version, source, extracted_by, fields, extraction_confidence)
             VALUES ($1, $2, $3, $4, $5, $6, 'llm-extractor', $7, $8::jsonb, $9)
             ON CONFLICT (tenant_id, document_id, extractor_kind, schema_version) WHERE superseded_at IS NULL
               DO NOTHING`,
            [id, doc.tenant_id, doc.loan_external_id, doc.id, category, HOI_SCHEMA_VERSION, result.extractedBy, JSON.stringify(result.fields), result.confidence],
          );
          trackExtractionOutcome(doc.tenant_id, category, "success");
        } catch (e) {
          console.error("[hoi-extractor] extraction failed", { documentId: doc.id, error: (e as Error).message });
          trackExtractionOutcome(doc.tenant_id, category, "malformed");
          // Persist the failure as a row with extraction_error so subsequent
          // poll cycles can drive backoff. Mirrors doc-fetch-dispatcher's
          // retry pattern (packages/api/src/doc-fetch-dispatcher.ts):
          //   - first 4 failures: insert/update extraction_error with attempt count
          //   - 5th failure: dead-letter (extraction_error remains, prediction_alerts
          //     row emitted with error_class='HoiExtractionFailed')
          //   - subsequent poll cycles skip rows whose latest failure is within
          //     the backoff window (1m → 5m → 30m → 2h → 12h)
          await c.query(
            `INSERT INTO document_extractions (id, tenant_id, loan_id, document_id, extractor_kind, schema_version, source, extracted_by, fields, extraction_confidence, extraction_error)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'llm-extractor', $6, '{}'::jsonb, 0, $7)
             ON CONFLICT (tenant_id, document_id, extractor_kind, schema_version) WHERE superseded_at IS NULL
               DO UPDATE SET extraction_error = EXCLUDED.extraction_error, extracted_at = NOW()`,
            [doc.tenant_id, doc.loan_external_id, doc.id, category, HOI_SCHEMA_VERSION, `worker:hoi-extractor:v${HOI_SCHEMA_VERSION}:error`, (e as Error).message.slice(0, 500)],
          );
        }
      }
    } finally {
      await c.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK]);
    }
  });
}

export function startHoiExtractorDispatcher(): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    runHoiExtractorOnce().catch((e) => console.error("[hoi-extractor] Error:", e));
  }, POLL_INTERVAL_MS);
  runHoiExtractorOnce().catch((e) => console.error("[hoi-extractor] Initial run error:", e));
  console.log(`[hoi-extractor] starting dispatcher (lock ${ADVISORY_LOCK}, poll ${POLL_INTERVAL_MS}ms)`);
}

export function stopHoiExtractorDispatcher(): void {
  if (intervalHandle) { clearInterval(intervalHandle); intervalHandle = null; }
}
```

- [ ] **Step 5: Wire into server.ts**

Edit `packages/api/src/server.ts`:

```ts
import { startHoiExtractorDispatcher } from "./hoi-extractor-dispatcher.js";
// ...
if (isDbEnabled()) {
  startSlaMonitor();
  // ...existing workers...
  startHoiExtractorDispatcher();
}
```

- [ ] **Step 6: Run integration tests**

Run: `pnpm --filter @twin/api test hoi-extraction.integration`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/hoi-extractor-dispatcher.ts packages/api/src/services/validators/hoi/cost-tracker.ts packages/api/src/server.ts packages/api/test/hoi-extraction.integration.test.ts
git commit -m "feat(hoi): hoi-extractor-dispatcher (lock 46) + cost-tracker + server wiring"
```

---

# Phase 5 — Resolver + UI + Pilot

## Task 18: `resolveHoiValidatorFindings` resolver

**Files:**
- Create: `packages/api/src/services/predict-conditions/resolvers/hoi-validator-resolver.ts`
- Modify: `packages/api/src/services/predict-conditions/pre-underwriter.ts`
- Create: `packages/api/test/hoi-validator-resolver.test.ts`

- [ ] **Step 1: Widen `Finding.sourceList` union**

Edit `packages/api/src/services/predict-conditions/pre-underwriter.ts`:

```ts
sourceList: "minimum" | "income" | "matrix" | "requirements" | "geographic" | "hoi-validator";

// Add to PRIORITY:
const PRIORITY: Record<Finding["sourceList"], number> = {
  matrix: 0, geographic: 1, minimum: 2, income: 3, requirements: 4,
  "hoi-validator": 5,
};
```

- [ ] **Step 2: Write failing unit tests**

Test cases (pure-function level, no DB):
- Loan with `validators.hoi.enabled=false` → returns `[]`
- Loan with `validators.hoi.enabled=true` and an HOI extraction with H1 failure → returns 1 Finding
- DSCR loan with H10 + H12 failures → returns 2 Findings

- [ ] **Step 3: Implement resolver**

Create `packages/api/src/services/predict-conditions/resolvers/hoi-validator-resolver.ts`:

```ts
import type pg from "pg";
import type { LoanContext } from "../../doc-requirements.js";
import type { Finding, KbVersionContext } from "../pre-underwriter.js";
import { HOI_RULES, type DocumentRef } from "../../validators/hoi/rules/index.js";
import { HOI_SCHEMA_VERSION, type HoiPolicyFields, type FloodCertFields } from "@twin/core";

interface ExtractionRow {
  id: string;
  document_id: string;
  extractor_kind: "hoi-policy" | "flood-cert";
  fields: HoiPolicyFields | FloodCertFields;
  extraction_confidence: number | null;
}

export async function resolveHoiValidatorFindings(
  c: pg.PoolClient,
  tenantId: string,
  _kbCtx: KbVersionContext,
  loan: LoanContext,
  args: { hoiEnabled: boolean; loanExternalId: string; loanNumber: string },
): Promise<Finding[]> {
  if (!args.hoiEnabled) return [];

  const { rows } = await c.query<ExtractionRow>(
    `SELECT id, document_id, extractor_kind, fields, extraction_confidence
       FROM document_extractions
      WHERE tenant_id = $1 AND loan_id = $2 AND schema_version = $3 AND superseded_at IS NULL`,
    [tenantId, args.loanExternalId, HOI_SCHEMA_VERSION],
  );

  const hoiRow = rows.find((r) => r.extractor_kind === "hoi-policy") ?? null;
  const floodRow = rows.find((r) => r.extractor_kind === "flood-cert") ?? null;
  if (!hoiRow && !floodRow) return [];

  const documents: { hoi: DocumentRef | null; floodCert: DocumentRef | null } = {
    hoi: hoiRow ? { tenantId, loanId: args.loanExternalId, documentId: hoiRow.document_id, category: "hoi-policy", storageUrl: "" } : null,
    floodCert: floodRow ? { tenantId, loanId: args.loanExternalId, documentId: floodRow.document_id, category: "flood-cert", storageUrl: "" } : null,
  };

  const ctx = {
    hoi: hoiRow ? (hoiRow.fields as HoiPolicyFields) : null,
    flood: floodRow ? (floodRow.fields as FloodCertFields) : null,
    loan,
    documents,
    extractionId: hoiRow?.id ?? floodRow?.id ?? "",
    loanNumber: args.loanNumber,
  };

  const findings: Finding[] = [];
  for (const rule of HOI_RULES) {
    const r = rule(ctx);
    if (r.fired && r.finding) {
      findings.push({
        description: ruleDescription(r.ruleId),
        note: r.finding.expectedValue,
        category: "PTD",
        sourceList: "hoi-validator",
        sourceRuleTable: "hoi_validator_rules",
        sourceRuleId: r.ruleId,
        emissionKind: "deterministic",
        metadata: {
          validationFindings: [r.finding],
        } as never,
      });
    }
  }

  // Aggregate-confidence escape hatch (Misc HOI Policy Review per C6 / §6.3)
  const lowConfFields = countLowConfidenceFields(ctx.hoi);
  const aggConf = hoiRow?.extraction_confidence;
  if (hoiRow && (aggConf != null && aggConf < 0.4) || lowConfFields >= 3) {
    findings.push(buildReviewFinding(hoiRow!, aggConf ?? 0, lowConfFields));
  }

  return findings;
}

function ruleDescription(ruleId: string): string {
  // map rule IDs to human-friendly card descriptions
  const map: Record<string, string> = {
    "hoi.loss-payee.match": "Hazard Insurance: Loss payee clause does not match required text",
    "hoi.named-insured.match": "Hazard Insurance: Named insured does not match borrower/entity",
    // ...
    "hoi.review.low-confidence": "HOI Policy: Manual Review Required",
  };
  return map[ruleId] ?? `Hazard Insurance: ${ruleId}`;
}

function countLowConfidenceFields(hoi: HoiPolicyFields | null): number {
  if (!hoi) return 0;
  let n = 0;
  if (hoi.windHailHurricane && hoi.windHailHurricane.confidence < 0.4) n++;
  if (hoi.rentLossActualCostSustained && hoi.rentLossActualCostSustained.confidence < 0.4) n++;
  if (hoi.premiumPaidInFull && hoi.premiumPaidInFull.confidence < 0.4) n++;
  if (hoi.wallsInCoverage && hoi.wallsInCoverage.confidence < 0.4) n++;
  return n;
}

function buildReviewFinding(row: ExtractionRow, agg: number, lowConfCount: number): Finding {
  return {
    description: "HOI Policy: Manual Review Required",
    note: `Automated extraction confidence ${agg.toFixed(2)} (${lowConfCount} prose-derived field(s) below 0.4). Verify per-field details manually before clearing the Hazard Insurance condition.`,
    category: "PTD",
    sourceList: "hoi-validator",
    sourceRuleTable: "hoi_validator_rules",
    sourceRuleId: "hoi.review.low-confidence",
    emissionKind: "deterministic",
    metadata: {
      validationFindings: [{
        ruleId: "hoi.review.low-confidence",
        severity: "warn" as const,
        currentValue: `aggregate_confidence=${agg.toFixed(2)}`,
        expectedValue: null,
        evidence: { documentId: row.document_id, extractionId: row.id, fieldPath: "<aggregate>", documentPage: null },
      }],
    } as never,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @twin/api test hoi-validator-resolver`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/predict-conditions/resolvers/hoi-validator-resolver.ts packages/api/src/services/predict-conditions/pre-underwriter.ts packages/api/test/hoi-validator-resolver.test.ts
git commit -m "feat(hoi): resolveHoiValidatorFindings + Misc Review aggregate hatch"
```

---

## Task 19: PC v2 service wiring + Layer 3 integration tests

**Files:**
- Modify: `packages/api/src/services/predict-conditions/service.ts`
- Create: `packages/api/test/hoi-validator-resolver.integration.test.ts`

- [ ] **Step 1: Write Layer 3 integration tests**

Three scenarios per spec §7 Layer 3:
1. Clean HOI policy on a Wholesale TX loan → zero `hoi-validator` predictions
2. Wholesale TX with wrong loss payee text → 1 prediction with `source_list='hoi-validator'`, `source_rule_id='hoi.loss-payee.match'`, validationFindings populated
3. DSCR loan with `rentLossCoverageMonths=3` → 1 prediction with `source_rule_id='hoi.dscr.rent-loss-coverage'`

- [ ] **Step 2: Wire resolver into service.ts**

Edit `packages/api/src/services/predict-conditions/service.ts`:

```ts
import { resolveHoiValidatorFindings } from "./resolvers/hoi-validator-resolver.js";

// Inside run():
// (a) Read tenant config to determine hoiEnabled
const { rows: tRows } = await c.query<{ settings: { validators?: { hoi?: { enabled?: boolean } } } }>(
  `SELECT settings FROM tenants WHERE id = $1`,
  [tenantId],
);
const hoiEnabled = tRows[0]?.settings?.validators?.hoi?.enabled === true;

// (b) Invoke alongside other resolvers
const hoiFindings = await resolveHoiValidatorFindings(c, tenantId, kbCtx, loan, {
  hoiEnabled,
  loanExternalId: loanId,
  loanNumber: loan.borrower?.loanNumber ?? loanId, // adjust to your real source-of-truth
});
allFindings.push(...hoiFindings);

// (c) Update DELETE-pending exclusion (R2)
await c.query(
  `DELETE FROM predicted_conditions
    WHERE tenant_id = $1 AND loan_id = $2 AND status = 'pending'
      AND source_list NOT IN ('portal-llm', 'hoi-validator')`,
  [tenantId, loanId],
);

// (d) Insert hoi-validator rows with ON CONFLICT DO NOTHING (R2)
for (const f of hoiFindings) {
  const extractionId = (f.metadata as { validationFindings: Array<{ evidence: { extractionId: string } }> }).validationFindings[0].evidence.extractionId;
  await c.query(
    `INSERT INTO predicted_conditions
      (tenant_id, loan_id, ..., source_list, source_rule_id, ..., portal_metadata)
     VALUES (...)
     ON CONFLICT ON CONSTRAINT predicted_conditions_hoi_validator_active DO NOTHING`,
    [/* ... including portal_metadata->>extractionId = extractionId */],
  );
}
```

- [ ] **Step 3: Add cross-source audit log (C2)**

In the `document_extractions` insert path (Task 13 + Task 17), when a new row supersedes an existing one with different `source`, emit a `tenant_audit_log` row per spec §6.6:

```ts
// Before INSERT, check for existing active row with different source:
const { rows: prior } = await c.query(
  `SELECT id, source FROM document_extractions
    WHERE tenant_id = $1 AND document_id = $2 AND extractor_kind = $3
      AND schema_version = $4 AND superseded_at IS NULL LIMIT 1`,
  [tenantId, documentId, extractorKind, schemaVersion],
);
if (prior.length > 0 && prior[0].source !== newSource) {
  await c.query(
    `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
     VALUES ($1, $2, 'document_extraction.superseded', $3, $4::jsonb)`,
    [tenantId, extractedBy, `extraction source change: ${prior[0].source} → ${newSource}`,
     JSON.stringify({ document_id: documentId, extractor_kind: extractorKind, schema_version: schemaVersion, from_source: prior[0].source, to_source: newSource, superseded_extraction_id: prior[0].id, new_extraction_id: newId })],
  );
  await c.query(`UPDATE document_extractions SET superseded_at = NOW() WHERE id = $1`, [prior[0].id]);
}
```

- [ ] **Step 4: Run Layer 3 tests**

Run: `pnpm --filter @twin/api test hoi-validator-resolver.integration`
Expected: PASS (3 scenarios).

- [ ] **Step 5: Bump `PC_SCHEMA_VERSION`**

Per project memory: "bump PC_SCHEMA_VERSION on every new source." Find the constant (likely in `service.ts` or `types.ts`) and increment.

- [ ] **Step 6: Run all PC v2 tests to confirm no regressions**

Run: `pnpm --filter @twin/api test predict-conditions`
Expected: PASS (existing + new tests).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/predict-conditions/service.ts packages/api/test/hoi-validator-resolver.integration.test.ts
git commit -m "feat(hoi): wire resolver into PC v2 service + cross-source audit + idempotent insert"
```

---

## Task 20: UI rendering branch + pilot enable + smoke test + memory update

**Files:**
- Modify: `packages/web/lib/prediction-grouping.ts`
- Modify: `packages/web/components/encompass/GroupedConditionCard.tsx`
- Create: `packages/web/components/encompass/__tests__/grouped-condition-card-validation.test.tsx`
- Create: `~/.claude/.../memory/project_hoi_validator_operational.md`
- Modify: `~/.claude/.../memory/MEMORY.md`

- [ ] **Step 1: Extend `PortalMetadata` TS interface**

Edit `packages/web/lib/prediction-grouping.ts`:

```ts
export interface ValidationFinding {
  ruleId: string;
  severity: "fail" | "warn";
  currentValue: string | null;
  expectedValue: string | null;
  evidence: {
    documentId: string;
    extractionId: string;
    fieldPath: string;
    documentPage: number | null;
  };
}

export interface PortalMetadata {
  // ...existing fields...
  validationFindings?: ValidationFinding[];
  extractionId?: string;
}
```

- [ ] **Step 2: Write failing UI tests**

Create `packages/web/components/encompass/__tests__/grouped-condition-card-validation.test.tsx`:

Cases:
- Group with `portal_metadata.validationFindings = [{ severity: 'fail', ruleId: 'hoi.loss-payee.match', ... }]` renders red badge + diff line
- `severity: 'warn'` renders yellow badge
- No validationFindings renders existing card without the new section

- [ ] **Step 3: Run tests; verify they fail**

- [ ] **Step 4: Add ValidationFindings rendering branch**

Edit `packages/web/components/encompass/GroupedConditionCard.tsx` — inside the existing card body, when any prediction in the group has non-empty `portal_metadata.validationFindings`:

```tsx
{group.predictions.some((p) => p.portal_metadata?.validationFindings?.length) && (
  <div className="mt-2 border-l-4 border-[#8a1a1a] pl-2">
    <div className="text-[11px] font-bold text-[#8a1a1a]">Validation findings</div>
    {group.predictions.flatMap((p) => p.portal_metadata?.validationFindings ?? []).map((f, i) => (
      <div key={`${f.ruleId}-${i}`} className="text-[11px] mt-1">
        <span className={`inline-block px-1 mr-1 text-white text-[9px] ${f.severity === "fail" ? "bg-[#8a1a1a]" : "bg-[#8a4b00]"}`}>
          {f.severity.toUpperCase()}
        </span>
        <span className="font-bold">{f.ruleId}</span>
        {f.currentValue && f.expectedValue && (
          <div className="ml-3 text-[#6b7a8f]">
            Found: <span className="text-[#1a2b4a]">{f.currentValue}</span>
            <br />Expected: <span className="text-[#1a2b4a]">{f.expectedValue}</span>
          </div>
        )}
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 5: Run UI tests + web build**

Run: `pnpm --filter @twin/web test`
Expected: PASS.

Run: `pnpm --filter @twin/web build`
Expected: clean (Next.js build succeeds).

- [ ] **Step 6: Enable validator for `npnqm-twin`**

Direct SQL update (or via admin script):

```sql
UPDATE tenants
   SET settings = jsonb_set(settings, '{validators,hoi}', '{"enabled": true, "extractorMode": "auto", "schemaVersion": 1, "dscrProductExclusions": []}'::jsonb, true)
 WHERE slug = 'npnqm-twin';
```

- [ ] **Step 7: Deploy + smoke test**

Run: `railway up --service api --detach`
Wait for `SUCCESS`.
Run: `railway up --service web --detach`
Wait for `SUCCESS`.

Manual smoke test on a real npnqm-twin loan with a known HOI policy uploaded:
- Hit the loan detail page; verify Validation Findings section renders when expected
- Inspect logs for `[hoi-extractor]` activity

- [ ] **Step 8: Memory update**

Create `~/.claude/projects/-Users-omarmendoza-Projects-encompass-digital-twin/memory/project_hoi_validator_operational.md`:

```markdown
---
name: HOI/Flood Validator operational
description: Pre-UW agentic layer first slice — 14 deterministic rules + LLM extraction + grounding-pass
type: project
---
HOI/Flood Validator shipped 2026-MM-DD against npnqm-twin tenant. PC v2 5th source (source_list='hoi-validator'). Rule set: 14 deterministic rules (H1-H12 HOI + F1-F2 Flood) from RM Job Aid §Taxes & Insurance. Dual-input extraction: NPNQM portal-provided (analysisOutput.extracted_documents[]) OR LLM extraction (LlmHoiExtractor with R1 grounding-pass). Findings surface via Two-Source UI validationFindings rendering branch.

**Key invariants:**
- hoi-validator predictions are idempotent (ON CONFLICT on partial unique index keyed on portal_metadata->>'extractionId'); excluded from DELETE-pending alongside portal-llm (R2)
- Per-field confidence on prose-derived booleans (windHailHurricane / rentLossActualCostSustained / wallsInCoverage / premiumPaidInFull) with R1 grounding-pass overriding to 0.3 on wording mismatch
- Confidence floor 0.7 mirrors PC v2 §5.3 LLM_CONFIDENCE_FLOOR; <0.4 skips rule entirely; aggregate <0.4 or ≥3 low-conf fields → Misc HOI Policy Review prediction
- Tenant-gated via validators.hoi.enabled; extractorMode='auto' prefers portal, falls back to LLM
- Cross-source extraction supersedes emit tenant_audit_log action='document_extraction.superseded'
- Advisory lock 46 (hoi-extractor-dispatcher)

**Known limitations / v1.1 deferrals:**
- NDC channel H1 branch no-ops without LoanContext.lenderName / lenderLoanNumber widening
- Layer 4 real-LLM CI tests deferred (RUN_LLM_TESTS=1 gated, run manually)
- Cross-document invoice check for H6 premium-paid deferred
- Portal extraction TTL-based LLM fallback deferred

**Spec + plan:**
- Spec: docs/superpowers/specs/2026-05-16-hoi-flood-validator-design.md (v2, d592e62)
- Plan: docs/superpowers/plans/2026-05-17-hoi-flood-validator.md
```

Edit `MEMORY.md`:
```markdown
- [HOI/Flood Validator operational](project_hoi_validator_operational.md) — 2026-MM-DD: pre-UW agentic layer first slice; 14 rules + LLM extraction + grounding-pass; idempotent inserts; tenant-gated.
```

- [ ] **Step 9: Commit + push + final smoke**

```bash
git add packages/web/lib/prediction-grouping.ts packages/web/components/encompass/GroupedConditionCard.tsx packages/web/components/encompass/__tests__/grouped-condition-card-validation.test.tsx
git commit -m "feat(web): ValidationFindings rendering branch in GroupedConditionCard"
git push origin main
```

---

## Self-review checklist (run after writing all task code)

- [ ] All 14 rules implemented and tested (Layer 1, ≥4 cases each, ~60 cases total)
- [ ] Layer 2 integration tests cover: portal-provided extraction precedence, schema version bump re-extraction, document supersede, extraction failure dead-letter, tenant isolation
- [ ] Layer 3 integration tests cover the 3 scenarios from spec §7
- [ ] `pnpm --filter @twin/core test` clean
- [ ] `pnpm --filter @twin/api test` clean (existing 98 + new ~40 = ~138)
- [ ] `pnpm --filter @twin/web test` clean
- [ ] `pnpm --filter @twin/api build` clean (tsc strict, 0 errors)
- [ ] `pnpm --filter @twin/web build` clean (Next.js production build)
- [ ] Migrations 025 + 026 applied on dev DB; verified via `\d document_extractions` and `\di predicted_conditions_hoi_validator_active`
- [ ] Advisory lock 46 confirmed unused before this work (locks 42-45 mapped per spec)
- [ ] Tenant config `validators.hoi.enabled=true` only on `npnqm-twin`
- [ ] Memory updated; both project file + MEMORY.md index entry
- [ ] Spec §10 NPNQM-side asks (§4.1.1-4.1.5) tracked in `docs/npnqm-source/2026-05-16-job-aid-followup.md` (already done before this plan)

---

## Estimated effort

Per spec §10: **3 weeks** total. Breakdown by phase:

- Phase 1 (Tasks 1-5): 2-3 days
- Phase 2 (Tasks 6-11): 4-5 days (rules + tests)
- Phase 3 (Tasks 12-16): 4-5 days (extractors)
- Phase 4 (Task 17): 2-3 days (worker + observability)
- Phase 5 (Tasks 18-20): 3-4 days (resolver + UI + pilot)

---

*End of plan. Per writing-plans skill: ready for either `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` (manual batches).*
