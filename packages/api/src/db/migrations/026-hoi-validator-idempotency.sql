-- 026-hoi-validator-idempotency.sql
-- Partial unique index supporting ON CONFLICT DO NOTHING inserts for hoi-validator
-- predicted_conditions rows. Stabilizes UUIDs across PC v2 re-runs so the
-- Two-Source UI's cleanup-banner can retry against a live row. Key includes
-- extractionId from portal_metadata so a fresh extraction (new doc upload)
-- legitimately produces a new row.

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
