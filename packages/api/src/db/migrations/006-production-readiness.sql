-- Add retry_count to detected_patterns
ALTER TABLE detected_patterns ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;

-- Extend pattern_suggestions for two-key flow + LLM tracking
ALTER TABLE pattern_suggestions ADD COLUMN IF NOT EXISTS redaction_manifest JSONB;
ALTER TABLE pattern_suggestions ADD COLUMN IF NOT EXISTS model_used TEXT;
ALTER TABLE pattern_suggestions ADD COLUMN IF NOT EXISTS input_tokens INT;
ALTER TABLE pattern_suggestions ADD COLUMN IF NOT EXISTS output_tokens INT;
ALTER TABLE pattern_suggestions ADD COLUMN IF NOT EXISTS admin_approved_at TIMESTAMPTZ;

-- Separation of duties constraint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'separation_of_duties'
  ) THEN
    ALTER TABLE pattern_suggestions ADD CONSTRAINT separation_of_duties
      CHECK (compliance_reviewed_by IS NULL OR compliance_reviewed_by <> reviewed_by);
  END IF;
END $$;

-- Learning outcomes table (data flywheel)
CREATE TABLE IF NOT EXISTS learning_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  pattern_id UUID NOT NULL REFERENCES detected_patterns(id),
  suggestion_id UUID NOT NULL REFERENCES pattern_suggestions(id),
  label TEXT NOT NULL CHECK (label IN ('approved', 'rejected', 'modified', 'expired')),
  reviewer_role TEXT NOT NULL,
  rejection_reason TEXT,
  time_to_decision_hours NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS on learning_outcomes
ALTER TABLE learning_outcomes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON learning_outcomes;
  CREATE POLICY tenant_isolation ON learning_outcomes
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
END $$;
