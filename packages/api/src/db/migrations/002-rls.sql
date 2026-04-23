ALTER TABLE world_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_guidelines ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingested_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_api_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON world_state;
  CREATE POLICY tenant_isolation ON world_state
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

  DROP POLICY IF EXISTS tenant_isolation ON action_log;
  CREATE POLICY tenant_isolation ON action_log
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

  DROP POLICY IF EXISTS tenant_isolation ON tenant_guidelines;
  CREATE POLICY tenant_isolation ON tenant_guidelines
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

  DROP POLICY IF EXISTS tenant_isolation ON tenant_workflows;
  CREATE POLICY tenant_isolation ON tenant_workflows
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

  DROP POLICY IF EXISTS tenant_isolation ON ingestion_mappings;
  CREATE POLICY tenant_isolation ON ingestion_mappings
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

  DROP POLICY IF EXISTS tenant_isolation ON ingested_loans;
  CREATE POLICY tenant_isolation ON ingested_loans
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

  DROP POLICY IF EXISTS tenant_isolation ON webhook_deliveries;
  CREATE POLICY tenant_isolation ON webhook_deliveries
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

  DROP POLICY IF EXISTS tenant_isolation ON tenant_api_keys;
  CREATE POLICY tenant_isolation ON tenant_api_keys
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
END $$;
