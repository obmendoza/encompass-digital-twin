# VA Review Layer — Design

**Date:** 2026-05-10
**Status:** Draft, pending user review
**Owner:** UAS platform team

## Goal

Insert a Virtual Assistant (VA) review tier between the Multi-Agent analysis and the Underwriter (UW) decision. The VA reviews the agent's output against the tenant's ingested Guidelines / Matrices / Doc Checklist, signs off per-specialist, and either concurs (forwarding the loan to UW) or sends the loan back to the originator with a structured doc-request. This is the value-proposition tier that earns the platform its name — Underwriting Assist Services (UAS).

The VA can be either an internal staff member of the lender or an outsourced BPO Subject Matter Expert (SME). Both identity classes are supported on day one.

## Non-Goals

Punted to future specs (named here so they don't leak in):

1. Doc-request expiry / auto-escalation when deadline passes.
2. Pinning re-review after docs return to the original VA (advisory display only).
3. NPNQM portal adapter implementation.
4. Predictive Conditions feature.
5. VA performance dashboard UI.
6. Conditional-by-confidence routing (only "all loans when enabled" in v1).
7. In-app messaging between VA and UW.
8. Multi-VA review (exactly one active VA review per loan iteration).
9. Add-condition during VA review (only `clear` / `contest`).
10. Direct VA-to-VA hand-off (release-and-reclaim only).

## Architecture Overview

```
                 Multi-Agent runs, stages a recommendation
                                    │
                  (tenant.va.required = true) │ (= false → today's flow)
                                    ▼
                        loan.state = va_review_pending
                                    │
                          routed to a pool by tenant rules
                                    │
                          claim by any pool member
                                    ▼
                            loan.state = va_in_review
                                    │
                ┌───────────────────┴────────────────────┐
                ▼                                        ▼
            "concur"                       "request_docs from originator"
                │                                        │
                ▼                                        ▼
   loan.state = uw_review_pending      loan.state = va_doc_request_pending
                │                                        │
        UW decides as today               event va.doc_request_issued
                                          dispatched to per-tenant adapter
                                                         │
                                                docs returned via portal
                                                         ▼
                                         loan.state = agent_review_pending
                                              (agent re-runs, loop closes)
```

## State Machine

Six states. New states italicised:

- `agent_review_pending` — multi-agent is running or has just staged.
- *`va_review_pending`* — assigned to a pool, unclaimed, awaiting any pool member to claim.
- *`va_in_review`* — claimed by exactly one VA.
- *`va_doc_request_pending`* — VA submitted with verdict=request_docs; loan parked until originator returns docs.
- `uw_review_pending` — VA concurred (or VA disabled at tenant level); UW now holds the loan.
- `decided` — UW issued the final decision.

**Five new actions** in the core Action union:

```ts
| { type: "ClaimForVAReview"; loanId: LoanId; vaId: string; actor: Actor }
| { type: "ReleaseVAClaim"; loanId: LoanId; vaId: string; actor: Actor }
| { type: "SubmitVAReview"; loanId: LoanId; review: VAReview; actor: Actor }
| { type: "ReceiveVADocResponse"; loanId: LoanId; docs: Document[]; actor: Actor }
// IssueVADocRequest is folded into SubmitVAReview when verdict=request_docs;
// it is not a separate action.
```

**Invariant.** When `tenant.settings.va.required === true`, the existing actions `AcceptRecommendation` / `OverrideDecision` / `SetDecision` are rejected by the reducer if `loan.state !== "uw_review_pending"`. UW cannot bypass VA. Enforcement lives in `packages/core/src/reduce.ts`.

### Toggle Semantics — flipping `tenant.settings.va.required`

The toggle changes a per-tenant invariant; in-flight loans need a deterministic transition policy.

**false → true.** A backfill task evaluates `va_routing_rules` for all loans currently at `agent_review_pending` and transitions them to `va_review_pending` with `assigned_pool_id` populated. Loans already at `uw_review_pending` are unaffected — the UW decision was already in flight before the toggle, and forcing them through VA retroactively would be operationally hostile and risk audit-log incoherence. The backfill task records a single `tenant_audit_log` entry summarising the migration ("flip true: N loans transitioned to va_review_pending").

**true → false.** Loans at `va_review_pending` or `va_in_review` are released to `uw_review_pending` (any active claim is voided; an audit log entry per loan records the toggle-induced release with `release_reason = 'tenant_va_disabled'`). Loans at `va_doc_request_pending` remain in that state — the doc request was already issued and the originator is acting on it; aborting it would create a worse user experience than completing the loop. When their docs return, the agent re-runs and the loan transitions `agent_review_pending` → `uw_review_pending` directly (skipping VA, since the toggle is now off).

The toggle is itself an admin action and is logged with `actor` + `from_state` + `to_state` in `tenant_audit_log` for SOC 2 defensibility.

`decided` is a terminal state — the toggle has no effect on already-decided loans.

## Data Model

### `va_reviews` (new table)

One row per submitted review. A loan that loops through VA after docs return creates a new row, preserving full review history.

```ts
type VAReview = {
  id: UUID;
  tenantId: UUID;
  loanId: string;
  vaId: string;                  // internal user id OR bpo_sme id
  vaPoolId: UUID;
  poolKind: "internal" | "bpo";
  verdict: "concur" | "request_docs";

  specialistSignoffs: Array<{    // exactly six entries, one per specialist
    specialist: "doc" | "income" | "asset" | "credit" | "property" | "compliance";
    signoff: "concur" | "disagree";
    notes: string | null;        // required when signoff === "disagree"
  }>;

  conditionActions: Array<{      // optional, zero or more
    conditionId: string;
    action: "clear" | "contest"; // no "add" in v1
    note: string | null;         // required when action === "contest"
  }>;

  overallRationale: string;      // free text, ≥ 20 chars

  docRequest: null | {           // populated iff verdict === "request_docs"
    docs: Array<{ docType: string; reason: string; required: boolean }>;
    deadline: string;            // ISO date
    messageToOriginator: string;
  };

  // Provenance (parity with decision_records — every review is auditable
  // evidence and must attribute to a specific agent run, KB version, and
  // any chatbot consultations the VA used during the review).
  agentRecommendationId: UUID;   // links to the specific agent run reviewed
  kbVersion: string;             // KB version active at review time
  chatbotConsultationIds: UUID[]; // any chatbot sessions started during this review

  claimedAt: string;             // ISO timestamp
  submittedAt: string;           // ISO timestamp
  reviewTimeSeconds: number;     // computed server-side
};
```

Validation rules (Zod-enforced at API edge):
- `specialistSignoffs.length === 6`, each specialist appears exactly once.
- For each row where `signoff === "disagree"`, `notes` is required (≥ 1 char).
- For each `conditionActions` row where `action === "contest"`, `note` is required.
- `overallRationale.length ≥ 20`.
- When `verdict === "request_docs"`, `docRequest.docs.length ≥ 1` and each `docType` must exist in the tenant's ingested Doc Checklist.

### `loans` (additive columns)

```sql
ALTER TABLE loans
  ADD COLUMN current_va_review_id UUID NULL REFERENCES va_reviews(id),
  ADD COLUMN va_id TEXT NULL,                  -- claimed-by, present iff state = va_in_review
  ADD COLUMN claimed_at TIMESTAMPTZ NULL,
  ADD COLUMN assigned_pool_id UUID NULL REFERENCES va_pools(id);
```

`current_va_review_id` always points to the most recent submitted review, for fast UW-side render. Unset until first submission.

### Pool tables (new)

```sql
CREATE TABLE va_pools (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('internal', 'bpo')),
  bpo_partner_id UUID NULL REFERENCES bpo_partners(id),
  active BOOLEAN NOT NULL DEFAULT true,
  CHECK ((kind = 'bpo') = (bpo_partner_id IS NOT NULL))
);

CREATE TABLE va_pool_memberships (
  pool_id UUID NOT NULL REFERENCES va_pools(id),
  member_id TEXT NOT NULL,
  member_kind TEXT NOT NULL CHECK (member_kind IN ('internal', 'bpo')),
  PRIMARY KEY (pool_id, member_id)
);

CREATE TABLE va_routing_rules (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  priority INTEGER NOT NULL,
  match JSONB NOT NULL,
  target_pool_id UUID NOT NULL REFERENCES va_pools(id)
);
```

`match` is JSONB to keep schema flexible while staying explicit:

```ts
type RoutingMatch = {
  program?: string[];
  loanAmountMin?: number;
  loanAmountMax?: number;
  occupancy?: ("Primary" | "Second" | "Investment")[];
};
```

Rules are evaluated in `priority` order (ascending). First match wins. If no rule matches, the loan routes to `tenant.settings.va.fallbackPoolId`.

RLS on all three tables: `tenant_id`-scoped via the existing `withTenantTx` pattern.

### BPO identity tables (new)

```sql
-- Global, NOT tenant-scoped (a partner can serve multiple tenants).
CREATE TABLE bpo_partners (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bpo_smes (
  id UUID PRIMARY KEY,
  bpo_partner_id UUID NOT NULL REFERENCES bpo_partners(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE
);

-- Per-SME-per-tenant API keys, hashed sha256 (same pattern as tenant_api_keys).
CREATE TABLE bpo_api_keys (
  id UUID PRIMARY KEY,
  sme_id UUID NOT NULL REFERENCES bpo_smes(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  key_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL
);
```

### Outbox table (new)

```sql
CREATE TABLE va_event_outbox (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  event_type TEXT NOT NULL,           -- 'va.doc_request_issued', etc.
  loan_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ NULL,
  delivered_at TIMESTAMPTZ NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  last_attempted_at TIMESTAMPTZ NULL
);

CREATE INDEX va_event_outbox_pending ON va_event_outbox (created_at)
  WHERE delivered_at IS NULL;
```

### RLS coverage

RLS is applied to every `tenant_id`-bearing table introduced by this spec: `va_reviews`, `va_pools`, `va_pool_memberships` (scoped via the pool's tenant), `va_routing_rules`, `va_event_outbox`, `bpo_api_keys`. All follow the existing `withTenantTx` pattern. The `bpo_partners` and `bpo_smes` tables are **global by design** — a partner can serve multiple tenants, and a single SME may have keys against multiple tenants — and are not RLS-scoped. They are accessed only through the platform-admin path (which never goes through `withTenantTx`) and through the BPO auth handler (which resolves the SME's identity before entering tenant context).

## Routing & Claim Flow

When the agent stages a recommendation and `tenant.settings.va.required === true`:

1. Reducer transitions `loan.state` from `agent_review_pending` to `va_review_pending`.
2. API handler resolves the routing rules (top-down by priority). First match assigns `loan.assigned_pool_id`. If no rule matches, falls back to `tenant.settings.va.fallbackPoolId`.
3. Loan is now visible in the Pool Queue UI to all members of `assigned_pool_id`.

Claim is a single SQL update guarded by state:

```sql
UPDATE loans
   SET state = 'va_in_review', va_id = $1, claimed_at = now()
 WHERE id = $2 AND state = 'va_review_pending'
   AND EXISTS (
     SELECT 1 FROM va_pool_memberships m
      WHERE m.pool_id = loans.assigned_pool_id AND m.member_id = $1
   )
RETURNING ...;
```

Zero rows returned ⇒ "already claimed by X." No queue daemon. Race-safe via the `WHERE state = 'va_review_pending'` predicate.

`ReleaseVAClaim` reverses: `state` returns to `va_review_pending`, `va_id` cleared. Allowed only by the current claimant or by an admin role.

## Send-Back Flow (verdict = request_docs)

Single transaction in `withTenantTx`:

1. INSERT into `va_reviews` (full report).
2. UPDATE `loans` set `state = 'va_doc_request_pending'`, `current_va_review_id = <new>`, `va_id = NULL`, `claimed_at = NULL`.
3. INSERT into `va_event_outbox` with `event_type = 'va.doc_request_issued'`.

Post-commit, an outbox dispatcher (long-running background worker, holding **advisory lock 44** continuously while running) reads pending rows and invokes the per-tenant adapter:

> **Advisory lock registry.** 42 — SLA monitor (Tenant Isolation v2). 43 — pattern detection / VA pattern pass (Learning Engine v2; this spec adds a co-tenant pass on the same lock). 44 — VA outbox dispatcher (this spec; held continuously by the long-running worker). New lock numbers must be coordinated and added to this registry to prevent cross-worker collision.

```ts
type VADocRequestAdapter =
  | { kind: "ui-only" }                             // no-op; demo default
  | { kind: "portal-webhook"; url: string; secretRef: string }
  | { kind: "npnqm-portal" };                       // placeholder, separate spec
```

Adapter result writes back to the outbox row (`delivered_at`, `last_error`, `attempts`). Exponential backoff on failure: 1m, 5m, 30m, 2h, 12h, dead-letter after 6 attempts.

The VA's UI confirms "request submitted" the moment the transaction commits — delivery reliability is a background concern.

### Inbound: docs returned

Two ingress paths to the same service function:

- `/bpo/loans/:id/docs-returned` — for portals that reply via a BPO-portal API call.
- Tenant inbound webhooks (existing `webhook_deliveries` infra) — for portals that POST asynchronously.

The service function `receiveVADocResponse(loanId, docs)`:

1. Authorises the call (BPO-token or tenant inbound webhook).
2. INSERTs the new docs into `loans.documents`.
3. Transitions `loan.state` from `va_doc_request_pending` to `agent_review_pending`.
4. Triggers the agent re-run (existing pipeline; new docs become input).

When the agent re-stages, the loan returns to `va_review_pending` and is **re-routed via the same routing rules** — fresh claim by any pool member. The original VA is not pinned. (Pinning to the prior reviewer, even as advisory display, is punted to a later spec — see *Non-Goals* item 2.)

## Per-Tenant Configuration

```ts
// Persisted at tenants.settings.va
type TenantVASettings = {
  required: boolean;
  fallbackPoolId: string | null;
  docRequestAdapter:
    | { kind: "ui-only" }
    | { kind: "portal-webhook"; url: string; secretRef: string }
    | { kind: "npnqm-portal" };
  reviewSlaMinutes: number | null;       // operational hint, surfaced in UI
};
```

**Validation invariants (enforced at config-write time, not runtime):**
- `required === true` ⇒ `fallbackPoolId` non-null AND that pool exists AND has ≥ 1 active member.
- All `va_routing_rules.target_pool_id` references must be valid for the tenant.

**Seed values:**
- `demo` tenant: `{ required: false, fallbackPoolId: null, docRequestAdapter: { kind: "ui-only" }, reviewSlaMinutes: null }` — current behaviour preserved; VA tier is invisible to the demo flow unless explicitly enabled.
- `npnqm-twin` tenant: `{ required: true, fallbackPoolId: <internal staff pool seeded by migration>, docRequestAdapter: { kind: "ui-only" }, reviewSlaMinutes: 60 }` — VA gate live from day one. The `npnqm-portal` adapter is a separate spec; until then, the portal-webhook generic adapter or ui-only suffice.

## Authentication

### Internal staff
- Existing Supabase auth. No changes.
- `actor = { kind: "internal", userId, email }` recorded in `action_log`.

### BPO partner SMEs (the day-one external identity)

```
SME (curl / portal SPA)
  ↓ Authorization: Bearer <bpo_api_key>
  ↓
/bpo/auth                              packages/api/src/routes/bpo/*
  ├── verify key against bpo_api_keys (sha256 hash)
  ├── resolve tenant_id, sme_id, partner_id
  ├── populate AsyncLocalStorage:
  │     tenantContext  = { tenantId }              (RLS, existing)
  │     bpoContext     = { partnerId, smeId }      (NEW, used by /bpo/* handlers)
  ↓
/bpo/queue, /bpo/loans/:id/review
  ├── RLS still enforces tenant boundary
  ├── Handler-level filter:
  │     loan.assigned_pool_id IN (
  │       SELECT pool_id FROM va_pool_memberships
  │        WHERE member_id = bpoContext.smeId AND member_kind = 'bpo'
  │     )
  └── No access to tenant admin features, no tenant switcher
```

Two layers of defence: RLS protects against cross-tenant leak; pool-membership filter protects against cross-pool leak inside a tenant. BPO routes are a strict subset of platform functionality — a BPO SME can claim, review, submit, and receive doc-response webhooks; nothing else.

`actor = { kind: "bpo", partnerId, smeId, smeName }` recorded in `action_log` for every BPO action.

### BPO NPI handling

A VA review requires the SME to see borrower NPI (income docs, asset statements, credit detail). For BPO partners, this is a regulated data-sharing event and the spec treats it as such.

**Loan-detail response shape.** `GET /bpo/loans/:id` returns the full loan record needed for review: borrower identity, transaction terms, agent worksheets and trace, agent-staged recommendation, condition list, and **document metadata** (filename, doctype, uploaded_at, page_count). Document content is *not* embedded in the response.

**Document-content access.** Document files live in tenant-scoped Supabase Storage buckets. BPO SMEs receive **signed URLs with 15-minute expiry**, generated per-request via a new `/bpo/loans/:id/documents/:docId/signed-url` endpoint. Each issuance writes a row to `tenant_audit_log` with:

- `action_type = 'bpo_document_access'`
- `actor = { kind: "bpo", partnerId, smeId }`
- `target_type = 'loan_document'`, `target_id = docId`
- `metadata = { tenant_id, loan_id, expiry_at }`

Audit rows for BPO document access are retained per the tenant's standard audit retention (existing `tenant_audit_log` policy). They are queryable by tenant admins and feed any SOC 2 / GLBA evidence packet.

**DPA precondition.** Tenant Data Processing Agreements with BPO partners are out of scope for this spec but are a precondition for enabling a BPO pool. The `POST /admin/bpo/partners` endpoint requires a tenant-scoped acknowledgment field (`dpa_on_file: boolean`, `dpa_reference: string`) that must be `true` and non-empty before any BPO pool referencing the partner can be created. Enforcement is at config-write time on `va_pools` (rejects creation of `kind = 'bpo'` pool when the partner's DPA flag is false).

## API Surface

New endpoints (all under `withTenantTx`):

- `POST /loans/:id/va/claim` — implements `ClaimForVAReview`. Returns 409 if already claimed.
- `POST /loans/:id/va/release` — implements `ReleaseVAClaim`.
- `POST /loans/:id/va/review` — implements `SubmitVAReview`. Body validated against `VAReview` Zod schema.
- `POST /loans/:id/va/docs-returned` — implements `ReceiveVADocResponse`. Two auth modes: tenant inbound webhook OR BPO token.
- `GET /va/queue?pool=<id>` — pool queue listing for the authenticated VA.
- `GET /va/pools` — pools the authenticated user is a member of.
- `GET /loans/:id/va/review-history` — full ordered list of prior `va_reviews` rows for the loan (the loan can have multiple after doc-request loops). Used by the VA Review Workspace to render the "Prior reviews" panel and by the UW Decision page when more than one review exists.

Admin endpoints (existing tenant-admin auth):
- `GET/POST/PATCH /admin/va/pools`
- `GET/POST/PATCH /admin/va/routing-rules`
- `GET/POST/DELETE /admin/bpo/partners`
- `GET/POST/DELETE /admin/bpo/smes`
- `POST /admin/bpo/api-keys` (returns the raw key once at creation)

BPO-portal endpoints (under `/bpo/*`, BPO-token auth):
- `POST /bpo/auth` — token exchange for session info.
- `GET /bpo/queue` — pool queue scoped to SME's pools.
- `GET /bpo/loans/:id` — loan detail (read-only).
- `POST /bpo/loans/:id/review` — submit review (same handler as `/loans/:id/va/review`).
- `POST /bpo/loans/:id/docs-returned` — for portal callbacks.

## UI Surfaces

Detailed in design conversation. Summary:

1. **VA Review Workspace** (`/t/:tenantSlug/va/:loanId/review`) — new page. Six-row signoff table, condition actions list, overall rationale textarea, verdict picker, expanded doc-request form when verdict=request_docs. If the loan has prior `va_reviews` rows (loop through doc-request), the workspace displays a collapsed **"Prior reviews"** panel above the signoff table, listing each prior review's verdict, doc-request (if any), and overall rationale, expandable for full detail. The new claimant must see why prior VAs sent the loan back before forming their own verdict.
2. **VA Pool Queue** — extension of existing `/t/:tenantSlug/va`. Adds pool filter + Claim button.
3. **UW Decision Page — VA Review Panel** — extension. Renders `loan.current_va_review_id` evidence above the agent recommendation when present.
4. **BPO Portal** (`/bpo/*`) — minimal new surface. Same review workspace component, scoped routes, distinguished header chrome ("BPO SME" badge).

Per CLAUDE.md: no emojis, Encompass navy palette, `enc-panel` / `enc-btn` / `enc-input` classes.

## Learning Engine Integration

The existing `decision_records`-based pattern detection is unchanged. A parallel pass joins `va_reviews` with `decision_records` on `loan_id` to surface assist-quality patterns:

- `va_disagree_rate` — per program, % of VA reviews where ≥ 1 specialist signoff was `disagree`.
- `va_contest_rate` — per program, % of reviews with ≥ 1 contested condition.
- `va_concur_then_uw_override` — VA concurred but UW overrode the agent recommendation. Signal: VA missed something.
- `va_request_docs_rate` — per program, % of reviews ending in request_docs vs concur.

New `pattern_kind` enum values added to the existing pattern detection schema. The 6-hourly worker (advisory lock 43) gets a second analysis pass. Patterns surface in the existing learning UI alongside the existing decision-record patterns; no new dashboard in v1.

**Provenance contract.** `va_reviews.agentRecommendationId`, `kbVersion`, and `chatbotConsultationIds` carry the same provenance discipline as `decision_records`. Pattern detection joins on `kbVersion` so a shift in disagree-rate after a KB ingest can be attributed to the new KB version rather than confounded with operator drift. Joins on `agentRecommendationId` let us measure VA reviews against specific agent runs (useful when the agent is upgraded mid-flight).

**Decision attribution unchanged.** The UW decision is still the system of record. VA review is *evidence the UW saw*, not a decision in itself.

## Error Handling

- **Claim race:** SQL UPDATE with state predicate is the source of truth. Lost claimants get a 409 with the current claimant's identity.
- **Submit validation failure:** 422 with field-level error array (Zod report).
- **State-machine violation** (e.g., `AcceptRecommendation` while `state = va_review_pending`): reducer throws `ActionError("VA_REVIEW_REQUIRED", ...)`; API returns 409.
- **Outbox dispatcher failure:** retried with exponential backoff. Dead-letter after 6 attempts; surfaced in admin UI as a warning.
- **BPO auth failure:** 401, no information disclosure about whether the token existed or was revoked.
- **BPO cross-pool access attempt:** 404 (not 403) so a BPO SME cannot probe for loan IDs outside their pools.

## Testing Strategy

Vitest, following existing patterns:

**Core (packages/core/test/):**
- Reducer state-machine transitions for all five new actions, including invariant violations.
- VAReview Zod schema validation: all fail-modes (missing specialist row, missing notes on disagree, < 20 char rationale, etc.).

**API (packages/api/test/):**
- Claim race: two concurrent claim calls; exactly one succeeds.
- Submit happy path (concur), submit happy path (request_docs), submit reject paths.
- BPO auth: valid key claims successfully; revoked key gets 401; cross-pool loan returns 404.
- Outbox: SubmitVAReview with verdict=request_docs writes outbox row; dispatcher delivers; failure increments attempts.
- Tenant policy: when `va.required=false`, AcceptRecommendation works in `agent_review_pending`; when `va.required=true`, same call returns 409.

**Integration (E2E harness):**
- New workflow `W9_va_review` covering the full agent → VA → UW path.
- Extension of existing W2_uw_override to include VA disagree → UW override case.

## Migration & Rollout

1. Schema migration `007-va-review-layer.sql` adds tables + columns. Existing `loans.state` values mapped: anything in current "pending recommendation" maps to `agent_review_pending`; anything decided stays `decided`.
2. Seed migration creates default pools per existing tenant: one `internal` pool named `<tenant-name> Internal Team`, populated with all current tenant users.
3. Demo tenant: `va.required = false`. No flow change. Optional showcase: admin can flip the toggle to demo the VA tier, but baseline is off.
4. NPNQM-twin tenant: `va.required = true` with `docRequestAdapter: { kind: "ui-only" }` initially. Real adapter is a separate spec.
5. Feature flag (`tenant.settings.va.required`) is the rollout switch; no code-level gate.

## Open Questions

None at design close. Items the user explicitly punted to later specs are listed in *Non-Goals*.

## Appendix — Glossary

- **VA** — Virtual Assistant. The reviewer tier. Either internal staff or BPO SME.
- **BPO SME** — Business Process Outsourcing Subject Matter Expert. External identity, authenticated via per-SME API key.
- **Pool** — Routing destination. Either an internal pool (Supabase users) or a BPO pool (SMEs of one partner).
- **Routing rule** — Tenant-scoped rule that maps a loan to a pool by program / amount / occupancy.
- **Doc-request** — VA's structured response when send-back is needed. Names specific docs (drawn from tenant's Doc Checklist) with reasons and a deadline.
- **Outbox** — Transactional event queue. Doc-request events write here in the same transaction as the review submit, then a background dispatcher delivers via the per-tenant adapter.
