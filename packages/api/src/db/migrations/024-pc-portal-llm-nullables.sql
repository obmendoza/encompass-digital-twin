-- 024-pc-portal-llm-nullables.sql
--
-- Spec 1.5 follow-up: relax NOT NULL on predicted_conditions columns that
-- only apply to PC v1/v2 (doc-checklist + pre-underwriter) rows. Portal-LLM
-- rows (source_list = 'portal-llm') have no kb_version, no resolved income
-- type, no source_order, and no predicted_by agent — those concepts belong
-- to the rule-engine path, not the portal analysis path.
--
-- PC v1/v2 inserts in service.ts always supply explicit values for all four
-- columns, so the behavioural contract for those rows is unchanged. Only the
-- DB constraint is relaxed; application-level NOT NULL enforcement remains
-- in the service layer for non-portal rows.

ALTER TABLE predicted_conditions ALTER COLUMN predicted_by DROP NOT NULL;
ALTER TABLE predicted_conditions ALTER COLUMN kb_version_id DROP NOT NULL;
ALTER TABLE predicted_conditions ALTER COLUMN resolved_income_type DROP NOT NULL;
ALTER TABLE predicted_conditions ALTER COLUMN source_order DROP NOT NULL;
