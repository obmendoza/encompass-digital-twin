-- 014-va-default-pools.sql
-- For every existing tenant, create a default internal pool and seed
-- tenant.settings.va. Demo defaults required=false; npnqm-twin defaults
-- required=true. Other tenants default required=false (opt-in).

DO $$
DECLARE
  t RECORD;
  new_pool_id UUID;
  va_required BOOLEAN;
  sla_minutes INTEGER;
BEGIN
  FOR t IN SELECT id, slug, name, settings FROM tenants WHERE deleted_at IS NULL LOOP
    -- Determine per-tenant defaults.
    IF t.slug = 'npnqm-twin' THEN
      va_required := true;
      sla_minutes := 60;
    ELSE
      va_required := false;
      sla_minutes := NULL;
    END IF;

    -- Create the default internal pool (idempotent: skip if already exists).
    SELECT id INTO new_pool_id
      FROM va_pools
     WHERE tenant_id = t.id AND kind = 'internal' AND name = (t.name || ' Internal Team');

    IF new_pool_id IS NULL THEN
      INSERT INTO va_pools (tenant_id, name, kind, bpo_partner_id, active)
        VALUES (t.id, t.name || ' Internal Team', 'internal', NULL, true)
        RETURNING id INTO new_pool_id;
    END IF;

    -- Merge va settings into tenants.settings without trampling existing keys.
    UPDATE tenants
       SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
             'va', jsonb_build_object(
               'required', va_required,
               'fallbackPoolId', new_pool_id::text,
               'docRequestAdapter', jsonb_build_object('kind', 'ui-only'),
               'reviewSlaMinutes', sla_minutes
             )
           )
     WHERE id = t.id;

    RAISE NOTICE 'tenant % seeded: pool=% required=%', t.slug, new_pool_id, va_required;
  END LOOP;
END $$;
