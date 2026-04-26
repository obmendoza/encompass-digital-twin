-- Onboarding sessions (resumable wizard state)
CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  current_step INT NOT NULL DEFAULT 1,
  step_data JSONB NOT NULL DEFAULT '{}',
  uploaded_documents JSONB NOT NULL DEFAULT '[]',
  extraction_results JSONB NOT NULL DEFAULT '{}',
  checklist_results JSONB NOT NULL DEFAULT '{}',
  notes TEXT,
  version INT NOT NULL DEFAULT 1,
  started_by TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  abandoned_at TIMESTAMPTZ
);

ALTER TABLE onboarding_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_sessions FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON onboarding_sessions;
  CREATE POLICY tenant_isolation ON onboarding_sessions
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
END $$;

-- Extend tenant_guidelines with provenance fields
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS source_document_ids UUID[];
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS extracted_rules JSONB;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS operator_edits JSONB;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS per_field_confidence JSONB;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS extraction_model_id TEXT;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS extraction_tokens JSONB;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS compliance_signoff_by TEXT;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS threshold_check_results JSONB;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ;

-- Set default status for existing rows
UPDATE tenant_guidelines SET status = 'active' WHERE status IS NULL;

-- Index for active guidelines
CREATE INDEX IF NOT EXISTS idx_guidelines_status_active ON tenant_guidelines(tenant_id, program)
  WHERE status = 'active';
