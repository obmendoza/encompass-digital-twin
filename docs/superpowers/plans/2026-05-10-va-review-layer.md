# VA Review Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a Virtual Assistant (VA) review tier between Multi-Agent analysis and UW Decision — required gate when tenant enables, structured review report (six specialist signoffs + condition actions + rationale), pool-based routing with internal + BPO identities from day one, and outbox-based portal-messaging integration for doc-requests back to the originator.

**Architecture:** Six new loan states + five new core actions; reducer enforces the gate invariant. New tables: `va_reviews`, `va_pools`, `va_pool_memberships`, `va_routing_rules`, `bpo_partners`, `bpo_smes`, `bpo_api_keys`, `va_event_outbox`. Three new UI surfaces (VA Review Workspace, BPO Portal, UW VA Review Panel) plus an extension of the existing VA Dashboard. Background outbox dispatcher holds advisory lock 44 continuously; pattern-detection worker (lock 43) gets a VA-assist co-tenant pass.

**Tech Stack:** TypeScript, Postgres (Supabase session pooler), Fastify 4, Next.js 15 App Router + React 19, Tailwind, Zod, Vitest. No new top-level package deps.

**Spec reference:** `docs/superpowers/specs/2026-05-10-va-review-layer-design.md` (commit `0c51cbd`).

---

## Resolutions for spec ambiguities

These five resolutions came up while writing the plan — none change the spec's intent, just lock in the implementation choice the spec left open:

1. **Migration numbering.** The next free migration is `014` (existing migrations end at `013-e2e-harness-metadata.sql`). VA schema is `014-va-review-layer.sql`; default-pool seed is `015-va-default-pools.sql`.
2. **Where the routing happens.** The spec says "API handler resolves the routing rules." Concretely: routing fires inside the existing `StageRecommendation` action handler in `packages/api/src/routes/world.ts`, *after* the reducer transitions the state to `agent_review_pending` but *before* the response returns. If `tenant.settings.va.required === true`, the handler then calls `vaRouter.routeLoan(loanId)` which evaluates rules and writes `loans.assigned_pool_id` + transitions state to `va_review_pending`.
3. **Where the gate invariant lives.** Reducer-level (`packages/core/src/reduce.ts`) for the deterministic state-machine check, AND API-level (`requireUWStateOrTenantOptOut` middleware) so the API returns 409 with a structured error before the action even reaches the reducer. Belt-and-suspenders to avoid 500s.
4. **Outbox dispatcher process model.** A single Node process per API instance, started in `server.ts` at boot (after migrations), holding advisory lock 44 in a continuous loop with a 2-second sleep between iterations. Multi-instance safety: every instance tries the lock, only one wins; the others sleep and retry every 30s in case the leader dies.
5. **Demo tenant default — do we ship `va.required = false` or omit the key?** Migration 014 inserts the full `va` settings object into every existing tenant's `settings` JSONB, with demo defaulting `required = false` and npnqm-twin defaulting `required = true`. Explicit-default beats implicit-undefined for diagnosability.

---

## File structure

