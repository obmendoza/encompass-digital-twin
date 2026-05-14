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
  allowedFetchHosts: string[];                        // R1: doc-fetch worker allowlist; non-optional — empty array = no docs fetchable
  maxFileBytes?: number;                              // default 50_000_000 (50 MB) per file
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

- **`EncompassLOSAdapter`** (type `encompass-los`) — handles Encompass JSON export (MISMO-derived field tree). Validates against the documented Encompass field paths; uses `config.fieldPathOverrides` for per-tenant variance.
- **`NPNQMPortalAdapter`** (type `npnqm-portal`) — handles the NPNQM portal's payload shape, distinct from Encompass. Different identity strategy, different doc-push shape.
- **`GenericJsonAdapter`** (type `generic-json`) — wraps the existing `GenericJsonTransformer` for backwards compatibility. Field-map driven, no type-specific logic.

**Naming convention (enforced by the registry).** `adapterType` strings are kebab-case matching `^[a-z][a-z0-9-]*$`. `registerAdapter` rejects mismatches at boot — a typo can't ship to production. The class-name convention is PascalCase + `Adapter` suffix (`<Source>Adapter`), one-to-one with its kebab type. This prevents the underscore-vs-hyphen drift problem when adapters are added by different authors.

---

## 4. Inbound Loan Channel

Extends the existing `POST /api/ingest/:tenantSlug/loans` route. No new endpoint.

### 4.1 Changes to the route

