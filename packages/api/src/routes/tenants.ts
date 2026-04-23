import type { FastifyInstance } from "fastify";
import { withDb } from "../db/pool.js";
import { getTenantContext } from "../tenant-context.js";
import { CreateTenantSchema } from "@twin/core";
import { RESERVED_SLUGS, DEFAULT_SLA_CONFIG } from "@twin/core";
import { randomUUID } from "node:crypto";

export function registerTenantRoutes(app: FastifyInstance): void {
  // List all tenants (super_admin only)
  app.get("/tenants", async (req, reply) => {
    const ctx = getTenantContext();
    if (!ctx.isSuperAdmin) return reply.code(403).send({ error: "super_admin required" });
    return withDb(async (client) => {
      const { rows } = await client.query(
        "SELECT id, name, slug, status, settings, created_at, deleted_at FROM tenants WHERE deleted_at IS NULL ORDER BY created_at"
      );
      return rows;
    });
  });

  // Get single tenant by slug
  app.get<{ Params: { slug: string } }>("/tenants/:slug", async (req, reply) => {
    const { slug } = req.params;
    return withDb(async (client) => {
      const { rows } = await client.query(
        "SELECT id, name, slug, status, settings, created_at FROM tenants WHERE slug = $1 AND deleted_at IS NULL", [slug]
      );
      if (rows.length === 0) return reply.code(404).send({ error: "Tenant not found" });
      return rows[0];
    });
  });

  // Create tenant (super_admin only)
  app.post("/tenants", async (req, reply) => {
    const ctx = getTenantContext();
    if (!ctx.isSuperAdmin) return reply.code(403).send({ error: "super_admin required" });

    const parsed = CreateTenantSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { name, slug, settings } = parsed.data;
    if (RESERVED_SLUGS.has(slug)) return reply.code(400).send({ error: `Slug "${slug}" is reserved` });

    const id = randomUUID();
    const tenantSettings = settings ?? {
      sla: DEFAULT_SLA_CONFIG,
      agentBehavior: { riskTolerance: "moderate", autoApproveThreshold: 0.85, escalationTriggers: [] },
      webhooks: [],
    };

    return withDb(async (client) => {
      try {
        const { rows } = await client.query(
          `INSERT INTO tenants (id, name, slug, status, settings) VALUES ($1, $2, $3, 'onboarding', $4) RETURNING id, name, slug, status, created_at`,
          [id, name, slug, JSON.stringify(tenantSettings)]
        );
        await client.query(
          `INSERT INTO tenant_audit_log (actor_id, target_tenant_id, action, reason) VALUES ($1, $2, 'create', 'Tenant created')`,
          [ctx.userId, id]
        );
        return reply.code(201).send(rows[0]);
      } catch (e: unknown) {
        if ((e as { code?: string }).code === "23505") return reply.code(409).send({ error: `Slug "${slug}" already exists` });
        throw e;
      }
    });
  });

  // Update tenant (super_admin only)
  app.patch<{ Params: { slug: string } }>("/tenants/:slug", async (req, reply) => {
    const ctx = getTenantContext();
    if (!ctx.isSuperAdmin) return reply.code(403).send({ error: "super_admin required" });

    const { slug } = req.params;
    const body = req.body as { status?: string; settings?: unknown; reason?: string };

    return withDb(async (client) => {
      const { rows: existing } = await client.query(
        "SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL", [slug]
      );
      if (existing.length === 0) return reply.code(404).send({ error: "Tenant not found" });

      const tenantId = existing[0].id;
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      if (body.status) {
        updates.push(`status = $${paramIdx++}`);
        values.push(body.status);
        if (body.status === "offboarding") updates.push(`deleted_at = NOW()`);
      }
      if (body.settings) {
        updates.push(`settings = $${paramIdx++}`);
        values.push(JSON.stringify(body.settings));
      }

      if (updates.length === 0) return reply.code(400).send({ error: "No updates provided" });

      values.push(slug);
      await client.query(`UPDATE tenants SET ${updates.join(", ")} WHERE slug = $${paramIdx}`, values);
      await client.query(
        `INSERT INTO tenant_audit_log (actor_id, target_tenant_id, action, reason) VALUES ($1, $2, $3, $4)`,
        [ctx.userId, tenantId, "update", body.reason ?? "Tenant updated"]
      );

      const { rows } = await client.query(
        "SELECT id, name, slug, status, settings, created_at, deleted_at FROM tenants WHERE slug = $1", [slug]
      );
      return rows[0];
    });
  });
}
