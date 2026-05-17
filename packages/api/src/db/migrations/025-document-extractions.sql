-- 025-document-extractions.sql
-- Cache table for HOI/Flood policy field extractions (LLM-derived or portal-provided).
-- Source-of-truth for the HOI validator's rule evaluation. Schema-versioned via
-- partial unique index so field-set changes invalidate prior extractions cleanly.

CREATE TABLE IF NOT EXISTS document_extractions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  loan_id               TEXT NOT NULL,
  document_id           UUID NOT NULL,
  extractor_kind        TEXT NOT NULL CHECK (extractor_kind IN ('hoi-policy', 'flood-cert')),
  schema_version        INT NOT NULL,
  source                TEXT NOT NULL CHECK (source IN ('portal', 'llm-extractor', 'manual')),
  extracted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  extracted_by          TEXT NOT NULL,
  fields                JSONB NOT NULL,
  extraction_confidence NUMERIC,
  extraction_error      TEXT,
  superseded_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS document_extractions_active
  ON document_extractions (tenant_id, document_id, extractor_kind, schema_version)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS document_extractions_loan
  ON document_extractions (tenant_id, loan_id, extractor_kind)
  WHERE superseded_at IS NULL;

ALTER TABLE document_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_extractions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON document_extractions;
CREATE POLICY tenant_isolation ON document_extractions
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
