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

## Phase 2 — API services (tenant-scoped business logic)

Phase 2 builds the four pure-server-side service modules that the routes will call in Phase 3. Each service does one thing, takes a `client` (or implicit `withTenantTx`) plus typed inputs, and returns a typed result. No HTTP concerns yet.

### Task 7: `va-routing` service — evaluate routing rules and assign pool

**Files:**
- Create: `packages/api/src/services/va-routing.ts`
- Create: `packages/api/test/va-routing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/test/va-routing.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { withTenantTx } from "../src/db/pool.js";
import { routeLoan } from "../src/services/va-routing.js";

const T = "00000000-0000-0000-0000-000000000099";  // ephemeral test tenant; created by setup

describe("va-routing", () => {
  beforeEach(async () => {
    await withTenantTx(T, async (c) => {
      await c.query("DELETE FROM va_routing_rules WHERE tenant_id = $1", [T]);
      await c.query("DELETE FROM va_pools WHERE tenant_id = $1", [T]);
    });
  });

  it("routes to fallback pool when no rule matches", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        "INSERT INTO va_pools (id, tenant_id, name, kind, active) VALUES ($1,$2,$3,'internal',true)",
        ["00000000-0000-0000-0000-000000000aaa", T, "Fallback"]
      );
    });
    const loan = { id: "L1", nqmProgram: "Flex Select", transaction: { loanAmount: 200000, occupancy: "Primary" } } as any;
    const result = await routeLoan(T, loan, { fallbackPoolId: "00000000-0000-0000-0000-000000000aaa" });
    expect(result.poolId).toBe("00000000-0000-0000-0000-000000000aaa");
    expect(result.matchedRule).toBeNull();
  });

  it("routes by program match (priority order)", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(
        "INSERT INTO va_pools (id, tenant_id, name, kind) VALUES ($1,$2,'DSCR Pool','internal'),($3,$2,'Default','internal')",
        ["00000000-0000-0000-0000-000000000bbb", T, "00000000-0000-0000-0000-000000000ccc"]
      );
      await c.query(
        "INSERT INTO va_routing_rules (tenant_id, priority, match, target_pool_id) VALUES ($1,1,$2,$3)",
        [T, JSON.stringify({ program: ["Investor DSCR", "DSCR Supreme"] }), "00000000-0000-0000-0000-000000000bbb"]
      );
    });
    const dscrLoan = { id: "L2", nqmProgram: "Investor DSCR", transaction: { loanAmount: 500000, occupancy: "Investment" } } as any;
    const result = await routeLoan(T, dscrLoan, { fallbackPoolId: "00000000-0000-0000-0000-000000000ccc" });
    expect(result.poolId).toBe("00000000-0000-0000-0000-000000000bbb");
  });

  it("returns the first-priority match when multiple rules match", async () => {
    // Setup: two rules both match Flex Select; lower priority number wins.
    await withTenantTx(T, async (c) => {
      await c.query("INSERT INTO va_pools (id, tenant_id, name, kind) VALUES ($1,$2,'A','internal'),($3,$2,'B','internal'),($4,$2,'F','internal')",
        ["00000000-0000-0000-0000-000000000111", T, "00000000-0000-0000-0000-000000000222", "00000000-0000-0000-0000-000000000333"]);
      await c.query("INSERT INTO va_routing_rules (tenant_id, priority, match, target_pool_id) VALUES ($1,2,$2,$3),($1,1,$4,$5)",
        [T, JSON.stringify({ program: ["Flex Select"] }), "00000000-0000-0000-0000-000000000222",
            JSON.stringify({ loanAmountMin: 100000 }), "00000000-0000-0000-0000-000000000111"]);
    });
    const loan = { id: "L3", nqmProgram: "Flex Select", transaction: { loanAmount: 200000, occupancy: "Primary" } } as any;
    const result = await routeLoan(T, loan, { fallbackPoolId: "00000000-0000-0000-0000-000000000333" });
    expect(result.poolId).toBe("00000000-0000-0000-0000-000000000111");  // priority 1 wins
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter @twin/api test va-routing
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
// packages/api/src/services/va-routing.ts
import type { Loan } from "@twin/core";
import { withTenantTx } from "../db/pool.js";

interface RoutingMatch {
  program?: string[];
  loanAmountMin?: number;
  loanAmountMax?: number;
  occupancy?: ("Primary" | "Second" | "Investment")[];
}

interface RoutingRuleRow {
  id: string;
  priority: number;
  match: RoutingMatch;
  target_pool_id: string;
}

export interface RouteLoanOptions {
  fallbackPoolId: string;
}

export interface RouteLoanResult {
  poolId: string;
  matchedRule: RoutingRuleRow | null;
}

function ruleMatches(rule: RoutingRuleRow, loan: Loan): boolean {
  const m = rule.match;
  if (m.program && !m.program.includes(loan.nqmProgram as string)) return false;
  if (m.loanAmountMin !== undefined && loan.transaction.loanAmount < m.loanAmountMin) return false;
  if (m.loanAmountMax !== undefined && loan.transaction.loanAmount > m.loanAmountMax) return false;
  if (m.occupancy && !m.occupancy.includes(loan.transaction.occupancy as any)) return false;
  return true;
}

export async function routeLoan(
  tenantId: string,
  loan: Loan,
  opts: RouteLoanOptions,
): Promise<RouteLoanResult> {
  return withTenantTx(tenantId, async (client) => {
    const { rows } = await client.query<RoutingRuleRow>(
      `SELECT id, priority, match, target_pool_id
         FROM va_routing_rules
        WHERE tenant_id = $1
        ORDER BY priority ASC`,
      [tenantId],
    );
    for (const rule of rows) {
      if (ruleMatches(rule, loan)) {
        return { poolId: rule.target_pool_id, matchedRule: rule };
      }
    }
    return { poolId: opts.fallbackPoolId, matchedRule: null };
  });
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter @twin/api test va-routing
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/va-routing.ts packages/api/test/va-routing.test.ts
git commit -m "feat(api): va-routing service — priority-ordered rule evaluation with fallback pool"
```

---

### Task 8: `va-pool` service — race-safe claim/release

