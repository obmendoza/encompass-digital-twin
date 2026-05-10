-- 013-va-review-layer.sql
-- VA Review Layer: tables, RLS, indexes. Numbering picks up after 012.
--
-- ARCHITECTURAL NOTE (post-Task-1 correction, 2026-05-10):
-- This codebase does NOT have a relational `loans` table. Loans are stored
-- as JSONB inside `world_state.loans` (see packages/api/src/persistence.ts).
-- Tenant-scoped relational tables that reference a loan use `loan_id TEXT`
-- without a foreign key, mirroring the existing `decision_records` pattern.
--
-- Per-loan VA state (state, va_id, claimed_at, current_va_review_id,
-- assigned_pool_id) lives in a dedicated `va_loan_state` side table — keyed
-- by (tenant_id, loan_id) — so that race-safe single-row UPDATE works for
-- claim/release. The in-memory Loan type still carries these fields for the
-- reducer; this side table is the durable, race-safe persistence layer.

-- ============================================================================
-- VA per-loan state (side table; "loans" stand-in for VA persistence)
-- ============================================================================

CREATE TABLE IF NOT EXISTS va_loan_state (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id TEXT NOT NULL,
  va_state TEXT NOT NULL DEFAULT 'agent_review_pending'
    CHECK (va_state IN (
      'agent_review_pending',
      'va_review_pending',
      'va_in_review',
      'va_doc_request_pending',
      'uw_review_pending',
      'decided'
    )),
  current_va_review_id UUID NULL,
  va_id TEXT NULL,
  claimed_at TIMESTAMPTZ NULL,
  assigned_pool_id UUID NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, loan_id)
);
CREATE INDEX IF NOT EXISTS idx_va_loan_state_queue
  ON va_loan_state (tenant_id, va_state, assigned_pool_id);

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

-- va_loan_state.assigned_pool_id FK (added now that va_pools exists).
-- The migration ledger (_migrations table) ensures this file applies once;
-- no ADD CONSTRAINT IF NOT EXISTS guard is needed (and it isn't valid PG).
ALTER TABLE va_loan_state
  ADD CONSTRAINT va_loan_state_assigned_pool_fk
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

-- va_pools.bpo_partner_id FK (added now that bpo_partners exists).
ALTER TABLE va_pools
  ADD CONSTRAINT va_pools_bpo_partner_fk
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
  specialist_signoffs JSONB NOT NULL,
  condition_actions JSONB NOT NULL,
  overall_rationale TEXT NOT NULL CHECK (length(overall_rationale) >= 20),
  doc_request JSONB NULL,
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

-- va_loan_state.current_va_review_id FK (added now that va_reviews exists).
ALTER TABLE va_loan_state
  ADD CONSTRAINT va_loan_state_current_review_fk
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

ALTER TABLE va_loan_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_va_loan_state ON va_loan_state
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

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
