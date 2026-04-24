-- tenant_api_keys is queried during authentication (before tenant is known)
-- RLS must be disabled on this table so the API key validation can look up
-- the tenant_id from the key hash without needing a tenant context.
ALTER TABLE tenant_api_keys DISABLE ROW LEVEL SECURITY;