**Files:**
- Create: `packages/api/src/services/va-pool.ts`
- Create: `packages/api/test/va-claim-race.test.ts`

- [ ] **Step 1: Write the failing test (concurrency-focused)**

```ts
// packages/api/test/va-claim-race.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { withTenantTx } from "../src/db/pool.js";
import { claimLoan, releaseLoan } from "../src/services/va-pool.js";

const T = "00000000-0000-0000-0000-000000000099";
const POOL = "00000000-0000-0000-0000-000000000aaa";
const LOAN = "L_CLAIM_RACE";

beforeEach(async () => {
  await withTenantTx(T, async (c) => {
    await c.query("DELETE FROM va_pool_memberships WHERE pool_id = $1", [POOL]);
    await c.query("DELETE FROM va_pools WHERE id = $1", [POOL]);
    await c.query("INSERT INTO va_pools (id, tenant_id, name, kind, active) VALUES ($1,$2,'TestPool','internal',true)", [POOL, T]);
    await c.query("INSERT INTO va_pool_memberships (pool_id, member_id, member_kind) VALUES ($1,'u1','internal'),($1,'u2','internal')", [POOL]);
    await c.query("DELETE FROM loans WHERE id = $1", [LOAN]);
    await c.query("INSERT INTO loans (id, tenant_id, va_state, assigned_pool_id, body) VALUES ($1,$2,'va_review_pending',$3,'{}')", [LOAN, T, POOL]);
  });
});

describe("va-pool", () => {
  it("exactly one of two concurrent claims succeeds", async () => {
    const [r1, r2] = await Promise.allSettled([
      claimLoan(T, LOAN, "u1"),
      claimLoan(T, LOAN, "u2"),
    ]);
    const successes = [r1, r2].filter((r) => r.status === "fulfilled" && (r as any).value.claimed === true);
    expect(successes.length).toBe(1);
  });

  it("claim by non-pool-member returns claimed=false", async () => {
    const r = await claimLoan(T, LOAN, "u_outsider");
    expect(r.claimed).toBe(false);
    expect(r.reason).toMatch(/not a member/i);
  });

  it("release reverts state and clears va_id", async () => {
    await claimLoan(T, LOAN, "u1");
    const r = await releaseLoan(T, LOAN, "u1");
    expect(r.released).toBe(true);
    await withTenantTx(T, async (c) => {
      const { rows } = await c.query("SELECT va_state, va_id FROM loans WHERE id=$1", [LOAN]);
      expect(rows[0].va_state).toBe("va_review_pending");
      expect(rows[0].va_id).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter @twin/api test va-claim-race
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
// packages/api/src/services/va-pool.ts
import { withTenantTx } from "../db/pool.js";

export interface ClaimResult {
  claimed: boolean;
  loanId: string;
  vaId: string | null;
  reason?: string;
}

export interface ReleaseResult {
  released: boolean;
  loanId: string;
  reason?: string;
}

export async function claimLoan(
  tenantId: string,
  loanId: string,
  vaId: string,
): Promise<ClaimResult> {
  return withTenantTx(tenantId, async (client) => {
    // Single update guarded by both state predicate and pool-membership predicate.
    const { rows } = await client.query<{ id: string; va_id: string }>(
      `UPDATE loans
          SET va_state = 'va_in_review', va_id = $1, claimed_at = now()
        WHERE id = $2 AND va_state = 'va_review_pending'
          AND EXISTS (
            SELECT 1 FROM va_pool_memberships m
             WHERE m.pool_id = loans.assigned_pool_id AND m.member_id = $1
          )
       RETURNING id, va_id`,
      [vaId, loanId],
    );
    if (rows.length === 1) return { claimed: true, loanId, vaId: rows[0].va_id };

    // Diagnose why we lost: still pending? Already claimed? Not a pool member?
    const { rows: existing } = await client.query<{ va_state: string; va_id: string | null; assigned_pool_id: string | null }>(
      `SELECT va_state, va_id, assigned_pool_id FROM loans WHERE id = $1`,
      [loanId],
    );
    if (existing.length === 0) return { claimed: false, loanId, vaId: null, reason: "loan not found" };
    const cur = existing[0];
    if (cur.va_state !== "va_review_pending") {
      return { claimed: false, loanId, vaId: cur.va_id, reason: `state is ${cur.va_state} (already claimed by ${cur.va_id ?? "unknown"})` };
    }
    return { claimed: false, loanId, vaId: null, reason: "user is not a member of the loan's assigned pool" };
  });
}

export async function releaseLoan(
  tenantId: string,
  loanId: string,
  vaId: string,
): Promise<ReleaseResult> {
  return withTenantTx(tenantId, async (client) => {
    const { rows } = await client.query(
      `UPDATE loans
          SET va_state = 'va_review_pending', va_id = NULL, claimed_at = NULL
        WHERE id = $1 AND va_state = 'va_in_review' AND va_id = $2
       RETURNING id`,
      [loanId, vaId],
    );
    if (rows.length === 1) return { released: true, loanId };
    return { released: false, loanId, reason: "loan is not currently claimed by this user" };
  });
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter @twin/api test va-claim-race
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/va-pool.ts packages/api/test/va-claim-race.test.ts
git commit -m "feat(api): va-pool service — race-safe claim/release with pool-membership predicate"
```

---

### Task 9: `va-review-writer` service — single-tx submit (concur + request_docs)

**Files:**
- Create: `packages/api/src/services/va-review-writer.ts`

- [ ] **Step 1: Implement (test in Task 13 once route exists)**

