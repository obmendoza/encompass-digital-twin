-- 019-pc-v2-pre-underwriter.sql
--
-- PC v2 Pre-Underwriter Validation (spec 2026-05-14). Extends
-- predicted_conditions to support findings from matrix, requirements,
-- and geographic resolvers (in addition to PC v1's minimum/income from
-- the doc-checklist).
--
-- CROSS-MIGRATION DEPENDENCIES: predicted_conditions owned by migration
-- 018; this migration extends its source_list CHECK and adds three columns
-- + one index. Backward-compatible for existing rows (NULL provenance +
-- 'deterministic' emission_kind by default).

-- ── 1. Widen source_list CHECK ──────────────────────────────────────────
-- PC v1's CHECK admitted only ('minimum','income'). PC v2 adds three.
ALTER TABLE predicted_conditions
  DROP CONSTRAINT IF EXISTS predicted_conditions_source_list_check;
ALTER TABLE predicted_conditions
  ADD CONSTRAINT predicted_conditions_source_list_check
  CHECK (source_list IN ('minimum', 'income', 'matrix', 'requirements', 'geographic'));

-- ── 2. Source-rule provenance ───────────────────────────────────────────
-- NULL for PC v1 rows (minimum/income don't carry rule-level provenance —
-- the doc-checklist resolver returns DocItems, not rule references).
-- Populated for matrix/requirements/geographic findings.
ALTER TABLE predicted_conditions
  ADD COLUMN IF NOT EXISTS source_rule_table TEXT
    CHECK (source_rule_table IS NULL OR source_rule_table IN
           ('program_matrix_tiers', 'program_requirements', 'geographic_restrictions'));
ALTER TABLE predicted_conditions
  ADD COLUMN IF NOT EXISTS source_rule_id UUID;

-- ── 3. Emission provenance ─────────────────────────────────────────────
-- Distinguishes deterministic resolver output from LLM-backstop output.
-- Required for audit, cost tracking, and the §5.4 dedup-ladder R3 property
-- ("Stage A always wins over Stage B with semantically-similar descriptions").
ALTER TABLE predicted_conditions
  ADD COLUMN IF NOT EXISTS emission_kind TEXT NOT NULL DEFAULT 'deterministic'
    CHECK (emission_kind IN ('deterministic', 'llm'));

-- ── 4. Provenance index for traceback queries ──────────────────────────
-- Supports "show me all predictions emitted from this matrix tier" lookups
-- for spec/operator debugging.
CREATE INDEX IF NOT EXISTS idx_pc_source_rule
  ON predicted_conditions (tenant_id, source_rule_table, source_rule_id);
