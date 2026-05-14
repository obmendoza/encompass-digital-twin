-- packages/api/src/db/migrations/020-ingestion-framework.sql
-- NPNQM Ingestion Framework — spec 2026-05-14-ingestion-framework-design.md
--
-- Adds:
--   1. ingestion_mappings.adapter_type + adapter_config (transitional; transformer_type retained)
--   2. ingested_documents (idempotency + worker queue for the doc channel)
--   3. loan_context_extras (F2-deferred LoanContext field closure; first-write-wins)
--   4. pc_v2_refire_debounce (collapses N AddDocument events into 1 PC v2 run per loan)

-- ── 1. Extend ingestion_mappings ────────────────────────────────────
ALTER TABLE ingestion_mappings ADD COLUMN IF NOT EXISTS adapter_type TEXT;
UPDATE ingestion_mappings SET adapter_type = transformer_type WHERE adapter_type IS NULL;
ALTER TABLE ingestion_mappings ALTER COLUMN adapter_type SET NOT NULL;
ALTER TABLE ingestion_mappings
  ADD COLUMN IF NOT EXISTS adapter_config JSONB NOT NULL DEFAULT '{}'::jsonb;
-- transformer_type retained for one release; removed in a follow-up migration.

-- ── 2. ingested_documents ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingested_documents (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  external_id TEXT NOT NULL
    CHECK (length(external_id) BETWEEN 1 AND 200 AND external_id ~ '^[A-Za-z0-9_.:-]+$'),
  document_id TEXT NOT NULL CHECK (length(document_id) BETWEEN 1 AND 200),
  loan_id TEXT NOT NULL CHECK (length(loan_id) BETWEEN 1 AND 200),
  source_url TEXT NOT NULL CHECK (length(source_url) <= 2048),
  file_name TEXT NOT NULL CHECK (length(file_name) <= 500),
  status TEXT NOT NULL DEFAULT 'pending_fetch'
    CHECK (status IN ('pending_fetch', 'fetched', 'failed')),
  failed_reason TEXT,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetched_at TIMESTAMPTZ,
  ingest_batch_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_ingested_documents_pending
  ON ingested_documents (status, next_attempt_at)
  WHERE status = 'pending_fetch';

ALTER TABLE ingested_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingested_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ingested_documents;
CREATE POLICY tenant_isolation ON ingested_documents
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── 3. loan_context_extras ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS loan_context_extras (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL CHECK (length(loan_id) BETWEEN 1 AND 200),
  extras JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, loan_id)
);

ALTER TABLE loan_context_extras ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_context_extras FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON loan_context_extras;
CREATE POLICY tenant_isolation ON loan_context_extras
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── 4. pc_v2_refire_debounce ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pc_v2_refire_debounce (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL CHECK (length(loan_id) BETWEEN 1 AND 200),
  ready_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, loan_id)
);

CREATE INDEX IF NOT EXISTS idx_pc_v2_refire_ready
  ON pc_v2_refire_debounce (ready_at);

ALTER TABLE pc_v2_refire_debounce ENABLE ROW LEVEL SECURITY;
ALTER TABLE pc_v2_refire_debounce FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pc_v2_refire_debounce;
CREATE POLICY tenant_isolation ON pc_v2_refire_debounce
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
