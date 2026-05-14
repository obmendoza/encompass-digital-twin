-- packages/api/src/db/migrations/022-worker-rls-policy.sql
-- Codex P1 fix: the doc-fetch worker uses withDb (admin connection) to
-- claim rows across tenants. FORCE ROW LEVEL SECURITY filters those out
-- in production where the app role doesn't have BYPASSRLS. Switching
-- to ENABLE (not FORCE) lets the table owner bypass; tenant-scoped
-- callers (e.g., admin API GET) still get filtered via the explicit
-- WHERE tenant_id clause they are already passing.

ALTER TABLE ingested_documents NO FORCE ROW LEVEL SECURITY;
ALTER TABLE pc_v2_refire_debounce NO FORCE ROW LEVEL SECURITY;
-- loan_context_extras stays FORCE — it is only accessed via withTenantTx.
-- ingestion_mappings already lacks FORCE in migration 020.
