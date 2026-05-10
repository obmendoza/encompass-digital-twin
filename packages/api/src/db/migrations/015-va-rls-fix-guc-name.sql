-- 015-va-rls-fix-guc-name.sql
--
-- Migration 013 introduced VA review layer RLS policies that reference
-- `current_setting('app.current_tenant_id')::uuid`, but the application's
-- `withTenantTx` helper (packages/api/src/db/pool.ts) sets the GUC under
-- the name `app.current_tenant` (no `_id` suffix), matching the convention
-- used by every other migration (002-rls.sql, 008-true-tenant-isolation.sql,
-- etc., all of which use `current_setting('app.current_tenant', true)::uuid`).
--
-- The mismatch was masked in the Supabase session pooler because that role
-- has BYPASSRLS — the policies were never enforced. In any environment
-- where the connecting role lacks BYPASSRLS, every va_* query would error
-- with "unrecognized configuration parameter".
--
-- This migration drops and recreates the seven RLS policies introduced by
-- migration 013, this time aligned with the existing GUC name. The
-- `, true` second argument to `current_setting` makes the lookup return
-- NULL when the GUC isn't set (instead of throwing), again matching the
-- existing convention.

DROP POLICY IF EXISTS tenant_isolation_va_loan_state ON va_loan_state;
CREATE POLICY tenant_isolation_va_loan_state ON va_loan_state
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_va_pools ON va_pools;
CREATE POLICY tenant_isolation_va_pools ON va_pools
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_va_pool_memberships ON va_pool_memberships;
CREATE POLICY tenant_isolation_va_pool_memberships ON va_pool_memberships
  USING (pool_id IN (
    SELECT id FROM va_pools
    WHERE tenant_id = current_setting('app.current_tenant', true)::uuid
  ));

DROP POLICY IF EXISTS tenant_isolation_va_routing_rules ON va_routing_rules;
CREATE POLICY tenant_isolation_va_routing_rules ON va_routing_rules
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_va_reviews ON va_reviews;
CREATE POLICY tenant_isolation_va_reviews ON va_reviews
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_va_event_outbox ON va_event_outbox;
CREATE POLICY tenant_isolation_va_event_outbox ON va_event_outbox
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_bpo_api_keys ON bpo_api_keys;
CREATE POLICY tenant_isolation_bpo_api_keys ON bpo_api_keys
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