| File | Responsibility | Phase |
|---|---|---|
| `packages/api/src/db/migrations/014-va-review-layer.sql` | All 8 new tables + 4 ALTER TABLE additions on `loans` | 1 |
| `packages/api/src/db/migrations/015-va-default-pools.sql` | One internal pool per existing tenant; populates `tenant.settings.va` defaults | 1 |
| `packages/core/src/types.ts` | Add `LoanState` union, 5 new Action variants, `VAReview` interface, `BpoActor` discriminator on `Actor` | 1 |
| `packages/core/src/schemas.ts` | Zod schemas for `VAReview` payload + 5 new action shapes | 1 |
| `packages/core/src/reduce.ts` | Handle 5 new actions; enforce VA-gate invariant on `AcceptRecommendation` / `OverrideDecision` / `SetDecision` | 1 |
| `packages/core/src/va-state-machine.ts` | Pure helper module: legal transitions table, `canTransition()`, `isTerminalState()` | 1 |
| `packages/core/test/va-state-machine.test.ts` | State machine unit tests | 1 |
| `packages/core/test/reducer-va-actions.test.ts` | Reducer tests for 5 new actions + invariant | 1 |
| `packages/core/test/va-review-schema.test.ts` | Zod validation tests for VAReview | 1 |
| `packages/api/src/services/va-routing.ts` | `routeLoan(loanId, tenantContext)` — evaluates rules, writes `assigned_pool_id`, transitions state | 2 |
| `packages/api/src/services/va-review-writer.ts` | `submitVAReview(loanId, review)` — single tx: INSERT va_review, UPDATE loan, INSERT outbox if request_docs | 2 |
| `packages/api/src/services/va-pool.ts` | `claimLoan(loanId, vaId)` (race-safe SQL), `releaseLoan(loanId, vaId)` | 2 |
| `packages/api/src/services/va-toggle.ts` | `applyToggleFlip(tenantId, from, to)` — backfill or release loans on `va.required` flip | 2 |
| `packages/api/src/services/bpo-document-access.ts` | Issue 15-min signed URL + audit-log row | 4 |
| `packages/api/src/services/va-outbox-dispatcher.ts` | Long-running worker holding lock 44; per-tenant adapter dispatch + retry/backoff | 5 |
| `packages/api/src/services/va-doc-return.ts` | `receiveVADocResponse(loanId, docs)` — both internal and BPO ingress paths converge here | 5 |
| `packages/api/src/services/va-pattern-detection.ts` | Co-tenant pass on lock 43; computes `va_disagree_rate`, `va_contest_rate`, `va_concur_then_uw_override`, `va_request_docs_rate` | 7 |
| `packages/api/src/routes/va.ts` | `/loans/:id/va/{claim,release,review,docs-returned}`, `/va/{queue,pools}`, `/loans/:id/va/review-history` | 3 |
| `packages/api/src/routes/va-admin.ts` | `/admin/va/{pools,routing-rules}`, `/admin/bpo/{partners,smes,api-keys}` (with DPA gate) | 4 |
| `packages/api/src/routes/bpo.ts` | `/bpo/{auth,queue,loans/:id,loans/:id/review,loans/:id/docs-returned,loans/:id/documents/:docId/signed-url}` | 4 |
| `packages/api/src/middleware/bpo-auth.ts` | Verify BPO API key, populate `bpoContext` AsyncLocalStorage | 4 |
| `packages/api/src/bpo-context.ts` | AsyncLocalStorage for `{ partnerId, smeId, smeName }` | 4 |
| `packages/api/src/server.ts` | Register new routes; start outbox dispatcher; start VA pattern worker | 3, 5, 7 |
| `packages/api/src/schemas.ts` | Zod schemas for new endpoint bodies (admin, BPO) | 3, 4 |
| `packages/api/test/va-routes.test.ts` | Routes happy-path + 4xx coverage | 3 |
| `packages/api/test/va-claim-race.test.ts` | Concurrent claim race; exactly one wins | 3 |
| `packages/api/test/va-toggle.test.ts` | Toggle flip semantics (false→true backfill, true→false release) | 3 |
| `packages/api/test/bpo-auth.test.ts` | Token-verification, revoked-key 401, cross-pool 404, per-access audit row | 4 |
| `packages/api/test/va-outbox.test.ts` | Outbox row inserted in same tx as review; dispatcher delivers; failure increments attempts | 5 |
| `packages/api/test/va-doc-return.test.ts` | Doc-return ingress flips state and triggers agent re-run | 5 |
| `packages/api/test/va-pattern-detection.test.ts` | Pattern computation correctness; advisory-lock 43 co-tenancy | 7 |
| `packages/web/components/encompass/VAReviewWorkspace.tsx` | Signoff table (6 rows) + condition actions + rationale + verdict picker + doc-request form | 6 |
| `packages/web/components/encompass/PriorReviewsPanel.tsx` | Collapsed history of prior `va_reviews` rows for a loan | 6 |
| `packages/web/components/encompass/UWReviewPanel.tsx` | Renders `current_va_review_id` evidence above agent recommendation on UW decision page | 6 |
| `packages/web/components/encompass/VADashboard.tsx` | MODIFY — add Pool Queue filter + Claim button per row | 6 |
| `packages/web/app/loan/[loanId]/va/review/page.tsx` | Server component fetching loan + history + agent trace; renders VAReviewWorkspace | 6 |
| `packages/web/app/loan/[loanId]/va/review/actions.ts` | Server actions: claim, release, submit | 6 |
| `packages/web/app/loan/[loanId]/page.tsx` | MODIFY — render UWReviewPanel when `current_va_review_id` is set | 6 |
| `packages/web/app/bpo/layout.tsx` | Distinct chrome ("BPO SME" badge); BPO-token cookie auth | 6 |
| `packages/web/app/bpo/login/page.tsx` | Token entry form | 6 |
| `packages/web/app/bpo/queue/page.tsx` | Pool queue scoped to SME's pools | 6 |
| `packages/web/app/bpo/loans/[id]/review/page.tsx` | Same VAReviewWorkspace, scoped routes | 6 |
| `packages/web/lib/bpo-client.ts` | BPO portal API client (typed wrapper over fetch) | 6 |
| `scripts/e2e-harness/workflows/W9-va-review.ts` | E2E harness workflow: agent → claim → submit-concur → UW accept; tagged with `harness_run_id` for purge | 7 |

---

## Phase 1 — Schema & Core (foundation)

Phase 1 lands the database schema, core types, Zod schemas, reducer changes, and the state-machine helper. After Phase 1, the system has the data model and reducer for VA reviews but no routes, no UI, no workers — purely additive and inert until Phase 3+ wires it up. Existing tests (84 core + 98 API) must still pass.

### Task 1: DB migration 014 — VA Review Layer schema

