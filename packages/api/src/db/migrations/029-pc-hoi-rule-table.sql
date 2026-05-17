-- 029-pc-hoi-rule-table.sql
-- Widen predicted_conditions.source_rule_table CHECK to include 'hoi_validator_rules'.
-- Migration 028 widened source_list; this migration completes the enablement
-- of hoi-validator findings by widening the source_rule_table constraint.

ALTER TABLE predicted_conditions
  DROP CONSTRAINT IF EXISTS predicted_conditions_source_rule_table_check;

ALTER TABLE predicted_conditions
  ADD CONSTRAINT predicted_conditions_source_rule_table_check
  CHECK (source_rule_table IS NULL OR source_rule_table IN (
    'program_matrix_tiers', 'program_requirements', 'geographic_restrictions',
    'hoi_validator_rules'
  ));