1. **Resolution** — load `ingestion_mappings` row for `(tenant_id, source_name)` with explicit `WHERE tenant_id = $1` filter (fixes the latent pooler-bypass-RLS bug in the current query).
2. **Adapter dispatch** — replaces the current `getTransformer(...).transform(loanData, fieldMap)` with `getAdapter(adapter_type).transformLoan(rawPayload, adapter_config)`. The adapter owns field-map interpretation.
3. **Identity** — `loanId = ${config.identityPrefix ?? "QL-"}${adapter.extractExternalLoanId(raw)}`. Avoids the cross-tenant `QL-${externalId}` collision noted in `service.ts`. Existing `QL-` loans keep their IDs (no rewrite).
4. **F2-field closure (first-write-wins).** After `store.dispatch({type:"InjectLoan", loan})`, the route calls `adapter.deriveContextFields(loan, raw, config)`, runs the result through `LoanContextExtrasSchema.parse(...)` (new Zod schema exported from `@twin/core`, mirrors the `LoanContext` v2 fields), and inserts into `loan_context_extras (tenant_id, loan_id, extras)` with `ON CONFLICT (tenant_id, loan_id) DO NOTHING`. **First-write-wins** — re-ingesting the same loan does not overwrite extras. Rationale (R3): once a row exists, operator-edits or `pc_v2_inferred` augmentation may have refined it; silent wholesale replace would regress. Updates are deferred to a future admin endpoint that can reason about provenance. `buildLoanContextFromLoan` reads from this row; if the Zod parse fails on read, the row is treated as absent and the resolvers degrade via their existing missing-field handling (consistent with PC v2's `console.warn` skip-and-continue).
5. **Auto-fire unchanged** — PC v2 still runs on `system:loan-ingest` after `InjectLoan`. With real `LoanContext` fields available, matrix/geographic/requirements resolvers now evaluate instead of skipping.
6. **Idempotency unchanged** — `(tenant_id, external_id)` collision returns the existing row.
7. **Error contract.** `validateLoan` failures → 400 with structured errors keyed by category, not by raw payload content: `{ error_id, error_class: "validation_failed", details: [{field, code}] }`. Adapter exceptions → 500 with `{ adapter_type, error_id }` only. Full stack and the originating message (which may contain payload fragments = borrower NPI) are written to server-side logs keyed by `error_id` for correlation — never to the response. Payload-derived strings (field values, raw fragments) never echo back to the lender. PC v2 auto-fire still swallows its errors (existing best-effort pattern).
8. **Per-ingest audit row.** Every loan-ingest call writes a `tenant_audit_log` entry with `action = 'ingest.loan'`, metadata `{ adapter_type, source_name, external_id, result: 'success' | 'rejected' | 'error', error_id?: string }`. Establishes the compliance trail expected for third-party-pushed loan data and gives security telemetry a queryable signal for malformed-payload patterns (potential compromised key).
9. **Structured logs.** Both the ingest route and adapter dispatch emit JSON logs with `request_id` (Fastify), `tenant_id`, `adapter_type`, `source_name`, `external_id`. Same shape as existing routes for SRE correlation.

### 4.2 `loan_context_extras` side table

```sql
CREATE TABLE loan_context_extras (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL CHECK (length(loan_id) BETWEEN 1 AND 200),
  extras JSONB NOT NULL,
  -- extras is validated against LoanContextExtrasSchema in @twin/core on
  -- both write (adapter output → INSERT) and read (buildLoanContextFromLoan).
  -- Write path = first-write-wins via ON CONFLICT DO NOTHING (see §4.1 step 4).
  -- Read path = parse-and-skip on failure (degrades to PC v2's existing
  -- missing-field warn-and-continue).
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
3. Generate an `ingest_batch_id = randomUUID()` for the request — used by the debounce trigger to collapse the whole batch into one PC v2 re-fire (see §5.4.2).
4. For each document in the batch: `adapter.transformDocument(raw, config) → DocumentMetadataInput`, run `validateDocument` (which **includes the fetch-security gate from §5.4.3 layers 1–2**: scheme + host allowlist; DNS-resolve check is deferred to worker fetch time to avoid blocking the request on N DNS lookups), then insert into `ingested_documents` with `status='pending_fetch'`, `ingest_batch_id`.
5. Write a `tenant_audit_log` row with `action='ingest.documents'`, metadata `{ adapter_type, source_name, external_loan_id, count: N, ingest_batch_id }`.
6. Return **202 Accepted** with `{ accepted: N, duplicates: M, jobs: [<external_id>, ...], ingest_batch_id }`. Structured logs include `request_id`, `tenant_id`, `adapter_type`, `external_loan_id`, `count`.

### 5.3 `ingested_documents` table

```sql
CREATE TABLE ingested_documents (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  external_id TEXT NOT NULL
    CHECK (length(external_id) BETWEEN 1 AND 200 AND external_id ~ '^[A-Za-z0-9_.:-]+$'),
  document_id TEXT NOT NULL CHECK (length(document_id) BETWEEN 1 AND 200),
  loan_id TEXT NOT NULL CHECK (length(loan_id) BETWEEN 1 AND 200),
  source_url TEXT NOT NULL CHECK (length(source_url) <= 2048),
  file_name TEXT NOT NULL CHECK (length(file_name) <= 500),
  status TEXT NOT NULL DEFAULT 'pending_fetch',
    CHECK (status IN ('pending_fetch', 'fetched', 'failed')),
  failed_reason TEXT,                -- e.g., 'ssrf_blocked', 'url_expired', 'too_large', 'fetch_error', 'max_attempts'
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetched_at TIMESTAMPTZ,
  ingest_batch_id UUID NOT NULL,     -- R2: same UUID for all docs in one POST batch; used by debounce trigger
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, external_id)
);
-- CHECK constraints are belt-and-suspenders against adapter bugs;
-- adapter.validateDocument enforces the same bounds before INSERT.

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
SELECT tenant_id, external_id, loan_id, source_url, attempts, ingest_batch_id
FROM ingested_documents
WHERE status = 'pending_fetch' AND next_attempt_at <= NOW()
ORDER BY created_at
LIMIT 10
FOR UPDATE SKIP LOCKED
```

#### 5.4.1 Per-row processing (sequential within a poll batch)

The worker processes the SKIP LOCKED batch **sequentially** — never in parallel — to avoid two store dispatches racing on the same loan and to preserve a predictable ordering for the debounce trigger. Per row, the worker:

1. **Fetch security gate** — runs §5.4.3 below before any network call. If the gate rejects, set `status='failed'`, `failed_reason='ssrf_blocked'`, write audit row, skip the rest.
2. **Fetch** — `fetch(sourceUrl, { redirect: 'manual', signal: AbortSignal.timeout(30_000) })` with a 30s timeout. Stream the response body through a byte counter; abort and fail with `failed_reason='too_large'` if `bytes > config.maxFileBytes ?? 50_000_000`.
3. **Upload** — bytes to Supabase Storage at `loan-documents/${tenantId}/${loanId}/${documentId}` (private bucket; signed URLs only on read).
4. **Atomic state transition** — wrap the next two operations in `withStoreSnapshot` (the F1 pattern from PC v2's store-DB consistency work): `store.dispatch({ type: "AddDocument", loanId, document })` AND the DB UPDATE setting `status='fetched'`, `fetched_at=NOW()`. Mid-sequence failure rolls back the store dispatch and leaves `status='pending_fetch'` for retry. Consistent with how `va-outbox-dispatcher` (lock 44) and the learning worker treat store-DB pairs.
5. **Debounce trigger** — see §5.4.2 below; no PC v2 re-fire happens here.

#### 5.4.2 Debounced PC v2 re-fire (R2)

The naive "re-fire after each `AddDocument`" of an earlier draft would have caused 1 LLM-budgeted PC v2 run per document. A 15-document batch would produce 15 audit rows and 15× the LLM token spend where 1 run is correct. The framework debounces instead.

**Mechanism.** New small table `pc_v2_refire_debounce`:

```sql
CREATE TABLE pc_v2_refire_debounce (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL CHECK (length(loan_id) BETWEEN 1 AND 200),
  ready_at TIMESTAMPTZ NOT NULL,           -- when the debounce fires
  reason TEXT NOT NULL,                    -- 'doc_added' | 'loan_re_ingested' | etc.
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, loan_id)
);
ALTER TABLE pc_v2_refire_debounce ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_v2_refire_debounce FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pc_v2_refire_debounce
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

