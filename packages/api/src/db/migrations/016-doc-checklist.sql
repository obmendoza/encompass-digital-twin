-- 016-doc-checklist.sql
--
-- NPNQM Doc Requirements Checklist Ingest (spec 2026-05-12).
--
-- Creates three new tenant-scoped tables for the doc-checklist data model:
--   program_doc_checklist        — per-scenario doc lists
--   program_doc_engine_rules     — predicate-based rule modifiers (LLC, Field Review, USCredit)
--   income_type_resolver         — Frontend→Resolved income type lookup
--
-- Also adds two constraints to F2's kb_versions table (migration 012):
--   1. Partial unique index for single-active-version-per-tenant (race protection
--      for scripts/approve-kb.ts --activate; see spec §2.1 + §8.2).
--   2. Audit-log dedup unique constraint on tenant_audit_log so that approve-kb.ts's
--      explicit application-level write doesn't duplicate a trigger row (spec §8.3).
--
-- CROSS-MIGRATION DEPENDENCY: This migration extends two tables owned by prior
-- migrations (012-guideline-processing.sql for kb_versions, 001-tenants.sql for
-- tenant_audit_log). Future schema changes to those tables must consider these
-- constraints. See spec §10 implementation note 1.

-- ── 1. program_doc_checklist ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS program_doc_checklist (
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kb_version_id        INT  NOT NULL REFERENCES kb_versions(id) ON DELETE CASCADE,
  resolved_income_type TEXT NOT NULL,
  program              TEXT NOT NULL,
  minimum_docs         JSONB NOT NULL,
  income_docs          JSONB NOT NULL,
  raw_min_msg          TEXT NOT NULL,
  raw_income_msg       TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kb_version_id, resolved_income_type)
);
CREATE INDEX IF NOT EXISTS idx_pdc_tenant_version ON program_doc_checklist(tenant_id, kb_version_id);

ALTER TABLE program_doc_checklist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pdc ON program_doc_checklist;
CREATE POLICY tenant_isolation_pdc ON program_doc_checklist
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── 2. program_doc_engine_rules ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS program_doc_engine_rules (
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kb_version_id INT  NOT NULL REFERENCES kb_versions(id) ON DELETE CASCADE,
  rule_name     TEXT NOT NULL,
  predicate     JSONB NOT NULL,
  effect        JSONB NOT NULL,
  description   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kb_version_id, rule_name)
);

ALTER TABLE program_doc_engine_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pder ON program_doc_engine_rules;
CREATE POLICY tenant_isolation_pder ON program_doc_engine_rules
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── 3. income_type_resolver ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS income_type_resolver (
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kb_version_id        INT  NOT NULL REFERENCES kb_versions(id) ON DELETE CASCADE,
  income_doc_type      TEXT NOT NULL,
  borrower_type        TEXT NOT NULL,
  citizenship          TEXT NOT NULL,
  is_itin              BOOLEAN NOT NULL,
  resolved_income_type TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kb_version_id, income_doc_type, borrower_type, citizenship, is_itin)
);

ALTER TABLE income_type_resolver ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_itr ON income_type_resolver;
CREATE POLICY tenant_isolation_itr ON income_type_resolver
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── 4. Single-active-version-per-tenant partial unique index ───────────────
-- Protects scripts/approve-kb.ts --activate from race-induced multi-active state.

CREATE UNIQUE INDEX IF NOT EXISTS kb_versions_one_active_per_tenant
  ON kb_versions (tenant_id)
  WHERE status = 'active';

-- ── 5. Audit-log dedup constraint ──────────────────────────────────────────
-- approve-kb.ts writes its own audit row inside the approval transaction. If a
-- trigger on kb_versions is later added that also writes audit rows, this
-- constraint guarantees only one row per (target_tenant, action, version,
-- actor) tuple. Metadata extraction uses jsonb_extract_path_text so the
-- constraint expression is immutable.

CREATE UNIQUE INDEX IF NOT EXISTS tenant_audit_log_kb_dedup
  ON tenant_audit_log (
    target_tenant_id,
    action,
    (metadata->>'kb_version_id'),
    actor_id
  )
  WHERE action IN ('kb_version.approve', 'kb_version.compliance_signoff', 'kb_version.activate');