**Files:**
- Create: `packages/api/src/db/migrations/014-va-review-layer.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 014-va-review-layer.sql
-- VA Review Layer: tables, RLS, indexes. Numbering picks up after 013.

-- ============================================================================
-- Loan state extensions (additive columns on existing loans table)
-- ============================================================================

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS va_state TEXT NOT NULL DEFAULT 'agent_review_pending'
    CHECK (va_state IN (
      'agent_review_pending',
      'va_review_pending',
      'va_in_review',
      'va_doc_request_pending',
      'uw_review_pending',
      'decided'
    )),
  ADD COLUMN IF NOT EXISTS current_va_review_id UUID NULL,
  ADD COLUMN IF NOT EXISTS va_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS assigned_pool_id UUID NULL;

-- ============================================================================
-- Pool & routing
-- ============================================================================

CREATE TABLE IF NOT EXISTS va_pools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('internal', 'bpo')),
  bpo_partner_id UUID NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'bpo') = (bpo_partner_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_va_pools_tenant ON va_pools(tenant_id);

CREATE TABLE IF NOT EXISTS va_pool_memberships (
  pool_id UUID NOT NULL REFERENCES va_pools(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL,
  member_kind TEXT NOT NULL CHECK (member_kind IN ('internal', 'bpo')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pool_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_va_pool_memberships_member ON va_pool_memberships(member_id);

CREATE TABLE IF NOT EXISTS va_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL,
  match JSONB NOT NULL,
  target_pool_id UUID NOT NULL REFERENCES va_pools(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_va_routing_rules_tenant_priority
  ON va_routing_rules(tenant_id, priority);

-- Loans FK to assigned_pool_id (added after va_pools exists)
ALTER TABLE loans
  ADD CONSTRAINT IF NOT EXISTS loans_assigned_pool_fk
  FOREIGN KEY (assigned_pool_id) REFERENCES va_pools(id) ON DELETE SET NULL;

-- ============================================================================
-- BPO identity (global tables, NOT tenant-scoped)
-- ============================================================================

CREATE TABLE IF NOT EXISTS bpo_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  dpa_on_file BOOLEAN NOT NULL DEFAULT false,
  dpa_reference TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bpo_smes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bpo_partner_id UUID NOT NULL REFERENCES bpo_partners(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bpo_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sme_id UUID NOT NULL REFERENCES bpo_smes(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key_hash BYTEA NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL,
  last_used_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS idx_bpo_api_keys_tenant_active
  ON bpo_api_keys(tenant_id) WHERE revoked_at IS NULL;

-- va_pools FK to bpo_partners (added after bpo_partners exists)
ALTER TABLE va_pools
  ADD CONSTRAINT IF NOT EXISTS va_pools_bpo_partner_fk
  FOREIGN KEY (bpo_partner_id) REFERENCES bpo_partners(id) ON DELETE RESTRICT;

-- DPA gate trigger: prevent creating a kind='bpo' pool for a partner with dpa_on_file=false.
CREATE OR REPLACE FUNCTION va_pools_dpa_gate() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.kind = 'bpo' THEN
    IF NOT EXISTS (
      SELECT 1 FROM bpo_partners
       WHERE id = NEW.bpo_partner_id
         AND dpa_on_file = true
         AND COALESCE(dpa_reference, '') <> ''
    ) THEN
      RAISE EXCEPTION 'va_pools.dpa_gate_violation: partner % lacks dpa_on_file=true with dpa_reference', NEW.bpo_partner_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_va_pools_dpa_gate ON va_pools;
CREATE TRIGGER trg_va_pools_dpa_gate
  BEFORE INSERT OR UPDATE ON va_pools
  FOR EACH ROW EXECUTE FUNCTION va_pools_dpa_gate();

-- ============================================================================
-- VA reviews (review report records)
-- ============================================================================

CREATE TABLE IF NOT EXISTS va_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id TEXT NOT NULL,
  va_id TEXT NOT NULL,
  va_pool_id UUID NOT NULL REFERENCES va_pools(id) ON DELETE RESTRICT,
  pool_kind TEXT NOT NULL CHECK (pool_kind IN ('internal', 'bpo')),
  verdict TEXT NOT NULL CHECK (verdict IN ('concur', 'request_docs')),
  specialist_signoffs JSONB NOT NULL,    -- exactly six entries; validated app-side
  condition_actions JSONB NOT NULL,      -- zero+; clear|contest only
  overall_rationale TEXT NOT NULL CHECK (length(overall_rationale) >= 20),
  doc_request JSONB NULL,                -- non-null iff verdict = 'request_docs'
  agent_recommendation_id UUID NOT NULL,
  kb_version TEXT NOT NULL,
  chatbot_consultation_ids UUID[] NOT NULL DEFAULT '{}',
  claimed_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  review_time_seconds INTEGER NOT NULL,
  CHECK ((verdict = 'request_docs') = (doc_request IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_va_reviews_loan ON va_reviews(loan_id);
CREATE INDEX IF NOT EXISTS idx_va_reviews_tenant_submitted ON va_reviews(tenant_id, submitted_at DESC);

-- Loans FK to current_va_review_id (added after va_reviews exists)
ALTER TABLE loans
  ADD CONSTRAINT IF NOT EXISTS loans_current_va_review_fk
  FOREIGN KEY (current_va_review_id) REFERENCES va_reviews(id) ON DELETE SET NULL;

-- ============================================================================
-- Outbox for doc-request events
-- ============================================================================

CREATE TABLE IF NOT EXISTS va_event_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  loan_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ NULL,
  delivered_at TIMESTAMPTZ NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  last_attempted_at TIMESTAMPTZ NULL,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_va_event_outbox_pending
  ON va_event_outbox(next_attempt_at)
  WHERE delivered_at IS NULL;

-- ============================================================================
-- RLS — every tenant_id-bearing table from this spec
-- ============================================================================

ALTER TABLE va_pools ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_va_pools ON va_pools
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE va_pool_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_va_pool_memberships ON va_pool_memberships
  USING (pool_id IN (
    SELECT id FROM va_pools
    WHERE tenant_id = current_setting('app.current_tenant_id')::uuid
  ));

ALTER TABLE va_routing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_va_routing_rules ON va_routing_rules
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE va_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_va_reviews ON va_reviews
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE va_event_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_va_event_outbox ON va_event_outbox
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE bpo_api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_bpo_api_keys ON bpo_api_keys
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- bpo_partners and bpo_smes are global by design (cross-tenant) — no RLS.
```

- [ ] **Step 2: Boot API and verify migration runs**

API runs migrations on boot via `runMigrations()` in `packages/api/src/db/migrations.ts`. Restart the API and watch the log:

```bash
pnpm --filter @twin/api dev
```

Expected log line: `[migrations] applied 014-va-review-layer.sql`. No error.

- [ ] **Step 3: Smoke-check the schema**

```bash
psql "$DATABASE_URL" -c "\d va_reviews" | head -20
psql "$DATABASE_URL" -c "\dt va_*"
psql "$DATABASE_URL" -c "\dt bpo_*"
```

Expected: `va_reviews` shows the columns from the migration; `\dt va_*` lists `va_pools`, `va_pool_memberships`, `va_routing_rules`, `va_reviews`, `va_event_outbox`; `\dt bpo_*` lists `bpo_partners`, `bpo_smes`, `bpo_api_keys`.

- [ ] **Step 4: Verify DPA gate trigger**

```bash
psql "$DATABASE_URL" <<'SQL'
INSERT INTO bpo_partners (name, contact_email, dpa_on_file)
  VALUES ('Test Partner Without DPA', 'x@y.com', false) RETURNING id \gset
INSERT INTO va_pools (tenant_id, name, kind, bpo_partner_id)
  VALUES ('00000000-0000-0000-0000-000000000000', 'Should Fail', 'bpo', :'id');
SQL
```

