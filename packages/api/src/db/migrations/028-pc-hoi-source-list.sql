-- 028-pc-hoi-source-list.sql
-- Widen two CHECK constraints to enable hoi-validator findings:
--
-- 1. source_list CHECK: add 'hoi-validator'
-- 2. source_rule_table CHECK: add 'hoi_validator_rules'
--
-- Migration 027 widened source_rule_id UUID→TEXT; this migration completes the
-- enablement of hoi-validator findings in predicted_conditions.

-- ── 1. Widen source_list CHECK ──────────────────────────────────────────────
ALTER TABLE predicted_conditions
  DROP CONSTRAINT IF EXISTS predicted_conditions_source_list_check;

ALTER TABLE predicted_conditions
  ADD CONSTRAINT predicted_conditions_source_list_check
  CHECK (source_list IN (
    'minimum', 'income', 'matrix', 'geographic', 'requirements',
    'portal-llm', 'hoi-validator'
  ));

-- ── 2. Widen source_rule_table CHECK ────────────────────────────────────────
ALTER TABLE predicted_conditions
  DROP CONSTRAINT IF EXISTS predicted_conditions_source_rule_table_check;

ALTER TABLE predicted_conditions
  ADD CONSTRAINT predicted_conditions_source_rule_table_check
  CHECK (source_rule_table IS NULL OR source_rule_table IN (
    'program_matrix_tiers', 'program_requirements', 'geographic_restrictions',
    'hoi_validator_rules'
  ));