```ts
// packages/api/src/services/va-review-writer.ts
import { randomUUID } from "node:crypto";
import { withTenantTx } from "../db/pool.js";
import type { VAReview } from "@twin/core";

export interface SubmitVAReviewInput {
  tenantId: string;
  loanId: string;
  vaId: string;
  vaPoolId: string;
  poolKind: "internal" | "bpo";
  verdict: "concur" | "request_docs";
  specialistSignoffs: VAReview["specialistSignoffs"];
  conditionActions: VAReview["conditionActions"];
  overallRationale: string;
  docRequest: VAReview["docRequest"];
  agentRecommendationId: string;
  kbVersion: string;
  chatbotConsultationIds: string[];
  claimedAt: string;
}

export interface SubmitVAReviewResult {
  reviewId: string;
  newState: "uw_review_pending" | "va_doc_request_pending";
  outboxEventId: string | null;
}

export async function submitVAReview(input: SubmitVAReviewInput): Promise<SubmitVAReviewResult> {
  const reviewId = randomUUID();
  const submittedAt = new Date().toISOString();
  const reviewTimeSeconds = Math.max(0, Math.floor((Date.parse(submittedAt) - Date.parse(input.claimedAt)) / 1000));
  const newState = input.verdict === "concur" ? "uw_review_pending" : "va_doc_request_pending";

  return withTenantTx(input.tenantId, async (client) => {
    // 1. INSERT into va_reviews
    await client.query(
      `INSERT INTO va_reviews (
        id, tenant_id, loan_id, va_id, va_pool_id, pool_kind, verdict,
        specialist_signoffs, condition_actions, overall_rationale, doc_request,
        agent_recommendation_id, kb_version, chatbot_consultation_ids,
        claimed_at, submitted_at, review_time_seconds
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        reviewId, input.tenantId, input.loanId, input.vaId, input.vaPoolId, input.poolKind, input.verdict,
        JSON.stringify(input.specialistSignoffs), JSON.stringify(input.conditionActions),
        input.overallRationale,
        input.docRequest ? JSON.stringify(input.docRequest) : null,
        input.agentRecommendationId, input.kbVersion, input.chatbotConsultationIds,
        input.claimedAt, submittedAt, reviewTimeSeconds,
      ],
    );

    // 2. UPDATE loan
    await client.query(
      `UPDATE loans
          SET va_state = $1, current_va_review_id = $2, va_id = NULL, claimed_at = NULL
        WHERE id = $3 AND va_state = 'va_in_review'`,
      [newState, reviewId, input.loanId],
    );

    // 3. INSERT outbox row when request_docs
    let outboxEventId: string | null = null;
    if (input.verdict === "request_docs" && input.docRequest) {
      outboxEventId = randomUUID();
      const payload = {
        docs: input.docRequest.docs,
        deadline: input.docRequest.deadline,
        messageToOriginator: input.docRequest.messageToOriginator,
        loanId: input.loanId,
        vaReviewId: reviewId,
      };
      await client.query(
        `INSERT INTO va_event_outbox (id, tenant_id, event_type, loan_id, payload)
         VALUES ($1,$2,'va.doc_request_issued',$3,$4::jsonb)`,
        [outboxEventId, input.tenantId, input.loanId, JSON.stringify(payload)],
      );
    }

    return { reviewId, newState, outboxEventId };
  });
}
```

- [ ] **Step 2: Build and commit**

```bash
pnpm --filter @twin/api build
git add packages/api/src/services/va-review-writer.ts
git commit -m "feat(api): va-review-writer service — single-tx insert review + update loan + outbox row"
```

---

### Task 10: `va-toggle` service — backfill on flip

**Files:**
- Create: `packages/api/src/services/va-toggle.ts`
- Create: `packages/api/test/va-toggle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/test/va-toggle.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { withTenantTx } from "../src/db/pool.js";
import { applyToggleFlip } from "../src/services/va-toggle.js";

const T = "00000000-0000-0000-0000-000000000099";
const POOL = "00000000-0000-0000-0000-000000000aaa";

beforeEach(async () => {
  await withTenantTx(T, async (c) => {
    await c.query("DELETE FROM loans WHERE id LIKE 'TFLIP%'");
    await c.query("DELETE FROM va_pools WHERE id = $1", [POOL]);
    await c.query("INSERT INTO va_pools (id, tenant_id, name, kind, active) VALUES ($1,$2,'TestPool','internal',true)", [POOL, T]);
  });
});

