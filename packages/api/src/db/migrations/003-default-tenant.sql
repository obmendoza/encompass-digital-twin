INSERT INTO tenants (id, name, slug, status, settings)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'Default Tenant',
  'default',
  'active',
  '{"sla":{"maxQueueTimeMinutes":30,"maxProcessingTimeMinutes":60,"maxReviewTimeMinutes":120,"maxTotalTimeMinutes":240},"agentBehavior":{"riskTolerance":"moderate","autoApproveThreshold":0.85,"escalationTriggers":[]},"webhooks":[]}'
)
ON CONFLICT (id) DO NOTHING;

UPDATE world_state SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;
UPDATE action_log SET tenant_id = '00000000-0000-0000-0000-000000000000' WHERE tenant_id IS NULL;

ALTER TABLE world_state ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE action_log ALTER COLUMN tenant_id SET NOT NULL;
