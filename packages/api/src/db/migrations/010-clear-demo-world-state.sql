-- Clear demo tenant's world_state since fixtures are loaded fresh on every boot
-- This prevents stale persisted loans from interfering with fixture loading
DELETE FROM world_state WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'demo');