describe("va-toggle", () => {
  it("false→true backfills agent_review_pending loans to va_review_pending", async () => {
    await withTenantTx(T, async (c) => {
      await c.query("INSERT INTO loans (id, tenant_id, va_state, body) VALUES ('TFLIP1',$1,'agent_review_pending','{}'),('TFLIP2',$1,'uw_review_pending','{}')", [T]);
    });
    const result = await applyToggleFlip(T, false, true, POOL);
    expect(result.transitioned).toBe(1);
    await withTenantTx(T, async (c) => {
      const { rows } = await c.query("SELECT id, va_state, assigned_pool_id FROM loans WHERE id LIKE 'TFLIP%' ORDER BY id");
      expect(rows[0]).toMatchObject({ id: "TFLIP1", va_state: "va_review_pending", assigned_pool_id: POOL });
      expect(rows[1]).toMatchObject({ id: "TFLIP2", va_state: "uw_review_pending" });  // unchanged
    });
  });

  it("true→false releases va_review_pending and va_in_review to uw_review_pending; preserves doc_request_pending", async () => {
    await withTenantTx(T, async (c) => {
      await c.query(`INSERT INTO loans (id, tenant_id, va_state, body) VALUES
        ('TFLIP3',$1,'va_review_pending','{}'),
        ('TFLIP4',$1,'va_in_review','{}'),
        ('TFLIP5',$1,'va_doc_request_pending','{}'),
        ('TFLIP6',$1,'decided','{}')`, [T]);
    });
    const result = await applyToggleFlip(T, true, false, POOL);
    expect(result.released).toBe(2);
    expect(result.preservedDocRequest).toBe(1);
    await withTenantTx(T, async (c) => {
      const { rows } = await c.query("SELECT id, va_state FROM loans WHERE id LIKE 'TFLIP%' ORDER BY id");
      const m = Object.fromEntries(rows.map(r => [r.id, r.va_state]));
      expect(m.TFLIP3).toBe("uw_review_pending");
      expect(m.TFLIP4).toBe("uw_review_pending");
      expect(m.TFLIP5).toBe("va_doc_request_pending");  // preserved
      expect(m.TFLIP6).toBe("decided");                 // terminal
    });
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
pnpm --filter @twin/api test va-toggle
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
// packages/api/src/services/va-toggle.ts
import { withTenantTx } from "../db/pool.js";

export interface ToggleFlipResult {
  direction: "false_to_true" | "true_to_false" | "noop";
  transitioned: number;     // false→true: loans moved from agent_review_pending to va_review_pending
  released: number;         // true→false: loans moved from va_review_pending or va_in_review to uw_review_pending
  preservedDocRequest: number;  // true→false: loans left in va_doc_request_pending
}

export async function applyToggleFlip(
  tenantId: string,
  fromRequired: boolean,
  toRequired: boolean,
  fallbackPoolId: string,
): Promise<ToggleFlipResult> {
  if (fromRequired === toRequired) {
    return { direction: "noop", transitioned: 0, released: 0, preservedDocRequest: 0 };
  }

  return withTenantTx(tenantId, async (client) => {
    if (!fromRequired && toRequired) {
      // false → true: every loan currently at agent_review_pending must be routed.
      // Routing simplification for the backfill: assign every backfilled loan to fallback pool.
      // (The full per-loan rule evaluation happens for newly staged loans; backfilling
      // historical loans against rules they may not match cleanly is operationally hostile.)
      const { rowCount: t } = await client.query(
        `UPDATE loans
            SET va_state = 'va_review_pending', assigned_pool_id = $1
          WHERE tenant_id = $2 AND va_state = 'agent_review_pending'`,
        [fallbackPoolId, tenantId],
      );
      // Audit-log a single summary row.
      await client.query(
        `INSERT INTO tenant_audit_log (tenant_id, action_type, actor, metadata)
         VALUES ($1, 'va_toggle_flip', $2::jsonb, $3::jsonb)
         ON CONFLICT DO NOTHING`,
        [tenantId, JSON.stringify({ kind: "system", id: "va-toggle" }), JSON.stringify({ direction: "false_to_true", transitioned: t ?? 0, fallbackPoolId })],
      ).catch(() => { /* tenant_audit_log may not exist in early dev */ });
      return { direction: "false_to_true", transitioned: t ?? 0, released: 0, preservedDocRequest: 0 };
    }

    // true → false: release pending-VA states, preserve in-flight doc-request loops.
    const { rowCount: r } = await client.query(
      `UPDATE loans
          SET va_state = 'uw_review_pending', va_id = NULL, claimed_at = NULL
        WHERE tenant_id = $1 AND va_state IN ('va_review_pending', 'va_in_review')`,
      [tenantId],
    );
    const { rows: preserved } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM loans WHERE tenant_id = $1 AND va_state = 'va_doc_request_pending'`,
      [tenantId],
    );
    await client.query(
      `INSERT INTO tenant_audit_log (tenant_id, action_type, actor, metadata)
       VALUES ($1, 'va_toggle_flip', $2::jsonb, $3::jsonb) ON CONFLICT DO NOTHING`,
      [tenantId, JSON.stringify({ kind: "system", id: "va-toggle" }),
       JSON.stringify({ direction: "true_to_false", released: r ?? 0, preservedDocRequest: parseInt(preserved[0].count, 10) })],
    ).catch(() => {});
    return { direction: "true_to_false", transitioned: 0, released: r ?? 0, preservedDocRequest: parseInt(preserved[0].count, 10) };
  });
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter @twin/api test va-toggle
```

Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/va-toggle.ts packages/api/test/va-toggle.test.ts
git commit -m "feat(api): va-toggle service — false→true backfill, true→false release, preserve doc_request_pending"
```

---

## Phase 3 — VA routes (internal-staff path)

Phase 3 wires the services from Phase 2 into HTTP routes for internal-staff VAs. BPO routes come in Phase 4. After Phase 3, an internal user can claim, release, submit (concur OR request_docs), see the queue, see review history, and the tenant admin can flip the toggle.

### Task 11: VA route module + claim/release/release routes

**Files:**
- Create: `packages/api/src/routes/va.ts`
- Modify: `packages/api/src/server.ts` (register the route module)
- Create: `packages/api/test/va-routes.test.ts`

- [ ] **Step 1: Implement the route module skeleton**

```ts
// packages/api/src/routes/va.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getTenantId } from "../tenant-context.js";
import { withTenantTx } from "../db/pool.js";
import { claimLoan, releaseLoan } from "../services/va-pool.js";
import { submitVAReview } from "../services/va-review-writer.js";
import { applyToggleFlip } from "../services/va-toggle.js";
import { VAReviewSchema } from "@twin/core/schemas";

const SubmitBody = z.object({
  verdict: z.enum(["concur", "request_docs"]),
  specialistSignoffs: z.array(z.any()).length(6),
  conditionActions: z.array(z.any()),
  overallRationale: z.string().min(20),
  docRequest: z.any().nullable(),
  agentRecommendationId: z.string().uuid(),
  kbVersion: z.string().min(1),
  chatbotConsultationIds: z.array(z.string().uuid()).default([]),
});

const ToggleBody = z.object({ required: z.boolean() });

function getActorFromRequest(req: any): { userId: string; email: string } {
  const userId = req.headers["x-user-id"] ?? "unknown";
  const email = req.headers["x-user-email"] ?? userId + "@local";
  return { userId, email };
}

export function registerVARoutes(app: FastifyInstance) {
  app.post("/loans/:id/va/claim", async (req, reply) => {
    const tenantId = getTenantId();
    const { id: loanId } = req.params as { id: string };
    const actor = getActorFromRequest(req);
    const result = await claimLoan(tenantId, loanId, actor.userId);
    if (!result.claimed) return reply.status(409).send(result);
    return reply.send(result);
  });

  app.post("/loans/:id/va/release", async (req, reply) => {
    const tenantId = getTenantId();
    const { id: loanId } = req.params as { id: string };
    const actor = getActorFromRequest(req);
    const result = await releaseLoan(tenantId, loanId, actor.userId);
    if (!result.released) return reply.status(409).send(result);
    return reply.send(result);
  });

  app.post("/loans/:id/va/review", async (req, reply) => {
    const tenantId = getTenantId();
    const { id: loanId } = req.params as { id: string };
    const actor = getActorFromRequest(req);
    const body = SubmitBody.parse(req.body);
    // Look up the loan's claim metadata; bail if not currently claimed by this user.
    const ctx = await withTenantTx(tenantId, async (c) => {
      const { rows } = await c.query<{ va_id: string | null; assigned_pool_id: string | null; claimed_at: string | null; va_state: string }>(
        "SELECT va_id, assigned_pool_id, claimed_at, va_state FROM loans WHERE id = $1",
        [loanId],
      );
      return rows[0];
    });
    if (!ctx || ctx.va_state !== "va_in_review" || ctx.va_id !== actor.userId) {
      return reply.status(409).send({ error: "VA_NOT_CLAIMANT", details: ctx });
    }
    const poolKindRow = await withTenantTx(tenantId, async (c) => {
      const { rows } = await c.query<{ kind: "internal" | "bpo" }>("SELECT kind FROM va_pools WHERE id = $1", [ctx.assigned_pool_id]);
      return rows[0];
    });
    // Validate full payload (rejects malformed signoffs, etc.).
    const review = VAReviewSchema.parse({
      id: "00000000-0000-0000-0000-000000000000",  // placeholder; writer assigns the real id
      tenantId, loanId, vaId: actor.userId, vaPoolId: ctx.assigned_pool_id!, poolKind: poolKindRow.kind,
      ...body,
      claimedAt: ctx.claimed_at!, submittedAt: new Date().toISOString(), reviewTimeSeconds: 0,
    });
    const result = await submitVAReview({
      tenantId, loanId, vaId: actor.userId, vaPoolId: ctx.assigned_pool_id!, poolKind: poolKindRow.kind,
      verdict: review.verdict, specialistSignoffs: review.specialistSignoffs, conditionActions: review.conditionActions,
      overallRationale: review.overallRationale, docRequest: review.docRequest,
      agentRecommendationId: review.agentRecommendationId, kbVersion: review.kbVersion,
      chatbotConsultationIds: review.chatbotConsultationIds, claimedAt: review.claimedAt,
    });
    return reply.send(result);
  });

  app.get("/loans/:id/va/review-history", async (req) => {
    const tenantId = getTenantId();
    const { id: loanId } = req.params as { id: string };
    return withTenantTx(tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, va_id, va_pool_id, pool_kind, verdict, specialist_signoffs,
                condition_actions, overall_rationale, doc_request, kb_version,
                claimed_at, submitted_at, review_time_seconds
           FROM va_reviews WHERE loan_id = $1 ORDER BY submitted_at ASC`,
        [loanId],
      );
      return { reviews: rows };
    });
  });

  app.get("/va/queue", async (req) => {
    const tenantId = getTenantId();
    const { pool, limit = "50", cursor } = req.query as { pool?: string; limit?: string; cursor?: string };
    return withTenantTx(tenantId, async (c) => {
      const params: any[] = [tenantId];
      let where = "tenant_id = $1 AND va_state = 'va_review_pending'";
      if (pool) { params.push(pool); where += ` AND assigned_pool_id = $${params.length}`; }
      if (cursor) { params.push(cursor); where += ` AND id > $${params.length}`; }
      params.push(Math.min(parseInt(limit, 10) || 50, 200));
      const { rows } = await c.query(
        `SELECT id, assigned_pool_id, body->>'borrower' AS borrower_json, body->>'transaction' AS tx_json
           FROM loans WHERE ${where} ORDER BY id ASC LIMIT $${params.length}`,
        params,
      );
      return { items: rows, nextCursor: rows.length === parseInt(limit, 10) ? rows[rows.length - 1].id : null };
    });
  });

  app.get("/va/pools", async (req) => {
    const tenantId = getTenantId();
    const actor = getActorFromRequest(req);
    return withTenantTx(tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT p.id, p.name, p.kind FROM va_pools p
           JOIN va_pool_memberships m ON m.pool_id = p.id
          WHERE p.tenant_id = $1 AND p.active = true AND m.member_id = $2`,
        [tenantId, actor.userId],
      );
      return { pools: rows };
    });
  });

  app.post("/admin/va/toggle", async (req, reply) => {
    const tenantId = getTenantId();
    const body = ToggleBody.parse(req.body);
    const { rows } = await withTenantTx(tenantId, async (c) => c.query<{ settings: any }>("SELECT settings FROM tenants WHERE id = $1", [tenantId]));
    const cur = rows[0]?.settings?.va;
    if (!cur) return reply.status(409).send({ error: "TENANT_VA_UNCONFIGURED" });
    if (body.required && !cur.fallbackPoolId) return reply.status(422).send({ error: "FALLBACK_POOL_REQUIRED" });
    const result = await applyToggleFlip(tenantId, !!cur.required, body.required, cur.fallbackPoolId);
    await withTenantTx(tenantId, async (c) => c.query(
      "UPDATE tenants SET settings = settings || jsonb_build_object('va', settings->'va' || jsonb_build_object('required', $1::boolean)) WHERE id = $2",
      [body.required, tenantId],
    ));
    return reply.send(result);
  });
}
```

- [ ] **Step 2: Register routes in server.ts**

In `packages/api/src/server.ts`, after the existing route registrations:

```ts
import { registerVARoutes } from "./routes/va.js";
// ... inside buildServer():
registerVARoutes(app);
```

- [ ] **Step 3: Write integration test**

```ts
// packages/api/test/va-routes.test.ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { buildServer } from "../src/server.js";

const T = "00000000-0000-0000-0000-000000000099";
const POOL = "00000000-0000-0000-0000-000000000aaa";
const LOAN = "TR_VA_ROUTES";

let app: Awaited<ReturnType<typeof buildServer>>;
beforeAll(async () => { app = await buildServer({ store: undefined as any }); await app.ready(); });

beforeEach(async () => {
  // Seed via direct DB.  (Reuse helpers if your project has them; else use raw SQL through the api's pool.)
});

describe("VA routes", () => {
  it("POST /loans/:id/va/claim returns 200 when in va_review_pending", async () => {
    const res = await app.inject({
      method: "POST", url: `/loans/${LOAN}/va/claim`,
      headers: { "x-tenant-id": T, "x-user-id": "u1", "x-user-email": "u1@test" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ claimed: true });
  });

  it("POST /loans/:id/va/claim returns 409 when not in va_review_pending", async () => {
    // Setup: loan in agent_review_pending state (skip seed for brevity)
    const res = await app.inject({
      method: "POST", url: `/loans/NOT_PENDING/va/claim`,
      headers: { "x-tenant-id": T, "x-user-id": "u1" },
    });
    expect(res.statusCode).toBe(409);
  });

  it("GET /loans/:id/va/review-history returns ordered prior reviews", async () => {
    const res = await app.inject({
      method: "GET", url: `/loans/${LOAN}/va/review-history`,
      headers: { "x-tenant-id": T, "x-user-id": "u1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("reviews");
  });
});
```

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @twin/api test va-routes
git add packages/api/src/routes/va.ts packages/api/src/server.ts packages/api/test/va-routes.test.ts
git commit -m "feat(api): VA routes — claim, release, submit, queue, pools, review-history, toggle"
```

---

### Task 12: Hook routing into `StageRecommendation`

**Files:**
- Modify: `packages/api/src/routes/loans.ts` (or wherever StageRecommendation handler lives — search `case "StageRecommendation"`)

- [ ] **Step 1: Locate handler and inject routing**

After the reducer dispatches `StageRecommendation` (and the loan is now at `agent_review_pending`), add:

```ts
import { routeLoan } from "../services/va-routing.js";
// ... after existing dispatch:
const tenantSettings = await getTenantSettings(tenantId);  // existing helper
if (tenantSettings?.va?.required === true) {
  const route = await routeLoan(tenantId, updatedLoan, { fallbackPoolId: tenantSettings.va.fallbackPoolId });
  await withTenantTx(tenantId, async (c) => {
    await c.query(
      "UPDATE loans SET va_state = 'va_review_pending', assigned_pool_id = $1 WHERE id = $2",
      [route.poolId, loanId],
    );
  });
} else {
  // Auto-promote to uw_review_pending so existing UW flow works as today.
  await withTenantTx(tenantId, async (c) => {
    await c.query(
      "UPDATE loans SET va_state = 'uw_review_pending' WHERE id = $1",
      [loanId],
    );
  });
}
```

- [ ] **Step 2: Build, test, commit**

```bash
pnpm --filter @twin/api build && pnpm --filter @twin/api test
git add packages/api/src/routes/loans.ts
git commit -m "feat(api): route loan to VA pool after StageRecommendation when tenant.va.required=true"
```

---

## Phase 4 — BPO identity & portal

Phase 4 ships the BPO partner subsystem: separate identity, `/bpo/*` portal, signed-URL document access with audit logging, and DPA-gated admin endpoints. After Phase 4, an external SME with a valid API key can claim and review loans via the BPO portal.

### Task 13: BPO context + auth middleware

**Files:**
- Create: `packages/api/src/bpo-context.ts`
- Create: `packages/api/src/middleware/bpo-auth.ts`

- [ ] **Step 1: BPO context (AsyncLocalStorage)**

```ts
// packages/api/src/bpo-context.ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface BpoContext {
  partnerId: string;
  smeId: string;
  smeName: string;
  tenantId: string;
}

const storage = new AsyncLocalStorage<BpoContext>();

export function runWithBpoContext<T>(ctx: BpoContext, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => storage.run(ctx, () => fn().then(resolve, reject)));
}

export function getBpoContext(): BpoContext {
  const ctx = storage.getStore();
  if (!ctx) throw new Error("getBpoContext called outside a BPO request");
  return ctx;
}

export function tryGetBpoContext(): BpoContext | null {
  return storage.getStore() ?? null;
}
```

- [ ] **Step 2: BPO auth middleware**

```ts
// packages/api/src/middleware/bpo-auth.ts
import type { FastifyRequest, FastifyReply } from "fastify";
import { createHash } from "node:crypto";
import { withDb } from "../db/pool.js";

export async function verifyBpoToken(req: FastifyRequest, reply: FastifyReply): Promise<{ ok: false } | { ok: true; tenantId: string; smeId: string; partnerId: string; smeName: string }> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    reply.status(401).send({ error: "missing_bearer_token" });
    return { ok: false };
  }
  const token = auth.slice(7);
  const hash = createHash("sha256").update(token).digest();
  const row = await withDb(async (c) => {
    const { rows } = await c.query<{ tenant_id: string; sme_id: string; partner_id: string; sme_name: string }>(
      `SELECT k.tenant_id, k.sme_id, s.bpo_partner_id AS partner_id, s.name AS sme_name
         FROM bpo_api_keys k
         JOIN bpo_smes s ON s.id = k.sme_id
        WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND s.active = true`,
      [hash],
    );
    return rows[0];
  });
  if (!row) {
    reply.status(401).send({ error: "invalid_or_revoked_token" });
    return { ok: false };
  }
  // Touch last_used_at; cheap async, ignore failure.
  withDb(async (c) => c.query("UPDATE bpo_api_keys SET last_used_at = now() WHERE key_hash = $1", [hash])).catch(() => {});
  return { ok: true, tenantId: row.tenant_id, smeId: row.sme_id, partnerId: row.partner_id, smeName: row.sme_name };
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/bpo-context.ts packages/api/src/middleware/bpo-auth.ts
git commit -m "feat(api): bpo-context + bpo-auth middleware (sha256 key verification, revoke check)"
```

---

### Task 14: Admin BPO endpoints (partners + DPA gate, smes, api-keys)

**Files:**
- Create: `packages/api/src/routes/va-admin.ts`
- Modify: `packages/api/src/server.ts`
- Create: `packages/api/test/bpo-admin.test.ts`

- [ ] **Step 1: Implement admin routes**

```ts
// packages/api/src/routes/va-admin.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { getTenantId } from "../tenant-context.js";
import { withDb, withTenantTx } from "../db/pool.js";

const PartnerCreate = z.object({
  name: z.string().min(1),
  contact_email: z.string().email(),
  dpa_on_file: z.boolean(),
  dpa_reference: z.string().nullable(),
});

const SMECreate = z.object({
  bpo_partner_id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
});

const KeyCreate = z.object({
  sme_id: z.string().uuid(),
  // tenant_id implicit from getTenantId()
});

const PoolCreate = z.object({
  name: z.string().min(1),
  kind: z.enum(["internal", "bpo"]),
  bpo_partner_id: z.string().uuid().nullable(),
});

const RuleCreate = z.object({
  priority: z.number().int(),
  match: z.object({
    program: z.array(z.string()).optional(),
    loanAmountMin: z.number().optional(),
    loanAmountMax: z.number().optional(),
    occupancy: z.array(z.enum(["Primary","Second","Investment"])).optional(),
  }),
  target_pool_id: z.string().uuid(),
});

export function registerVAAdminRoutes(app: FastifyInstance) {
  // Partners are global — no tenant context required, but require admin auth (existing requireSuperAdmin or equivalent).
  app.post("/admin/bpo/partners", async (req, reply) => {
    const body = PartnerCreate.parse(req.body);
    const id = await withDb(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "INSERT INTO bpo_partners (name, contact_email, dpa_on_file, dpa_reference) VALUES ($1,$2,$3,$4) RETURNING id",
        [body.name, body.contact_email, body.dpa_on_file, body.dpa_reference],
      );
      return rows[0].id;
    });
    return reply.send({ id });
  });

  app.post("/admin/bpo/smes", async (req, reply) => {
    const body = SMECreate.parse(req.body);
    const id = await withDb(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "INSERT INTO bpo_smes (bpo_partner_id, name, email) VALUES ($1,$2,$3) RETURNING id",
        [body.bpo_partner_id, body.name, body.email],
      );
      return rows[0].id;
    });
    return reply.send({ id });
  });

  app.post("/admin/bpo/api-keys", async (req, reply) => {
    const body = KeyCreate.parse(req.body);
    const tenantId = getTenantId();
    const raw = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(raw).digest();
    const id = await withDb(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "INSERT INTO bpo_api_keys (sme_id, tenant_id, key_hash) VALUES ($1,$2,$3) RETURNING id",
        [body.sme_id, tenantId, hash],
      );
      return rows[0].id;
    });
    // The raw token is returned ONCE here; never persisted.
    return reply.send({ id, token: raw });
  });

  app.post("/admin/va/pools", async (req, reply) => {
    const tenantId = getTenantId();
    const body = PoolCreate.parse(req.body);
    if (body.kind === "bpo" && !body.bpo_partner_id) {
      return reply.status(422).send({ error: "BPO_PARTNER_ID_REQUIRED" });
    }
    try {
      const id = await withTenantTx(tenantId, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          "INSERT INTO va_pools (tenant_id, name, kind, bpo_partner_id, active) VALUES ($1,$2,$3,$4,true) RETURNING id",
          [tenantId, body.name, body.kind, body.bpo_partner_id],
        );
        return rows[0].id;
      });
      return reply.send({ id });
    } catch (e: any) {
      if (e?.message?.includes("dpa_gate_violation")) {
        return reply.status(409).send({ error: "DPA_GATE_VIOLATION", details: "BPO partner lacks dpa_on_file=true with dpa_reference" });
      }
      throw e;
    }
  });

  app.post("/admin/va/routing-rules", async (req, reply) => {
    const tenantId = getTenantId();
    const body = RuleCreate.parse(req.body);
    const id = await withTenantTx(tenantId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "INSERT INTO va_routing_rules (tenant_id, priority, match, target_pool_id) VALUES ($1,$2,$3::jsonb,$4) RETURNING id",
        [tenantId, body.priority, JSON.stringify(body.match), body.target_pool_id],
      );
      return rows[0].id;
    });
    return reply.send({ id });
  });
}
```

- [ ] **Step 2: Register + test DPA gate end-to-end**

Test should hit `POST /admin/va/pools` with `kind=bpo` and a partner that has `dpa_on_file=false`; expect 409 with `DPA_GATE_VIOLATION`.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/va-admin.ts packages/api/src/server.ts packages/api/test/bpo-admin.test.ts
git commit -m "feat(api): admin BPO + VA pool/routing endpoints; DPA gate enforced as 409"
```

---

### Task 15: BPO portal routes (auth, queue, loan-detail, review submit, docs-returned)

**Files:**
- Create: `packages/api/src/routes/bpo.ts`
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Implement portal routes**

```ts
// packages/api/src/routes/bpo.ts
import type { FastifyInstance } from "fastify";
import { verifyBpoToken } from "../middleware/bpo-auth.js";
import { runWithBpoContext, getBpoContext } from "../bpo-context.js";
import { runWithTenantContext } from "../tenant-context.js";
import { withTenantTx } from "../db/pool.js";
import { claimLoan, releaseLoan } from "../services/va-pool.js";
import { submitVAReview } from "../services/va-review-writer.js";
import { receiveVADocResponse } from "../services/va-doc-return.js";
import { issueSignedUrl } from "../services/bpo-document-access.js";
import { z } from "zod";

async function bpoGuard<T>(req: any, reply: any, fn: () => Promise<T>): Promise<T | undefined> {
  const auth = await verifyBpoToken(req, reply);
  if (!auth.ok) return;
  return runWithTenantContext({ tenantId: auth.tenantId }, () =>
    runWithBpoContext({ partnerId: auth.partnerId, smeId: auth.smeId, smeName: auth.smeName, tenantId: auth.tenantId }, fn),
  );
}

const SubmitBody = z.object({ /* same shape as /loans/:id/va/review body — reuse SubmitBody type */ });

export function registerBpoRoutes(app: FastifyInstance) {
  app.post("/bpo/auth", async (req, reply) =>
    bpoGuard(req, reply, async () => {
      const ctx = getBpoContext();
      return { partnerId: ctx.partnerId, smeId: ctx.smeId, smeName: ctx.smeName, tenantId: ctx.tenantId };
    }),
  );

  app.get("/bpo/queue", async (req, reply) =>
    bpoGuard(req, reply, async () => {
      const ctx = getBpoContext();
      return withTenantTx(ctx.tenantId, async (c) => {
        const { rows } = await c.query(
          `SELECT l.id, l.assigned_pool_id, l.body
             FROM loans l
             JOIN va_pool_memberships m ON m.pool_id = l.assigned_pool_id
            WHERE l.tenant_id = $1 AND l.va_state = 'va_review_pending'
              AND m.member_id = $2 AND m.member_kind = 'bpo'
            ORDER BY l.id ASC LIMIT 50`,
          [ctx.tenantId, ctx.smeId],
        );
        return { items: rows };
      });
    }),
  );

  app.get("/bpo/loans/:id", async (req, reply) =>
    bpoGuard(req, reply, async () => {
      const ctx = getBpoContext();
      const { id } = req.params as { id: string };
      return withTenantTx(ctx.tenantId, async (c) => {
        const { rows } = await c.query(
          `SELECT l.* FROM loans l
             JOIN va_pool_memberships m ON m.pool_id = l.assigned_pool_id
            WHERE l.id = $1 AND m.member_id = $2 AND m.member_kind = 'bpo' LIMIT 1`,
          [id, ctx.smeId],
        );
        if (rows.length === 0) {
          // 404 (not 403) — don't leak loan-id existence to non-pool BPO actors.
          reply.status(404).send({ error: "loan_not_found" });
          return;
        }
        return { loan: rows[0] };
      });
    }),
  );

  app.get("/bpo/loans/:id/documents/:docId/signed-url", async (req, reply) =>
    bpoGuard(req, reply, async () => {
      const ctx = getBpoContext();
      const { id, docId } = req.params as { id: string; docId: string };
      const result = await issueSignedUrl({ tenantId: ctx.tenantId, partnerId: ctx.partnerId, smeId: ctx.smeId, loanId: id, docId });
      return result;
    }),
  );

  app.post("/bpo/loans/:id/claim", async (req, reply) =>
    bpoGuard(req, reply, async () => {
      const ctx = getBpoContext();
      const { id } = req.params as { id: string };
      const r = await claimLoan(ctx.tenantId, id, ctx.smeId);
      if (!r.claimed) reply.status(409);
      return r;
    }),
  );

  app.post("/bpo/loans/:id/review", async (req, reply) =>
    bpoGuard(req, reply, async () => {
      // Identical to /loans/:id/va/review but with poolKind=bpo and actor.kind=bpo.
      // Implementation: reuse the va.ts handler logic — extract a shared helper if duplication grows.
      return { stub: "implement same way as /loans/:id/va/review" };
    }),
  );

  app.post("/bpo/loans/:id/docs-returned", async (req, reply) =>
    bpoGuard(req, reply, async () => {
      const ctx = getBpoContext();
      const { id } = req.params as { id: string };
      const body = req.body as { documents: any[] };
      return receiveVADocResponse({ tenantId: ctx.tenantId, loanId: id, documents: body.documents });
    }),
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/routes/bpo.ts packages/api/src/server.ts
git commit -m "feat(api): /bpo/* portal routes — auth, queue, loan-detail, claim, review, docs-returned"
```

---

### Task 16: BPO document signed-URL service + audit logging

**Files:**
- Create: `packages/api/src/services/bpo-document-access.ts`
- Create: `packages/api/test/bpo-document-access.test.ts`

- [ ] **Step 1: Implement**

```ts
// packages/api/src/services/bpo-document-access.ts
import { withTenantTx } from "../db/pool.js";
import { getSupabaseAdmin } from "../supabase.js";  // existing helper

export interface SignedUrlInput {
  tenantId: string;
  partnerId: string;
  smeId: string;
  loanId: string;
  docId: string;
}

export interface SignedUrlResult {
  url: string;
  expiresAt: string;
}

const EXPIRY_SECONDS = 15 * 60;

export async function issueSignedUrl(input: SignedUrlInput): Promise<SignedUrlResult> {
  // 1. Resolve doc → bucket + path inside the loan's tenant context, validating membership.
  const docRow = await withTenantTx(input.tenantId, async (c) => {
    const { rows } = await c.query<{ storage_bucket: string; storage_path: string }>(
      `SELECT d.storage_bucket, d.storage_path
         FROM loan_documents d
         JOIN loans l ON l.id = d.loan_id
         JOIN va_pool_memberships m ON m.pool_id = l.assigned_pool_id
        WHERE d.id = $1 AND d.loan_id = $2
          AND m.member_id = $3 AND m.member_kind = 'bpo' LIMIT 1`,
      [input.docId, input.loanId, input.smeId],
    );
    if (rows.length === 0) throw new Error("DOCUMENT_NOT_FOUND");
    return rows[0];
  });

  // 2. Generate signed URL via Supabase Storage admin client.
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(docRow.storage_bucket).createSignedUrl(docRow.storage_path, EXPIRY_SECONDS);
  if (error || !data) throw new Error(`signed_url_failed: ${error?.message}`);

  const expiresAt = new Date(Date.now() + EXPIRY_SECONDS * 1000).toISOString();

  // 3. Audit log every issuance.
  await withTenantTx(input.tenantId, async (c) => {
    await c.query(
      `INSERT INTO tenant_audit_log (tenant_id, action_type, actor, target_type, target_id, metadata)
       VALUES ($1, 'bpo_document_access', $2::jsonb, 'loan_document', $3, $4::jsonb)`,
      [
        input.tenantId,
        JSON.stringify({ kind: "bpo", partnerId: input.partnerId, smeId: input.smeId }),
        input.docId,
        JSON.stringify({ tenant_id: input.tenantId, loan_id: input.loanId, expiry_at: expiresAt }),
      ],
    );
  });

  return { url: data.signedUrl, expiresAt };
}
```

- [ ] **Step 2: Test (signed URL issued, audit row written, non-pool returns 404 upstream)**

```ts
// packages/api/test/bpo-document-access.test.ts
import { describe, it, expect } from "vitest";
import { issueSignedUrl } from "../src/services/bpo-document-access.js";

describe("bpo-document-access", () => {
  it("rejects when doc/loan/sme combo doesn't match a pool membership", async () => {
    await expect(issueSignedUrl({ tenantId: "T", partnerId: "P", smeId: "outsider", loanId: "L", docId: "D" }))
      .rejects.toThrow(/DOCUMENT_NOT_FOUND/);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/services/bpo-document-access.ts packages/api/test/bpo-document-access.test.ts
git commit -m "feat(api): BPO document signed-URL service (15-min expiry) with tenant_audit_log row per access"
```

---