After every successful `AddDocument` (§5.4.1 step 4) the worker upserts `(tenant_id, loan_id)` with `ready_at = NOW() + INTERVAL '30 seconds'`, `ON CONFLICT DO UPDATE SET ready_at = EXCLUDED.ready_at` — each new doc **pushes the ready-time forward**, so a stream of 15 docs over 5s collapses to one fire 30s after the last arrival.

A periodic tick (every 5s, piggy-backed onto the same worker loop) drains rows with `ready_at <= NOW()`: for each, call `runPredictions(tenantId, loanId, ctx, 'system:loan-ingest')`, then delete the row. PC v2's existing per-loan advisory lock (`predict:<loanId>`) handles serialization if a manual `/predictions/run` races the debounce.

**Result:** N docs in one batch → 1 PC v2 run. Individual docs arriving 5 minutes apart → 2 runs (the debounce doesn't span the gap). Correct cost shape.

#### 5.4.3 Fetch security (R1)

The doc-fetch worker calls into URLs chosen by a third-party lender. Without constraints, this is an SSRF primitive: a malicious or compromised lender API key can send `sourceUrl` pointing to internal services, RFC 1918 addresses, cloud metadata endpoints (`169.254.169.254`), or redirect-chains that resolve internal. The framework defends in five layers, all enforced before the network call:

1. **Scheme allowlist.** `https://` only. `http://` (cleartext, MITM-trivial), `file://`, `data:`, `gopher:`, `ftp:`, anything else → reject at `validateDocument` time → 400 from the inbound endpoint OR `failed_reason='ssrf_blocked'` if it slipped past validation.
2. **Host allowlist per adapter or tenant.** `config.allowedFetchHosts: string[]` (required, non-optional in `AdapterConfig`). Worker rejects any `sourceUrl` whose `URL.hostname` is not in the allowlist. For NPNQM this is the portal's known doc-storage hostname; for Encompass tenants, the Encompass storage CDN. An empty array means "no doc-fetch enabled" — a tenant can be loan-channel-only.
3. **DNS resolve + IP-range gate.** Before fetch, resolve the hostname via `dns.lookup(host, { all: true })` and reject the URL if any returned address falls in: loopback (`127/8`, `::1`), private (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`), link-local (`169.254/16`, `fe80::/10`), multicast, or unspecified. Re-resolve and re-check before fetch (TOCTOU mitigation; cheap with cached DNS).
4. **No redirects.** `fetch(..., { redirect: 'manual' })`. If the response is a 30x with a `Location`, reject with `failed_reason='unexpected_redirect'`. Lenders can configure their storage to issue direct URLs; redirect chains are an SSRF amplifier we don't need to support.
5. **Timeout + content-length cap.** 30s timeout per attempt (§5.4.1 step 2). Stream the body through a byte counter and abort on `config.maxFileBytes ?? 50_000_000`. Don't trust `Content-Length` header alone (lender can lie); enforce in the stream.

The validation runs **twice**: once at inbound time inside `adapter.validateDocument(meta)` (so a bad URL fails fast and the document never queues), and again at fetch time in the worker (TOCTOU; an allowlist change between queue and fetch could otherwise admit a now-invalid URL). The second check is cheap (single DNS lookup + range test) and worth the belt-and-suspenders given the blast radius.

All five gates are tenant-scoped via `config.allowedFetchHosts`. A new tenant's onboarding (§6.3) explicitly populates this allowlist; without it, doc-channel ingest returns 400 with `error_class='ssrf_misconfigured'` and the operator sees a clear actionable message.

#### 5.4.4 Failure handling

- Increment `attempts`, set `last_error` (server-side categorized message, no payload echo), set `failed_reason` (see categories below), schedule next attempt via exponential backoff: 1m → 5m → 30m → 2h → 12h.
- After 5 attempts, `status='failed'` (dead-letter).
- **Fast-fail on expired URL (C3).** Presigned URLs typically expire in 15min–1h; after the third retry slot (30m) the URL is almost certainly dead. If two consecutive attempts return `403` or `404`, the worker sets `status='failed'`, `failed_reason='url_expired'` immediately rather than continuing the backoff. Most presigned-URL schemes also encode expiry in the URL itself (`X-Amz-Expires`, etc.) — when present, the queue-time validator parses and refuses to schedule any retry past the encoded expiry.
- **`failed_reason` categories:** `ssrf_blocked`, `url_expired`, `too_large`, `unexpected_redirect`, `fetch_error`, `max_attempts`. Each fires a distinct `tenant_audit_log` row (`action='ingest.doc.failed'`, metadata `{ adapter_type, external_id, loan_id, failed_reason, attempts }`) so operators can filter by cause.
- Per-attempt audit row (`action='ingest.doc.attempt'`) for the third attempt onward — earlier ones flood the log for transient failures that retry naturally.

#### 5.4.5 Observability

The worker emits structured logs (`request_id`-equivalent per-row, `tenant_id`, `adapter_type`, `external_id`, `loan_id`, `attempt`, `outcome`) and Prometheus-style metrics through the existing instrumentation:

- `doc_fetch_attempts_total{outcome=success|fail,failed_reason=...}`
- `doc_fetch_duration_seconds` (histogram)
- `doc_fetch_bytes_total` (counter)
- `doc_fetch_dead_lettered_total`
- `pc_v2_refire_debounce_depth` (gauge — current pending rows)
- `pc_v2_refire_fires_total`

Same instrumentation pattern as `va-outbox-dispatcher` and `learning-worker`.

### 5.5 Idempotency

`(tenant_id, external_id)` PK on `ingested_documents`. Same document pushed twice returns 202 with `duplicates: 1`. No bytes re-fetched.

### 5.6 Auth on the fetch

The worker passes `source_url` through verbatim — but only after the §5.4.3 security gates clear. The URL is presigned by the lender; we don't add auth. If the URL expires before fetch, §5.4.4's fast-fail kicks in. If portal supports webhook-style URL refresh, that's a future enhancement.

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
  allowedFetchHosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)).default([]),
    // R1: doc-fetch SSRF defense. Empty array = no docs fetchable for this tenant.
    // Validator rejects entries containing scheme, port, or path — just hostnames.
  maxFileBytes: z.number().int().positive().max(500_000_000).default(50_000_000),
  extras: z.record(z.string(), z.unknown()).optional(),
});

// Mirror schema for the loan_context_extras row body — used on both the
// adapter-write path and the buildLoanContextFromLoan read path (§4.1 step 4).
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
}).strict();   // unknown keys rejected — adapter bugs surface loudly
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

**Deployment ordering (C4).** Migration 020 must apply **before** the code change that reads `adapter_type` deploys. The intermediate code release reads `adapter_type` but writes **both** `transformer_type` and `adapter_type` on every INSERT/UPDATE, so a rollback to the prior release still works. A follow-up migration in a later release drops `transformer_type`. Concrete order:

1. Apply migration 020 (adds `adapter_type`, backfills from `transformer_type`).
2. Verify every `ingestion_mappings` row has `adapter_type` populated.
3. Deploy the code release: reads `adapter_type`, writes both columns.
4. Verify no production errors over one observation window.
5. (Later release) Migration 02X drops `transformer_type`.

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

**Completeness criterion (P2).** The fixture set must collectively exercise:

1. One purchase loan (loan-channel happy path).
2. One refinance loan (Rate-and-Term or Cash-Out — exercises the Loan Purpose alias normalization landed in PC v2).
3. One document batch with mixed `docType` values (drives `documentTypeMapping` and the worker's batched-flow code path).
4. One payload that exercises `programMapping` (the lender's program name differs from our canonical and must be translated).
5. One adversarial payload for security-gate testing (e.g., `sourceUrl` pointing to `169.254.169.254`, a private IP, an `http://` scheme) — confirms `validateDocument` and the worker SSRF gate reject it without queueing.

Adapter unit tests must cover all five. The W11 e2e workflow exercises the happy path end-to-end against a real fixture.

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
| SSRF via attacker-controlled `sourceUrl` (R1) | Five-layer defense in §5.4.3: HTTPS-only scheme, per-tenant `allowedFetchHosts` allowlist, DNS-resolve-and-range-check (block RFC 1918 / link-local / loopback), `redirect: 'manual'`, 30s timeout + 50 MB byte cap. Validation runs at both inbound time (`validateDocument`) and worker fetch time (TOCTOU). New `failed_reason='ssrf_blocked'` categorizes rejections. |
| PC v2 re-fire amplification on batched docs (R2) | Debounce via `pc_v2_refire_debounce` (§5.4.2): every `AddDocument` upserts `ready_at = NOW() + 30s`; the periodic drain runs PC v2 once per loan. 15-doc batches → 1 PC v2 run (was: 15 runs at full LLM cost). |
| `loan_context_extras` upsert silently destructive of operator edits (R3) | First-write-wins via `ON CONFLICT (tenant_id, loan_id) DO NOTHING` (§4.1 step 4). Re-ingest cannot overwrite extras. A future admin endpoint owns updates and can reason about provenance (`adapter` vs `operator` vs `pc_v2_inferred`); listed in §13. |
| Payload echo via 500 response (C1) | `validateLoan`/`validateDocument` failures return `{ error_class, details: [{field, code}] }` — category-coded, never raw payload fragments. Adapter exceptions return `{ adapter_type, error_id }`; stack + payload-bearing message live server-side only, keyed by `error_id` for correlation. |

---

## 12. Acceptance Criteria

1. `POST /api/ingest/:tenantSlug/loans` accepts a real Encompass payload, dispatches the `EncompassLOSAdapter`, ingests the loan, populates `loan_context_extras`, and PC v2 produces a batch with matrix + geographic + requirements findings (not just minimum/income).
2. `POST /api/ingest/:tenantSlug/documents` accepts a portal doc-push batch, returns 202, queues fetches in `ingested_documents`. The doc-fetch worker fetches each within 30 seconds (default poll), uploads to Supabase Storage, dispatches `AddDocument`, marks `status='fetched'`.
3. After all docs in a batch land and the debounce window expires (30s after the last `AddDocument`), PC v2 re-fires **once** and the doc-checklist resolver returns a non-empty pending set matching the docs that are still missing. The audit log shows exactly one `predict_conditions.run` entry per batch, not one per document.
4. W11 e2e workflow passes end-to-end on the harness.
5. Migration 020 applies cleanly to a fresh DB and to an existing DB with PC v2 already deployed. No destructive changes.
6. All adapter unit tests pass against committed fixtures.
7. Admin API can list/create/patch/delete `ingestion_mappings` rows; unknown `adapter_type` returns 400; every change writes a `tenant_audit_log` row.

---

## 13. Open Items

- Whether the migration backfill of `loan_context_extras` for demo fixtures is done in SQL (per-fixture VALUES) or via a one-shot TypeScript seed script (cleaner, reusable shape). Plan-task decision; default to TypeScript seed if fixtures-as-code are easier to keep in sync with the actual fixture files.
- **Operator-edit propagation path for `loan_context_extras`** (R3 follow-up). First-write-wins keeps re-ingest from overwriting refined values, but eventually operators need to update an `extras` row (manually correct an auto-detected `isItin`, refresh a stale `repFico`). The natural next surface: a `PATCH /admin/tenants/:tenantSlug/loans/:loanId/context-extras` endpoint with per-field provenance (`adapter` | `operator` | `pc_v2_inferred`) that lets operator edits supersede adapter writes on a per-field basis. Out of scope for this spec; flagged here so a future spec or admin-UX initiative picks it up.

---

## 14. Sequencing for the Plan

Five phases:

- **Phase A — Framework primitives.** `LenderAdapter` base class, `AdapterConfig` + `LoanContextExtrasSchema` Zod schemas, registry with kebab-case validation, migration 020 (`adapter_type`/`adapter_config`, `ingested_documents`, `loan_context_extras`, `pc_v2_refire_debounce`). Existing route still works.
- **Phase B — Adapters.** `EncompassLOSAdapter`, `NPNQMPortalAdapter`, `GenericJsonAdapter` wrapper. Golden-file tests across all five fixture cases (§8.1 completeness criterion). Adversarial SSRF fixture exercises `validateDocument`'s security gate (§5.4.3 layers 1–2).
- **Phase C — Loan channel wiring.** Existing route delegates to the registry. `loan_context_extras` populated via first-write-wins; `buildLoanContextFromLoan` reads with Zod parse-and-skip. Demo backfill (TypeScript seed). Per-ingest audit + structured logs.
- **Phase D — Document channel + worker.** New endpoint, `ingested_documents` writes, `doc-fetch-dispatcher` worker (lock 45) with full SSRF defense (§5.4.3), sequential per-row + `withStoreSnapshot`, expired-URL fast-fail, debounced PC v2 re-fire via `pc_v2_refire_debounce`, Prometheus metrics, audit categorization by `failed_reason`.
- **Phase E — Admin API + W11 e2e.** `/admin/tenants/:tenantSlug/ingestion-mappings` CRUD with `AdapterConfigSchema` validation, W11 harness workflow exercising the full path (loan + docs + PC v2 re-fire), final integration polish.

Estimate: 20-24 plan tasks across 5 phases. Slightly bigger than PC v2 because Phase D carries the SSRF defense and debounce mechanism; manageable in one PR.
