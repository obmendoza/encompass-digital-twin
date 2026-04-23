-- ── Loan Programs (reference table) ───────────────────────────────
CREATE TABLE IF NOT EXISTS loan_programs (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO loan_programs (code, display_name) VALUES
  ('bank_statement', 'Bank Statement'),
  ('dscr', 'DSCR'),
  ('asset_depletion', 'Asset Depletion'),
  ('profit_and_loss', 'Profit & Loss'),
  ('1099_income', '1099 Income'),
  ('wvoe', 'Written Verification of Employment'),
  ('foreign_national', 'Foreign National'),
  ('itin', 'ITIN'),
  ('bridge_loan', 'Bridge Loan')
ON CONFLICT (code) DO NOTHING;

-- ── Decision Records ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decision_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL,
  loan_program TEXT NOT NULL REFERENCES loan_programs(code),
  decision_type TEXT NOT NULL
    CHECK (decision_type IN ('accepted', 'overridden', 'manual')),
  agent_recommendation TEXT,
  agent_confidence NUMERIC
    CHECK (agent_confidence IS NULL OR (agent_confidence >= 0 AND agent_confidence <= 1)),
  final_decision TEXT NOT NULL,
  override_reason TEXT
    CHECK (override_reason IS NULL OR override_reason IN (
      'dti_exception', 'income_adjustment', 'credit_reassessment',
      'doc_sufficiency', 'compliance_exception', 'guideline_exception',
      'risk_tolerance', 'data_error', 'other'
    )),
  rationale TEXT,
  guideline_version_id UUID NOT NULL,
  agent_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  investor_id TEXT,
  pool_id TEXT,
  ingested_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL,
  decision_time_seconds NUMERIC NOT NULL,
  recorded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT override_requires_reason
    CHECK (decision_type != 'overridden' OR override_reason IS NOT NULL)
);

-- Decision record indexes
CREATE INDEX IF NOT EXISTS idx_dr_tenant_time
  ON decision_records(tenant_id, decided_at);
CREATE INDEX IF NOT EXISTS idx_dr_tenant_program
  ON decision_records(tenant_id, loan_program);
CREATE INDEX IF NOT EXISTS idx_dr_tenant_reason
  ON decision_records(tenant_id, override_reason)
  WHERE override_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dr_tenant_confidence
  ON decision_records(tenant_id, agent_confidence)
  WHERE agent_confidence IS NOT NULL;

-- ── Metrics Snapshots ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metrics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  snapshot_date DATE NOT NULL,
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, snapshot_date)
);

-- ── Detected Patterns ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS detected_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  rule_name TEXT NOT NULL,
  program TEXT,
  override_reason TEXT,
  metrics_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'analyzing', 'suggestion_ready', 'applied', 'dismissed', 'analysis_failed')),
  suppressed_until TIMESTAMPTZ,
  status_history JSONB NOT NULL DEFAULT '[]',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index on active patterns (not dismissed/applied)
CREATE UNIQUE INDEX IF NOT EXISTS idx_dp_tenant_active_rule
  ON detected_patterns(tenant_id, rule_name, COALESCE(program, ''), COALESCE(override_reason, ''))
  WHERE status NOT IN ('dismissed', 'applied');

-- ── Pattern Suggestions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pattern_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  pattern_id UUID NOT NULL REFERENCES detected_patterns(id),
  suggestion_type TEXT NOT NULL
    CHECK (suggestion_type IN ('guideline_update', 'threshold_change', 'prompt_refinement', 'escalation_rule')),
  root_cause TEXT NOT NULL,
  specific_change JSONB NOT NULL,
  confidence NUMERIC NOT NULL
    CHECK (confidence >= 0 AND confidence <= 1),
  risk_assessment TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  redaction_applied BOOLEAN NOT NULL DEFAULT false,
  redaction_version TEXT NOT NULL DEFAULT '1.0',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  visibility TEXT NOT NULL DEFAULT 'admin'
    CHECK (visibility IN ('admin', 'compliance_only')),
  reviewed_by TEXT,
  compliance_reviewed_by TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Suggestion Compliance Checks ──────────────────────────────────
CREATE TABLE IF NOT EXISTS suggestion_compliance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id UUID NOT NULL REFERENCES pattern_suggestions(id),
  check_type TEXT NOT NULL
    CHECK (check_type IN ('disparate_impact', 'adverse_action_preservation', 'threshold_reasonableness')),
  result TEXT NOT NULL
    CHECK (result IN ('pass', 'warn', 'block')),
  details JSONB NOT NULL DEFAULT '{}',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
