-- 1. Add type column to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'production'
  CHECK (type IN ('demo', 'production'));

-- 2. Migrate Default Tenant to Demo Tenant with real UUID
DO $$
DECLARE
  new_demo_id UUID := gen_random_uuid();
  old_id UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF EXISTS (SELECT 1 FROM tenants WHERE id = old_id) THEN
    UPDATE tenants SET id = new_demo_id, name = 'Demo Tenant', slug = 'demo', type = 'demo' WHERE id = old_id;
    UPDATE world_state SET tenant_id = new_demo_id WHERE tenant_id = old_id;
    UPDATE action_log SET tenant_id = new_demo_id WHERE tenant_id = old_id;
    UPDATE decision_records SET tenant_id = new_demo_id WHERE tenant_id = old_id;
    UPDATE detected_patterns SET tenant_id = new_demo_id WHERE tenant_id = old_id;
    UPDATE pattern_suggestions SET tenant_id = new_demo_id WHERE tenant_id = old_id;
    UPDATE metrics_snapshots SET tenant_id = new_demo_id WHERE tenant_id = old_id;
    UPDATE learning_outcomes SET tenant_id = new_demo_id WHERE tenant_id = old_id;
  END IF;
END $$;

-- 3. Add timezone/locale
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en-US';

-- 4. Expand status to include 'archived'
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check_v2;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check_v2
  CHECK (status IN ('onboarding', 'active', 'suspended', 'offboarding', 'archived'));

-- 5. Force RLS on all tenant-scoped tables
ALTER TABLE world_state FORCE ROW LEVEL SECURITY;
ALTER TABLE decision_records FORCE ROW LEVEL SECURITY;
ALTER TABLE detected_patterns FORCE ROW LEVEL SECURITY;
ALTER TABLE pattern_suggestions FORCE ROW LEVEL SECURITY;
ALTER TABLE metrics_snapshots FORCE ROW LEVEL SECURITY;

-- 6. Append-only audit log rules
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_rules WHERE rulename = 'no_update_audit') THEN
    CREATE RULE no_update_audit AS ON UPDATE TO tenant_audit_log DO INSTEAD NOTHING;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_rules WHERE rulename = 'no_delete_audit') THEN
    CREATE RULE no_delete_audit AS ON DELETE TO tenant_audit_log DO INSTEAD NOTHING;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON tenant_audit_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target_time ON tenant_audit_log(target_tenant_id, created_at DESC);
