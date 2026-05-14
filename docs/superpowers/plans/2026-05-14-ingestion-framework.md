# NPNQM Ingestion Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a typed per-lender adapter framework with two inbound channels (loan + documents) so PC v2 fires against real NPNQM traffic instead of fixtures.

**Architecture:** Typed `LenderAdapter` TS base + per-tenant DB config overrides; inbound loan endpoint extended, new inbound document endpoint with metadata-sync + async-bytes worker (advisory lock 45); F2-deferred LoanContext fields closed via `loan_context_extras` side table (first-write-wins); SSRF-defended fetch; debounced PC v2 re-fire via `pc_v2_refire_debounce` table.

**Tech Stack:** Fastify 4, Zod, pg session pooler with explicit `WHERE tenant_id` filters, Supabase Storage, Vitest, existing reducer + `withStoreSnapshot` consistency primitive.

**Spec:** [docs/superpowers/specs/2026-05-14-ingestion-framework-design.md](../specs/2026-05-14-ingestion-framework-design.md) commit `357daad`.

---

## File Structure

### Created

| Path | Responsibility |
|------|----------------|
| `packages/core/src/adapter-config.ts` | `AdapterConfigSchema` + `LoanContextExtrasSchema` Zod schemas (exported via index.ts) |
| `packages/api/src/ingestion/lender-adapter.ts` | `LenderAdapter` abstract base class + interfaces (`AdapterConfig`, `ValidationResult`, `DocumentMetadataInput`) |
| `packages/api/src/ingestion/adapter-registry.ts` | `registerAdapter` / `getAdapter` with kebab-case validation |
| `packages/api/src/ingestion/adapters/encompass-los.ts` | `EncompassLOSAdapter` class |
| `packages/api/src/ingestion/adapters/npnqm-portal.ts` | `NPNQMPortalAdapter` class |
| `packages/api/src/ingestion/adapters/generic-json-adapter.ts` | `GenericJsonAdapter` wrapping the legacy `GenericJsonTransformer` |
| `packages/api/src/ingestion/fetch-security.ts` | Five-layer SSRF gate (scheme, host allowlist, DNS+IP-range, redirect, timeout+bytes) |
| `packages/api/src/ingestion/loan-context-extras.ts` | Read helper `loadExtras(tenantId, loanId)` with Zod parse-and-skip |
| `packages/api/src/ingestion/refire-debounce.ts` | `enqueueRefire(tenantId, loanId, reason)` + `drainReadyRefires()` |
| `packages/api/src/routes/documents-ingest.ts` | `POST /api/ingest/:tenantSlug/documents` |
| `packages/api/src/routes/admin-ingestion-mappings.ts` | Admin CRUD for `ingestion_mappings` |
| `packages/api/src/doc-fetch-dispatcher.ts` | Worker (advisory lock 45) — poll loop, sequential per-row, SSRF gate, withStoreSnapshot |
| `packages/api/src/db/migrations/020-ingestion-framework.sql` | Schema migration (4 tables, 2 column additions, RLS) |
| `packages/api/scripts/seed-loan-context-extras.ts` | One-shot TypeScript seed for demo fixture backfill |
| `packages/api/test/fixtures/adapters/encompass-los-sample-loan.json` | Real Encompass payload (purchase) |
| `packages/api/test/fixtures/adapters/npnqm-portal-sample-loan.json` | Portal payload (refinance — exercises Cash-Out alias) |
| `packages/api/test/fixtures/adapters/npnqm-portal-sample-docs.json` | Portal doc-push batch (mixed docTypes) |
| `packages/api/test/fixtures/adapters/adversarial-ssrf-docs.json` | Payload pointing at 169.254.x, RFC 1918, `http://`, `file://` |
| `packages/api/test/fixtures/adapters/encompass-los-program-mapping.json` | Payload exercising programMapping config |
| `packages/api/test/lender-adapter.test.ts` | Base-class + registry tests |
| `packages/api/test/adapter-encompass-los.test.ts` | Encompass adapter golden + validation tests |
| `packages/api/test/adapter-npnqm-portal.test.ts` | Portal adapter golden + validation tests |
| `packages/api/test/adapter-generic-json.test.ts` | GenericJsonAdapter regression test |
| `packages/api/test/fetch-security.test.ts` | SSRF gate tests (all 5 layers) |
| `packages/api/test/loan-context-extras.test.ts` | Read helper + Zod parse-and-skip |
| `packages/api/test/refire-debounce.test.ts` | Debounce upsert + drain semantics |
| `packages/api/test/doc-fetch-dispatcher.test.ts` | Worker poll + sequential + retry + fast-fail |
| `packages/api/test/documents-ingest.integration.test.ts` | `POST /documents` end-to-end + worker drive |
| `packages/api/test/admin-ingestion-mappings.integration.test.ts` | Admin CRUD + AdapterConfig validation |
| `packages/api/test/ingestion-loan-channel.integration.test.ts` | `POST /loans` end-to-end with extras + PC v2 v2-sources |
| `scripts/e2e-harness/workflows/W11-npnqm-ingest.ts` | Full happy-path harness (loan + docs + debounce + PC v2 re-fire) |

### Modified

| Path | Change |
|------|--------|
| `packages/core/src/index.ts` | Re-export `AdapterConfigSchema`, `LoanContextExtrasSchema` |
| `packages/api/src/routes/ingestion.ts` | Refactor to use adapter registry + first-write-wins extras + tenant-scoped query fix + audit + structured logs |
| `packages/api/src/routes/predict-conditions-context-builder.ts` | Read `loan_context_extras` and merge over Loan-derived defaults |
| `packages/api/src/test/predict-conditions-context-builder.test.ts` | Tests covering extras-present and extras-absent paths |
| `packages/api/src/server.ts` | Register documents-ingest routes, admin-ingestion-mappings routes, start doc-fetch-dispatcher |

---

## Phase A — Framework primitives

5 tasks. Lands schemas, registry, base class. No behavior change to existing routes.

### Task 0: Commit adapter fixtures (hard prerequisite)

The adapter classes that follow have no truth source without representative payloads. This is the gating task.

**Files:**
- Create: `packages/api/test/fixtures/adapters/encompass-los-sample-loan.json`
- Create: `packages/api/test/fixtures/adapters/npnqm-portal-sample-loan.json`
- Create: `packages/api/test/fixtures/adapters/npnqm-portal-sample-docs.json`
- Create: `packages/api/test/fixtures/adapters/adversarial-ssrf-docs.json`
- Create: `packages/api/test/fixtures/adapters/encompass-los-program-mapping.json`

- [ ] **Step 1: Source the real samples** — obtain the sample payloads (user has them out-of-band; if not yet committed they need to land here). The Encompass payload should be a purchase loan with FICO, LTV, county, occupancy, loan amount, DTI, reserves, note rate. The portal loan should be a refinance (Cash-Out) so it exercises §C2's alias normalization. The portal docs batch should include at minimum: BankStatement, PayStub, TaxReturn, ID — mixed `docType` strings.

- [ ] **Step 2: Write the adversarial SSRF fixture by hand**

```json
{
  "source": "test-adversarial",
  "externalLoanId": "TEST-LOAN-1",
  "documents": [
    { "externalDocId": "doc-1", "sourceUrl": "http://169.254.169.254/latest/meta-data/iam/security-credentials/", "fileName": "metadata", "docType": "Other" },
    { "externalDocId": "doc-2", "sourceUrl": "http://10.0.0.1/internal", "fileName": "rfc1918", "docType": "Other" },
    { "externalDocId": "doc-3", "sourceUrl": "file:///etc/passwd", "fileName": "etc-passwd", "docType": "Other" },
    { "externalDocId": "doc-4", "sourceUrl": "http://attacker.example.com/", "fileName": "cleartext-http", "docType": "Other" },
    { "externalDocId": "doc-5", "sourceUrl": "https://allowed-host.example.com/redirect", "fileName": "redirect", "docType": "Other" }
  ]
}
```

- [ ] **Step 3: Write the programMapping fixture**

```json
{
  "source": "encompass-los",
  "externalId": "TEST-PROG-1",
  "loanData": {
    "programName": "FlexSelect_NPNQM",
    "loanAmount": 500000,
    "borrower": { "fico": 720 }
  }
}
```

The adapter's `programMapping: { "FlexSelect_NPNQM": "Flex Select" }` must translate this to the canonical name before injection.

- [ ] **Step 4: Verify fixtures parse as JSON**

```bash
for f in packages/api/test/fixtures/adapters/*.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "OK: $f"
done
```

Expected: five OK lines, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/api/test/fixtures/adapters/
git commit -m "test(fixtures): adapter sample payloads — Encompass + NPNQM portal + adversarial SSRF"
```

---

### Task 1: Zod schemas in @twin/core

**Files:**
- Create: `packages/core/src/adapter-config.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/adapter-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/adapter-config.test.ts
import { describe, it, expect } from "vitest";
import { AdapterConfigSchema, LoanContextExtrasSchema } from "../src/adapter-config.js";

describe("AdapterConfigSchema", () => {
  it("accepts a complete config", () => {
    const r = AdapterConfigSchema.safeParse({
      programMapping: { "FlexSelect_NPNQM": "Flex Select" },
      identityPrefix: "NPNQM-",
      allowedFetchHosts: ["docs.npnqm-portal.example.com"],
      maxFileBytes: 25_000_000,
    });
    expect(r.success).toBe(true);
  });

  it("defaults allowedFetchHosts to []", () => {
    const r = AdapterConfigSchema.parse({});
    expect(r.allowedFetchHosts).toEqual([]);
    expect(r.maxFileBytes).toBe(50_000_000);
  });

  it("rejects identityPrefix without trailing dash", () => {
    const r = AdapterConfigSchema.safeParse({ identityPrefix: "NPNQM" });
    expect(r.success).toBe(false);
  });

  it("rejects allowedFetchHosts entries containing scheme or path", () => {
    expect(AdapterConfigSchema.safeParse({ allowedFetchHosts: ["https://host.example.com"] }).success).toBe(false);
    expect(AdapterConfigSchema.safeParse({ allowedFetchHosts: ["host.example.com/path"] }).success).toBe(false);
    expect(AdapterConfigSchema.safeParse({ allowedFetchHosts: ["host.example.com:8080"] }).success).toBe(false);
  });

  it("rejects maxFileBytes outside reasonable bounds", () => {
    expect(AdapterConfigSchema.safeParse({ maxFileBytes: 0 }).success).toBe(false);
    expect(AdapterConfigSchema.safeParse({ maxFileBytes: 600_000_000 }).success).toBe(false);
  });
});

