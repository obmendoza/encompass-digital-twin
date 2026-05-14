# NPNQM Ingestion Framework — Design

**Date:** 2026-05-14
**Status:** Draft (Spec 1 of 2 — inbound only; outbound writeback deferred to Spec 2)
**Predecessors:** [PC v2 Pre-Underwriter Design (2026-05-14)](2026-05-14-pc-v2-pre-underwriter-design.md), [Doc Checklist Ingest Design (2026-05-12)](2026-05-12-doc-checklist-ingest-design.md), [Multi-Tenant Platform Foundation (2026-04-23)](2026-04-23-multi-tenant-platform-foundation-design.md)

---

## 1. Goal

Build a typed, per-tenant adapter framework that lets each lender push loans and documents into UAS through their own data shape, with NPNQM (Encompass LOS + broker portal) as the first user. The framework makes tenant N+1 cheap: shared TS code per LOS family, per-tenant config overrides for the rest.

**Why now:** PC v2 just shipped but fires only on fixture loans. The matrix, geographic, and requirements resolvers silently degrade because `LoanContext` fields (`repFico`, `ltv`, `county`, `isItin`, `loanAmount`, `dti`, `reservesMonths`, `noteRate`, `llcOrLegalEntity`) are F2-deferred — emitted as `undefined` until "real ingestion is wired." Without this spec, PC v2's three new sources don't activate against production traffic.

**Non-goals (this spec):**
- Outbound writeback (Recommended Documents push, decision events). Deferred to Spec 2 — depends on NPNQM portal's outbound API contract, not yet in hand.
- Loan updates / PATCH semantics. Duplicate `external_id` returns the existing row; updates deferred.
- Admin UI. API-only in v1.
- MISMO 3.4 XML parsing. Encompass JSON only.

---

## 2. Architecture

Two inbound channels reach the framework: loan data (synchronous) and document submissions (synchronous metadata + async byte fetch). Each tenant binds to one or more typed `LenderAdapter` classes via per-tenant config rows in `ingestion_mappings`. PC v2 fires automatically on both channels.

```
┌─ Inbound (lender → us) ─────────────────────────────────────────┐
│                                                                  │
│  POST /api/ingest/:tenantSlug/loans       ← existing, extended  │
│  POST /api/ingest/:tenantSlug/documents   ← new                  │
│         │                                                        │
│         ▼                                                        │
│  apiKeyAuthHook → tenant resolved                               │
│         │                                                        │
│         ▼                                                        │
│  LenderAdapter (resolved via ingestion_mappings.adapter_type)   │
│   ├─ EncompassLOSAdapter                                         │
│   ├─ NPNQMPortalAdapter                                          │
│   └─ GenericJsonAdapter (existing, kept as fallback)             │
│         │                                                        │
│   ┌─────┴─────┐                                                  │
│   │           │                                                  │
│ loan          documents                                          │
│   │           │                                                  │
│   ▼           ▼                                                  │
│ Store         ingested_documents (status='pending_fetch')        │
│ (InjectLoan)        │                                            │
│   │                 ▼                                            │
│   ▼          doc-fetch-worker (advisory lock 45)                 │
│ loan_context_extras    fetches bytes → Supabase Storage          │
│   │                    → AddDocument dispatch → Loan.documents   │
│   ▼                    → PC v2 re-fires                          │
│ PC v2 auto-fire                                                  │
└──────────────────────────────────────────────────────────────────┘
```

**Key claims:**

- Adapter is a typed TS class implementing the `LenderAdapter` interface. Per-tenant config overrides (program-name mapping, field-path overrides, identity strategy) live in DB rows; code only changes for new LOS *families*.
- Loan channel stays synchronous (200 returns immediately after store dispatch + PC v2 auto-fire — same as today).
- Document channel is synchronous-metadata + async-bytes. Portal pushes metadata + presigned URL → 202 → worker fetches bytes to Supabase Storage → dispatches `AddDocument` → PC v2's doc-checklist resolver now sees real documents.
- The F2-deferred `LoanContext` fields are populated by the adapter via a `deriveContextFields(loan, raw, config)` hook so PC v2's matrix/geographic/requirements resolvers stop running on `undefined`.