Expected: the second INSERT fails with `va_pools.dpa_gate_violation`. Clean up: `psql "$DATABASE_URL" -c "DELETE FROM bpo_partners WHERE name = 'Test Partner Without DPA';"`

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/db/migrations/014-va-review-layer.sql
git commit -m "feat(db): VA review layer schema — tables, RLS, DPA gate trigger"
```

---

### Task 2: DB migration 015 — default pools + tenant.settings.va seed

**Files:**
- Create: `packages/api/src/db/migrations/015-va-default-pools.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 015-va-default-pools.sql
-- For every existing tenant, create a default internal pool and seed
-- tenant.settings.va. Demo defaults required=false; npnqm-twin defaults
-- required=true. Other tenants default required=false (opt-in).

DO $$
DECLARE
  t RECORD;
  new_pool_id UUID;
  va_required BOOLEAN;
  sla_minutes INTEGER;
BEGIN
  FOR t IN SELECT id, slug, name, settings FROM tenants WHERE deleted_at IS NULL LOOP
    -- Determine per-tenant defaults.
    IF t.slug = 'npnqm-twin' THEN
      va_required := true;
      sla_minutes := 60;
    ELSE
      va_required := false;
      sla_minutes := NULL;
    END IF;

    -- Create the default internal pool (idempotent: skip if already exists).
    SELECT id INTO new_pool_id
      FROM va_pools
     WHERE tenant_id = t.id AND kind = 'internal' AND name = (t.name || ' Internal Team');

    IF new_pool_id IS NULL THEN
      INSERT INTO va_pools (tenant_id, name, kind, bpo_partner_id, active)
        VALUES (t.id, t.name || ' Internal Team', 'internal', NULL, true)
        RETURNING id INTO new_pool_id;
    END IF;

    -- Merge va settings into tenants.settings without trampling existing keys.
    UPDATE tenants
       SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
             'va', jsonb_build_object(
               'required', va_required,
               'fallbackPoolId', new_pool_id::text,
               'docRequestAdapter', jsonb_build_object('kind', 'ui-only'),
               'reviewSlaMinutes', sla_minutes
             )
           )
     WHERE id = t.id;

    RAISE NOTICE 'tenant % seeded: pool=% required=%', t.slug, new_pool_id, va_required;
  END LOOP;
END $$;
```

- [ ] **Step 2: Restart API and verify**

```bash
pnpm --filter @twin/api dev
```

Watch for `tenant demo seeded`, `tenant npnqm-twin seeded` notice lines.

- [ ] **Step 3: Smoke-check the seed**

```bash
psql "$DATABASE_URL" -c "SELECT slug, settings->'va' FROM tenants WHERE slug IN ('demo','npnqm-twin');"
```

Expected: demo has `"required": false`; npnqm-twin has `"required": true`. Both have non-null `fallbackPoolId`.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/db/migrations/015-va-default-pools.sql
git commit -m "feat(db): seed default VA internal pool per tenant + tenants.settings.va defaults"
```

---

### Task 3: Core types — `LoanState`, 5 actions, `VAReview` interface, `BpoActor`

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Add `LoanState` union and add `state` field to `Loan`**

In `packages/core/src/types.ts`, after the existing imports and before the `Loan` interface, add:

```ts
export type LoanState =
  | "agent_review_pending"
  | "va_review_pending"
  | "va_in_review"
  | "va_doc_request_pending"
  | "uw_review_pending"
  | "decided";
```

In the `Loan` interface (search for `interface Loan`), add (preserve existing fields):

```ts
  // VA review layer additions (spec 2026-05-10):
  state?: LoanState;                    // optional during in-flight migration; treat undefined as "agent_review_pending"
  currentVaReviewId?: string | null;
  vaId?: string | null;                 // current claimant when state === "va_in_review"
  claimedAt?: string | null;
  assignedPoolId?: string | null;
```

- [ ] **Step 2: Add `VAReview` interface**

After the `Loan` interface, add:

```ts
export type VASpecialistKind =
  | "doc" | "income" | "asset" | "credit" | "property" | "compliance";

export interface VASpecialistSignoff {
  specialist: VASpecialistKind;
  signoff: "concur" | "disagree";
  notes: string | null;
}

export interface VAConditionAction {
  conditionId: string;
  action: "clear" | "contest";
  note: string | null;
}

export interface VADocRequestItem {
  docType: string;
  reason: string;
  required: boolean;
}

export interface VADocRequest {
  docs: VADocRequestItem[];
  deadline: string;            // ISO date
  messageToOriginator: string;
}

export interface VAReview {
  id: string;
  tenantId: string;
  loanId: LoanId;
  vaId: string;
  vaPoolId: string;
  poolKind: "internal" | "bpo";
  verdict: "concur" | "request_docs";
  specialistSignoffs: VASpecialistSignoff[];     // length 6, one per specialist, distinct
  conditionActions: VAConditionAction[];
  overallRationale: string;                       // ≥ 20 chars
  docRequest: VADocRequest | null;                // non-null iff verdict === "request_docs"
  agentRecommendationId: string;
  kbVersion: string;
  chatbotConsultationIds: string[];
  claimedAt: string;
  submittedAt: string;
  reviewTimeSeconds: number;
}
```

- [ ] **Step 3: Extend `Actor` with BPO discriminator**

Search for the existing `Actor` type (near line 280-310). Replace it with:

```ts
export type Actor =
  | { kind: "internal"; userId: string; email: string }
  | { kind: "bpo"; partnerId: string; smeId: string; smeName: string }
  | { kind: "agent"; id: string }
  | { kind: "system"; id: string };
```

If the existing `Actor` is structurally different, add the BPO variant alongside without removing existing variants.

- [ ] **Step 4: Add 5 new Action variants**

Find the `Action` union type (search `type Action =`). Add these variants:

```ts
  | { type: "ClaimForVAReview"; loanId: LoanId; vaId: string; poolId: string; poolKind: "internal" | "bpo"; actor: Actor }
  | { type: "ReleaseVAClaim"; loanId: LoanId; vaId: string; actor: Actor }
  | { type: "SubmitVAReview"; loanId: LoanId; review: VAReview; actor: Actor }
  | { type: "ReceiveVADocResponse"; loanId: LoanId; documents: Document[]; actor: Actor }
  | { type: "RouteToVA"; loanId: LoanId; assignedPoolId: string; actor: Actor }
```

