-- Ensure demo tenant has type = 'demo'
-- Migration 008 may not have set it correctly due to column default ordering
UPDATE tenants SET type = 'demo' WHERE slug = 'demo';
