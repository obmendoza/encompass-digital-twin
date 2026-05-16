-- 027-pc-source-rule-id-text.sql
-- Two changes required to enable hoi-validator findings in predicted_conditions:
--
-- 1. Widen source_list CHECK to include 'hoi-validator'.
--    Prior constraint: ('minimum','income','matrix','geographic','requirements','portal-llm')
--
-- 2. Widen source_rule_id from UUID to TEXT so HOI rule IDs (e.g. 'hoi.loss-payee.match')
--    can be stored. Matrix/geographic/requirements resolvers store UUID values which
--    cast cleanly to TEXT — fully backward-compatible.
--
-- Also recreates the partial unique index from 026 against the TEXT-typed column.

-- ── 1. Widen source_list CHECK ──────────────────────────────────────────────
ALTER TABLE predicted_conditions
  DROP CONSTRAINT IF EXISTS predicted_conditions_source_list_check;

ALTER TABLE predicted_conditions
  ADD CONSTRAINT predicted_conditions_source_list_check
  CHECK (source_list IN (
    'minimum', 'income', 'matrix', 'geographic', 'requirements',
    'portal-llm', 'hoi-validator'
  ));

-- ── 2. Widen source_rule_id to TEXT ─────────────────────────────────────────
ALTER TABLE predicted_conditions
  ALTER COLUMN source_rule_id TYPE TEXT;

-- The existing index idx_pc_rule_id references source_rule_id; drop + recreate
-- to pick up the type change.
DROP INDEX IF EXISTS idx_pc_rule_id;
CREATE INDEX IF NOT EXISTS idx_pc_rule_id
  ON predicted_conditions (tenant_id, source_rule_table, source_rule_id);

-- Recreate the HOI-validator idempotency index against the TEXT-typed column.
DROP INDEX IF EXISTS predicted_conditions_hoi_validator_active;
CREATE UNIQUE INDEX IF NOT EXISTS predicted_conditions_hoi_validator_active
  ON predicted_conditions (
    tenant_id,
    loan_id,
    source_list,
    source_rule_id,
    ((portal_metadata->>'extractionId'))
  )
  WHERE source_list = 'hoi-validator'
    AND status = 'pending'
    AND superseded_at IS NULL;
