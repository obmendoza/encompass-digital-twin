-- 017-kb-superseded-at.sql
--
-- Adds the `superseded_at` column to F2's kb_versions table (migration 012).
--
-- Spec 2026-05-12 §8.2 prescribes setting superseded_at=now() on a kb_version
-- row when --activate demotes the prior active version. Migration 012's
-- original kb_versions schema didn't include the column; this migration
-- closes that gap. The doc-checklist spec is the first feature that depends
-- on the demote timestamp being recorded.
--
-- CROSS-MIGRATION DEPENDENCY: Extends kb_versions (owned by migration 012).
-- See migration 016 for the partial unique index on kb_versions also added
-- by the doc-checklist work.

ALTER TABLE kb_versions
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ NULL;
