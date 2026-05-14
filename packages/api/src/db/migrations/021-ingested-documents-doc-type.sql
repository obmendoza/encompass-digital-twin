-- packages/api/src/db/migrations/021-ingested-documents-doc-type.sql
-- Persist adapter-classified docType + source_name on ingested_documents so the
-- worker can route doc-type and per-source adapter config correctly.

ALTER TABLE ingested_documents ADD COLUMN IF NOT EXISTS doc_type TEXT;
ALTER TABLE ingested_documents ADD COLUMN IF NOT EXISTS source_name TEXT;
-- Default existing rows so the worker has something to fall back on.
UPDATE ingested_documents SET doc_type = 'Other' WHERE doc_type IS NULL;
ALTER TABLE ingested_documents ALTER COLUMN doc_type SET NOT NULL;
ALTER TABLE ingested_documents ALTER COLUMN doc_type SET DEFAULT 'Other';
-- source_name stays nullable for backwards-compat with rows ingested pre-migration.

-- One active mapping per (tenant, source_name). Inactive rows accumulate
-- (history/audit) but don't shadow the active one.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_ingestion_mapping
  ON ingestion_mappings (tenant_id, source_name)
  WHERE active = true;