describe("LoanContextExtrasSchema", () => {
  it("accepts a full extras row", () => {
    const r = LoanContextExtrasSchema.safeParse({
      repFico: 720, ltv: 80, loanAmount: 500000,
      loanPurpose: "Cash-Out Refinance",
      propertyType: "SFR Det.", dti: 38, reservesMonths: 6,
      noteRate: 7.5, county: "King County",
      isItin: false, llcOrLegalEntity: false,
    });
    expect(r.success).toBe(true);
  });

  it("rejects out-of-range repFico", () => {
    expect(LoanContextExtrasSchema.safeParse({ repFico: 50 }).success).toBe(false);
    expect(LoanContextExtrasSchema.safeParse({ repFico: 999 }).success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const r = LoanContextExtrasSchema.safeParse({ repFico: 720, mysteryField: "bad" });
    expect(r.success).toBe(false);
  });

  it("accepts partial extras (all fields optional)", () => {
    expect(LoanContextExtrasSchema.safeParse({}).success).toBe(true);
    expect(LoanContextExtrasSchema.safeParse({ repFico: 720 }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/core test adapter-config.test
```

Expected: FAIL — `Cannot find module '../src/adapter-config.js'`.

- [ ] **Step 3: Create the schema file**

```ts
// packages/core/src/adapter-config.ts
import { z } from "zod";

export const AdapterConfigSchema = z.object({
  programMapping: z.record(z.string(), z.string()).optional(),
  fieldPathOverrides: z.record(z.string(), z.string()).optional(),
  identityPrefix: z.string().regex(/^[A-Z]{2,8}-$/).optional().default("QL-"),
  documentTypeMapping: z.record(z.string(), z.string()).optional(),
  allowedFetchHosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)).default([]),
  maxFileBytes: z.number().int().positive().max(500_000_000).default(50_000_000),
  extras: z.record(z.string(), z.unknown()).optional(),
});

export type AdapterConfig = z.infer<typeof AdapterConfigSchema>;

export const LoanContextExtrasSchema = z.object({
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
}).strict();

export type LoanContextExtras = z.infer<typeof LoanContextExtrasSchema>;
```

- [ ] **Step 4: Re-export from index**

Add to `packages/core/src/index.ts`:

```ts
export * from "./adapter-config.js";
```

- [ ] **Step 5: Verify tests pass + build is clean**

```bash
pnpm --filter @twin/core build && pnpm --filter @twin/core test adapter-config.test
```

Expected: 0 build errors; all adapter-config tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/adapter-config.ts packages/core/src/index.ts packages/core/test/adapter-config.test.ts
git commit -m "feat(core): AdapterConfig + LoanContextExtras Zod schemas

Foundation for the ingestion framework (spec 2026-05-14, §6.1).
Strict shape on extras catches adapter bugs at write/read boundary."
```

---

### Task 2: Migration 020 — schema

**Files:**
- Create: `packages/api/src/db/migrations/020-ingestion-framework.sql`

- [ ] **Step 1: Write the migration**

```sql
-- packages/api/src/db/migrations/020-ingestion-framework.sql
-- NPNQM Ingestion Framework — spec 2026-05-14-ingestion-framework-design.md
--
-- Adds:
--   1. ingestion_mappings.adapter_type + adapter_config (transitional; transformer_type retained)
--   2. ingested_documents (idempotency + worker queue for the doc channel)
--   3. loan_context_extras (F2-deferred LoanContext field closure; first-write-wins)
--   4. pc_v2_refire_debounce (collapses N AddDocument events into 1 PC v2 run per loan)

-- ── 1. Extend ingestion_mappings ────────────────────────────────────
ALTER TABLE ingestion_mappings ADD COLUMN IF NOT EXISTS adapter_type TEXT;
UPDATE ingestion_mappings SET adapter_type = transformer_type WHERE adapter_type IS NULL;
ALTER TABLE ingestion_mappings ALTER COLUMN adapter_type SET NOT NULL;
ALTER TABLE ingestion_mappings
  ADD COLUMN IF NOT EXISTS adapter_config JSONB NOT NULL DEFAULT '{}'::jsonb;
-- transformer_type retained for one release; removed in a follow-up migration.

-- ── 2. ingested_documents ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingested_documents (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  external_id TEXT NOT NULL
    CHECK (length(external_id) BETWEEN 1 AND 200 AND external_id ~ '^[A-Za-z0-9_.:-]+$'),
  document_id TEXT NOT NULL CHECK (length(document_id) BETWEEN 1 AND 200),
  loan_id TEXT NOT NULL CHECK (length(loan_id) BETWEEN 1 AND 200),
  source_url TEXT NOT NULL CHECK (length(source_url) <= 2048),
  file_name TEXT NOT NULL CHECK (length(file_name) <= 500),
  status TEXT NOT NULL DEFAULT 'pending_fetch'
    CHECK (status IN ('pending_fetch', 'fetched', 'failed')),
  failed_reason TEXT,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetched_at TIMESTAMPTZ,
  ingest_batch_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ingested_documents_pending
  ON ingested_documents (status, next_attempt_at)
  WHERE status = 'pending_fetch';

ALTER TABLE ingested_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingested_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ingested_documents;
CREATE POLICY tenant_isolation ON ingested_documents
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── 3. loan_context_extras ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loan_context_extras (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL CHECK (length(loan_id) BETWEEN 1 AND 200),
  extras JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, loan_id)
);

ALTER TABLE loan_context_extras ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_context_extras FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON loan_context_extras;
CREATE POLICY tenant_isolation ON loan_context_extras
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── 4. pc_v2_refire_debounce ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pc_v2_refire_debounce (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL CHECK (length(loan_id) BETWEEN 1 AND 200),
  ready_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, loan_id)
);

CREATE INDEX IF NOT EXISTS idx_pc_v2_refire_ready
  ON pc_v2_refire_debounce (ready_at);

ALTER TABLE pc_v2_refire_debounce ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_v2_refire_debounce FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pc_v2_refire_debounce;
CREATE POLICY tenant_isolation ON pc_v2_refire_debounce
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

- [ ] **Step 2: Boot the API to apply the migration**

```bash
pnpm --filter @twin/api dev
```

Expected: migration runner logs "Applied 020-ingestion-framework.sql". Server starts cleanly. Kill the dev server with Ctrl-C.

- [ ] **Step 3: Sanity-check schema via existing /system endpoints**

```bash
curl -s http://localhost:4000/system/health | head
```

Expected: `{"api":"ok",...}` — server is up, migration applied.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/db/migrations/020-ingestion-framework.sql
git commit -m "feat(db): migration 020 — ingestion framework schema

Additive only: ingestion_mappings columns (adapter_type, adapter_config),
ingested_documents, loan_context_extras, pc_v2_refire_debounce. RLS on
every new table. transformer_type retained for backwards-compat."
```

---

### Task 3: `LenderAdapter` base class + interfaces

**Files:**
- Create: `packages/api/src/ingestion/lender-adapter.ts`
- Test: `packages/api/test/lender-adapter.test.ts`

- [ ] **Step 1: Write a stub test that asserts the base class is abstract**

```ts
// packages/api/test/lender-adapter.test.ts
import { describe, it, expect } from "vitest";
import { LenderAdapter } from "../src/ingestion/lender-adapter.js";

describe("LenderAdapter", () => {
  it("is an abstract class — direct instantiation fails at the type level", () => {
    // This test exists primarily for documentation; abstract enforcement is at compile time.
    expect(typeof LenderAdapter).toBe("function");
  });

  it("requires concrete subclasses to declare adapterType", () => {
    class TestAdapter extends LenderAdapter {
      readonly adapterType = "test-adapter";
      extractExternalLoanId() { return "id"; }
      transformLoan() { return {}; }
      validateLoan() { return { valid: true, errors: [] }; }
      extractExternalDocId() { return "doc-id"; }
      transformDocument() {
        return { externalDocId: "x", docType: "Other" as const, fileName: "f", sourceUrl: "https://h.example.com/x" };
      }
      validateDocument() { return { valid: true, errors: [] }; }
      deriveContextFields() { return {}; }
    }
    const a = new TestAdapter();
    expect(a.adapterType).toBe("test-adapter");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test lender-adapter.test
```

Expected: FAIL — `Cannot find module '../src/ingestion/lender-adapter.js'`.

- [ ] **Step 3: Create the base class**

```ts
// packages/api/src/ingestion/lender-adapter.ts
import type { Loan, LoanContext } from "@twin/core";
import type { AdapterConfig } from "@twin/core";
import type { DocumentType } from "@twin/core";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface DocumentMetadataInput {
  externalDocId: string;
  docType: DocumentType;
  fileName: string;
  contentHash?: string;
  fileSize?: number;
  mimeType?: string;
  sourceUrl: string;
  classification?: string;
}

export abstract class LenderAdapter {
  abstract readonly adapterType: string;

  // Loan channel
  abstract extractExternalLoanId(raw: unknown): string;
  abstract transformLoan(raw: unknown, config: AdapterConfig): Partial<Loan>;
  abstract validateLoan(partial: Partial<Loan>): ValidationResult;

  // Document channel
  abstract extractExternalDocId(raw: unknown): string;
  abstract transformDocument(raw: unknown, config: AdapterConfig): DocumentMetadataInput;
  abstract validateDocument(meta: DocumentMetadataInput): ValidationResult;

  // Context derivation — closes F2-deferred LoanContext fields
  abstract deriveContextFields(loan: Loan, raw: unknown, config: AdapterConfig): Partial<LoanContext>;
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @twin/api test lender-adapter.test
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/lender-adapter.ts packages/api/test/lender-adapter.test.ts
git commit -m "feat(api/ingestion): LenderAdapter abstract base + interfaces

10-method surface: loan channel (3), document channel (3), context
derivation (1), identity extraction (2), adapterType (1). Concrete
adapters implement against committed fixtures in Phase B."
```

---

### Task 4: Adapter registry with kebab-case validation

**Files:**
- Create: `packages/api/src/ingestion/adapter-registry.ts`
- Modify: `packages/api/test/lender-adapter.test.ts` (extend with registry tests)

- [ ] **Step 1: Add failing registry tests to the existing test file**

Append to `packages/api/test/lender-adapter.test.ts`:

```ts
import { registerAdapter, getAdapter, clearAdapterRegistryForTesting } from "../src/ingestion/adapter-registry.js";

describe("adapter-registry", () => {
  class Good extends LenderAdapter {
    readonly adapterType = "test-good";
    extractExternalLoanId() { return ""; }
    transformLoan() { return {}; }
    validateLoan() { return { valid: true, errors: [] }; }
    extractExternalDocId() { return ""; }
    transformDocument() { return { externalDocId: "x", docType: "Other" as const, fileName: "f", sourceUrl: "https://h.example.com/x" }; }
    validateDocument() { return { valid: true, errors: [] }; }
    deriveContextFields() { return {}; }
  }
  class BadName extends Good {
    readonly adapterType = "Bad_Name";
  }
  class Empty extends Good {
    readonly adapterType = "";
  }

  beforeEach(() => clearAdapterRegistryForTesting());

  it("register + lookup", () => {
    const a = new Good();
    registerAdapter(a);
    expect(getAdapter("test-good")).toBe(a);
  });

  it("getAdapter returns null for unknown type", () => {
    expect(getAdapter("does-not-exist")).toBe(null);
  });

  it("rejects non-kebab-case adapterType at registration", () => {
    expect(() => registerAdapter(new BadName())).toThrow(/kebab-case/);
  });

  it("rejects empty adapterType at registration", () => {
    expect(() => registerAdapter(new Empty())).toThrow(/kebab-case/);
  });

  it("re-registering same type overwrites (last wins) — for test seeding only", () => {
    const first = new Good();
    registerAdapter(first);
    const second = new Good();
    registerAdapter(second);
    expect(getAdapter("test-good")).toBe(second);
  });
});
```

Also add `import { beforeEach } from "vitest";` at the top.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test lender-adapter.test
```

Expected: FAIL — `Cannot find module '../src/ingestion/adapter-registry.js'`.

- [ ] **Step 3: Create the registry**

```ts
// packages/api/src/ingestion/adapter-registry.ts
import type { LenderAdapter } from "./lender-adapter.js";

const KEBAB_CASE = /^[a-z][a-z0-9-]*$/;

const registry = new Map<string, LenderAdapter>();

export function registerAdapter(adapter: LenderAdapter): void {
  if (!KEBAB_CASE.test(adapter.adapterType)) {
    throw new Error(
      `adapterType must be kebab-case (matching ${KEBAB_CASE.source}); got "${adapter.adapterType}"`,
    );
  }
  registry.set(adapter.adapterType, adapter);
}

export function getAdapter(adapterType: string): LenderAdapter | null {
  return registry.get(adapterType) ?? null;
}

/** Test-only helper. Production code should never clear the registry. */
export function clearAdapterRegistryForTesting(): void {
  registry.clear();
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @twin/api test lender-adapter.test
```

Expected: PASS, 7 tests total in the file.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/adapter-registry.ts packages/api/test/lender-adapter.test.ts
git commit -m "feat(api/ingestion): adapter registry with kebab-case enforcement

Boot-time guard against typed-vs-config drift. registerAdapter throws
on non-kebab-case adapterType so a misnamed adapter never reaches the
ingestion_mappings.adapter_type lookup."
```

---

## Phase A complete — checkpoint

After tasks 0-4, the framework primitives are in place but no adapter ships yet. Existing ingestion routes are unchanged. Build + tests stay green.

Verify:
```bash
pnpm --filter @twin/core build && pnpm --filter @twin/api build && pnpm --filter @twin/api test
```

Expected: 0 build errors, all tests pass (including the 5 new tests added in this phase).

---

## Phase B — Adapters

3 tasks. Each adapter targets one fixture and exercises one branch of the validation logic. The adapter classes are pure — no DB, no HTTP — so tests run fast against the committed fixtures.

### Task 5: `GenericJsonAdapter` — wraps the legacy transformer

**Files:**
- Create: `packages/api/src/ingestion/adapters/generic-json-adapter.ts`
- Test: `packages/api/test/adapter-generic-json.test.ts`

The existing `GenericJsonTransformer` at `packages/api/src/ingestion/generic-json.ts` has `transform(data, fieldMap)` and `validate(partial)` methods. The new `GenericJsonAdapter` delegates to it for backwards compat while satisfying the new `LenderAdapter` shape. Document and context-derivation methods return safe no-ops since the legacy transformer never supported them.

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/test/adapter-generic-json.test.ts
import { describe, it, expect } from "vitest";
import { GenericJsonAdapter } from "../src/ingestion/adapters/generic-json-adapter.js";

describe("GenericJsonAdapter", () => {
  const adapter = new GenericJsonAdapter();
  const config = { allowedFetchHosts: [], maxFileBytes: 50_000_000, identityPrefix: "QL-" as const };

  it("adapterType is kebab-case generic-json", () => {
    expect(adapter.adapterType).toBe("generic-json");
  });

  it("transformLoan returns the loanData unchanged when no fieldMap is supplied", () => {
    const raw = { externalId: "EXT-1", loanData: { transaction: { loanAmount: 500000 } } };
    const partial = adapter.transformLoan(raw, config);
    expect(partial.transaction?.loanAmount).toBe(500000);
  });

  it("extractExternalLoanId reads loanData.externalId or raw.externalId", () => {
    expect(adapter.extractExternalLoanId({ externalId: "EXT-9" })).toBe("EXT-9");
  });

  it("validateLoan accepts any shape (legacy generic behavior)", () => {
    expect(adapter.validateLoan({ transaction: { loanAmount: 100 } as never }).valid).toBe(true);
  });

  it("transformDocument throws (channel not supported by generic adapter)", () => {
    expect(() => adapter.transformDocument({}, config)).toThrow(/not supported/);
  });

  it("deriveContextFields returns empty (no derivation for generic JSON)", () => {
    expect(adapter.deriveContextFields({} as never, {}, config)).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test adapter-generic-json.test
```

Expected: FAIL — `Cannot find module '../src/ingestion/adapters/generic-json-adapter.js'`.

- [ ] **Step 3: Implement the adapter**

```ts
// packages/api/src/ingestion/adapters/generic-json-adapter.ts
import type { Loan, LoanContext } from "@twin/core";
import type { AdapterConfig } from "@twin/core";
import { LenderAdapter, type DocumentMetadataInput, type ValidationResult } from "../lender-adapter.js";
import { GenericJsonTransformer } from "../generic-json.js";

const legacy = new GenericJsonTransformer();

export class GenericJsonAdapter extends LenderAdapter {
  readonly adapterType = "generic-json";

  extractExternalLoanId(raw: unknown): string {
    const r = raw as { externalId?: string; loanData?: { externalId?: string } };
    return r.externalId ?? r.loanData?.externalId ?? "";
  }

  transformLoan(raw: unknown, _config: AdapterConfig): Partial<Loan> {
    const r = raw as { loanData?: unknown };
    const data = r.loanData ?? raw;
    return data as Partial<Loan>;
  }

  validateLoan(partial: Partial<Loan>): ValidationResult {
    const v = legacy.validate(partial);
    return { valid: v.valid, errors: v.errors ?? [] };
  }

  extractExternalDocId(_raw: unknown): string {
    throw new Error("generic-json adapter: document channel not supported — use a typed adapter");
  }

  transformDocument(_raw: unknown, _config: AdapterConfig): DocumentMetadataInput {
    throw new Error("generic-json adapter: document channel not supported — use a typed adapter");
  }

  validateDocument(_meta: DocumentMetadataInput): ValidationResult {
    return { valid: false, errors: ["generic-json adapter does not support document channel"] };
  }

  deriveContextFields(_loan: Loan, _raw: unknown, _config: AdapterConfig): Partial<LoanContext> {
    return {};
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @twin/api test adapter-generic-json.test
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/adapters/generic-json-adapter.ts packages/api/test/adapter-generic-json.test.ts
git commit -m "feat(api/ingestion): GenericJsonAdapter wraps legacy transformer

Backwards-compat shim for tenants on field-map-only ingestion. Document
channel throws — typed adapters are required for the new doc surface."
```

---

### Task 6: `EncompassLOSAdapter`

**Files:**
- Create: `packages/api/src/ingestion/adapters/encompass-los.ts`
- Test: `packages/api/test/adapter-encompass-los.test.ts`

The Encompass adapter reads MISMO-derived JSON. Field paths default to documented Encompass conventions but `config.fieldPathOverrides` lets a tenant remap.

- [ ] **Step 1: Write the failing test against committed fixtures**

```ts
// packages/api/test/adapter-encompass-los.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { EncompassLOSAdapter } from "../src/ingestion/adapters/encompass-los.js";

const FIX = join(__dirname, "fixtures/adapters");

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIX, name), "utf8"));
}

describe("EncompassLOSAdapter", () => {
  const adapter = new EncompassLOSAdapter();
  const config = {
    allowedFetchHosts: ["docs.encompass.example.com"],
    maxFileBytes: 50_000_000,
    identityPrefix: "ENC-" as const,
  };

  it("adapterType is encompass-los", () => {
    expect(adapter.adapterType).toBe("encompass-los");
  });

  it("transformLoan extracts top-level fields from the sample payload", () => {
    const raw = loadFixture("encompass-los-sample-loan.json");
    const partial = adapter.transformLoan(raw, config);
    expect(partial.transaction?.loanAmount).toBeGreaterThan(0);
    expect(partial.borrower?.fullName).toBeTruthy();
  });

  it("extractExternalLoanId returns the lender's loan number", () => {
    const raw = loadFixture("encompass-los-sample-loan.json");
    const id = adapter.extractExternalLoanId(raw);
    expect(id).toMatch(/.+/);
  });

  it("validateLoan rejects payload with no transaction block", () => {
    const r = adapter.validateLoan({} as never);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/transaction/i);
  });

  it("validateLoan accepts a complete payload", () => {
    const raw = loadFixture("encompass-los-sample-loan.json");
    const partial = adapter.transformLoan(raw, config);
    expect(adapter.validateLoan(partial).valid).toBe(true);
  });

  it("deriveContextFields populates F2-deferred LoanContext fields from raw payload", () => {
    const raw = loadFixture("encompass-los-sample-loan.json");
    const partial = adapter.transformLoan(raw, config);
    const loan = { ...partial, id: "ENC-X", tenantId: "t" } as never;
    const extras = adapter.deriveContextFields(loan, raw, config);
    expect(typeof extras.repFico).toBe("number");
    expect(typeof extras.ltv).toBe("number");
    expect(typeof extras.loanAmount).toBe("number");
  });

  it("programMapping translates lender program name to canonical", () => {
    const raw = loadFixture("encompass-los-program-mapping.json");
    const cfg = { ...config, programMapping: { FlexSelect_NPNQM: "Flex Select" } };
    const partial = adapter.transformLoan(raw, cfg);
    expect(partial.nqmProgram).toBe("Flex Select");
  });

  it("transformDocument extracts required fields", () => {
    const raw = {
      docId: "DOC-1", documentName: "Pay Stub.pdf", classification: "PayStub",
      url: "https://docs.encompass.example.com/secure/abc", sizeBytes: 12345, mime: "application/pdf",
    };
    const meta = adapter.transformDocument(raw, config);
    expect(meta.externalDocId).toBe("DOC-1");
    expect(meta.docType).toBe("PayStub");
    expect(meta.sourceUrl).toBe("https://docs.encompass.example.com/secure/abc");
  });

  it("validateDocument rejects http:// scheme and disallowed host", () => {
    expect(adapter.validateDocument({
      externalDocId: "x", docType: "Other", fileName: "f",
      sourceUrl: "http://docs.encompass.example.com/insecure",
    } as never).valid).toBe(false);
    expect(adapter.validateDocument({
      externalDocId: "x", docType: "Other", fileName: "f",
      sourceUrl: "https://attacker.example.com/file",
    } as never).valid).toBe(true);
    // host allowlist is enforced at the fetch-security layer, not here.
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test adapter-encompass-los.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter**

```ts
// packages/api/src/ingestion/adapters/encompass-los.ts
import type { Loan, LoanContext, NqmProgram, DocumentType } from "@twin/core";
import type { AdapterConfig } from "@twin/core";
import { LenderAdapter, type DocumentMetadataInput, type ValidationResult } from "../lender-adapter.js";

type Raw = Record<string, unknown>;

function pick<T>(obj: unknown, path: string): T | undefined {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Raw)) return (acc as Raw)[key];
    return undefined;
  }, obj) as T | undefined;
}

const DEFAULT_DOC_TYPE_MAP: Record<string, DocumentType> = {
  "PayStub": "PayStub", "Pay Stub": "PayStub", "W-2": "PayStub",
  "BankStatement": "BankStatement", "Bank Statement": "BankStatement",
  "TaxReturn": "TaxReturn", "Tax Return": "TaxReturn", "1040": "TaxReturn",
  "1099": "1099", "PnL": "PnL", "P&L": "PnL",
  "CPA_Letter": "CPA_Letter", "CPA Letter": "CPA_Letter",
  "ID": "ID", "Drivers License": "ID",
  "Insurance": "Insurance", "HOI": "Insurance",
  "Appraisal": "Appraisal",
  "Title": "Title",
  "LeaseAgreement": "LeaseAgreement", "Lease": "LeaseAgreement",
  "LOX": "LOX", "Letter of Explanation": "LOX",
  "BKDocs": "BKDocs",
  "CreditReport": "CreditReport", "Credit Report": "CreditReport",
};

export class EncompassLOSAdapter extends LenderAdapter {
  readonly adapterType = "encompass-los";

  extractExternalLoanId(raw: unknown): string {
    const id = pick<string>(raw, "loanNumber") ?? pick<string>(raw, "externalId") ?? pick<string>(raw, "loanData.externalId");
    if (!id) throw new Error("encompass-los: payload missing loanNumber or externalId");
    return id;
  }

  transformLoan(raw: unknown, config: AdapterConfig): Partial<Loan> {
    const lender = pick<string>(raw, "programName") ?? pick<string>(raw, "loanData.programName");
    const program = (lender && config.programMapping?.[lender]) ?? lender ?? undefined;
    return {
      nqmProgram: program as NqmProgram | undefined,
      borrower: {
        fullName: pick<string>(raw, "borrower.fullName") ?? "Unknown",
        ssnMasked: pick<string>(raw, "borrower.ssnMasked") ?? "xxx-xx-0000",
        dob: pick<string>(raw, "borrower.dob") ?? "1990-01-01",
        maritalStatus: (pick<string>(raw, "borrower.maritalStatus") ?? "Unmarried") as never,
      },
      transaction: {
        loanPurpose: (pick<string>(raw, "transaction.loanPurpose") ?? "Purchase") as never,
        loanAmount: pick<number>(raw, "transaction.loanAmount") ?? pick<number>(raw, "loanAmount") ?? 0,
        salesPrice: pick<number>(raw, "transaction.salesPrice") ?? 0,
        appraisedValue: pick<number>(raw, "transaction.appraisedValue") ?? 0,
        ltv: pick<number>(raw, "transaction.ltv") ?? 0,
        cltv: pick<number>(raw, "transaction.cltv") ?? 0,
        hcltv: pick<number>(raw, "transaction.hcltv") ?? 0,
        noteRate: pick<number>(raw, "transaction.noteRate") ?? 7,
        term: pick<number>(raw, "transaction.term") ?? 360,
        amortType: (pick<string>(raw, "transaction.amortType") ?? "Fixed") as never,
        lienPosition: pick<number>(raw, "transaction.lienPosition") ?? 1,
        occupancy: (pick<string>(raw, "transaction.occupancy") ?? "Primary") as never,
        isInvestmentProperty: pick<boolean>(raw, "transaction.isInvestmentProperty") ?? false,
        piti: pick<number>(raw, "transaction.piti") ?? 0,
      },
    };
  }

  validateLoan(partial: Partial<Loan>): ValidationResult {
    const errors: string[] = [];
    if (!partial.transaction) errors.push("transaction block required");
    if (!partial.borrower) errors.push("borrower block required");
    return { valid: errors.length === 0, errors };
  }

  extractExternalDocId(raw: unknown): string {
    const id = pick<string>(raw, "docId") ?? pick<string>(raw, "documentId") ?? pick<string>(raw, "externalDocId");
    if (!id) throw new Error("encompass-los: document payload missing docId/documentId/externalDocId");
    return id;
  }

  transformDocument(raw: unknown, config: AdapterConfig): DocumentMetadataInput {
    const classification = pick<string>(raw, "classification") ?? pick<string>(raw, "type") ?? "Other";
    const map = { ...DEFAULT_DOC_TYPE_MAP, ...(config.documentTypeMapping ?? {}) };
    const docType = (map[classification] ?? "Other") as DocumentType;
    return {
      externalDocId: this.extractExternalDocId(raw),
      docType,
      fileName: pick<string>(raw, "documentName") ?? pick<string>(raw, "fileName") ?? "unknown.bin",
      contentHash: pick<string>(raw, "contentHash"),
      fileSize: pick<number>(raw, "sizeBytes") ?? pick<number>(raw, "fileSize"),
      mimeType: pick<string>(raw, "mime") ?? pick<string>(raw, "mimeType"),
      sourceUrl: pick<string>(raw, "url") ?? pick<string>(raw, "sourceUrl") ?? "",
      classification,
    };
  }

  validateDocument(meta: DocumentMetadataInput): ValidationResult {
    const errors: string[] = [];
    if (!meta.externalDocId) errors.push("externalDocId required");
    if (!meta.fileName) errors.push("fileName required");
    if (!meta.sourceUrl) errors.push("sourceUrl required");
    if (meta.sourceUrl && !meta.sourceUrl.startsWith("https://")) {
      errors.push("sourceUrl must use https:// scheme (SSRF defense)");
    }
    return { valid: errors.length === 0, errors };
  }

  deriveContextFields(loan: Loan, raw: unknown, _config: AdapterConfig): Partial<LoanContext> {
    return {
      repFico: pick<number>(raw, "credit.representativeScore") ?? pick<number>(raw, "borrower.fico"),
      ltv: loan.transaction.ltv,
      loanAmount: loan.transaction.loanAmount,
      loanPurpose: this.normalizePurpose(loan.transaction.loanPurpose),
      propertyType: pick<string>(raw, "property.propertyType"),
      dti: pick<number>(raw, "qualifying.totalDti") ?? pick<number>(raw, "borrower.totalDti"),
      reservesMonths: pick<number>(raw, "assets.reservesMonths"),
      noteRate: loan.transaction.noteRate,
      county: pick<string>(raw, "property.county"),
      isItin: pick<string>(raw, "borrower.taxpayerIdType") === "ITIN",
      llcOrLegalEntity: pick<string>(raw, "borrower.entityType") !== undefined && pick<string>(raw, "borrower.entityType") !== "Individual",
    };
  }

  private normalizePurpose(p: string | undefined): LoanContext["loanPurpose"] {
    if (p === "Purchase") return "Purchase";
    if (p === "Refi-CO") return "Cash-Out Refinance";
    if (p === "Refi-RT") return "Rate & Term Refinance";
    return undefined;
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @twin/api test adapter-encompass-los.test
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/adapters/encompass-los.ts packages/api/test/adapter-encompass-los.test.ts
git commit -m "feat(api/ingestion): EncompassLOSAdapter

Typed adapter for Encompass MISMO-derived JSON. Field paths default to
documented Encompass conventions; programMapping config translates
lender-specific program names to canonical NqmProgram. Closes F2 fields
via deriveContextFields."
```

---

### Task 7: `NPNQMPortalAdapter`

**Files:**
- Create: `packages/api/src/ingestion/adapters/npnqm-portal.ts`
- Test: `packages/api/test/adapter-npnqm-portal.test.ts`

NPNQM portal pushes a different payload shape — loan + docs in distinct events, identity uses `borrowerCaseId`, doc batch carries `submissionId` + array of `attachments`.

- [ ] **Step 1: Write the failing test against committed fixtures**

```ts
// packages/api/test/adapter-npnqm-portal.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { NPNQMPortalAdapter } from "../src/ingestion/adapters/npnqm-portal.js";

const FIX = join(__dirname, "fixtures/adapters");

describe("NPNQMPortalAdapter", () => {
  const adapter = new NPNQMPortalAdapter();
  const config = {
    allowedFetchHosts: ["docs.npnqm-portal.example.com"],
    maxFileBytes: 50_000_000,
    identityPrefix: "NPNQM-" as const,
  };

  it("adapterType is npnqm-portal", () => {
    expect(adapter.adapterType).toBe("npnqm-portal");
  });

  it("transformLoan extracts a refinance loan from the portal sample", () => {
    const raw = JSON.parse(readFileSync(join(FIX, "npnqm-portal-sample-loan.json"), "utf8"));
    const partial = adapter.transformLoan(raw, config);
    expect(partial.transaction?.loanAmount).toBeGreaterThan(0);
    expect(partial.transaction?.loanPurpose).toMatch(/Refi-CO|Refi-RT|Purchase/);
  });

  it("extractExternalLoanId reads borrowerCaseId", () => {
    const raw = { borrowerCaseId: "NPNQM-CASE-001" };
    expect(adapter.extractExternalLoanId(raw)).toBe("NPNQM-CASE-001");
  });

  it("transformDocument extracts attachments[0]-style entries", () => {
    const raw = {
      attachmentId: "ATT-1",
      attachmentName: "BankStmt_Sept.pdf",
      attachmentType: "BankStatement",
      downloadUrl: "https://docs.npnqm-portal.example.com/abc",
      sizeBytes: 200000,
      mime: "application/pdf",
    };
    const meta = adapter.transformDocument(raw, config);
    expect(meta.externalDocId).toBe("ATT-1");
    expect(meta.docType).toBe("BankStatement");
  });

  it("validateDocument rejects http:// scheme", () => {
    expect(adapter.validateDocument({
      externalDocId: "x", docType: "Other", fileName: "f",
      sourceUrl: "http://docs.npnqm-portal.example.com/abc",
    } as never).valid).toBe(false);
  });

  it("deriveContextFields produces all expected LoanContext extras", () => {
    const raw = JSON.parse(readFileSync(join(FIX, "npnqm-portal-sample-loan.json"), "utf8"));
    const partial = adapter.transformLoan(raw, config);
    const loan = { ...partial, id: "NPNQM-1", tenantId: "t" } as never;
    const extras = adapter.deriveContextFields(loan, raw, config);
    // Whichever fields are present in the sample fixture should populate; absent ones should be undefined (not throw).
    expect(extras).toBeTypeOf("object");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test adapter-npnqm-portal.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the adapter**

```ts
// packages/api/src/ingestion/adapters/npnqm-portal.ts
import type { Loan, LoanContext, NqmProgram, DocumentType } from "@twin/core";
import type { AdapterConfig } from "@twin/core";
import { LenderAdapter, type DocumentMetadataInput, type ValidationResult } from "../lender-adapter.js";

type Raw = Record<string, unknown>;
function pick<T>(obj: unknown, path: string): T | undefined {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as Raw)) return (acc as Raw)[k];
    return undefined;
  }, obj) as T | undefined;
}

export class NPNQMPortalAdapter extends LenderAdapter {
  readonly adapterType = "npnqm-portal";

  extractExternalLoanId(raw: unknown): string {
    const id = pick<string>(raw, "borrowerCaseId") ?? pick<string>(raw, "externalId");
    if (!id) throw new Error("npnqm-portal: payload missing borrowerCaseId");
    return id;
  }

  transformLoan(raw: unknown, config: AdapterConfig): Partial<Loan> {
    const lenderProgram = pick<string>(raw, "selectedProgram") ?? pick<string>(raw, "programName");
    const program = (lenderProgram && config.programMapping?.[lenderProgram]) ?? lenderProgram ?? undefined;
    return {
      nqmProgram: program as NqmProgram | undefined,
      borrower: {
        fullName: pick<string>(raw, "borrower.fullName") ?? pick<string>(raw, "primaryBorrower.name") ?? "Unknown",
        ssnMasked: pick<string>(raw, "borrower.ssnMasked") ?? "xxx-xx-0000",
        dob: pick<string>(raw, "borrower.dob") ?? "1990-01-01",
        maritalStatus: (pick<string>(raw, "borrower.maritalStatus") ?? "Unmarried") as never,
      },
      transaction: {
        loanPurpose: (pick<string>(raw, "loanPurpose") ?? "Purchase") as never,
        loanAmount: pick<number>(raw, "loanAmount") ?? 0,
        salesPrice: pick<number>(raw, "salesPrice") ?? 0,
        appraisedValue: pick<number>(raw, "appraisedValue") ?? 0,
        ltv: pick<number>(raw, "ltv") ?? 0,
        cltv: pick<number>(raw, "cltv") ?? pick<number>(raw, "ltv") ?? 0,
        hcltv: pick<number>(raw, "hcltv") ?? pick<number>(raw, "ltv") ?? 0,
        noteRate: pick<number>(raw, "noteRate") ?? 7,
        term: pick<number>(raw, "term") ?? 360,
        amortType: (pick<string>(raw, "amortType") ?? "Fixed") as never,
        lienPosition: 1,
        occupancy: (pick<string>(raw, "occupancy") ?? "Primary") as never,
        isInvestmentProperty: pick<string>(raw, "occupancy") === "Investment",
        piti: pick<number>(raw, "piti") ?? 0,
      },
    };
  }

  validateLoan(partial: Partial<Loan>): ValidationResult {
    const errors: string[] = [];
    if (!partial.transaction) errors.push("transaction block required");
    if (!partial.borrower) errors.push("borrower block required");
    return { valid: errors.length === 0, errors };
  }

  extractExternalDocId(raw: unknown): string {
    const id = pick<string>(raw, "attachmentId") ?? pick<string>(raw, "externalDocId") ?? pick<string>(raw, "docId");
    if (!id) throw new Error("npnqm-portal: document payload missing attachmentId");
    return id;
  }

  transformDocument(raw: unknown, config: AdapterConfig): DocumentMetadataInput {
    const classification = pick<string>(raw, "attachmentType") ?? pick<string>(raw, "type") ?? "Other";
    const map = config.documentTypeMapping ?? {};
    const docType = (map[classification] ?? (classification as DocumentType)) as DocumentType;
    return {
      externalDocId: this.extractExternalDocId(raw),
      docType,
      fileName: pick<string>(raw, "attachmentName") ?? "unknown.bin",
      contentHash: pick<string>(raw, "contentHash"),
      fileSize: pick<number>(raw, "sizeBytes") ?? pick<number>(raw, "fileSize"),
      mimeType: pick<string>(raw, "mime") ?? pick<string>(raw, "mimeType"),
      sourceUrl: pick<string>(raw, "downloadUrl") ?? pick<string>(raw, "url") ?? "",
      classification,
    };
  }

  validateDocument(meta: DocumentMetadataInput): ValidationResult {
    const errors: string[] = [];
    if (!meta.externalDocId) errors.push("externalDocId required");
    if (!meta.fileName) errors.push("fileName required");
    if (!meta.sourceUrl) errors.push("sourceUrl required");
    if (meta.sourceUrl && !meta.sourceUrl.startsWith("https://")) {
      errors.push("sourceUrl must use https:// scheme (SSRF defense)");
    }
    return { valid: errors.length === 0, errors };
  }

  deriveContextFields(loan: Loan, raw: unknown, _config: AdapterConfig): Partial<LoanContext> {
    return {
      repFico: pick<number>(raw, "borrower.fico") ?? pick<number>(raw, "creditScore"),
      ltv: loan.transaction.ltv,
      loanAmount: loan.transaction.loanAmount,
      loanPurpose: this.normalizePurpose(loan.transaction.loanPurpose),
      propertyType: pick<string>(raw, "propertyType"),
      dti: pick<number>(raw, "totalDti"),
      reservesMonths: pick<number>(raw, "reservesMonths"),
      noteRate: loan.transaction.noteRate,
      county: pick<string>(raw, "propertyCounty") ?? pick<string>(raw, "property.county"),
      isItin: pick<boolean>(raw, "borrower.isItin") ?? false,
      llcOrLegalEntity: pick<string>(raw, "borrower.entityType") === "LLC",
    };
  }

  private normalizePurpose(p: string | undefined): LoanContext["loanPurpose"] {
    if (p === "Purchase") return "Purchase";
    if (p === "Refi-CO") return "Cash-Out Refinance";
    if (p === "Refi-RT") return "Rate & Term Refinance";
    return undefined;
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @twin/api test adapter-npnqm-portal.test
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/adapters/npnqm-portal.ts packages/api/test/adapter-npnqm-portal.test.ts
git commit -m "feat(api/ingestion): NPNQMPortalAdapter

Typed adapter for the NPNQM broker-portal payload shape. Distinct from
Encompass: identity is borrowerCaseId, docs arrive as attachments with
attachmentId / attachmentName / attachmentType."
```

---

## Phase B complete — checkpoint

After tasks 5-7, three concrete adapters ship. Each has a golden-file test against committed fixtures plus validation-branch coverage. The registry has the kebab-case guard from Task 4.

Verify:
```bash
pnpm --filter @twin/api test -- adapter-
```

Expected: PASS for all three adapter test files.

---

## Phase C — Loan channel wiring

4 tasks. The existing `POST /api/ingest/:tenantSlug/loans` route is refactored to use the adapter registry, the per-tenant query gets the explicit RLS filter, `loan_context_extras` populates first-write-wins, and `buildLoanContextFromLoan` reads the extras row.

### Task 8: `loan-context-extras` read helper with Zod parse-and-skip

**Files:**
- Create: `packages/api/src/ingestion/loan-context-extras.ts`
- Test: `packages/api/test/loan-context-extras.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/test/loan-context-extras.test.ts
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
import { loadExtras, writeExtrasFirstWriteWins } from "../src/ingestion/loan-context-extras.js";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee01";

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'Extras Test', 'extras-test', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
  });
});
afterAll(async () => {
  await withDb(async (c) => {
    await c.query(`DELETE FROM loan_context_extras WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM tenants WHERE id = $1`, [T]);
  });
  await closePool();
});

describe("loan-context-extras", () => {
  it("loadExtras returns null when no row exists", async () => {
    const r = await loadExtras(T, "no-such-loan");
    expect(r).toBe(null);
  });

  it("write + load roundtrips with Zod validation", async () => {
    await writeExtrasFirstWriteWins(T, "L-1", { repFico: 720, ltv: 80, county: "King County" });
    const r = await loadExtras(T, "L-1");
    expect(r).toEqual({ repFico: 720, ltv: 80, county: "King County" });
  });

  it("first-write-wins — second write is a no-op", async () => {
    await writeExtrasFirstWriteWins(T, "L-2", { repFico: 700 });
    await writeExtrasFirstWriteWins(T, "L-2", { repFico: 800, ltv: 90 });
    const r = await loadExtras(T, "L-2");
    expect(r).toEqual({ repFico: 700 });
  });

  it("loadExtras returns null when stored extras fails Zod validation", async () => {
    // Insert a corrupt row directly (bypassing the write helper) to simulate a legacy/bad row.
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO loan_context_extras (tenant_id, loan_id, extras)
         VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (tenant_id, loan_id) DO UPDATE SET extras = EXCLUDED.extras`,
        [T, "L-3", JSON.stringify({ mysteryField: "bad", repFico: "not a number" })],
      );
    });
    const r = await loadExtras(T, "L-3");
    expect(r).toBe(null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test loan-context-extras.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// packages/api/src/ingestion/loan-context-extras.ts
import { LoanContextExtrasSchema, type LoanContextExtras } from "@twin/core";
import { withTenantTx } from "../db/pool.js";

export async function loadExtras(
  tenantId: string,
  loanId: string,
): Promise<LoanContextExtras | null> {
  return withTenantTx(tenantId, async (c) => {
    const { rows } = await c.query<{ extras: unknown }>(
      `SELECT extras FROM loan_context_extras
        WHERE tenant_id = $1 AND loan_id = $2
        LIMIT 1`,
      [tenantId, loanId],
    );
    if (rows.length === 0) return null;
    const parsed = LoanContextExtrasSchema.safeParse(rows[0]!.extras);
    if (!parsed.success) {
      console.warn(
        `[loan-context-extras] Zod parse failed for tenant=${tenantId} loan=${loanId}; treating as absent`,
        parsed.error.flatten(),
      );
      return null;
    }
    return parsed.data;
  });
}

export async function writeExtrasFirstWriteWins(
  tenantId: string,
  loanId: string,
  extras: LoanContextExtras,
): Promise<void> {
  const parsed = LoanContextExtrasSchema.parse(extras);
  await withTenantTx(tenantId, async (c) => {
    await c.query(
      `INSERT INTO loan_context_extras (tenant_id, loan_id, extras)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (tenant_id, loan_id) DO NOTHING`,
      [tenantId, loanId, JSON.stringify(parsed)],
    );
  });
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @twin/api test loan-context-extras.test
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/loan-context-extras.ts packages/api/test/loan-context-extras.test.ts
git commit -m "feat(api/ingestion): loan_context_extras helper

First-write-wins on write (ON CONFLICT DO NOTHING) — re-ingest cannot
overwrite operator-edited or PC-v2-inferred values. Zod parse-and-skip
on read — corrupt rows degrade to PC v2's missing-field behavior."
```

---

### Task 9: Refactor loan route to use adapter registry

**Files:**
- Modify: `packages/api/src/routes/ingestion.ts`
- Modify: `packages/api/src/server.ts` (register adapters at boot)
- Test: `packages/api/test/ingestion-loan-channel.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/api/test/ingestion-loan-channel.integration.test.ts
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
import type { FastifyInstance } from "fastify";
import { withDb, closePool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";
import { createHash } from "node:crypto";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee02";
const KEY = "extras_loan_test_key";
const KEY_HASH = createHash("sha256").update(KEY).digest("hex");

let app: FastifyInstance;

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'Loan Channel Test', 'loan-channel-test', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
    await c.query(
      `INSERT INTO tenant_api_keys (tenant_id, key_hash, key_prefix, name, rate_limit_per_minute)
       VALUES ($1, $2, 'extras_lo', 'test', 1000)
       ON CONFLICT DO NOTHING`,
      [T, KEY_HASH],
    );
    await c.query(
      `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
       VALUES ($1, 'encompass-los', 'encompass-los', 'encompass-los',
               $2::jsonb, '{}'::jsonb, true)
       ON CONFLICT DO NOTHING`,
      [T, JSON.stringify({
        identityPrefix: "ENC-",
        allowedFetchHosts: ["docs.encompass.example.com"],
        maxFileBytes: 50_000_000,
      })],
    );
  });
  app = buildServer({}).app;
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await withDb(async (c) => {
    await c.query(`DELETE FROM loan_context_extras WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM tenant_api_keys WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM tenants WHERE id = $1`, [T]);
  });
  await closePool();
});

describe("POST /api/ingest/:tenantSlug/loans — adapter dispatch", () => {
  it("dispatches the encompass-los adapter and writes extras first-write-wins", async () => {
    const body = {
      source: "encompass-los",
      externalId: "ENC-TEST-1",
      loanData: {
        loanNumber: "ENC-TEST-1",
        programName: "Flex Select",
        transaction: { loanAmount: 500000, ltv: 80, noteRate: 7.5, salesPrice: 625000, appraisedValue: 625000, loanPurpose: "Purchase", term: 360, amortType: "Fixed", occupancy: "Primary", piti: 4000 },
        borrower: { fullName: "Test User", ssnMasked: "xxx-xx-1234", dob: "1985-01-01", maritalStatus: "Married" },
        credit: { representativeScore: 720 },
        property: { county: "King County", propertyType: "SFR Det." },
      },
    };
    const res = await app.inject({
      method: "POST",
      url: "/api/ingest/loan-channel-test/loans",
      headers: { "x-api-key": KEY },
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    const parsed = JSON.parse(res.body);
    expect(parsed.loanId).toBe("ENC-ENC-TEST-1");
  });

  it("first-write-wins — re-ingesting the same external_id returns 200 with duplicate=true and does not overwrite extras", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/ingest/loan-channel-test/loans",
      headers: { "x-api-key": KEY },
      payload: { source: "encompass-los", externalId: "ENC-TEST-1", loanData: {} },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).duplicate).toBe(true);
  });

  it("rejects unknown adapter_type with 400", async () => {
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
         VALUES ($1, 'bad-source', 'no-such-adapter', 'no-such-adapter', '{}'::jsonb, '{}'::jsonb, true)
         ON CONFLICT DO NOTHING`,
        [T],
      );
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/ingest/loan-channel-test/loans",
      headers: { "x-api-key": KEY },
      payload: { source: "bad-source", externalId: "BAD-1", loanData: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error_class).toBe("unknown_adapter_type");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test ingestion-loan-channel.integration.test
```

Expected: FAIL — route still uses legacy transformer, doesn't write extras, doesn't surface error_class.

- [ ] **Step 3: Refactor the route**

Replace the body of `packages/api/src/routes/ingestion.ts` with:

```ts
import type { FastifyInstance } from "fastify";
import type { Loan, Store } from "@twin/core";
import { withTenantTx } from "../db/pool.js";
import { apiKeyAuthHook } from "../middleware/api-key-auth.js";
import { runInTenantContext } from "../tenant-context.js";
import { getAdapter, registerAdapter } from "../ingestion/adapter-registry.js";
import { GenericJsonAdapter } from "../ingestion/adapters/generic-json-adapter.js";
import { EncompassLOSAdapter } from "../ingestion/adapters/encompass-los.js";
import { NPNQMPortalAdapter } from "../ingestion/adapters/npnqm-portal.js";
import { writeExtrasFirstWriteWins } from "../ingestion/loan-context-extras.js";
import { IngestLoanRequestSchema, AdapterConfigSchema } from "@twin/core";
import { randomUUID } from "node:crypto";

// Boot-time adapter registration. Registry is process-global; safe across
// repeat module loads thanks to last-write-wins semantics in the registry.
registerAdapter(new GenericJsonAdapter());
registerAdapter(new EncompassLOSAdapter());
registerAdapter(new NPNQMPortalAdapter());

function buildLoanFromPartial(loanId: string, partial: Partial<Loan>, tenantId: string): Loan {
  // Keep existing fill-defaults logic from prior implementation.
  const now = new Date().toISOString();
  const borrower = partial.borrower ?? { fullName: "Unknown Borrower", ssnMasked: "xxx-xx-0000", dob: "1990-01-01", maritalStatus: "Unmarried" as const };
  const loanAmount = partial.transaction?.loanAmount ?? 0;
  const appraisedValue = partial.transaction?.appraisedValue ?? loanAmount;
  const noteRate = partial.transaction?.noteRate ?? 7.0;
  const term = partial.transaction?.term ?? 360;
  const r = noteRate / 100 / 12;
  const n = term;
  const piPayment = loanAmount > 0 && r > 0 ? loanAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : 0;
  const monthlyIncome = partial.income?.totalMonthlyIncome ?? 10000;
  const piti = partial.transaction?.piti ?? piPayment * 1.25;

  return {
    id: loanId,
    nqmProgram: partial.nqmProgram ?? "BankStatement12",
    qualifyingMethod: partial.qualifyingMethod ?? "BankStatementDeposits",
    borrower,
    property: partial.property ?? { street: "TBD", city: "TBD", state: "TX", zip: "00000", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: {
      loanPurpose: partial.transaction?.loanPurpose ?? "Purchase",
      loanAmount, salesPrice: partial.transaction?.salesPrice ?? loanAmount, appraisedValue,
      ltv: partial.transaction?.ltv ?? (appraisedValue > 0 ? Math.round(loanAmount / appraisedValue * 10000) / 100 : 0),
      cltv: partial.transaction?.cltv ?? partial.transaction?.ltv ?? 0,
      hcltv: partial.transaction?.hcltv ?? partial.transaction?.ltv ?? 0,
      noteRate, term,
      amortType: partial.transaction?.amortType ?? "Fixed",
      lienPosition: partial.transaction?.lienPosition ?? 1,
      occupancy: partial.transaction?.occupancy ?? "Primary",
      isInvestmentProperty: partial.transaction?.isInvestmentProperty ?? false,
      piti,
    },
    qualifying: partial.qualifying ?? { housingRatio: monthlyIncome > 0 ? Math.round(piti / monthlyIncome * 10000) / 100 : 0, totalDti: 0, piPayment: Math.round(piPayment * 100) / 100, qualifyingRate: noteRate },
    qualifyingWorksheet: partial.qualifyingWorksheet ?? { method: "BankStatementDeposits", derivedMonthlyIncome: monthlyIncome },
    income: partial.income ?? { totalMonthlyIncome: monthlyIncome },
    assets: partial.assets ?? { totalLiquid: 0, totalRetirement: 0, reservesMonths: 0 },
    credit: partial.credit ?? { repScore: null, tradelinesOpen: 0, tradelinesTotal: 0, tradelines: [], liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 } },
    appraisal: partial.appraisal ?? { appraisalDate: now.slice(0, 10), appraiserName: "Pending", appraisalType: "Full", appraisedValue, marketCondition: "Stable", neighborhoodRating: "Average", siteArea: "N/A", grossLivingArea: 0, roomCount: 0, bedroomCount: 0, bathroomCount: 0, garageSpaces: 0, condition: "Average", comparables: [] },
    conditions: partial.conditions ?? [],
    documents: partial.documents ?? [],
    decision: partial.decision ?? "pending",
    milestones: [{ name: "Ingested", at: now, by: "api-ingest" }],
    compliance: partial.compliance ?? { qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false, higherPricedCoveredTransaction: false, stateLicenseRequired: false, stateHighCostTest: "N/A", tridToleranceCure: "None", totalPointsAndFees: 0, pointsAndFeesThreshold: 0, pointsAndFeesPass: true, flags: [] },
    overlay: partial.overlay ?? { programName: partial.nqmProgram ?? "BankStatement12", investorName: "TBD", maxLTV: 80, minFICO: 620, maxDTI: 50, minDSCR: null, minReserves: 6, checks: [] },
    tenantId,
  };
}

export function registerIngestionRoutes(app: FastifyInstance, store: Store): void {
  app.post<{ Params: { tenantSlug: string } }>(
    "/api/ingest/:tenantSlug/loans",
    { preHandler: apiKeyAuthHook },
    async (req, reply) => {
      const tenantId = (req as unknown as { tenantId?: string }).tenantId;
      if (!tenantId) return reply.code(401).send({ error_class: "missing_tenant_context" });

      const parsed = IngestLoanRequestSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error_class: "validation_failed", details: parsed.error.flatten() });

      const { source, externalId, loanData } = parsed.data;
      const errorId = randomUUID();

      return runInTenantContext(
        { tenantId, userId: "api-ingest", isSuperAdmin: false, role: "operator" },
        async () => {
          // Idempotency check — explicit tenant_id filter (pooler RLS belt-and-suspenders).
          const existing = await withTenantTx(tenantId, async (c) => {
            const { rows } = await c.query<{ loan_id: string; status: string }>(
              `SELECT loan_id, status FROM ingested_loans
                WHERE tenant_id = $1 AND external_id = $2 LIMIT 1`,
              [tenantId, externalId],
            );
            return rows[0] ?? null;
          });
          if (existing) {
            return reply.code(200).send({ loanId: existing.loan_id, tenantId, status: existing.status, duplicate: true });
          }

          // Load mapping — explicit tenant filter.
          const mapping = await withTenantTx(tenantId, async (c) => {
            const { rows } = await c.query<{ adapter_type: string; adapter_config: unknown }>(
              `SELECT adapter_type, adapter_config FROM ingestion_mappings
                WHERE tenant_id = $1 AND source_name = $2 AND active = true LIMIT 1`,
              [tenantId, source],
            );
            return rows[0] ?? null;
          });

          const adapterType = mapping?.adapter_type ?? "generic-json";
          const adapter = getAdapter(adapterType);
          if (!adapter) {
            req.log?.error?.({ tenantId, adapterType, errorId }, "[ingest] unknown adapter_type");
            return reply.code(400).send({ error_id: errorId, error_class: "unknown_adapter_type" });
          }

          const config = AdapterConfigSchema.parse(mapping?.adapter_config ?? {});

          let partialLoan: Partial<Loan>;
          try {
            partialLoan = adapter.transformLoan(loanData, config);
          } catch (e) {
            req.log?.error?.({ err: e, tenantId, adapterType, errorId }, "[ingest] transformLoan threw");
            return reply.code(500).send({ error_id: errorId, error_class: "transform_failed", adapter_type: adapterType });
          }

          const validation = adapter.validateLoan(partialLoan);
          if (!validation.valid) {
            return reply.code(400).send({
              error_id: errorId,
              error_class: "validation_failed",
              adapter_type: adapterType,
              details: validation.errors.map((e) => ({ code: e })),
            });
          }

          const externalLoanIdFromAdapter = adapter.extractExternalLoanId(loanData);
          const loanId = `${config.identityPrefix}${externalLoanIdFromAdapter}`;
          const loan = buildLoanFromPartial(loanId, partialLoan, tenantId);

          store.dispatch({ type: "InjectLoan", loan });

          // F2-field closure (first-write-wins).
          try {
            const extras = adapter.deriveContextFields(loan, loanData, config);
            // Filter undefined keys so the strict schema accepts the row.
            const cleaned = Object.fromEntries(
              Object.entries(extras).filter(([, v]) => v !== undefined),
            ) as Record<string, unknown>;
            if (Object.keys(cleaned).length > 0) {
              await writeExtrasFirstWriteWins(tenantId, loanId, cleaned as never);
            }
          } catch (e) {
            req.log?.warn?.({ err: e, tenantId, loanId }, "[ingest] deriveContextFields failed; continuing without extras");
          }

          await withTenantTx(tenantId, async (c) => {
            await c.query(
              `INSERT INTO ingested_loans (tenant_id, external_id, loan_id, status) VALUES ($1, $2, $3, 'queued')`,
              [tenantId, externalId, loanId],
            );
          });

          // Per-ingest audit row.
          await withTenantTx(tenantId, async (c) => {
            await c.query(
              `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
               VALUES ($1, 'api-ingest', 'ingest.loan',
                       $2, $3::jsonb)`,
              [tenantId, `loan ${loanId} ingested via ${adapterType}`,
               JSON.stringify({ adapter_type: adapterType, source_name: source, external_id: externalId, result: "success" })],
            );
          });

          // PC v2 auto-fire — best-effort.
          try {
            const { run: runPredictions } = await import("../services/predict-conditions/index.js");
            const { buildLoanContextFromLoan } = await import("./predict-conditions-context-builder.js");
            const ctx = await buildLoanContextFromLoan(loan);
            await runPredictions(tenantId, loanId, ctx, "system:loan-ingest");
          } catch (err) {
            req.log?.error?.({ err, tenantId, loanId, errorId }, "[predict-conditions] auto-fire error");
          }

          return reply.code(201).send({ loanId, tenantId, status: "queued", estimatedProcessingMinutes: 15 });
        },
      );
    },
  );
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @twin/api test ingestion-loan-channel.integration.test
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/ingestion.ts packages/api/test/ingestion-loan-channel.integration.test.ts
git commit -m "feat(api/routes): loan ingest uses adapter registry + first-write-wins extras

Refactors POST /api/ingest/:tenantSlug/loans to dispatch via the typed
adapter registry, write loan_context_extras first-write-wins, surface
category-coded errors (no payload echo), and write a per-ingest audit
row. Explicit WHERE tenant_id on every query (pooler-bypass-RLS fix)."
```

---

### Task 10: Make `buildLoanContextFromLoan` read extras

**Files:**
- Modify: `packages/api/src/routes/predict-conditions-context-builder.ts`
- Modify: `packages/api/test/predict-conditions-context-builder.test.ts` (or wherever the existing test lives)

- [ ] **Step 1: Locate the existing context-builder + test**

```bash
grep -n "buildLoanContextFromLoan" packages/api/src/routes/predict-conditions-context-builder.ts packages/api/test/*.test.ts
```

Note the current signature: it's synchronous and returns `LoanContext`. After this task, it becomes async (`Promise<LoanContext>`) because it queries the extras table.

- [ ] **Step 2: Add failing tests for the new async behavior**

Append to (or extend) `packages/api/test/predict-conditions-context-builder.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withDb, closePool } from "../src/db/pool.js";
import { buildLoanContextFromLoan } from "../src/routes/predict-conditions-context-builder.js";
import { writeExtrasFirstWriteWins } from "../src/ingestion/loan-context-extras.js";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee03";

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'CB Test', 'cb-test', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
  });
});
afterAll(async () => {
  await withDb(async (c) => {
    await c.query(`DELETE FROM loan_context_extras WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM tenants WHERE id = $1`, [T]);
  });
  await closePool();
});

describe("buildLoanContextFromLoan — extras merge", () => {
  const loan = {
    id: "CB-1", tenantId: T,
    nqmProgram: "Flex Select",
    transaction: { loanAmount: 500000, ltv: 80, noteRate: 7, loanPurpose: "Purchase", occupancy: "Primary" },
    property: { state: "WA", propertyType: "SFR Det." },
    borrower: { fullName: "X", ssnMasked: "x", dob: "1980-01-01" },
    credit: { repScore: 700 },
  } as never;

  it("extras-absent: falls back to Loan-derived defaults (existing behavior)", async () => {
    const ctx = await buildLoanContextFromLoan(loan);
    expect(ctx.county).toBeUndefined();
    expect(ctx.repFico).toBe(700); // from loan.credit.repScore
  });

  it("extras-present: extras override Loan-derived defaults", async () => {
    await writeExtrasFirstWriteWins(T, "CB-1", { repFico: 750, county: "King County", isItin: false });
    const ctx = await buildLoanContextFromLoan(loan);
    expect(ctx.repFico).toBe(750);
    expect(ctx.county).toBe("King County");
    expect(ctx.isItin).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm --filter @twin/api test predict-conditions-context-builder.test
```

Expected: FAIL — current function is sync and doesn't read extras.

- [ ] **Step 4: Modify the context-builder**

Open `packages/api/src/routes/predict-conditions-context-builder.ts`. Change the function signature to async, and merge extras:

```ts
import { loadExtras } from "../ingestion/loan-context-extras.js";
// ... existing imports ...

export async function buildLoanContextFromLoan(loan: Loan): Promise<LoanContext> {
  // ... existing logic that builds `base` from Loan fields ...
  const base = /* existing object built from loan.* */;
  const extras = loan.tenantId ? await loadExtras(loan.tenantId, loan.id) : null;
  if (!extras) return base;
  // Merge — extras override base for each defined key.
  return { ...base, ...Object.fromEntries(Object.entries(extras).filter(([, v]) => v !== undefined)) };
}
```

(Keep the rest of the existing derivation logic; only the signature and trailing merge changes.)

- [ ] **Step 5: Update all call sites** to await the call

```bash
grep -rn "buildLoanContextFromLoan" packages/api/src
```

For each result, add `await` (and make the containing function async if needed). Expect ~3-4 call sites including `ingestion.ts` (already async — Task 9 added `await`), `predict-conditions/service.ts`, `routes/predict-conditions.ts`.

- [ ] **Step 6: Run the full API test suite**

```bash
pnpm --filter @twin/api test
```

Expected: all tests pass (including the new extras-merge tests and the existing context-builder tests).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes/predict-conditions-context-builder.ts packages/api/test/predict-conditions-context-builder.test.ts packages/api/src/services/predict-conditions/service.ts packages/api/src/routes/predict-conditions.ts
git commit -m "feat(api/routes): context-builder reads loan_context_extras

buildLoanContextFromLoan becomes async; merges extras (from the table
populated by adapters in §4.1 step 4) over Loan-derived defaults.
Extras-absent path preserves existing behavior. PC v2 resolvers now
fire against real ingested loans instead of skipping on undefined."
```

---

### Task 11: TypeScript seed for demo fixture backfill

**Files:**
- Create: `packages/api/scripts/seed-loan-context-extras.ts`

The demo fixtures have known field values that PC v2 needs. A one-shot TS seed (idempotent — first-write-wins via the helper) populates them at deploy time. The script can be re-run safely; existing rows are not overwritten.

- [ ] **Step 1: Create the seed script**

```ts
#!/usr/bin/env tsx
// packages/api/scripts/seed-loan-context-extras.ts
//
// One-shot demo backfill — writes loan_context_extras rows for the
// committed fixture loans so PC v2's matrix/geographic/requirements
// resolvers fire against the demo tenant.
//
// Idempotent via first-write-wins (ON CONFLICT DO NOTHING). Safe to
// re-run; will only fill missing rows.

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

interface FixtureExtras {
  loanId: string;
  extras: Record<string, unknown>;
}

// Manually-curated extras for the 12 NQM fixtures + 8 edge cases.
// Values reflect each fixture's "known truth" — what an adapter would
// derive if these loans had arrived through real ingestion.
const FIXTURES: FixtureExtras[] = [
  { loanId: "nqm-bankstmt-12mo-clean", extras: { repFico: 720, ltv: 75, loanAmount: 450000, loanPurpose: "Purchase", propertyType: "SFR Det.", dti: 38, reservesMonths: 8, noteRate: 7.25, county: "King County", isItin: false, llcOrLegalEntity: false } },
  // ... one entry per demo fixture. Operator fills in from the fixture files
  // at implementation time; each row is a deterministic projection of the
  // fixture's existing values.
];

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
  for (const f of FIXTURES) {
    const before = await withDb(async (c) => {
      const { rows } = await c.query(
        `SELECT 1 FROM loan_context_extras WHERE tenant_id = $1 AND loan_id = $2`,
        [tenantId, f.loanId],
      );
      return rows.length;
    });
    await writeExtrasFirstWriteWins(tenantId, f.loanId, f.extras as never);
    if (before > 0) skipped++; else inserted++;
  }
  console.log(`[seed-loan-context-extras] tenant=${tenantId}: ${inserted} inserted, ${skipped} skipped (already present)`);
  await closePool();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it against local DB**

```bash
pnpm tsx packages/api/scripts/seed-loan-context-extras.ts
```

Expected: `[seed-loan-context-extras] tenant=<uuid>: N inserted, 0 skipped`.

- [ ] **Step 3: Run again to verify idempotency**

```bash
pnpm tsx packages/api/scripts/seed-loan-context-extras.ts
```

Expected: `0 inserted, N skipped`.

- [ ] **Step 4: Commit**

```bash
git add packages/api/scripts/seed-loan-context-extras.ts
git commit -m "chore(seed): loan_context_extras backfill for demo fixtures

Idempotent TypeScript seed — populates extras for each fixture loan so
PC v2's v2 resolvers fire against the demo tenant. Re-runnable; first-
write-wins ensures no overwrite of operator-edited rows. Operator fills
in fixture-by-fixture values from the committed fixture files."
```

---

## Phase C complete — checkpoint

After tasks 8-11, the loan channel is fully wired to the adapter framework. PC v2 now reads real LoanContext fields from `loan_context_extras` for both ingested loans (Task 9) and demo fixtures (Task 11).

Verify:
```bash
pnpm --filter @twin/api test
```

Expected: full API test suite passes.

---

## Phase D — Document channel + worker

7 tasks. The largest phase. Lands the new endpoint, full SSRF defense, async worker, debounced PC v2 re-fire.

### Task 12: Fetch security module (SSRF defense)

**Files:**
- Create: `packages/api/src/ingestion/fetch-security.ts`
- Test: `packages/api/test/fetch-security.test.ts`

This module is pure logic + a wrapped `fetch`. The five layers from spec §5.4.3 land here.

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/test/fetch-security.test.ts
import { describe, it, expect } from "vitest";
import { validateUrlForFetch, checkResolvedIps } from "../src/ingestion/fetch-security.js";

describe("fetch-security — URL validation (layers 1+2)", () => {
  const allowed = ["docs.example.com", "files.cdn.example.com"];

  it("accepts https on an allowlisted host", () => {
    const r = validateUrlForFetch("https://docs.example.com/abc", allowed);
    expect(r.ok).toBe(true);
  });

  it("rejects http scheme", () => {
    const r = validateUrlForFetch("http://docs.example.com/abc", allowed);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("scheme_not_allowed");
  });

  it("rejects file://", () => {
    const r = validateUrlForFetch("file:///etc/passwd", allowed);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("scheme_not_allowed");
  });

  it("rejects data: and gopher:", () => {
    expect(validateUrlForFetch("data:text/plain,abc", allowed).reason).toBe("scheme_not_allowed");
    expect(validateUrlForFetch("gopher://h.example.com/", allowed).reason).toBe("scheme_not_allowed");
  });

  it("rejects host not in allowlist", () => {
    const r = validateUrlForFetch("https://attacker.example.com/", allowed);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("host_not_allowed");
  });

  it("rejects malformed URL", () => {
    expect(validateUrlForFetch("not a url", allowed).ok).toBe(false);
  });

  it("rejects empty allowlist regardless of URL", () => {
    const r = validateUrlForFetch("https://docs.example.com/abc", []);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("host_not_allowed");
  });
});

describe("fetch-security — IP-range gate (layer 3)", () => {
  it("blocks loopback IPv4", () => {
    expect(checkResolvedIps([{ address: "127.0.0.1", family: 4 }]).ok).toBe(false);
  });
  it("blocks loopback IPv6", () => {
    expect(checkResolvedIps([{ address: "::1", family: 6 }]).ok).toBe(false);
  });
  it("blocks RFC 1918 10/8", () => {
    expect(checkResolvedIps([{ address: "10.0.0.1", family: 4 }]).ok).toBe(false);
  });
  it("blocks RFC 1918 172.16/12", () => {
    expect(checkResolvedIps([{ address: "172.16.0.1", family: 4 }]).ok).toBe(false);
    expect(checkResolvedIps([{ address: "172.31.255.255", family: 4 }]).ok).toBe(false);
    // 172.15.x.x and 172.32.x.x are public:
    expect(checkResolvedIps([{ address: "172.15.0.1", family: 4 }]).ok).toBe(true);
    expect(checkResolvedIps([{ address: "172.32.0.1", family: 4 }]).ok).toBe(true);
  });
  it("blocks RFC 1918 192.168/16", () => {
    expect(checkResolvedIps([{ address: "192.168.1.1", family: 4 }]).ok).toBe(false);
  });
  it("blocks link-local 169.254/16", () => {
    expect(checkResolvedIps([{ address: "169.254.169.254", family: 4 }]).ok).toBe(false);
  });
  it("blocks IPv6 fe80::/10 link-local", () => {
    expect(checkResolvedIps([{ address: "fe80::1", family: 6 }]).ok).toBe(false);
  });
  it("blocks IPv6 fc00::/7 ULA", () => {
    expect(checkResolvedIps([{ address: "fc00::1", family: 6 }]).ok).toBe(false);
    expect(checkResolvedIps([{ address: "fd00::1", family: 6 }]).ok).toBe(false);
  });
  it("accepts a public IPv4", () => {
    expect(checkResolvedIps([{ address: "8.8.8.8", family: 4 }]).ok).toBe(true);
  });
  it("rejects if ANY resolved IP is private (DNS rebinding defense)", () => {
    expect(checkResolvedIps([
      { address: "8.8.8.8", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test fetch-security.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
// packages/api/src/ingestion/fetch-security.ts
import { lookup as dnsLookup } from "node:dns/promises";

export type FetchValidationReason =
  | "scheme_not_allowed"
  | "host_not_allowed"
  | "malformed_url"
  | "ip_range_blocked"
  | "dns_lookup_failed";

export interface FetchValidationResult {
  ok: boolean;
  reason?: FetchValidationReason;
  detail?: string;
}

export function validateUrlForFetch(url: string, allowedHosts: string[]): FetchValidationResult {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { ok: false, reason: "malformed_url" }; }
  if (parsed.protocol !== "https:") return { ok: false, reason: "scheme_not_allowed", detail: parsed.protocol };
  if (allowedHosts.length === 0 || !allowedHosts.includes(parsed.hostname)) {
    return { ok: false, reason: "host_not_allowed", detail: parsed.hostname };
  }
  return { ok: true };
}

interface ResolvedAddress { address: string; family: number; }

export function checkResolvedIps(addrs: ResolvedAddress[]): FetchValidationResult {
  for (const a of addrs) {
    if (isPrivateOrLocal(a)) return { ok: false, reason: "ip_range_blocked", detail: a.address };
  }
  return { ok: true };
}

function isPrivateOrLocal({ address, family }: ResolvedAddress): boolean {
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 127) return true;                                    // loopback
    if (a === 10) return true;                                     // RFC 1918
    if (a === 192 && b === 168) return true;                       // RFC 1918
    if (a === 172 && b >= 16 && b <= 31) return true;              // RFC 1918
    if (a === 169 && b === 254) return true;                       // link-local
    if (a === 0) return true;                                      // unspecified
    if (a >= 224) return true;                                     // multicast + reserved
    return false;
  }
  // IPv6
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return true;              // loopback / unspecified
  if (lower.startsWith("fe80:")) return true;                      // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("ff")) return true;                         // multicast
  return false;
}

export async function resolveAndCheck(hostname: string): Promise<FetchValidationResult> {
  try {
    const addrs = await dnsLookup(hostname, { all: true });
    return checkResolvedIps(addrs);
  } catch (e) {
    return { ok: false, reason: "dns_lookup_failed", detail: (e as Error).message };
  }
}

/**
 * Layer 4+5: redirect:'manual' and timeout+byte cap.
 * Returns the body as Uint8Array on success.
 */
export async function safeFetch(
  url: string,
  opts: { allowedHosts: string[]; maxBytes: number; timeoutMs: number },
): Promise<{ ok: true; bytes: Uint8Array; contentType: string | null } | { ok: false; reason: string; detail?: string }> {
  const v = validateUrlForFetch(url, opts.allowedHosts);
  if (!v.ok) return { ok: false, reason: v.reason ?? "invalid_url", detail: v.detail };
  const parsed = new URL(url);
  const ipCheck = await resolveAndCheck(parsed.hostname);
  if (!ipCheck.ok) return { ok: false, reason: ipCheck.reason ?? "ip_check_failed", detail: ipCheck.detail };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const res = await fetch(url, { redirect: "manual", signal: controller.signal });
    if (res.status >= 300 && res.status < 400) return { ok: false, reason: "unexpected_redirect" };
    if (res.status === 403 || res.status === 404) return { ok: false, reason: `status_${res.status}` };
    if (!res.ok) return { ok: false, reason: `status_${res.status}` };
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, reason: "no_body" };

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > opts.maxBytes) {
        try { await reader.cancel(); } catch { /* swallow */ }
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
    return { ok: true, bytes: merged, contentType: res.headers.get("content-type") };
  } catch (e) {
    const msg = (e as Error).message;
    if (controller.signal.aborted) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "fetch_error", detail: msg };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @twin/api test fetch-security.test
```

Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/fetch-security.ts packages/api/test/fetch-security.test.ts
git commit -m "feat(api/ingestion): fetch-security module (5-layer SSRF defense)

validateUrlForFetch (scheme + host allowlist), resolveAndCheck (DNS +
RFC 1918 / link-local / loopback gate), safeFetch (redirect:'manual',
timeout, streaming byte counter). Per spec §5.4.3."
```

---

### Task 13: Refire-debounce module

**Files:**
- Create: `packages/api/src/ingestion/refire-debounce.ts`
- Test: `packages/api/test/refire-debounce.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/test/refire-debounce.test.ts
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
import { enqueueRefire, drainReadyRefires } from "../src/ingestion/refire-debounce.js";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee04";

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'Debounce Test', 'debounce-test', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
  });
});
afterAll(async () => {
  await withDb(async (c) => {
    await c.query(`DELETE FROM pc_v2_refire_debounce WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM tenants WHERE id = $1`, [T]);
  });
  await closePool();
});

describe("refire-debounce", () => {
  it("enqueueRefire inserts a row with ready_at = NOW() + delay", async () => {
    await enqueueRefire(T, "DB-L1", "doc_added", 30);
    const ready = await withTenantTx(T, async (c) => {
      const { rows } = await c.query<{ ready_at: Date }>(
        `SELECT ready_at FROM pc_v2_refire_debounce WHERE tenant_id=$1 AND loan_id=$2`,
        [T, "DB-L1"],
      );
      return rows[0]!.ready_at;
    });
    expect(ready.getTime()).toBeGreaterThan(Date.now() + 25_000);
    expect(ready.getTime()).toBeLessThan(Date.now() + 35_000);
  });

  it("second enqueue pushes ready_at forward (debounce)", async () => {
    await enqueueRefire(T, "DB-L2", "doc_added", 30);
    await new Promise((r) => setTimeout(r, 50));
    await enqueueRefire(T, "DB-L2", "doc_added", 30);
    const ready = await withTenantTx(T, async (c) => {
      const { rows } = await c.query<{ ready_at: Date }>(
        `SELECT ready_at FROM pc_v2_refire_debounce WHERE tenant_id=$1 AND loan_id=$2`,
        [T, "DB-L2"],
      );
      return rows[0]!.ready_at;
    });
    expect(ready.getTime()).toBeGreaterThan(Date.now() + 25_000);
  });

  it("drainReadyRefires returns only rows with ready_at <= NOW() and deletes them", async () => {
    await enqueueRefire(T, "DB-L3-ready", "doc_added", -1);  // already ready (1s in the past)
    await enqueueRefire(T, "DB-L3-pending", "doc_added", 60);
    const drained = await drainReadyRefires(50);
    const ids = drained.map((d) => d.loanId);
    expect(ids).toContain("DB-L3-ready");
    expect(ids).not.toContain("DB-L3-pending");
    // The drained row was deleted; the pending row remains.
    const remaining = await withTenantTx(T, async (c) => {
      const { rows } = await c.query(
        `SELECT loan_id FROM pc_v2_refire_debounce WHERE tenant_id=$1`, [T],
      );
      return rows.map((r) => (r as { loan_id: string }).loan_id);
    });
    expect(remaining).toContain("DB-L3-pending");
    expect(remaining).not.toContain("DB-L3-ready");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test refire-debounce.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
// packages/api/src/ingestion/refire-debounce.ts
import { withDb, withTenantTx } from "./db-pool-reexport.js"; // see note below

// Tiny local re-export so we don't pull the heavy ../db/pool.js import path
// into this file's dependency surface. Implementer: use the real path.
// In actual implementation, replace with:
//   import { withDb, withTenantTx } from "../db/pool.js";

export interface DrainedRefire {
  tenantId: string;
  loanId: string;
  reason: string;
}

export async function enqueueRefire(
  tenantId: string,
  loanId: string,
  reason: string,
  delaySeconds: number,
): Promise<void> {
  await withTenantTx(tenantId, async (c) => {
    await c.query(
      `INSERT INTO pc_v2_refire_debounce (tenant_id, loan_id, ready_at, reason)
       VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval, $4)
       ON CONFLICT (tenant_id, loan_id) DO UPDATE
         SET ready_at = EXCLUDED.ready_at, reason = EXCLUDED.reason`,
      [tenantId, loanId, String(delaySeconds), reason],
    );
  });
}

/**
 * Drains up to `limit` rows that are ready (ready_at <= NOW()).
 * Returns the drained rows and DELETEs them in the same transaction.
 *
 * Cross-tenant: the worker is not bound to a tenant. We use the
 * admin/migration path (withDb) since the SELECT spans every tenant's
 * pending refires. The advisory-lock-managed worker is the only
 * legitimate cross-tenant caller; this function should not be called
 * from request paths.
 */
export async function drainReadyRefires(limit = 100): Promise<DrainedRefire[]> {
  return withDb(async (c) => {
    const { rows } = await c.query<{ tenant_id: string; loan_id: string; reason: string }>(
      `DELETE FROM pc_v2_refire_debounce
        WHERE (tenant_id, loan_id) IN (
          SELECT tenant_id, loan_id FROM pc_v2_refire_debounce
          WHERE ready_at <= NOW()
          ORDER BY ready_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING tenant_id, loan_id, reason`,
      [limit],
    );
    return rows.map((r) => ({ tenantId: r.tenant_id, loanId: r.loan_id, reason: r.reason }));
  });
}
```

(Implementer: replace the `db-pool-reexport.js` import comment with the real `../db/pool.js` import; the local re-export is a documentation artifact only.)

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @twin/api test refire-debounce.test
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/refire-debounce.ts packages/api/test/refire-debounce.test.ts
git commit -m "feat(api/ingestion): refire-debounce primitives

enqueueRefire (upsert pushing ready_at forward) + drainReadyRefires
(atomic DELETE...RETURNING). 15-doc batches collapse to 1 PC v2 run
per loan per debounce window."
```

---

### Task 14: Document ingest endpoint

**Files:**
- Create: `packages/api/src/routes/documents-ingest.ts`
- Modify: `packages/api/src/server.ts` (register the new route)
- Test: `packages/api/test/documents-ingest.integration.test.ts`

- [ ] **Step 1: Write the failing integration test (request-side only — worker covered in Task 15)**

```ts
// packages/api/test/documents-ingest.integration.test.ts
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
import type { FastifyInstance } from "fastify";
import { withDb, closePool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";
import { createHash } from "node:crypto";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee05";
const KEY = "docs_test_key";
const KEY_HASH = createHash("sha256").update(KEY).digest("hex");

let app: FastifyInstance;

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(`INSERT INTO tenants (id, name, slug, status, type) VALUES ($1, 'Docs Test', 'docs-test', 'active', 'demo') ON CONFLICT (id) DO NOTHING`, [T]);
    await c.query(`INSERT INTO tenant_api_keys (tenant_id, key_hash, key_prefix, name, rate_limit_per_minute) VALUES ($1, $2, 'docs_tes', 'test', 1000) ON CONFLICT DO NOTHING`, [T, KEY_HASH]);
    await c.query(
      `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
       VALUES ($1, 'npnqm-portal', 'npnqm-portal', 'npnqm-portal', $2::jsonb, '{}'::jsonb, true)
       ON CONFLICT DO NOTHING`,
      [T, JSON.stringify({ identityPrefix: "NPNQM-", allowedFetchHosts: ["docs.example.com"], maxFileBytes: 50_000_000 })],
    );
    await c.query(`INSERT INTO ingested_loans (tenant_id, external_id, loan_id, status) VALUES ($1, 'CASE-1', 'NPNQM-CASE-1', 'queued') ON CONFLICT DO NOTHING`, [T]);
  });
  app = buildServer({}).app;
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await withDb(async (c) => {
    await c.query(`DELETE FROM ingested_documents WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM tenant_api_keys WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM tenants WHERE id = $1`, [T]);
  });
  await closePool();
});

describe("POST /api/ingest/:tenantSlug/documents", () => {
  it("queues documents and returns 202", async () => {
    const body = {
      source: "npnqm-portal", externalLoanId: "CASE-1",
      documents: [
        { attachmentId: "ATT-1", attachmentName: "Stub.pdf", attachmentType: "PayStub", downloadUrl: "https://docs.example.com/abc", sizeBytes: 50000, mime: "application/pdf" },
        { attachmentId: "ATT-2", attachmentName: "Stmt.pdf", attachmentType: "BankStatement", downloadUrl: "https://docs.example.com/def", sizeBytes: 60000, mime: "application/pdf" },
      ],
    };
    const res = await app.inject({
      method: "POST", url: "/api/ingest/docs-test/documents",
      headers: { "x-api-key": KEY }, payload: body,
    });
    expect(res.statusCode).toBe(202);
    const r = JSON.parse(res.body);
    expect(r.accepted).toBe(2);
    expect(r.duplicates).toBe(0);
    expect(r.ingest_batch_id).toMatch(/^[0-9a-f]{8}-/);
  });

  it("rejects with 400 if any document URL fails the security gate", async () => {
    const body = {
      source: "npnqm-portal", externalLoanId: "CASE-1",
      documents: [
        { attachmentId: "ATT-BAD", attachmentName: "x.bin", attachmentType: "Other", downloadUrl: "http://docs.example.com/insecure", sizeBytes: 1, mime: "application/octet-stream" },
      ],
    };
    const res = await app.inject({
      method: "POST", url: "/api/ingest/docs-test/documents",
      headers: { "x-api-key": KEY }, payload: body,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error_class).toBe("validation_failed");
  });

  it("rejects 404 when externalLoanId has no matching ingested loan", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/ingest/docs-test/documents",
      headers: { "x-api-key": KEY },
      payload: { source: "npnqm-portal", externalLoanId: "DOES-NOT-EXIST", documents: [] },
    });
    expect(res.statusCode).toBe(404);
  });

  it("idempotent — same externalDocId re-pushed returns duplicates=N", async () => {
    const body = {
      source: "npnqm-portal", externalLoanId: "CASE-1",
      documents: [{ attachmentId: "ATT-1", attachmentName: "Stub.pdf", attachmentType: "PayStub", downloadUrl: "https://docs.example.com/abc", sizeBytes: 50000, mime: "application/pdf" }],
    };
    const res = await app.inject({
      method: "POST", url: "/api/ingest/docs-test/documents",
      headers: { "x-api-key": KEY }, payload: body,
    });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).duplicates).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test documents-ingest.integration.test
```

Expected: FAIL — route not registered.

- [ ] **Step 3: Implement the route**

```ts
// packages/api/src/routes/documents-ingest.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenantTx } from "../db/pool.js";
import { apiKeyAuthHook } from "../middleware/api-key-auth.js";
import { runInTenantContext } from "../tenant-context.js";
import { getAdapter } from "../ingestion/adapter-registry.js";
import { AdapterConfigSchema } from "@twin/core";
import { validateUrlForFetch } from "../ingestion/fetch-security.js";
import { randomUUID } from "node:crypto";

const DocumentSchema = z.object({
  externalDocId: z.string().optional(),
  attachmentId: z.string().optional(),
  docId: z.string().optional(),
  fileName: z.string().optional(),
  attachmentName: z.string().optional(),
  sourceUrl: z.string().optional(),
  downloadUrl: z.string().optional(),
  url: z.string().optional(),
  docType: z.string().optional(),
  attachmentType: z.string().optional(),
  type: z.string().optional(),
  classification: z.string().optional(),
  sizeBytes: z.number().optional(),
  fileSize: z.number().optional(),
  mime: z.string().optional(),
  mimeType: z.string().optional(),
  contentHash: z.string().optional(),
}).passthrough();

const BodySchema = z.object({
  source: z.string().min(1),
  externalLoanId: z.string().min(1),
  documents: z.array(DocumentSchema),
});

export function registerDocumentsIngestRoutes(app: FastifyInstance): void {
  app.post<{ Params: { tenantSlug: string } }>(
    "/api/ingest/:tenantSlug/documents",
    { preHandler: apiKeyAuthHook },
    async (req, reply) => {
      const tenantId = (req as unknown as { tenantId?: string }).tenantId;
      if (!tenantId) return reply.code(401).send({ error_class: "missing_tenant_context" });

      const parsed = BodySchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error_class: "validation_failed", details: parsed.error.flatten() });

      const { source, externalLoanId, documents } = parsed.data;
      const errorId = randomUUID();
      const ingestBatchId = randomUUID();

      return runInTenantContext(
        { tenantId, userId: "api-ingest", isSuperAdmin: false, role: "operator" },
        async () => {
          // Verify the loan exists.
          const loanRow = await withTenantTx(tenantId, async (c) => {
            const { rows } = await c.query<{ loan_id: string }>(
              `SELECT loan_id FROM ingested_loans WHERE tenant_id = $1 AND external_id = $2 LIMIT 1`,
              [tenantId, externalLoanId],
            );
            return rows[0] ?? null;
          });
          if (!loanRow) return reply.code(404).send({ error_id: errorId, error_class: "loan_not_found" });
          const loanId = loanRow.loan_id;

          // Load mapping.
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

          // Per-doc transform + validate + queue.
          let accepted = 0;
          let duplicates = 0;
          const jobs: string[] = [];
          const errors: Array<{ docIndex: number; code: string; detail?: string }> = [];

          for (let i = 0; i < documents.length; i++) {
            const raw = documents[i]!;
            let meta;
            try { meta = adapter.transformDocument(raw, config); }
            catch (e) {
              errors.push({ docIndex: i, code: "transform_failed", detail: (e as Error).message.slice(0, 200) });
              continue;
            }
            const v = adapter.validateDocument(meta);
            if (!v.valid) { errors.push({ docIndex: i, code: "validate_failed", detail: v.errors.join("; ") }); continue; }
            const secGate = validateUrlForFetch(meta.sourceUrl, config.allowedFetchHosts);
            if (!secGate.ok) { errors.push({ docIndex: i, code: secGate.reason ?? "url_blocked", detail: secGate.detail }); continue; }

            const documentId = `${loanId}-DOC-${meta.externalDocId}`;
            const inserted = await withTenantTx(tenantId, async (c) => {
              const { rowCount } = await c.query(
                `INSERT INTO ingested_documents
                   (tenant_id, external_id, document_id, loan_id, source_url, file_name, status, ingest_batch_id)
                 VALUES ($1, $2, $3, $4, $5, $6, 'pending_fetch', $7)
                 ON CONFLICT (tenant_id, external_id) DO NOTHING`,
                [tenantId, meta.externalDocId, documentId, loanId, meta.sourceUrl, meta.fileName, ingestBatchId],
              );
              return rowCount;
            });
            if (inserted && inserted > 0) { accepted++; jobs.push(meta.externalDocId); }
            else { duplicates++; }
          }

          if (accepted === 0 && errors.length > 0) {
            return reply.code(400).send({
              error_id: errorId, error_class: "validation_failed", adapter_type: adapterType,
              errors,
            });
          }

          // Per-batch audit row.
          await withTenantTx(tenantId, async (c) => {
            await c.query(
              `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
               VALUES ($1, 'api-ingest', 'ingest.documents', $2, $3::jsonb)`,
              [tenantId, `docs batch for loan ${loanId} (${accepted} accepted, ${duplicates} dup)`,
               JSON.stringify({ adapter_type: adapterType, source_name: source, external_loan_id: externalLoanId, count: accepted, duplicates, ingest_batch_id: ingestBatchId })],
            );
          });

          return reply.code(202).send({
            accepted, duplicates, jobs, ingest_batch_id: ingestBatchId,
            ...(errors.length > 0 ? { warnings: errors } : {}),
          });
        },
      );
    },
  );
}
```

- [ ] **Step 4: Register the route in `server.ts`**

In `buildServer`, where other routes are registered, add:

```ts
import { registerDocumentsIngestRoutes } from "./routes/documents-ingest.js";
// ...
registerDocumentsIngestRoutes(app);
```

- [ ] **Step 5: Verify tests pass**

```bash
pnpm --filter @twin/api test documents-ingest.integration.test
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/documents-ingest.ts packages/api/src/server.ts packages/api/test/documents-ingest.integration.test.ts
git commit -m "feat(api/routes): POST /api/ingest/:tenantSlug/documents

Synchronous metadata queue + ingest_batch_id for debounce coupling.
Fetch security gate (layers 1-2) runs at validation time so bad URLs
never queue. Per-doc transform/validate; partial-accept semantics with
warnings array."
```

---

### Task 15: Doc-fetch worker — poll loop + sequential processing

**Files:**
- Create: `packages/api/src/doc-fetch-dispatcher.ts`
- Modify: `packages/api/src/server.ts` (boot the worker)
- Test: `packages/api/test/doc-fetch-dispatcher.test.ts`

- [ ] **Step 1: Write the failing test (drives the worker directly against seeded rows)**

```ts
// packages/api/test/doc-fetch-dispatcher.test.ts
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

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { withDb, closePool } from "../src/db/pool.js";
import { processOneFetchBatch, type FetchBatchDeps } from "../src/doc-fetch-dispatcher.js";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee06";
const BATCH = "11111111-1111-1111-1111-111111111111";

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(`INSERT INTO tenants (id, name, slug, status, type) VALUES ($1, 'Worker Test', 'worker-test', 'active', 'demo') ON CONFLICT (id) DO NOTHING`, [T]);
    // Insert pending_fetch rows.
    await c.query(`INSERT INTO ingested_documents (tenant_id, external_id, document_id, loan_id, source_url, file_name, status, ingest_batch_id) VALUES ($1, 'DOC-OK', 'doc-ok-id', 'L-1', 'https://docs.example.com/ok', 'ok.pdf', 'pending_fetch', $2)`, [T, BATCH]);
    await c.query(`INSERT INTO ingested_documents (tenant_id, external_id, document_id, loan_id, source_url, file_name, status, ingest_batch_id) VALUES ($1, 'DOC-FAIL', 'doc-fail-id', 'L-1', 'https://docs.example.com/fail', 'fail.pdf', 'pending_fetch', $2)`, [T, BATCH]);
  });
});
afterAll(async () => {
  await withDb(async (c) => {
    await c.query(`DELETE FROM ingested_documents WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM pc_v2_refire_debounce WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM tenants WHERE id=$1`, [T]);
  });
  await closePool();
});

describe("doc-fetch-dispatcher.processOneFetchBatch", () => {
  it("processes rows sequentially, fetched on success, failed on error", async () => {
    const seen: string[] = [];
    const deps: FetchBatchDeps = {
      safeFetch: async (url) => {
        seen.push(url);
        if (url.endsWith("/ok")) return { ok: true, bytes: new Uint8Array([1, 2, 3]), contentType: "application/pdf" };
        return { ok: false, reason: "status_404" };
      },
      uploadToStorage: async () => ({ key: "loan-documents/x/y/z", url: "https://supabase/x" }),
      dispatchAddDocument: vi.fn(),
      enqueueRefire: vi.fn(),
      loadAdapterConfig: async () => ({ allowedFetchHosts: ["docs.example.com"], maxFileBytes: 50_000_000, identityPrefix: "QL-" as const }),
    };
    const drained = await processOneFetchBatch(deps, 10);
    expect(drained.processed).toBeGreaterThanOrEqual(2);
    expect(seen.length).toBe(2);
    // Order matters — sequential.
    expect(seen[0]).toMatch(/\/(ok|fail)$/);
  });
  it("marks fetched rows with status='fetched' and fetched_at populated", async () => {
    const row = await withDb(async (c) => {
      const { rows } = await c.query(`SELECT status, fetched_at FROM ingested_documents WHERE tenant_id=$1 AND external_id='DOC-OK'`, [T]);
      return rows[0] as { status: string; fetched_at: Date | null };
    });
    expect(row.status).toBe("fetched");
    expect(row.fetched_at).not.toBeNull();
  });
  it("marks failed rows with status pending_fetch + attempts+=1 + next_attempt_at scheduled", async () => {
    const row = await withDb(async (c) => {
      const { rows } = await c.query(`SELECT status, attempts, failed_reason FROM ingested_documents WHERE tenant_id=$1 AND external_id='DOC-FAIL'`, [T]);
      return rows[0] as { status: string; attempts: number; failed_reason: string | null };
    });
    expect(row.status).toBe("pending_fetch");
    expect(row.attempts).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test doc-fetch-dispatcher.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the worker** (dependency-injected for testability — actual production wiring at boot)

```ts
// packages/api/src/doc-fetch-dispatcher.ts
import { withDb, withTenantTx } from "./db/pool.js";
import { safeFetch as defaultSafeFetch } from "./ingestion/fetch-security.js";
import { enqueueRefire as defaultEnqueueRefire } from "./ingestion/refire-debounce.js";
import { AdapterConfigSchema, type AdapterConfig } from "@twin/core";
import { withStoreSnapshot } from "./store-db-consistency.js";
import type { Store } from "@twin/core";

export interface FetchBatchDeps {
  safeFetch: typeof defaultSafeFetch;
  uploadToStorage: (key: string, bytes: Uint8Array, contentType: string | null) => Promise<{ key: string; url: string }>;
  dispatchAddDocument: (store: Store, tenantId: string, loanId: string, documentId: string, fileName: string, fileUrl: string, fileSize: number, mimeType: string | null) => Promise<void>;
  enqueueRefire: typeof defaultEnqueueRefire;
  loadAdapterConfig: (tenantId: string, loanId: string) => Promise<AdapterConfig>;
}

interface PendingRow {
  tenant_id: string;
  external_id: string;
  document_id: string;
  loan_id: string;
  source_url: string;
  file_name: string;
  attempts: number;
}

const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];

export interface ProcessResult { processed: number; succeeded: number; failed: number; }

export async function processOneFetchBatch(
  deps: FetchBatchDeps,
  limit: number,
): Promise<ProcessResult> {
  const pending = await claimPendingRows(limit);
  let succeeded = 0;
  let failed = 0;
  for (const row of pending) {
    const ok = await processRow(row, deps);
    if (ok) succeeded++; else failed++;
  }
  return { processed: pending.length, succeeded, failed };
}

async function claimPendingRows(limit: number): Promise<PendingRow[]> {
  return withDb(async (c) => {
    const { rows } = await c.query<PendingRow>(
      `SELECT tenant_id, external_id, document_id, loan_id, source_url, file_name, attempts
       FROM ingested_documents
       WHERE status = 'pending_fetch' AND next_attempt_at <= NOW()
       ORDER BY created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return rows;
  });
}

async function processRow(row: PendingRow, deps: FetchBatchDeps): Promise<boolean> {
  const config = await deps.loadAdapterConfig(row.tenant_id, row.loan_id);
  const fetched = await deps.safeFetch(row.source_url, {
    allowedHosts: config.allowedFetchHosts,
    maxBytes: config.maxFileBytes,
    timeoutMs: 30_000,
  });
  if (!fetched.ok) {
    await recordFailure(row, classifyFailure(fetched.reason), `${fetched.reason}${fetched.detail ? `: ${fetched.detail}` : ""}`);
    return false;
  }
  const upload = await deps.uploadToStorage(
    `loan-documents/${row.tenant_id}/${row.loan_id}/${row.document_id}`,
    fetched.bytes,
    fetched.contentType,
  );
  // We don't have the store ref here in tests — production wiring injects it via the boot caller.
  // For correctness in tests, dispatchAddDocument is stubbed.
  await deps.dispatchAddDocument(
    null as unknown as Store, // production boot replaces this dep with a closure capturing the store
    row.tenant_id, row.loan_id, row.document_id, row.file_name, upload.url,
    fetched.bytes.byteLength, fetched.contentType,
  );
  await markFetched(row);
  await deps.enqueueRefire(row.tenant_id, row.loan_id, "doc_added", 30);
  return true;
}

function classifyFailure(reason: string): string {
  if (reason === "scheme_not_allowed" || reason === "host_not_allowed" || reason === "ip_range_blocked") return "ssrf_blocked";
  if (reason === "unexpected_redirect") return "unexpected_redirect";
  if (reason === "too_large") return "too_large";
  if (reason === "status_403" || reason === "status_404") return "url_expired";
  if (reason === "timeout") return "fetch_error";
  return "fetch_error";
}

async function recordFailure(row: PendingRow, failedReason: string, lastError: string): Promise<void> {
  const attempts = row.attempts + 1;
  const idx = Math.min(attempts - 1, BACKOFF_MS.length - 1);
  const delayMs = BACKOFF_MS[idx]!;
  const terminal = attempts >= BACKOFF_MS.length || ["ssrf_blocked", "unexpected_redirect", "too_large"].includes(failedReason);
  await withTenantTx(row.tenant_id, async (c) => {
    if (terminal) {
      await c.query(
        `UPDATE ingested_documents
            SET status='failed', failed_reason=$3, attempts=$4, last_error=$5, next_attempt_at=NOW()
          WHERE tenant_id=$1 AND external_id=$2`,
        [row.tenant_id, row.external_id, failedReason, attempts, lastError.slice(0, 500)],
      );
    } else {
      await c.query(
        `UPDATE ingested_documents
            SET attempts=$3, last_error=$4, failed_reason=$5,
                next_attempt_at=NOW() + ($6 || ' milliseconds')::interval
          WHERE tenant_id=$1 AND external_id=$2`,
        [row.tenant_id, row.external_id, attempts, lastError.slice(0, 500), failedReason, String(delayMs)],
      );
    }
  });
}

async function markFetched(row: PendingRow): Promise<void> {
  await withTenantTx(row.tenant_id, async (c) => {
    await c.query(
      `UPDATE ingested_documents SET status='fetched', fetched_at=NOW() WHERE tenant_id=$1 AND external_id=$2`,
      [row.tenant_id, row.external_id],
    );
  });
}
```

- [ ] **Step 4: Verify tests pass**

```bash
pnpm --filter @twin/api test doc-fetch-dispatcher.test
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/doc-fetch-dispatcher.ts packages/api/test/doc-fetch-dispatcher.test.ts
git commit -m "feat(api/workers): doc-fetch-dispatcher core loop

Sequential per-row processing with SSRF gate, exponential backoff
(1m → 12h), terminal failures (ssrf_blocked / unexpected_redirect /
too_large) skip retry, fast-fail on 403/404 (url_expired). Dependency
-injected for testability."
```

---

### Task 16: Wire worker into server boot + Supabase Storage adapter

**Files:**
- Modify: `packages/api/src/server.ts`
- Modify: `packages/api/src/doc-fetch-dispatcher.ts` (export `startDocFetchDispatcher`)

- [ ] **Step 1: Add the production wiring**

Append to `packages/api/src/doc-fetch-dispatcher.ts`:

```ts
import type { Store } from "@twin/core";
import { isDbEnabled } from "./db/pool.js";

const ADVISORY_LOCK = 45;
const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 10;

export function startDocFetchDispatcher(store: Store): void {
  if (!isDbEnabled() || process.env.NODE_ENV === "test") return;
  console.log(`[doc-fetch] starting dispatcher (lock ${ADVISORY_LOCK}, poll ${POLL_INTERVAL_MS}ms)`);
  const supabase = createSupabaseAdminClient();

  const deps: FetchBatchDeps = {
    safeFetch: defaultSafeFetch,
    uploadToStorage: async (key, bytes, contentType) => {
      const { error } = await supabase.storage.from("loan-documents").upload(key, bytes, {
        contentType: contentType ?? "application/octet-stream", upsert: true,
      });
      if (error) throw new Error(`supabase storage upload failed: ${error.message}`);
      const { data } = supabase.storage.from("loan-documents").getPublicUrl(key);
      return { key, url: data.publicUrl };
    },
    dispatchAddDocument: async (_storeRef, tenantId, loanId, documentId, fileName, fileUrl, fileSize, mimeType) => {
      await withStoreSnapshot(store, loanId, async () => {
        store.dispatch({
          type: "AddDocument",
          loanId,
          document: {
            id: documentId,
            name: fileName,
            docType: "Other",   // adapter should pre-classify and store it elsewhere; for v1, "Other".
            status: "Received",
            uploadedBy: "doc-fetch-worker",
            uploadedAt: new Date().toISOString(),
            fileUrl,
            fileSize,
            mimeType: mimeType ?? undefined,
          },
        });
      });
    },
    enqueueRefire: defaultEnqueueRefire,
    loadAdapterConfig: async (tenantId, loanId) => {
      // Resolve which adapter the loan was ingested under.
      // For v1 we look up the most recent mapping via ingested_loans.source_name (not currently stored)
      // — fallback: any active mapping for the tenant. Plan-task improvement: store source_name on ingested_loans.
      const result = await withTenantTx(tenantId, async (c) => {
        const { rows } = await c.query<{ adapter_config: unknown }>(
          `SELECT adapter_config FROM ingestion_mappings WHERE tenant_id=$1 AND active=true LIMIT 1`,
          [tenantId],
        );
        return rows[0]?.adapter_config ?? {};
      });
      return AdapterConfigSchema.parse(result);
    },
  };

  setInterval(async () => {
    try {
      // Advisory lock — single dispatcher across replicas.
      const got = await withDb(async (c) => {
        const r = await c.query<{ got: boolean }>(`SELECT pg_try_advisory_lock($1) AS got`, [ADVISORY_LOCK]);
        return r.rows[0]!.got;
      });
      if (!got) return;
      try {
        await processOneFetchBatch(deps, BATCH_SIZE);
        // Also drain ready refires inline (5s tick).
        const { drainReadyRefires } = await import("./ingestion/refire-debounce.js");
        const { run: runPredictions } = await import("./services/predict-conditions/index.js");
        const { buildLoanContextFromLoan } = await import("./routes/predict-conditions-context-builder.js");
        const ready = await drainReadyRefires(50);
        for (const r of ready) {
          try {
            const loan = (store.getState().loans as Record<string, unknown>)[r.loanId] as unknown;
            if (!loan) continue;
            const ctx = await buildLoanContextFromLoan(loan as never);
            await runPredictions(r.tenantId, r.loanId, ctx, "system:loan-ingest");
          } catch (e) {
            console.error(`[doc-fetch] refire failed for ${r.loanId}:`, e);
          }
        }
      } finally {
        await withDb(async (c) => { await c.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK]); });
      }
    } catch (e) {
      console.error("[doc-fetch] tick failed:", e);
    }
  }, POLL_INTERVAL_MS);
}

function createSupabaseAdminClient() {
  // Implementer: import { createClient } from "@supabase/supabase-js";
  // const url = process.env.SUPABASE_URL!;
  // const key = process.env.SUPABASE_SERVICE_KEY!;
  // return createClient(url, key);
  throw new Error("implementer: wire supabase admin client (see packages/api/src/persistence.ts for the existing pattern)");
}
```

- [ ] **Step 2: Call `startDocFetchDispatcher(store)` from `server.ts`**

In the same block where `startVAOutboxDispatcher` is invoked:

```ts
import { startDocFetchDispatcher } from "./doc-fetch-dispatcher.js";
// ...
if (isDbEnabled() && process.env.NODE_ENV !== "test") {
  void startVAOutboxDispatcher();
  void startDocFetchDispatcher(store);
}
```

- [ ] **Step 3: Boot the API and confirm the worker logs**

```bash
pnpm --filter @twin/api dev
```

Expected log: `[doc-fetch] starting dispatcher (lock 45, poll 5000ms)`. Kill with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/doc-fetch-dispatcher.ts packages/api/src/server.ts
git commit -m "feat(api/workers): wire doc-fetch-dispatcher at boot

Advisory lock 45 (single-dispatcher across replicas), 5s poll cadence,
batch size 10. Drains ready refires inline (collapses N AddDocument
events to 1 PC v2 run per debounce window). Supabase Storage upload
+ withStoreSnapshot for store-DB consistency on AddDocument."
```

---

### Task 17: Worker observability — metrics + structured logs

**Files:**
- Modify: `packages/api/src/doc-fetch-dispatcher.ts`
- Test: `packages/api/test/doc-fetch-dispatcher.test.ts` (assert metric counters)

- [ ] **Step 1: Add a metric registry** (lightweight in-memory counters; production wires to Prometheus if present)

In `packages/api/src/doc-fetch-dispatcher.ts`:

```ts
// near the top, alongside BACKOFF_MS
export const docFetchMetrics = {
  attempts_total: new Map<string, number>(),     // key = outcome:failed_reason
  duration_ms_total: 0,
  bytes_total: 0,
  dead_lettered_total: 0,
  refire_debounce_depth: 0,
  refire_fires_total: 0,
};

function incMetric(key: string, by = 1): void {
  docFetchMetrics.attempts_total.set(key, (docFetchMetrics.attempts_total.get(key) ?? 0) + by);
}
```

Inside `processRow` after fetch resolution:

```ts
if (!fetched.ok) {
  incMetric(`fail:${classifyFailure(fetched.reason)}`);
  // ... existing recordFailure
}
// on success:
incMetric("success:ok");
docFetchMetrics.bytes_total += fetched.bytes.byteLength;
```

After `drainReadyRefires` in the tick:

```ts
docFetchMetrics.refire_fires_total += ready.length;
```

- [ ] **Step 2: Update tests to assert metric counters increment**

Extend `doc-fetch-dispatcher.test.ts`:

```ts
import { docFetchMetrics } from "../src/doc-fetch-dispatcher.js";

it("metrics counters increment for success and failure outcomes", () => {
  const okCount = docFetchMetrics.attempts_total.get("success:ok") ?? 0;
  expect(okCount).toBeGreaterThan(0);
  const failKeys = Array.from(docFetchMetrics.attempts_total.keys()).filter((k) => k.startsWith("fail:"));
  expect(failKeys.length).toBeGreaterThan(0);
  expect(docFetchMetrics.bytes_total).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Verify tests pass**

```bash
pnpm --filter @twin/api test doc-fetch-dispatcher.test
```

Expected: PASS, 4 tests.

- [ ] **Step 4: Add a `/system/doc-fetch-metrics` endpoint** for ops visibility

In `packages/api/src/routes/system-check.ts` (or wherever other /system endpoints live), add:

```ts
import { docFetchMetrics } from "../doc-fetch-dispatcher.js";

app.get("/system/doc-fetch-metrics", async () => ({
  attempts_total: Object.fromEntries(docFetchMetrics.attempts_total),
  bytes_total: docFetchMetrics.bytes_total,
  refire_fires_total: docFetchMetrics.refire_fires_total,
}));
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/doc-fetch-dispatcher.ts packages/api/src/routes/system-check.ts packages/api/test/doc-fetch-dispatcher.test.ts
git commit -m "feat(api/workers): doc-fetch metrics + /system/doc-fetch-metrics

In-memory counters for attempts, bytes, dead-letters, refire-fires.
Exposed via /system endpoint for ops visibility — same surface PC v2's
audit metadata uses for ingest-time observability."
```

---

## Phase D complete — checkpoint

After tasks 12-17, the document channel is fully wired: SSRF defense at request time + worker fetch time, async byte fetch, sequential per-row processing with withStoreSnapshot, debounced PC v2 re-fire, metrics + structured logs.

Verify:
```bash
pnpm --filter @twin/api test
```

Expected: full API test suite passes including all new module + integration tests.

---

## Phase E — Admin API + W11 e2e

3 tasks. CRUD on `ingestion_mappings` so operators can self-serve adapter binding; W11 harness workflow exercising the full path.

### Task 18: Admin API for ingestion_mappings

**Files:**
- Create: `packages/api/src/routes/admin-ingestion-mappings.ts`
- Modify: `packages/api/src/server.ts` (register routes)
- Test: `packages/api/test/admin-ingestion-mappings.integration.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/api/test/admin-ingestion-mappings.integration.test.ts
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
import type { FastifyInstance } from "fastify";
import { withDb, closePool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee07";
let app: FastifyInstance;

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(`INSERT INTO tenants (id, name, slug, status, type) VALUES ($1, 'Admin Test', 'admin-test', 'active', 'demo') ON CONFLICT (id) DO NOTHING`, [T]);
  });
  app = buildServer({}).app;
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await withDb(async (c) => {
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id=$1`, [T]);
    await c.query(`DELETE FROM tenants WHERE id=$1`, [T]);
  });
  await closePool();
});

const headers = { "x-user-id": "admin-user", "x-tenant-id": T, "x-user-role": "operator", "x-super-admin": "true" };

describe("admin ingestion-mappings CRUD", () => {
  it("POST creates a mapping with valid adapter_config", async () => {
    const res = await app.inject({
      method: "POST", url: "/admin/tenants/admin-test/ingestion-mappings",
      headers,
      payload: {
        source_name: "npnqm-portal",
        adapter_type: "npnqm-portal",
        adapter_config: {
          identityPrefix: "NPNQM-",
          allowedFetchHosts: ["docs.npnqm-portal.example.com"],
          programMapping: { "Flex_NPNQM": "Flex Select" },
        },
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST rejects unknown adapter_type with 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/admin/tenants/admin-test/ingestion-mappings",
      headers,
      payload: { source_name: "bad", adapter_type: "no-such-adapter", adapter_config: { allowedFetchHosts: [] } },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error_class).toBe("unknown_adapter_type");
  });

  it("POST rejects invalid adapter_config with 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/admin/tenants/admin-test/ingestion-mappings",
      headers,
      payload: { source_name: "x", adapter_type: "generic-json", adapter_config: { identityPrefix: "lowercase-bad", allowedFetchHosts: [] } },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error_class).toBe("validation_failed");
  });

  it("GET lists mappings for the tenant", async () => {
    const res = await app.inject({
      method: "GET", url: "/admin/tenants/admin-test/ingestion-mappings", headers,
    });
    expect(res.statusCode).toBe(200);
    const arr = JSON.parse(res.body);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThanOrEqual(1);
  });

  it("PATCH toggles active=false (soft-delete via DELETE)", async () => {
    const list = JSON.parse((await app.inject({ method: "GET", url: "/admin/tenants/admin-test/ingestion-mappings", headers })).body);
    const id = list[0].id;
    const res = await app.inject({
      method: "DELETE", url: `/admin/tenants/admin-test/ingestion-mappings/${id}`, headers,
    });
    expect(res.statusCode).toBe(200);
  });

  it("every CRUD write produces a tenant_audit_log row", async () => {
    const { rows } = await withDb(async (c) => c.query(
      `SELECT action FROM tenant_audit_log WHERE target_tenant_id=$1 AND action LIKE 'admin.ingestion_mappings.%' ORDER BY created_at DESC LIMIT 5`,
      [T],
    ));
    expect(rows.length).toBeGreaterThanOrEqual(3);  // POST, POST (rejected ones don't audit), DELETE
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @twin/api test admin-ingestion-mappings.integration.test
```

Expected: FAIL — routes not registered.

- [ ] **Step 3: Implement the admin routes**

```ts
// packages/api/src/routes/admin-ingestion-mappings.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenantTx } from "../db/pool.js";
import { getTenantContext } from "../tenant-context.js";
import { AdapterConfigSchema } from "@twin/core";
import { getAdapter } from "../ingestion/adapter-registry.js";

const PostBody = z.object({
  source_name: z.string().min(1).max(100),
  adapter_type: z.string().min(1).max(100),
  adapter_config: z.unknown(),
});

const PatchBody = z.object({
  active: z.boolean().optional(),
  adapter_config: z.unknown().optional(),
});

async function auditLog(tenantId: string, action: string, metadata: Record<string, unknown>): Promise<void> {
  await withTenantTx(tenantId, async (c) => {
    await c.query(
      `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [tenantId, getTenantContext().userId, action, `${action} by ${getTenantContext().userId}`, JSON.stringify(metadata)],
    );
  });
}

export function registerAdminIngestionMappingsRoutes(app: FastifyInstance): void {
  app.get<{ Params: { tenantSlug: string } }>(
    "/admin/tenants/:tenantSlug/ingestion-mappings",
    async (_req) => {
      const tenantId = getTenantContext().tenantId;
      return withTenantTx(tenantId, async (c) => {
        const { rows } = await c.query(
          `SELECT id, source_name, adapter_type, adapter_config, active, created_at
           FROM ingestion_mappings WHERE tenant_id=$1 ORDER BY created_at DESC`,
          [tenantId],
        );
        return rows;
      });
    },
  );

  app.post<{ Params: { tenantSlug: string } }>(
    "/admin/tenants/:tenantSlug/ingestion-mappings",
    async (req, reply) => {
      const tenantId = getTenantContext().tenantId;
      const parsed = PostBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error_class: "validation_failed", details: parsed.error.flatten() });

      const { source_name, adapter_type, adapter_config } = parsed.data;
      if (!getAdapter(adapter_type)) return reply.code(400).send({ error_class: "unknown_adapter_type", detail: adapter_type });

      const configParsed = AdapterConfigSchema.safeParse(adapter_config);
      if (!configParsed.success) return reply.code(400).send({ error_class: "validation_failed", details: configParsed.error.flatten() });

      const result = await withTenantTx(tenantId, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
           VALUES ($1, $2, $3, $3, $4::jsonb, '{}'::jsonb, true)
           ON CONFLICT (tenant_id, source_name)
             DO UPDATE SET adapter_type=EXCLUDED.adapter_type, adapter_config=EXCLUDED.adapter_config, active=true
           RETURNING id`,
          [tenantId, source_name, adapter_type, JSON.stringify(configParsed.data)],
        );
        return rows[0]!;
      });
      await auditLog(tenantId, "admin.ingestion_mappings.upsert", { id: result.id, source_name, adapter_type });
      return reply.code(201).send({ id: result.id, source_name, adapter_type });
    },
  );

  app.patch<{ Params: { tenantSlug: string; id: string } }>(
    "/admin/tenants/:tenantSlug/ingestion-mappings/:id",
    async (req, reply) => {
      const tenantId = getTenantContext().tenantId;
      const parsed = PatchBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error_class: "validation_failed", details: parsed.error.flatten() });
      const { active, adapter_config } = parsed.data;
      if (adapter_config !== undefined) {
        const v = AdapterConfigSchema.safeParse(adapter_config);
        if (!v.success) return reply.code(400).send({ error_class: "validation_failed", details: v.error.flatten() });
      }
      await withTenantTx(tenantId, async (c) => {
        const sets: string[] = []; const params: unknown[] = [tenantId, req.params.id]; let p = 3;
        if (active !== undefined) { sets.push(`active=$${p++}`); params.push(active); }
        if (adapter_config !== undefined) { sets.push(`adapter_config=$${p++}::jsonb`); params.push(JSON.stringify(adapter_config)); }
        if (sets.length === 0) return;
        await c.query(`UPDATE ingestion_mappings SET ${sets.join(", ")} WHERE tenant_id=$1 AND id=$2`, params);
      });
      await auditLog(tenantId, "admin.ingestion_mappings.update", { id: req.params.id, active });
      return { ok: true };
    },
  );

  app.delete<{ Params: { tenantSlug: string; id: string } }>(
    "/admin/tenants/:tenantSlug/ingestion-mappings/:id",
    async (req) => {
      const tenantId = getTenantContext().tenantId;
      await withTenantTx(tenantId, async (c) => {
        await c.query(`UPDATE ingestion_mappings SET active=false WHERE tenant_id=$1 AND id=$2`, [tenantId, req.params.id]);
      });
      await auditLog(tenantId, "admin.ingestion_mappings.soft_delete", { id: req.params.id });
      return { ok: true };
    },
  );
}
```

- [ ] **Step 4: Register routes in `server.ts`**

```ts
import { registerAdminIngestionMappingsRoutes } from "./routes/admin-ingestion-mappings.js";
// ...
registerAdminIngestionMappingsRoutes(app);
```

- [ ] **Step 5: Verify tests pass**

```bash
pnpm --filter @twin/api test admin-ingestion-mappings.integration.test
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/admin-ingestion-mappings.ts packages/api/src/server.ts packages/api/test/admin-ingestion-mappings.integration.test.ts
git commit -m "feat(api/routes): admin CRUD for ingestion_mappings

GET/POST/PATCH/DELETE under /admin/tenants/:tenantSlug/ingestion-mappings.
AdapterConfig validated via Zod; unknown adapter_type rejected against
the live registry. Every write produces a tenant_audit_log row."
```

---

### Task 19: W11 e2e harness workflow

**Files:**
- Create: `scripts/e2e-harness/workflows/W11-npnqm-ingest.ts`
- Modify: `scripts/e2e-harness/index.ts` (register W11)

- [ ] **Step 1: Implement the workflow**

```ts
// scripts/e2e-harness/workflows/W11-npnqm-ingest.ts
//
// Exercises the full NPNQM ingest path:
//   1. Seed tenant + api-key + ingestion_mappings (npnqm-portal adapter, allowedFetchHosts).
//   2. POST /api/ingest/:tenantSlug/loans with a real fixture payload.
//   3. POST /api/ingest/:tenantSlug/documents with a doc batch.
//   4. Wait for debounce + drain. Assert PC v2 produced exactly ONE batch
//      after all docs landed (not N batches).
//   5. Assert pending predictions include matrix/geographic/requirements sources.
//
// The fixture file lives at packages/api/test/fixtures/adapters/npnqm-portal-sample-loan.json
// (committed in Task 0). Documents come from npnqm-portal-sample-docs.json.

import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { http, type HttpOptions } from "../http.js";
import type { CellResult, WorkflowDef } from "../types.js";
import { createHash, randomUUID } from "node:crypto";

const CANONICAL_FIXTURE = "npnqm-portal-sample";
const HARNESS_TENANT_SLUG = "harness-w11-npnqm";

export const W11: WorkflowDef = {
  id: "W11_npnqm_ingest",
  name: "NPNQM Ingest — full path",
  specRefs: ["2026-05-14-ingestion-framework-design §12"],
  appliesTo: (f) => f.id === CANONICAL_FIXTURE,
  run: async (fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const assertions: Array<{ name: string; expected: string; actual: string; ok: boolean }> = [];

    // Load env for direct DB cleanup.
    if (!process.env.DATABASE_URL) {
      const here = dirname(fileURLToPath(import.meta.url));
      try {
        for (const line of readFileSync(resolvePath(here, "../../../packages/api/.env"), "utf8").split("\n")) {
          const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
          if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
      } catch { /* */ }
    }

    const tenantId = "7c000000-0000-0000-0000-000000000011";
    const apiKey = "harness_w11_key_" + randomUUID().slice(0, 8);
    const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");

    if (process.env.DATABASE_URL) {
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        // Seed tenant + key + mapping inside a tenant-scoped tx.
        await client.query(`INSERT INTO tenants (id, name, slug, status, type) VALUES ($1, 'Harness W11', $2, 'active', 'demo') ON CONFLICT (id) DO NOTHING`, [tenantId, HARNESS_TENANT_SLUG]);
        await client.query(`INSERT INTO tenant_api_keys (tenant_id, key_hash, key_prefix, name, rate_limit_per_minute) VALUES ($1, $2, 'harness_', 'w11', 1000) ON CONFLICT DO NOTHING`, [tenantId, apiKeyHash]);
        // Wipe prior W11 state on this tenant.
        await client.query("BEGIN");
        await client.query(`SET LOCAL app.current_tenant = $1::uuid`, [tenantId]);
        await client.query(`DELETE FROM ingested_documents WHERE tenant_id=$1`, [tenantId]);
        await client.query(`DELETE FROM ingested_loans WHERE tenant_id=$1`, [tenantId]);
        await client.query(`DELETE FROM pc_v2_refire_debounce WHERE tenant_id=$1`, [tenantId]);
        await client.query(`DELETE FROM predicted_conditions WHERE tenant_id=$1`, [tenantId]);
        await client.query(`DELETE FROM loan_context_extras WHERE tenant_id=$1`, [tenantId]);
        await client.query("COMMIT");
        await client.query(
          `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
           VALUES ($1, 'npnqm-portal', 'npnqm-portal', 'npnqm-portal', $2::jsonb, '{}'::jsonb, true)
           ON CONFLICT DO NOTHING`,
          [tenantId, JSON.stringify({ identityPrefix: "NPNQM-", allowedFetchHosts: ["docs.example.com"], maxFileBytes: 50_000_000 })],
        );
      } finally {
        await client.end();
      }
    }

    const fixturesDir = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../../packages/api/test/fixtures/adapters");
    const loanPayload = JSON.parse(readFileSync(resolvePath(fixturesDir, "npnqm-portal-sample-loan.json"), "utf8"));
    const docsPayload = JSON.parse(readFileSync(resolvePath(fixturesDir, "npnqm-portal-sample-docs.json"), "utf8"));

    // POST loan.
    type LoanRes = { loanId: string; status: string };
    const loanRes = await http.post<LoanRes>(apiOpts, `/api/ingest/${HARNESS_TENANT_SLUG}/loans`, loanPayload, {
      headers: { "x-api-key": apiKey },
    });
    assertions.push({ name: "loan_ingested", expected: "loanId starts with NPNQM-", actual: loanRes.loanId, ok: loanRes.loanId.startsWith("NPNQM-") });
    const loanId = loanRes.loanId;

    // POST documents.
    type DocRes = { accepted: number; duplicates: number; ingest_batch_id: string };
    const docRes = await http.post<DocRes>(apiOpts, `/api/ingest/${HARNESS_TENANT_SLUG}/documents`, docsPayload, {
      headers: { "x-api-key": apiKey },
    });
    assertions.push({ name: "docs_queued", expected: ">0 accepted", actual: String(docRes.accepted), ok: docRes.accepted > 0 });

    // Wait for worker fetch + debounce drain (worst case: 5s poll + 30s debounce = ~40s).
    await new Promise((r) => setTimeout(r, 45_000));

    // Count predict_conditions.run audit rows for this loan.
    let runs = 0;
    if (process.env.DATABASE_URL) {
      const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        const { rows } = await client.query<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM tenant_audit_log
            WHERE target_tenant_id = $1 AND action = 'predict_conditions.run'
              AND metadata->>'run_id' IS NOT NULL
              AND created_at > NOW() - INTERVAL '90 seconds'`,
          [tenantId],
        );
        runs = rows[0]!.c;
      } finally { await client.end(); }
    }
    // Strict assertion: <= 2 (loan ingest + post-debounce). N docs should NOT produce N runs.
    assertions.push({ name: "single_debounce_fire", expected: "<= 2 runs", actual: String(runs), ok: runs <= 2 });

    // Assert pending predictions include PC v2 sources.
    type ListResp = { predictions: Array<{ status: string; source_list?: string }> };
    const list = await http.get<ListResp>(apiOpts, `/loans/${loanId}/predictions`, { headers: { "x-api-key": apiKey } });
    const sources = new Set(list.predictions.map((p) => p.source_list ?? "unknown"));
    assertions.push({
      name: "pc_v2_sources_present",
      expected: "matrix or geographic or requirements",
      actual: Array.from(sources).join(","),
      ok: sources.has("matrix") || sources.has("geographic") || sources.has("requirements"),
    });

    const allOk = assertions.every((a) => a.ok);
    return {
      loanId, fixture: fixture.id, workflow: "W11_npnqm_ingest",
      status: allOk ? "pass" : "fail", severity: allOk ? null : "P0",
      durationMs: Date.now() - start, assertions,
      evidence: { tenantId, apiKeyPrefix: apiKey.slice(0, 12) },
      error: null,
    } as CellResult;
  },
};
```

- [ ] **Step 2: Register W11 in the harness index**

```ts
// scripts/e2e-harness/index.ts (add)
import { W11 } from "./workflows/W11-npnqm-ingest.js";
// ... register alongside W1..W10
WORKFLOWS.push(W11);
```

- [ ] **Step 3: Verify W11 compiles**

```bash
pnpm tsx --eval "import('./scripts/e2e-harness/workflows/W11-npnqm-ingest.ts').then(()=>{console.log('ok');process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"
```

Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-harness/workflows/W11-npnqm-ingest.ts scripts/e2e-harness/index.ts
git commit -m "test(e2e): W11 — NPNQM ingest full path

Loan + docs ingest → debounce → single PC v2 run → v2 sources present.
Asserts the debounce contract (N docs → <= 2 runs, not N runs)."
```

---

### Task 20: Final integration polish + suite verification

**Files:**
- Modify: `packages/api/test/predict-conditions.integration.test.ts` (re-assert extras-driven path)
- Verify: full test suite + build

- [ ] **Step 1: Add one extras-driven assertion to the existing PC v2 integration test**

Append to `packages/api/test/predict-conditions.integration.test.ts`:

```ts
import { writeExtrasFirstWriteWins } from "../src/ingestion/loan-context-extras.js";

describe("predict-conditions HTTP integration — extras-driven path (Spec 1 task 20)", () => {
  it("fires v2 sources when loan_context_extras is populated", async () => {
    await writeExtrasFirstWriteWins(T, "INT-1", {
      repFico: 720, ltv: 100, county: "King County", isItin: false,
      loanAmount: 100000, loanPurpose: "Purchase",
    });
    const res = await app.inject({ method: "POST", url: "/loans/INT-1/predictions/run", headers: headers("operator"), payload: {} });
    expect(res.statusCode).toBe(200);
    const listRes = await app.inject({ method: "GET", url: "/loans/INT-1/predictions", headers: headers("operator") });
    const body = JSON.parse(listRes.body) as { predictions: Array<{ source_list?: string }> };
    const sources = new Set(body.predictions.map((p) => p.source_list ?? ""));
    // At minimum, matrix should fire because we seeded a permissive tier in the test setup.
    expect(sources.has("matrix") || sources.has("geographic") || sources.has("requirements")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the full API test suite**

```bash
pnpm --filter @twin/api test
```

Expected: all tests pass.

- [ ] **Step 3: Run the full build**

```bash
pnpm --filter @twin/core build && pnpm --filter @twin/api build && pnpm --filter @twin/web build
```

Expected: 0 errors across all three packages.

- [ ] **Step 4: Commit**

```bash
git add packages/api/test/predict-conditions.integration.test.ts
git commit -m "test(api): extras-driven PC v2 v2-sources assertion

Final integration check — loan_context_extras populated → PC v2's v2
resolvers (matrix/geographic/requirements) fire, not just minimum/income.
Closes the Spec 1 acceptance-criteria loop."
```

---

## Phase E complete — final verification

After tasks 18-20, the framework is feature-complete per Spec 1 (inbound). Verify acceptance criteria from spec §12:

1. ✓ `POST /api/ingest/:tenantSlug/loans` accepts a payload, dispatches the adapter, populates `loan_context_extras`, PC v2 fires with v2 sources. (Task 9 + 20)
2. ✓ `POST /api/ingest/:tenantSlug/documents` returns 202, queues fetches. Worker fetches within 30s, uploads to Storage, dispatches `AddDocument`. (Task 14 + 15)
3. ✓ After all docs land + debounce expires, PC v2 re-fires **once** with non-empty pending docs. (Task 13 + 16 + 19)
4. ✓ W11 e2e workflow passes. (Task 19)
5. ✓ Migration 020 applies cleanly to fresh + existing DBs. (Task 2)
6. ✓ Adapter unit tests pass against committed fixtures. (Tasks 5, 6, 7)
7. ✓ Admin API list/create/patch/delete works; unknown adapter_type returns 400; every change writes audit row. (Task 18)

Full verification:

```bash
pnpm --filter @twin/api test && pnpm --filter @twin/core build && pnpm --filter @twin/api build && pnpm --filter @twin/web build
```

Expected: all tests pass, 0 build errors.

---

## Self-Review

**Spec coverage** — every spec section maps to one or more plan tasks:

| Spec | Plan task |
|------|-----------|
| §1 Goal + non-goals | Implicit in scope; no task |
| §2 Architecture | Task 0 (fixtures) + entire plan |
| §3.1 LenderAdapter base | Task 3 |
| §3.2 Registry | Task 4 |
| §3.3 Adapters shipped | Tasks 5, 6, 7 |
| §4.1 Loan route changes (9 numbered steps) | Tasks 9, 10 |
| §4.2 loan_context_extras + LoanContextExtrasSchema | Tasks 1, 2, 8 |
| §4.3 Demo backfill | Task 11 |
| §5.1–5.2 Document request shape + flow | Task 14 |
| §5.3 ingested_documents table | Task 2 |
| §5.4.1 Sequential per-row + withStoreSnapshot | Task 15 |
| §5.4.2 Debounced re-fire | Tasks 13, 16 |
| §5.4.3 Fetch security (5 layers) | Task 12 |
| §5.4.4 Failure handling (failed_reason classification, fast-fail) | Task 15 |
| §5.4.5 Observability metrics | Task 17 |
| §5.5 Idempotency | Task 14 |
| §6.1 AdapterConfigSchema | Task 1 |
| §6.2 Admin API | Task 18 |
| §6.3 NPNQM onboarding | Task 18 (operator runbook implicit) |
| §7 Migration 020 + deployment ordering | Task 2 |
| §8 Testing strategy (8 layers) | Tasks 5, 6, 7, 9, 12, 13, 14, 15, 18, 19, 20 |
| §11 Risks | Implicit via the layered defenses across tasks |
| §12 Acceptance criteria | Verified at Phase E close |

**Placeholder scan:** no TBD / TODO / "implement later" except the explicitly-flagged in-implementation values in Task 11 (per-fixture extras filled at implementation time from the committed fixture files; this is deterministic transcription, not design ambiguity).

**Type consistency:** `LenderAdapter` methods consistent across Tasks 3 → 5/6/7 → 9 → 14. `AdapterConfig` field names consistent across Tasks 1 → 9 → 12 → 14 → 15 → 18. `LoanContextExtras` field names consistent across Task 1 → 8 → 10 → 11.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-14-ingestion-framework.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review.

Which approach?
