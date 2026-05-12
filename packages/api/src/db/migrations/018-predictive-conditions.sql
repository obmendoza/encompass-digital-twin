-- 018-predictive-conditions.sql
--
-- NPNQM Predictive Conditions (spec 2026-05-12). First downstream consumer
-- of the doc-checklist ingest (migration 016, shipped 2026-05-12).
--
-- Creates two new tenant-scoped tables:
--   predicted_conditions  — N predictions per loan per run; status state machine
--                           (pending → accepted | dismissed); promoted predictions
--                           link to the Condition.id they created.
--   prediction_alerts     — One row per resolver-error event on a loan; cleared
--                           manually or auto-cleared by a successful re-run.
--
-- Also extends migration 016's audit-log dedup index to cover all five new
-- predict_conditions.* audit actions, including alert_clear (keyed on alert_id
-- rather than prediction_id; defense-in-depth against advisory-lock-edge races).
--
-- CROSS-MIGRATION DEPENDENCY: predicted_conditions.kb_version_id references
-- kb_versions owned by migration 012. See migration 016 for prior cross-migration
-- constraints; migration 017 for superseded_at.

-- ── 1. predicted_conditions ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS predicted_conditions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id                TEXT NOT NULL,
  prediction_run_id      UUID NOT NULL,
  source_input_hash      TEXT NOT NULL,
  predicted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  predicted_by           TEXT NOT NULL,
  kb_version_id          INT  NOT NULL REFERENCES kb_versions(id) ON DELETE CASCADE,
  resolved_income_type   TEXT NOT NULL,
  -- The CHECK below freezes the four-value set for this spec. ConditionCategory
  -- in @twin/core types must stay in sync; adding a fifth value (e.g. 'PTC')
  -- requires a future migration to relax this CHECK. See spec §9 non-goal.
  category               TEXT NOT NULL,
  description            TEXT NOT NULL,
  note                   TEXT NULL,
  source_list            TEXT NOT NULL,
  source_order           INT  NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending',
  acted_by               TEXT NULL,
  acted_at               TIMESTAMPTZ NULL,
  acted_role             TEXT NULL,
  dismissal_reason       TEXT NULL,
  accepted_condition_id  TEXT NULL,
  CHECK (category IN ('PTA','PTD','PTF','PTP')),
  CHECK (source_list IN ('minimum','income')),
  CHECK (status IN ('pending','accepted','dismissed')),
  CHECK (acted_role IS NULL OR acted_role IN ('operator','va')),
  -- Biconditional: status='accepted' iff accepted_condition_id is set.
  CHECK ((status = 'accepted') = (accepted_condition_id IS NOT NULL)),
  -- One-way: status='dismissed' implies a non-empty reason (≥10 chars).
  -- Doesn't constrain reason when status != 'dismissed'.
  CHECK (status != 'dismissed' OR (dismissal_reason IS NOT NULL AND char_length(dismissal_reason) >= 10))
);
CREATE INDEX IF NOT EXISTS idx_pc_tenant_loan        ON predicted_conditions(tenant_id, loan_id);
CREATE INDEX IF NOT EXISTS idx_pc_tenant_loan_status ON predicted_conditions(tenant_id, loan_id, status);
CREATE INDEX IF NOT EXISTS idx_pc_run_id             ON predicted_conditions(tenant_id, prediction_run_id);

ALTER TABLE predicted_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE predicted_conditions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pc ON predicted_conditions;
CREATE POLICY tenant_isolation_pc ON predicted_conditions
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── 2. prediction_alerts ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prediction_alerts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  loan_id              TEXT NOT NULL,
  alerted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_class          TEXT NOT NULL,
  error_payload        JSONB NOT NULL,
  remediation_hint     TEXT NOT NULL,
  cleared_by           TEXT NULL,
  cleared_at           TIMESTAMPTZ NULL,
  CHECK (error_class IN ('NoActiveKbVersionError','KbVersionNotFoundError','IncomeTypeUnresolvedError')),
  CHECK ((cleared_at IS NULL) = (cleared_by IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_pa_tenant_loan   ON prediction_alerts(tenant_id, loan_id);
CREATE INDEX IF NOT EXISTS idx_pa_tenant_active ON prediction_alerts(tenant_id, cleared_at)
  WHERE cleared_at IS NULL;

ALTER TABLE prediction_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pa ON prediction_alerts;
CREATE POLICY tenant_isolation_pa ON prediction_alerts
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── 3. Audit-log dedup index for predict_conditions.* (prediction-id keyed) ──

CREATE UNIQUE INDEX IF NOT EXISTS tenant_audit_log_predict_dedup
  ON tenant_audit_log (
    target_tenant_id,
    action,
    (metadata->>'prediction_id'),
    actor_id
  )
  WHERE action IN ('predict_conditions.accept',
                   'predict_conditions.dismiss',
                   'predict_conditions.reopen_and_accept');

-- ── 4. Audit-log dedup index for predict_conditions.alert + alert_clear ──
-- Different key (alert_id, not prediction_id). Reviewer-recommended defense
-- against the very rare advisory-lock-edge race where two near-simultaneous
-- successful reruns could each attempt to auto-clear the same alert.

CREATE UNIQUE INDEX IF NOT EXISTS tenant_audit_log_predict_alert_dedup
  ON tenant_audit_log (
    target_tenant_id,
    action,
    (metadata->>'alert_id'),
    actor_id
  )
  WHERE action IN ('predict_conditions.alert',
                   'predict_conditions.alert_clear');