(`RouteToVA` is the action emitted by the routing service after `StageRecommendation` when `tenant.va.required = true`. It's a separate action from `SubmitVAReview` so the reducer can be tested independently of the routing service.)

- [ ] **Step 5: Build core**

```bash
pnpm --filter @twin/core build
```

Expected: clean build, no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): add LoanState, VAReview, BPO Actor variant, and 5 VA action types"
```

---

### Task 4: Core state-machine helper — legal transitions table

**Files:**
- Create: `packages/core/src/va-state-machine.ts`
- Create: `packages/core/test/va-state-machine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/va-state-machine.test.ts
import { describe, it, expect } from "vitest";
import { canTransition, isTerminalState, LEGAL_TRANSITIONS } from "../src/va-state-machine.js";

describe("VA state machine", () => {
  it("allows agent_review_pending → va_review_pending (RouteToVA)", () => {
    expect(canTransition("agent_review_pending", "va_review_pending")).toBe(true);
  });

  it("allows agent_review_pending → uw_review_pending (skip when va.required=false)", () => {
    expect(canTransition("agent_review_pending", "uw_review_pending")).toBe(true);
  });

  it("allows va_review_pending → va_in_review (claim)", () => {
    expect(canTransition("va_review_pending", "va_in_review")).toBe(true);
  });

  it("allows va_in_review → va_review_pending (release)", () => {
    expect(canTransition("va_in_review", "va_review_pending")).toBe(true);
  });

  it("allows va_in_review → uw_review_pending (concur)", () => {
    expect(canTransition("va_in_review", "uw_review_pending")).toBe(true);
  });

  it("allows va_in_review → va_doc_request_pending (request_docs)", () => {
    expect(canTransition("va_in_review", "va_doc_request_pending")).toBe(true);
  });

  it("allows va_doc_request_pending → agent_review_pending (docs returned)", () => {
    expect(canTransition("va_doc_request_pending", "agent_review_pending")).toBe(true);
  });

  it("allows uw_review_pending → decided (UW decides)", () => {
    expect(canTransition("uw_review_pending", "decided")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransition("decided", "agent_review_pending")).toBe(false);
    expect(canTransition("agent_review_pending", "decided")).toBe(false);
    expect(canTransition("va_review_pending", "decided")).toBe(false);
    expect(canTransition("va_in_review", "decided")).toBe(false);
  });

  it("decided is terminal", () => {
    expect(isTerminalState("decided")).toBe(true);
  });

  it("non-decided states are not terminal", () => {
    for (const s of ["agent_review_pending","va_review_pending","va_in_review","va_doc_request_pending","uw_review_pending"] as const) {
      expect(isTerminalState(s)).toBe(false);
    }
  });

  it("LEGAL_TRANSITIONS is exhaustive over all source states", () => {
    const allStates = ["agent_review_pending","va_review_pending","va_in_review","va_doc_request_pending","uw_review_pending","decided"] as const;
    for (const s of allStates) {
      expect(LEGAL_TRANSITIONS[s]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter @twin/core test va-state-machine
```

Expected: FAIL — `Cannot find module '../src/va-state-machine.js'`.

- [ ] **Step 3: Implement the module**

```ts
// packages/core/src/va-state-machine.ts
import type { LoanState } from "./types.js";

export const LEGAL_TRANSITIONS: Record<LoanState, ReadonlyArray<LoanState>> = {
  agent_review_pending: ["va_review_pending", "uw_review_pending"],
  va_review_pending: ["va_in_review"],
  va_in_review: ["va_review_pending", "uw_review_pending", "va_doc_request_pending"],
  va_doc_request_pending: ["agent_review_pending"],
  uw_review_pending: ["decided"],
  decided: [],
};

export function canTransition(from: LoanState, to: LoanState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function isTerminalState(s: LoanState): boolean {
  return LEGAL_TRANSITIONS[s].length === 0;
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter @twin/core test va-state-machine
```

Expected: 12 tests pass.

- [ ] **Step 5: Build and commit**

```bash
pnpm --filter @twin/core build
git add packages/core/src/va-state-machine.ts packages/core/test/va-state-machine.test.ts
git commit -m "feat(core): VA state-machine helper with legal-transitions table + tests"
```

---

### Task 5: Core Zod schemas for VAReview + new actions

**Files:**
- Modify: `packages/core/src/schemas.ts`
- Create: `packages/core/test/va-review-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/va-review-schema.test.ts
import { describe, it, expect } from "vitest";
import { VAReviewSchema, VASpecialistSignoffSchema } from "../src/schemas.js";

const validReview = {
  id: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000002",
  loanId: "L1",
  vaId: "u1",
  vaPoolId: "00000000-0000-0000-0000-000000000003",
  poolKind: "internal",
  verdict: "concur",
  specialistSignoffs: [
    { specialist: "doc", signoff: "concur", notes: null },
    { specialist: "income", signoff: "concur", notes: null },
    { specialist: "asset", signoff: "concur", notes: null },
    { specialist: "credit", signoff: "concur", notes: null },
    { specialist: "property", signoff: "concur", notes: null },
    { specialist: "compliance", signoff: "concur", notes: null },
  ],
  conditionActions: [],
  overallRationale: "All specialists concur. Loan presents no anomalies.",
  docRequest: null,
  agentRecommendationId: "00000000-0000-0000-0000-000000000099",
  kbVersion: "v7.10",
  chatbotConsultationIds: [],
  claimedAt: "2026-05-10T10:00:00Z",
  submittedAt: "2026-05-10T10:12:00Z",
  reviewTimeSeconds: 720,
};

describe("VAReviewSchema", () => {
  it("accepts a valid concur review", () => {
    expect(() => VAReviewSchema.parse(validReview)).not.toThrow();
  });

  it("rejects when specialistSignoffs has fewer than 6 entries", () => {
    const bad = { ...validReview, specialistSignoffs: validReview.specialistSignoffs.slice(0, 5) };
    expect(() => VAReviewSchema.parse(bad)).toThrow();
  });

  it("rejects when specialistSignoffs has duplicate specialists", () => {
    const bad = { ...validReview, specialistSignoffs: [
      ...validReview.specialistSignoffs.slice(0, 5),
      { specialist: "doc", signoff: "concur", notes: null },  // duplicate
    ] };
    expect(() => VAReviewSchema.parse(bad)).toThrow(/distinct/i);
  });

  it("rejects when a disagree signoff has null notes", () => {
    const bad = { ...validReview, specialistSignoffs: [
      { specialist: "doc", signoff: "disagree", notes: null },
      ...validReview.specialistSignoffs.slice(1),
    ] };
    expect(() => VAReviewSchema.parse(bad)).toThrow();
  });

  it("rejects when overallRationale is shorter than 20 chars", () => {
    const bad = { ...validReview, overallRationale: "too short" };
    expect(() => VAReviewSchema.parse(bad)).toThrow();
  });

  it("rejects when verdict=request_docs but docRequest is null", () => {
    const bad = { ...validReview, verdict: "request_docs", docRequest: null };
    expect(() => VAReviewSchema.parse(bad)).toThrow();
  });

  it("accepts a valid request_docs review", () => {
    const good = {
      ...validReview,
      verdict: "request_docs",
      docRequest: {
        docs: [{ docType: "Bank Statement (Personal)", reason: "Latest 3 months missing", required: true }],
        deadline: "2026-05-20",
        messageToOriginator: "Please upload 3 most recent personal bank statements.",
      },
    };
    expect(() => VAReviewSchema.parse(good)).not.toThrow();
  });

  it("rejects when verdict=request_docs has empty docs array", () => {
    const bad = {
      ...validReview,
      verdict: "request_docs",
      docRequest: { docs: [], deadline: "2026-05-20", messageToOriginator: "..." },
    };
    expect(() => VAReviewSchema.parse(bad)).toThrow();
  });

  it("rejects when a contest condition action has null note", () => {
    const bad = { ...validReview, conditionActions: [
      { conditionId: "c1", action: "contest", note: null },
    ] };
    expect(() => VAReviewSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect failure (schemas don't exist yet)**

```bash
pnpm --filter @twin/core test va-review-schema
```

Expected: FAIL — `VAReviewSchema is not exported`.

- [ ] **Step 3: Add the schemas to `packages/core/src/schemas.ts`**

Append to `packages/core/src/schemas.ts`:

```ts
import { z } from "zod";

export const VASpecialistKindSchema = z.enum(["doc","income","asset","credit","property","compliance"]);

export const VASpecialistSignoffSchema = z.object({
  specialist: VASpecialistKindSchema,
  signoff: z.enum(["concur", "disagree"]),
  notes: z.string().nullable(),
}).superRefine((v, ctx) => {
  if (v.signoff === "disagree" && (v.notes === null || v.notes.trim().length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "notes required when signoff is 'disagree'", path: ["notes"] });
  }
});

export const VAConditionActionSchema = z.object({
  conditionId: z.string().min(1),
  action: z.enum(["clear", "contest"]),
  note: z.string().nullable(),
}).superRefine((v, ctx) => {
  if (v.action === "contest" && (v.note === null || v.note.trim().length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "note required when action is 'contest'", path: ["note"] });
  }
});

export const VADocRequestSchema = z.object({
  docs: z.array(z.object({
    docType: z.string().min(1),
    reason: z.string().min(1),
    required: z.boolean(),
  })).min(1),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  messageToOriginator: z.string().min(1),
});

const SIX_SPECIALISTS = ["doc","income","asset","credit","property","compliance"] as const;

export const VAReviewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  loanId: z.string().min(1),
  vaId: z.string().min(1),
  vaPoolId: z.string().uuid(),
  poolKind: z.enum(["internal", "bpo"]),
  verdict: z.enum(["concur", "request_docs"]),
  specialistSignoffs: z.array(VASpecialistSignoffSchema).length(6),
  conditionActions: z.array(VAConditionActionSchema),
  overallRationale: z.string().min(20),
  docRequest: VADocRequestSchema.nullable(),
  agentRecommendationId: z.string().uuid(),
  kbVersion: z.string().min(1),
  chatbotConsultationIds: z.array(z.string().uuid()),
  claimedAt: z.string(),
  submittedAt: z.string(),
  reviewTimeSeconds: z.number().int().nonnegative(),
}).superRefine((v, ctx) => {
  // exactly one entry per specialist, no duplicates
  const seen = new Set<string>();
  for (const s of v.specialistSignoffs) {
    if (seen.has(s.specialist)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "specialistSignoffs must be distinct", path: ["specialistSignoffs"] });
      return;
    }
    seen.add(s.specialist);
  }
  for (const required of SIX_SPECIALISTS) {
    if (!seen.has(required)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `missing signoff for specialist '${required}'`, path: ["specialistSignoffs"] });
      return;
    }
  }
  // verdict <-> docRequest invariant
  if ((v.verdict === "request_docs") !== (v.docRequest !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "docRequest must be non-null iff verdict='request_docs'", path: ["docRequest"] });
  }
});
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter @twin/core test va-review-schema
```

Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/test/va-review-schema.test.ts
git commit -m "feat(core): Zod schemas for VAReview + sub-schemas with structural invariants"
```

---

### Task 6: Reducer — handle 5 new VA actions

**Files:**
- Modify: `packages/core/src/reduce.ts`
- Create: `packages/core/test/reducer-va-actions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/reducer-va-actions.test.ts
import { describe, it, expect } from "vitest";
import { reduce } from "../src/reduce.js";
import type { State, Action, Loan } from "../src/types.js";

function loanAt(state: Loan["state"], extra: Partial<Loan> = {}): Loan {
  return {
    id: "L1",
    tenantId: "T1",
    nqmProgram: "Flex Select",
    state,
    borrower: { fullName: "X", ssnMasked: "xxx-xx-1234", dob: "1980-01-01", maritalStatus: "Single" },
    property: { street: "1 Main St", city: "C", state: "CA", zip: "90000", propertyType: "SFR Det.", units: 1, yearBuilt: 1990 },
    transaction: { loanPurpose: "Purchase", loanAmount: 100000, salesPrice: 120000, appraisedValue: 120000, ltv: 80, cltv: 80, hcltv: 80, noteRate: 7, term: 360, amortType: "Fixed", lienPosition: 1, occupancy: "Primary", isInvestmentProperty: false, piti: 700 },
    qualifying: { housingRatio: 25, totalDti: 35, piPayment: 700, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "TraditionalDocs", monthsCovered: 12, derivedMonthlyIncome: 5000 },
    income: { totalMonthlyIncome: 5000, notes: "" },
    assets: { totalLiquid: 50000, totalRetirement: 0, reservesMonths: 12 },
    credit: { repScore: 720, tradelinesOpen: 4, tradelinesTotal: 4, tradelines: [], liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 } },
    conditions: [], documents: [],
    appraisal: { appraisalDate: "2026-05-01", appraiserName: "X", appraisalType: "Full", appraisedValue: 120000, marketCondition: "Stable", neighborhoodRating: "Good", siteArea: "0.1", grossLivingArea: 1000, roomCount: 5, bedroomCount: 3, bathroomCount: 2, garageSpaces: 1, condition: "Good", comparables: [] },
    decision: "pending",
    milestones: [],
    compliance: { qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false, higherPricedCoveredTransaction: false, stateLicenseRequired: false, stateHighCostTest: "Pass", tridToleranceCure: "None", totalPointsAndFees: 0, pointsAndFeesThreshold: 0, pointsAndFeesPass: true, flags: [] },
    overlay: { programName: "Flex Select", investorName: "x", maxLTV: 80, minFICO: 680, maxDTI: 50, minDSCR: null, minReserves: 6, checks: [] },
    ...extra,
  } as Loan;
}

const baseState = (loan: Loan): State => ({
  scenarioId: "_test", loans: [loan], actionLog: [], conversationLog: [], currentUser: { kind: "internal", userId: "u1", email: "u1@test" } as any,
} as any);

const actor = { kind: "internal", userId: "u1", email: "u1@test" } as const;

describe("reducer — VA actions", () => {
  it("RouteToVA transitions agent_review_pending → va_review_pending and sets pool", () => {
    const s = baseState(loanAt("agent_review_pending"));
    const a: Action = { type: "RouteToVA", loanId: "L1", assignedPoolId: "P1", actor };
    const next = reduce(s, a);
    expect(next.loans[0].state).toBe("va_review_pending");
    expect(next.loans[0].assignedPoolId).toBe("P1");
  });

  it("ClaimForVAReview transitions va_review_pending → va_in_review and stamps vaId", () => {
    const s = baseState(loanAt("va_review_pending", { assignedPoolId: "P1" }));
    const a: Action = { type: "ClaimForVAReview", loanId: "L1", vaId: "u1", poolId: "P1", poolKind: "internal", actor };
    const next = reduce(s, a);
    expect(next.loans[0].state).toBe("va_in_review");
    expect(next.loans[0].vaId).toBe("u1");
    expect(next.loans[0].claimedAt).toBeTypeOf("string");
  });

  it("ReleaseVAClaim transitions va_in_review → va_review_pending and clears vaId", () => {
    const s = baseState(loanAt("va_in_review", { vaId: "u1", claimedAt: "2026-05-10T10:00:00Z" }));
    const a: Action = { type: "ReleaseVAClaim", loanId: "L1", vaId: "u1", actor };
    const next = reduce(s, a);
    expect(next.loans[0].state).toBe("va_review_pending");
    expect(next.loans[0].vaId).toBeNull();
    expect(next.loans[0].claimedAt).toBeNull();
  });

  it("SubmitVAReview verdict=concur transitions va_in_review → uw_review_pending", () => {
    const s = baseState(loanAt("va_in_review", { vaId: "u1" }));
    const review: any = { id: "R1", verdict: "concur", docRequest: null };
    const a: Action = { type: "SubmitVAReview", loanId: "L1", review, actor };
    const next = reduce(s, a);
    expect(next.loans[0].state).toBe("uw_review_pending");
    expect(next.loans[0].currentVaReviewId).toBe("R1");
  });

  it("SubmitVAReview verdict=request_docs transitions va_in_review → va_doc_request_pending", () => {
    const s = baseState(loanAt("va_in_review", { vaId: "u1" }));
    const review: any = { id: "R2", verdict: "request_docs", docRequest: { docs: [{ docType: "X", reason: "y", required: true }], deadline: "2026-05-20", messageToOriginator: "z" } };
    const a: Action = { type: "SubmitVAReview", loanId: "L1", review, actor };
    const next = reduce(s, a);
    expect(next.loans[0].state).toBe("va_doc_request_pending");
    expect(next.loans[0].currentVaReviewId).toBe("R2");
    expect(next.loans[0].vaId).toBeNull();
  });

  it("ReceiveVADocResponse transitions va_doc_request_pending → agent_review_pending and adds docs", () => {
    const s = baseState(loanAt("va_doc_request_pending"));
    const a: Action = { type: "ReceiveVADocResponse", loanId: "L1", documents: [{ id: "D1", name: "Bank Stmt", docType: "Bank Statement", uploadedAt: "2026-05-15T10:00:00Z", uploadedBy: "broker", page_count: 3 } as any], actor };
    const next = reduce(s, a);
    expect(next.loans[0].state).toBe("agent_review_pending");
    expect(next.loans[0].documents.length).toBe(1);
  });

  it("VA gate invariant: AcceptRecommendation throws when state !== uw_review_pending", () => {
    const s = baseState(loanAt("va_review_pending", { pendingRecommendation: { recommendation: "Approve", rationale: "x", confidence: 0.9, conditions: [], trace: [] } as any }));
    const a: Action = { type: "AcceptRecommendation", loanId: "L1", actor };
    expect(() => reduce(s, a)).toThrow(/VA_REVIEW_REQUIRED/);
  });

  it("VA gate invariant: AcceptRecommendation succeeds when state === uw_review_pending", () => {
    const s = baseState(loanAt("uw_review_pending", { pendingRecommendation: { recommendation: "Approve", rationale: "x", confidence: 0.9, conditions: [], trace: [] } as any }));
    const a: Action = { type: "AcceptRecommendation", loanId: "L1", actor };
    expect(() => reduce(s, a)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter @twin/core test reducer-va-actions
```

Expected: FAIL on every assertion.

- [ ] **Step 3: Implement reducer cases**

In `packages/core/src/reduce.ts`, find the existing `switch (action.type)` block and add these cases. Use the helper `find` pattern already in the file (a function `loan(state, loanId)` exists):

```ts
    case "RouteToVA": {
      const idx = state.loans.findIndex((l) => l.id === action.loanId);
      if (idx < 0) throw new ActionError("LOAN_NOT_FOUND", `loan ${action.loanId} not found`);
      const cur = state.loans[idx];
      const newLoans = [...state.loans];
      newLoans[idx] = { ...cur, state: "va_review_pending", assignedPoolId: action.assignedPoolId };
      return { ...state, loans: newLoans, actionLog: [...state.actionLog, action] };
    }

    case "ClaimForVAReview": {
      const idx = state.loans.findIndex((l) => l.id === action.loanId);
      if (idx < 0) throw new ActionError("LOAN_NOT_FOUND", `loan ${action.loanId} not found`);
      const cur = state.loans[idx];
      if (cur.state !== "va_review_pending") {
        throw new ActionError("VA_CLAIM_INVALID_STATE", `loan must be in va_review_pending; was ${cur.state}`);
      }
      const newLoans = [...state.loans];
      newLoans[idx] = { ...cur, state: "va_in_review", vaId: action.vaId, claimedAt: new Date().toISOString() };
      return { ...state, loans: newLoans, actionLog: [...state.actionLog, action] };
    }

    case "ReleaseVAClaim": {
      const idx = state.loans.findIndex((l) => l.id === action.loanId);
      if (idx < 0) throw new ActionError("LOAN_NOT_FOUND", `loan ${action.loanId} not found`);
      const cur = state.loans[idx];
      if (cur.state !== "va_in_review") {
        throw new ActionError("VA_RELEASE_INVALID_STATE", `loan must be in va_in_review; was ${cur.state}`);
      }
      const newLoans = [...state.loans];
      newLoans[idx] = { ...cur, state: "va_review_pending", vaId: null, claimedAt: null };
      return { ...state, loans: newLoans, actionLog: [...state.actionLog, action] };
    }

    case "SubmitVAReview": {
      const idx = state.loans.findIndex((l) => l.id === action.loanId);
      if (idx < 0) throw new ActionError("LOAN_NOT_FOUND", `loan ${action.loanId} not found`);
      const cur = state.loans[idx];
      if (cur.state !== "va_in_review") {
        throw new ActionError("VA_SUBMIT_INVALID_STATE", `loan must be in va_in_review; was ${cur.state}`);
      }
      const nextState = action.review.verdict === "concur" ? "uw_review_pending" : "va_doc_request_pending";
      const newLoans = [...state.loans];
      newLoans[idx] = {
        ...cur,
        state: nextState,
        currentVaReviewId: action.review.id,
        vaId: null,
        claimedAt: null,
      };
      return { ...state, loans: newLoans, actionLog: [...state.actionLog, action] };
    }

    case "ReceiveVADocResponse": {
      const idx = state.loans.findIndex((l) => l.id === action.loanId);
      if (idx < 0) throw new ActionError("LOAN_NOT_FOUND", `loan ${action.loanId} not found`);
      const cur = state.loans[idx];
      if (cur.state !== "va_doc_request_pending") {
        throw new ActionError("VA_DOC_RESPONSE_INVALID_STATE", `loan must be in va_doc_request_pending; was ${cur.state}`);
      }
      const newLoans = [...state.loans];
      newLoans[idx] = {
        ...cur,
        state: "agent_review_pending",
        documents: [...cur.documents, ...action.documents],
      };
      return { ...state, loans: newLoans, actionLog: [...state.actionLog, action] };
    }
```

- [ ] **Step 4: Add VA-gate invariant on existing actions**

Find the existing `case "AcceptRecommendation":`, `case "OverrideDecision":`, `case "SetDecision":` blocks. At the top of each, *before* any other check, add:

```ts
      // VA gate invariant (spec 2026-05-10 §State Machine).
      // When a tenant has VA enabled, these decisions can only land at uw_review_pending.
      // The reducer is tenant-agnostic; the API layer skips this check when tenant.va.required=false
      // by ensuring loan.state === "uw_review_pending" before dispatching. The reducer enforces
      // the deterministic check unconditionally — a loan in va_review_pending or va_in_review
      // cannot be UW-decided in any tenant.
      {
        const idx = state.loans.findIndex((l) => l.id === action.loanId);
        if (idx >= 0) {
          const s = state.loans[idx].state ?? "agent_review_pending";
          if (s !== "uw_review_pending" && s !== "agent_review_pending") {
            throw new ActionError("VA_REVIEW_REQUIRED",
              `loan ${action.loanId} must be in uw_review_pending or agent_review_pending; was ${s}`);
          }
        }
      }
```

(The `agent_review_pending` allowance is the back-compat path: when `va.required = false`, the agent stages a recommendation and the loan stays at `agent_review_pending` — UW can decide directly. When `va.required = true`, the routing service flips to `va_review_pending` before UW touches it.)

- [ ] **Step 5: Run test, expect pass**

```bash
pnpm --filter @twin/core test
```

Expected: all core tests pass (84 prior + 8 new VA reducer + 12 state-machine + 9 schema).

- [ ] **Step 6: Build and commit**

```bash
pnpm --filter @twin/core build
git add packages/core/src/reduce.ts packages/core/test/reducer-va-actions.test.ts
git commit -m "feat(core): reducer cases for 5 VA actions + VA-gate invariant on existing actions"
```

---

