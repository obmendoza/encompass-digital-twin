-- ── KB Versions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kb_versions (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  version INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_approval', 'pending_compliance', 'active', 'superseded', 'archived')),
  source_documents JSONB NOT NULL DEFAULT '[]',
  chunks_created INT,
  tiers_created INT,
  requirements_created INT,
  restrictions_created INT,
  test_results JSONB,
  ingested_by UUID,
  approved_by UUID,
  compliance_signoff_by UUID,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  compliance_signoff_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  UNIQUE (tenant_id, version),
  CONSTRAINT different_approvers
    CHECK (approved_by IS NULL OR compliance_signoff_by IS NULL OR approved_by <> compliance_signoff_by)
);

ALTER TABLE kb_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_versions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON kb_versions;
  CREATE POLICY tenant_isolation ON kb_versions
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
END $$;

CREATE INDEX IF NOT EXISTS idx_kb_active
  ON kb_versions(tenant_id, status)
  WHERE status = 'active';

-- ── Program Matrix Tiers ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS program_matrix_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  kb_version INT NOT NULL,
  program TEXT NOT NULL,
  occupancy TEXT NOT NULL,
  min_fico INT NOT NULL,
  max_fico INT NOT NULL,
  max_loan_amount NUMERIC,
  max_ltv_purchase NUMERIC,
  max_ltv_cashout NUMERIC,
  max_ltv_rate_term NUMERIC,
  property_types TEXT[],
  source_page INT,
  source_doc_hash TEXT NOT NULL,
  extraction_run_id UUID NOT NULL,
  extraction_confidence NUMERIC CHECK (extraction_confidence >= 0 AND extraction_confidence <= 1),
  operator_edited BOOLEAN NOT NULL DEFAULT false,
  operator_edit_diff JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE program_matrix_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_matrix_tiers FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON program_matrix_tiers;
  CREATE POLICY tenant_isolation ON program_matrix_tiers
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
END $$;

CREATE INDEX IF NOT EXISTS idx_matrix_lookup
  ON program_matrix_tiers(tenant_id, kb_version, program, occupancy, min_fico, max_fico);

-- ── Program Requirements ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS program_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  kb_version INT NOT NULL,
  program TEXT NOT NULL,
  category TEXT NOT NULL,
  requirement_key TEXT NOT NULL,
  requirement_value JSONB NOT NULL,
  source_page INT,
  source_doc_hash TEXT NOT NULL,
  extraction_run_id UUID NOT NULL,
  extraction_confidence NUMERIC CHECK (extraction_confidence >= 0 AND extraction_confidence <= 1),
  operator_edited BOOLEAN NOT NULL DEFAULT false,
  operator_edit_diff JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE program_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_requirements FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON program_requirements;
  CREATE POLICY tenant_isolation ON program_requirements
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
END $$;

CREATE INDEX IF NOT EXISTS idx_requirements_lookup
  ON program_requirements(tenant_id, kb_version, program, category);

-- ── Geographic Restrictions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS geographic_restrictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  kb_version INT NOT NULL,
  state TEXT NOT NULL,
  restriction TEXT NOT NULL,
  occupancy_affected TEXT,
  programs_affected TEXT[],
  notes TEXT,
  source_doc_hash TEXT NOT NULL,
  extraction_run_id UUID NOT NULL,
  extraction_confidence NUMERIC CHECK (extraction_confidence >= 0 AND extraction_confidence <= 1),
  operator_edited BOOLEAN NOT NULL DEFAULT false,
  operator_edit_diff JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE geographic_restrictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE geographic_restrictions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON geographic_restrictions;
  CREATE POLICY tenant_isolation ON geographic_restrictions
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
END $$;

CREATE INDEX IF NOT EXISTS idx_geo_lookup
  ON geographic_restrictions(tenant_id, kb_version, state);

-- ── Chatbot Conversations ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chatbot_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL,
  user_role TEXT NOT NULL,
  loan_id TEXT,
  messages JSONB NOT NULL DEFAULT '[]',
  kb_version INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE chatbot_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chatbot_conversations FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON chatbot_conversations;
  CREATE POLICY tenant_isolation ON chatbot_conversations
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_user
  ON chatbot_conversations(tenant_id, user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_loan
  ON chatbot_conversations(tenant_id, loan_id)
  WHERE loan_id IS NOT NULL;

-- ── KB Cost Events ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kb_cost_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  event_type TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INT NOT NULL,
  output_tokens INT NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(10,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE kb_cost_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_cost_events FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON kb_cost_events;
  CREATE POLICY tenant_isolation ON kb_cost_events
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
END $$;

CREATE INDEX IF NOT EXISTS idx_cost_tenant_date
  ON kb_cost_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_tenant_type
  ON kb_cost_events(tenant_id, event_type, created_at DESC);

-- ── Extend decision_records ───────────────────────────────────────
ALTER TABLE decision_records
  ADD COLUMN IF NOT EXISTS kb_version INT,
  ADD COLUMN IF NOT EXISTS chatbot_consultation_id UUID REFERENCES chatbot_conversations(id),
  ADD COLUMN IF NOT EXISTS agent_context JSONB;
