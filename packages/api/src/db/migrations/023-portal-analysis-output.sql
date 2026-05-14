-- packages/api/src/db/migrations/023-portal-analysis-output.sql
-- Spec 1.5: Portal Analysis Output Ingestion
--
-- Adds:
--   1. predicted_conditions.source_list CHECK widens to include 'portal-llm'
--   2. predicted_conditions.portal_metadata JSONB (per-row portal detail)
--   3. predicted_conditions.analysis_hash TEXT + superseded_at TIMESTAMPTZ
--      (re-analysis supersede flow per spec §4.2 step 4)
--   4. ingested_loans.analysis_hash TEXT (content-hash idempotency)
--   5. portal_eligibility_verdicts table (per-program PASS/FAIL with versioning)

-- ── 1. Widen predicted_conditions.source_list CHECK ──────────────────────
ALTER TABLE predicted_conditions DROP CONSTRAINT IF EXISTS predicted_conditions_source_list_check;
ALTER TABLE predicted_conditions ADD CONSTRAINT predicted_conditions_source_list_check
  CHECK (source_list IN (
    'minimum', 'income', 'matrix', 'geographic', 'requirements',
    'portal-llm'
  ));

-- ── 2. Portal-specific metadata + supersede provenance ───────────────────
ALTER TABLE predicted_conditions ADD COLUMN IF NOT EXISTS portal_metadata JSONB;
ALTER TABLE predicted_conditions ADD COLUMN IF NOT EXISTS analysis_hash TEXT;
ALTER TABLE predicted_conditions ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

-- ── 3. Content-hash idempotency on ingested_loans ────────────────────────
ALTER TABLE ingested_loans ADD COLUMN IF NOT EXISTS analysis_hash TEXT;

-- ── 4. portal_eligibility_verdicts table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_eligibility_verdicts (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL CHECK (length(loan_id) BETWEEN 1 AND 200),
  program TEXT NOT NULL CHECK (length(program) BETWEEN 1 AND 100),
  status TEXT NOT NULL CHECK (status IN ('PASS', 'FAIL')),
  passed_count INT NOT NULL DEFAULT 0,
  failed_count INT NOT NULL DEFAULT 0,
  failed_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  analysis_hash TEXT NOT NULL,
  superseded_at TIMESTAMPTZ,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, loan_id, program, recorded_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_eligibility_active_per_program
  ON portal_eligibility_verdicts (tenant_id, loan_id, program)
  WHERE superseded_at IS NULL;

ALTER TABLE portal_eligibility_verdicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_eligibility_verdicts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON portal_eligibility_verdicts;
CREATE POLICY tenant_isolation ON portal_eligibility_verdicts
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