Why this shape:

- Async doc fetch mirrors existing worker patterns (va-outbox lock 44, learning lock 43, sla-monitor lock 42 → new doc-fetch lock 45). No new infrastructure.
- Adapter-as-class + config-as-DB lets framework reason about an entire tenant integration as one coherent unit while keeping internals composable.
- Both channels write to the existing `Loan` domain model; PC v2 doesn't change.

---

## 3. Adapter Framework

### 3.1 `LenderAdapter` base class

```ts
// packages/api/src/ingestion/lender-adapter.ts (new)
export interface AdapterConfig {
  programMapping?: Record<string, NqmProgram>;
  fieldPathOverrides?: Record<string, string>;
  identityPrefix?: string;                            // "QL-" default; per-tenant override avoids cross-tenant collisions
  documentTypeMapping?: Record<string, DocumentType>; // lender's doc-type label → our canonical enum
  extras?: Record<string, unknown>;                   // adapter-specific bag
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface DocumentMetadataInput {
  externalDocId: string;        // lender's stable doc ID
  docType: DocumentType;
  fileName: string;
  contentHash?: string;
  fileSize?: number;
  mimeType?: string;
  sourceUrl: string;            // presigned URL the worker will fetch
  classification?: string;      // raw classification, audit only
}

export abstract class LenderAdapter {
  abstract readonly adapterType: string;            // "encompass-los" | "npnqm-portal" | "generic-json"

  // Loan channel
  abstract extractExternalLoanId(raw: unknown): string;
  abstract transformLoan(raw: unknown, config: AdapterConfig): Partial<Loan>;
  abstract validateLoan(partial: Partial<Loan>): ValidationResult;

  // Document channel
  abstract extractExternalDocId(raw: unknown): string;
  abstract transformDocument(raw: unknown, config: AdapterConfig): DocumentMetadataInput;
  abstract validateDocument(meta: DocumentMetadataInput): ValidationResult;

  // Context derivation — closes the F2-deferred LoanContext fields
  abstract deriveContextFields(loan: Loan, raw: unknown, config: AdapterConfig): Partial<LoanContext>;
}
```

### 3.2 Registry

Extends the existing `transformer.ts` pattern:

```ts
registerAdapter(adapter: LenderAdapter): void;
getAdapter(adapterType: string): LenderAdapter | null;
```

The existing `Transformer` interface (and its `GenericJsonTransformer`) stays as the underlying primitive used by `GenericJsonAdapter`. Both registries coexist for one release; `Transformer` is deprecated and removed in a follow-up cleanup.

### 3.3 Adapters shipped in v1

- **`EncompassLOSAdapter`** — handles Encompass JSON export (MISMO-derived field tree). Validates against the documented Encompass field paths; uses `config.fieldPathOverrides` for per-tenant variance.
- **`NPNQMPortalAdapter`** — handles the NPNQM portal's payload shape, distinct from Encompass. Different identity strategy, different doc-push shape.
- **`GenericJsonAdapter`** — wraps the existing `GenericJsonTransformer` for backwards compatibility. Field-map driven, no type-specific logic.

---

## 4. Inbound Loan Channel

Extends the existing `POST /api/ingest/:tenantSlug/loans` route. No new endpoint.

### 4.1 Changes to the route

1. **Resolution** — load `ingestion_mappings` row for `(tenant_id, source_name)` with explicit `WHERE tenant_id = $1` filter (fixes the latent pooler-bypass-RLS bug in the current query).
2. **Adapter dispatch** — replaces the current `getTransformer(...).transform(loanData, fieldMap)` with `getAdapter(adapter_type).transformLoan(rawPayload, adapter_config)`. The adapter owns field-map interpretation.
3. **Identity** — `loanId = ${config.identityPrefix ?? "QL-"}${adapter.extractExternalLoanId(raw)}`. Avoids the cross-tenant `QL-${externalId}` collision noted in `service.ts`. Existing `QL-` loans keep their IDs (no rewrite).
4. **F2-field closure** — after `store.dispatch({type:"InjectLoan", loan})`, route calls `adapter.deriveContextFields(loan, raw, config)` and upserts the result into `loan_context_extras (tenant_id, loan_id, extras)`. `buildLoanContextFromLoan` reads from this row.
5. **Auto-fire unchanged** — PC v2 still runs on `system:loan-ingest` after `InjectLoan`. With real `LoanContext` fields available, matrix/geographic/requirements resolvers now evaluate instead of skipping.
6. **Idempotency unchanged** — `(tenant_id, external_id)` collision returns the existing row.
7. **Error contract** — `validateLoan` failures → 400 with structured errors. Adapter exceptions → 500 with `adapter_type` in the response (audit-loggable). PC v2 auto-fire still swallows its errors (existing best-effort pattern).

