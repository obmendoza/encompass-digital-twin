ALTER TABLE decision_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE detected_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE pattern_suggestions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON decision_records;
  CREATE POLICY tenant_isolation ON decision_records
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

  DROP POLICY IF EXISTS tenant_isolation ON metrics_snapshots;
  CREATE POLICY tenant_isolation ON metrics_snapshots
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

  DROP POLICY IF EXISTS tenant_isolation ON detected_patterns;
  CREATE POLICY tenant_isolation ON detected_patterns
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

  DROP POLICY IF EXISTS tenant_isolation ON pattern_suggestions;
  CREATE POLICY tenant_isolation ON pattern_suggestions
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
END $$;
