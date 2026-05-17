-- 027-pc-source-rule-id-text.sql
-- Widen predicted_conditions.source_rule_id from UUID to TEXT so that
-- HOI-validator findings can store string rule IDs (e.g. 'hoi.loss-payee.match').
-- Prior rows from matrix/geographic/requirements resolvers stored UUID values
-- that cast cleanly to TEXT; this migration is fully backward-compatible.
--
-- See 028-pc-hoi-source-list.sql for the source_list CHECK widen, and
-- 029-pc-hoi-rule-table.sql for the source_rule_table CHECK widen.

ALTER TABLE predicted_conditions
  ALTER COLUMN source_rule_id TYPE TEXT;

-- The existing index idx_pc_rule_id references source_rule_id; drop + recreate
-- to pick up the type change (Postgres requires this for expression indexes).
DROP INDEX IF EXISTS idx_pc_rule_id;
CREATE INDEX IF NOT EXISTS idx_pc_rule_id
  ON predicted_conditions (tenant_id, source_rule_table, source_rule_id);

-- Recreate the HOI-validator idempotency index with the TEXT-typed column
-- (the original from 026 may have been created before the type change).
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