### 4.2 `loan_context_extras` side table

```sql
CREATE TABLE loan_context_extras (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL,
  extras JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, loan_id)
);

ALTER TABLE loan_context_extras ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_context_extras FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loan_context_extras
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

Why a side table, not widening `Loan`:

- `LoanContext` is a PC-specific projection; not all of it belongs in the underwriting domain (`county` is geo-resolver fuel, `isItin` is requirements-resolver fuel — neither is a Loan attribute the UW reviews).
- Keeps `@twin/core` types stable; no domino refactor across web + tests.
- Reversible — if a field proves Loan-level later, promote with a small migration.
- Same RLS pattern as every other tenant-scoped table.

### 4.3 Demo fixture backfill

A one-time INSERT in the migration writes `loan_context_extras` rows for the existing demo fixtures with their known values. No retroactive guesswork against production loans (there are none on real tenants for PC v2 yet).

---

## 5. Inbound Document Channel

New endpoint: `POST /api/ingest/:tenantSlug/documents`. Same auth + tenant-scoping as the loan channel.

### 5.1 Request shape

```ts
{
  source: string,                  // matches ingestion_mappings.source_name
  externalLoanId: string,          // ties this doc batch to a previously-ingested loan
  documents: Array<{               // batch allowed (portal often pushes N docs in one event)
    externalDocId: string,
    sourceUrl: string,
    docType?: string,              // adapter normalizes to canonical DocumentType
    fileName: string,
    contentHash?: string,
    fileSize?: number,
    mimeType?: string,
  }>
}
```

### 5.2 Flow

1. Resolve adapter + config (same lookup as loan channel).
2. Verify loan exists: `SELECT loan_id FROM ingested_loans WHERE tenant_id = $1 AND external_id = $2`. 404 if missing.
3. For each document in the batch: `adapter.transformDocument(raw, config) → DocumentMetadataInput`, validate, insert into `ingested_documents` with `status='pending_fetch'`.
4. Return **202 Accepted** with `{ accepted: N, duplicates: M, jobs: [<external_id>, ...] }`. Synchronous response is fast; fetching happens out-of-band.

### 5.3 `ingested_documents` table

```sql
CREATE TABLE ingested_documents (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  external_id TEXT NOT NULL,         -- lender's externalDocId
  document_id TEXT NOT NULL,         -- our DocumentId after fetch
  loan_id TEXT NOT NULL,             -- which loan this attaches to
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_fetch',
    CHECK (status IN ('pending_fetch', 'fetched', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, external_id)
);

CREATE INDEX idx_ingested_documents_pending
  ON ingested_documents (status, next_attempt_at)
  WHERE status = 'pending_fetch';

ALTER TABLE ingested_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingested_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ingested_documents
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

### 5.4 Doc-fetch worker

`packages/api/src/workers/doc-fetch-dispatcher.ts` — same shape as `va-outbox-dispatcher` (lock 44) and `learning-worker` (lock 43). Boots from `server.ts` alongside the other workers; lock 45.

Poll loop:

```sql
SELECT tenant_id, external_id, loan_id, source_url, attempts
FROM ingested_documents
WHERE status = 'pending_fetch' AND next_attempt_at <= NOW()
ORDER BY created_at
LIMIT 10
FOR UPDATE SKIP LOCKED
```

Per row:

1. `fetch(sourceUrl)` — no additional auth from us; the URL is presigned by the lender.
2. Upload bytes to Supabase Storage under `loan-documents/${tenantId}/${loanId}/${documentId}` (private bucket; signed URLs only).
3. `store.dispatch({ type: "AddDocument", loanId, document })` to write into the in-memory store and persist via the existing reducer + persistence layer.
4. Mark `status='fetched'`, record `fetched_at`.

Failure handling:

- Increment `attempts`, set `last_error`, schedule next attempt via exponential backoff: 1m → 5m → 30m → 2h → 12h.
- After 5 attempts, `status='failed'` (dead-letter). Operator visibility via `tenant_audit_log` (not `prediction_alerts`): the request already returned 202, so the failure isn't blocking anything; `prediction_alerts` is for ingest-time alerts that gate user-facing flows. Operators see `failed` rows via a future admin endpoint or DB query.
- PC v2 re-fires after each successful `AddDocument` (loan-input hash changes when docs arrive; PC_SCHEMA_VERSION + new docs invalidate the prior batch's reuse check).

### 5.5 Idempotency

`(tenant_id, external_id)` PK on `ingested_documents`. Same document pushed twice returns 202 with `duplicates: 1`. No bytes re-fetched.

### 5.6 Auth on the fetch

The worker passes `source_url` through verbatim. If the URL expires before fetch, the attempt fails and retry schedules. If portal supports webhook-style URL refresh, that's a future enhancement.

### 5.7 Trade-off flagged

The worker dispatching `AddDocument` to the in-memory store means it shares the store reference with the API. That's already how `va-outbox-dispatcher` works, so this isn't new — but it does mean the worker can't run as a separate process today. If workers split into their own service later, this becomes a DB event + Redis pub/sub. **Out of scope for v1.**

---

## 6. Per-Tenant Config & Admin Surface

### 6.1 `adapter_config` JSONB schema

```ts
// packages/core/src/adapter-config.ts (new — exported for both API + admin tooling)
export const AdapterConfigSchema = z.object({
  programMapping: z.record(z.string(), z.string()).optional(),
  fieldPathOverrides: z.record(z.string(), z.string()).optional(),
  identityPrefix: z.string().regex(/^[A-Z]{2,8}-$/).optional().default("QL-"),
  documentTypeMapping: z.record(z.string(), DocumentTypeSchema).optional(),
  extras: z.record(z.string(), z.unknown()).optional(),
});
```

### 6.2 Admin API

```
GET    /admin/tenants/:tenantSlug/ingestion-mappings           — list active mappings
POST   /admin/tenants/:tenantSlug/ingestion-mappings           — create/upsert (validates body against AdapterConfigSchema)
PATCH  /admin/tenants/:tenantSlug/ingestion-mappings/:id       — toggle active, replace config
DELETE /admin/tenants/:tenantSlug/ingestion-mappings/:id       — soft-delete (sets active=false)
```

- Behind existing admin role gate (same pattern as `/admin/api-keys`).
- Two-key approval NOT required (these are config, not guideline changes); each change writes a `tenant_audit_log` row.
- Validates `adapter_type` against the live registry — rejects unknown types so a typo can't park a tenant in a non-routable state.

### 6.3 NPNQM onboarding flow (concrete)

1. Operator POSTs `ingestion_mappings` row: `{ source_name: "npnqm-portal", adapter_type: "npnqm-portal", adapter_config: { identityPrefix: "NPNQM-", programMapping: {...}, ... } }`
2. Operator creates a `tenant_api_keys` row for npnqm-twin tenant (existing flow).
3. Operator hands the key + base URL to NPNQM. They start pushing.
4. Operator monitors `ingested_loans`, `ingested_documents`, prediction audit log for the first few real loans; tunes `adapter_config` if needed.

### 6.4 Caching

`adapter_config` lookups are per-request right now (single SELECT). Single-row reads on the session pooler are sub-millisecond. Cache **deferred** — add only if profiling shows it's hot.

### 6.5 No admin UI in v1

API-only. UI is its own spec, likely tied to a broader admin-console initiative.

---

## 7. Schema Changes (Migration 020)

All additive. No destructive ALTER, no FK breakage.

```sql
-- packages/api/src/db/migrations/020-ingestion-framework.sql

-- 7.1 Extend ingestion_mappings with adapter_type + adapter_config
ALTER TABLE ingestion_mappings ADD COLUMN IF NOT EXISTS adapter_type TEXT;
UPDATE ingestion_mappings SET adapter_type = transformer_type WHERE adapter_type IS NULL;
ALTER TABLE ingestion_mappings ALTER COLUMN adapter_type SET NOT NULL;
ALTER TABLE ingestion_mappings ADD COLUMN IF NOT EXISTS adapter_config JSONB NOT NULL DEFAULT '{}'::jsonb;
-- transformer_type retained for one release for backwards-compat; removed in next migration.

-- 7.2 ingested_documents table (Section 5.3)
-- [body as documented in §5.3]

-- 7.3 loan_context_extras table (Section 4.2)
-- [body as documented in §4.2]

-- 7.4 Demo fixture backfill — insert known extras for each demo loan
INSERT INTO loan_context_extras (tenant_id, loan_id, extras)
SELECT
  (SELECT id FROM tenants WHERE type = 'demo' LIMIT 1),
  fixture_id,
  fixture_extras
FROM (VALUES
  -- one row per demo fixture, populated from the fixture's existing field values
  -- (filled in during plan-task implementation; deterministic)
) AS demo_fixtures(fixture_id, fixture_extras)
ON CONFLICT (tenant_id, loan_id) DO NOTHING;
```

---

## 8. Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Adapter unit | Each `LenderAdapter` subclass | Golden-file tests: sample payload → expected `Partial<Loan>` + LoanContext extras. One file per adapter per representative loan shape, committed to `packages/api/test/fixtures/adapters/`. |
| Adapter validation | `validateLoan` / `validateDocument` error paths | Per-adapter test suite enumerating known invalid shapes. |
| Registry | `getAdapter` resolution + fallback | Vitest — register, lookup, unknown-type 400 contract. |
| Loan-channel HTTP integration | `POST /api/ingest/:tenantSlug/loans` end-to-end | Existing `predict-conditions.integration.test.ts` pattern — seed tenant + mapping + KB version, POST a real payload, assert loan ingested + PC v2 fired + LoanContext extras populated. |
| Doc-channel HTTP integration | `POST /api/ingest/:tenantSlug/documents` + worker | POST returns 202; test drives the doc-fetch worker directly against the queued row (mock the `fetch`) and asserts `AddDocument` dispatch + PC v2 re-fire. |
| Worker retry | Backoff schedule (1m → 12h → dead-letter) | Unit test with a fake clock; not an integration test. |
| F2-field closure | `buildLoanContextFromLoan` merges extras | Add to `predict-conditions-context-builder.test.ts`: when `loan_context_extras` has a row, those values override; when absent, deferred-`undefined` behavior preserved. |
| W11 e2e (new harness workflow) | Full NPNQM happy path | New `scripts/e2e-harness/workflows/W11-npnqm-ingest.ts`: load demo tenant w/ mapped npnqm-portal adapter, push a fixture payload, assert loan + docs ingested, PC v2 produces a v2 batch including matrix/geographic/requirements sources. |

### 8.1 Fixtures committed

- `packages/api/test/fixtures/adapters/encompass-los-sample-loan.json`
- `packages/api/test/fixtures/adapters/npnqm-portal-sample-loan.json`
- `packages/api/test/fixtures/adapters/npnqm-portal-sample-docs.json`

**Hard prerequisite:** these fixtures must be committed before adapter classes are implemented. Plan task 0 is "commit fixtures from real NPNQM samples."

---

## 9. Out of Scope (deferred, not non-goals)

- **Outbound writeback** — separate spec (Spec 2). Recommended Documents push + decision events.
- **Loan updates / PATCH semantics** — duplicate `external_id` returns the existing row.
- **Admin UI** — API-only for v1.
- **MISMO 3.4 XML parsing** — Encompass JSON only. A `MismoXmlAdapter` can be added later.
- **Adapter versioning** — adapters are versioned by code (TS class). If we need adapter v2 alongside v1, that's a future generalization (likely tied to `KbVersionContext`-style typed disambiguation).
- **Cross-tenant adapter templates** — every tenant gets its own `ingestion_mappings` rows. If onboarding a 3rd Encompass tenant becomes painful, build template inheritance later.
- **Real-time doc-push WebSocket** — async worker is sync-enough for v1. Redis pub/sub can be added if portal needs immediate doc-arrival signal.

## 10. Out of Scope (true non-goals)

- Per-document encryption at rest beyond Supabase Storage's defaults.
- Adapter sandboxing — adapter code is our code, not user-uploaded.
- Per-adapter rate limiting — existing `tenant_api_keys.rate_limit_per_minute` is sufficient.

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Sample payloads we have don't match what NPNQM eventually pushes | Plan task 0 commits the samples; adapter implementation validates against them. If NPNQM's real payloads diverge, `adapter_config` can absorb most variance; structural deltas force an adapter version bump. |
| Doc fetch worker overwhelms a busy portal with retries | Exponential backoff caps at 12h; 5-attempt dead-letter. Per-tenant rate-limit-per-minute already in place on inbound (`tenant_api_keys.rate_limit_per_minute`). |
| Supabase Storage bucket fills | Bytes are not duplicated (idempotent fetch). Bucket lifecycle policy (retention) is a Supabase config concern, not a spec concern. |
| Cross-tenant collision via reused `external_id` | `identityPrefix` per tenant + `(tenant_id, external_id)` composite PKs. Existing `QL-` prefix kept for backwards compat; new tenants get unique prefixes. |
| Worker crashes mid-fetch | Bytes upload is idempotent (Supabase Storage overwrites by key). `status='pending_fetch'` row is the source of truth; on restart the worker picks up where it left off via `FOR UPDATE SKIP LOCKED`. |

---

## 12. Acceptance Criteria

1. `POST /api/ingest/:tenantSlug/loans` accepts a real Encompass payload, dispatches the `EncompassLOSAdapter`, ingests the loan, populates `loan_context_extras`, and PC v2 produces a batch with matrix + geographic + requirements findings (not just minimum/income).
2. `POST /api/ingest/:tenantSlug/documents` accepts a portal doc-push batch, returns 202, queues fetches in `ingested_documents`. The doc-fetch worker fetches each within 30 seconds (default poll), uploads to Supabase Storage, dispatches `AddDocument`, marks `status='fetched'`.
3. After all docs land, PC v2 re-fires and the doc-checklist resolver returns a non-empty pending set matching the docs that are still missing.
4. W11 e2e workflow passes end-to-end on the harness.
5. Migration 020 applies cleanly to a fresh DB and to an existing DB with PC v2 already deployed. No destructive changes.
6. All adapter unit tests pass against committed fixtures.
7. Admin API can list/create/patch/delete `ingestion_mappings` rows; unknown `adapter_type` returns 400; every change writes a `tenant_audit_log` row.

---

## 13. Open Items

- Whether the migration backfill of `loan_context_extras` for demo fixtures is done in SQL (per-fixture VALUES) or via a one-shot TypeScript seed script (cleaner, reusable shape). Plan-task decision; default to TypeScript seed if fixtures-as-code are easier to keep in sync with the actual fixture files.

---

## 14. Sequencing for the Plan

Five phases:

- **Phase A — Framework primitives.** `LenderAdapter` base class, `AdapterConfig` schema, registry, migration 020. Existing route still works.
- **Phase B — Adapters.** `EncompassLOSAdapter`, `NPNQMPortalAdapter`, `GenericJsonAdapter` wrapper. Golden-file tests.
- **Phase C — Loan channel wiring.** Existing route delegates to the registry. `loan_context_extras` populated; `buildLoanContextFromLoan` reads it. Demo backfill in migration.
- **Phase D — Document channel.** New endpoint, `ingested_documents` table, `doc-fetch-dispatcher` worker (lock 45), Supabase Storage integration. PC v2 re-fire trigger.
- **Phase E — Admin API + W11 e2e.** `/admin/tenants/:tenantSlug/ingestion-mappings` CRUD, W11 harness workflow, final integration polish.

Estimate: 18-22 plan tasks across 5 phases. Comparable to PC v2 scope.
