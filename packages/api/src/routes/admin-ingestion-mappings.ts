import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withDb, withTenantTx } from "../db/pool.js";
import { getTenantContext } from "../tenant-context.js";
import { AdapterConfigSchema } from "@twin/core";
import { getAdapter } from "../ingestion/adapter-registry.js";

const PostBody = z.object({
  source_name: z.string().min(1).max(100),
  adapter_type: z.string().min(1).max(100),
  adapter_config: z.unknown(),
});

const PatchBody = z.object({
  active: z.boolean().optional(),
  adapter_config: z.unknown().optional(),
});

async function auditLog(
  tenantId: string,
  actorId: string,
  action: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [tenantId, actorId, action, `${action} by ${actorId}`, JSON.stringify(metadata)],
    );
  });
}

export function registerAdminIngestionMappingsRoutes(app: FastifyInstance): void {
  app.get<{ Params: { tenantSlug: string } }>(
    "/admin/tenants/:tenantSlug/ingestion-mappings",
    async () => {
      const { tenantId } = getTenantContext();
      return withTenantTx(tenantId, async (c) => {
        const { rows } = await c.query(
          `SELECT id, source_name, adapter_type, adapter_config, active, created_at
           FROM ingestion_mappings WHERE tenant_id=$1 ORDER BY created_at DESC`,
          [tenantId],
        );
        return rows;
      });
    },
  );

  app.post<{ Params: { tenantSlug: string } }>(
    "/admin/tenants/:tenantSlug/ingestion-mappings",
    async (req, reply) => {
      const ctx = getTenantContext();
      if (!ctx.isSuperAdmin) return reply.code(403).send({ error_class: "forbidden" });
      const { tenantId, userId } = ctx;
      const parsed = PostBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error_class: "validation_failed", details: parsed.error.flatten() });
      }

      const { source_name, adapter_type, adapter_config } = parsed.data;

      if (!getAdapter(adapter_type)) {
        return reply.code(400).send({ error_class: "unknown_adapter_type", detail: adapter_type });
      }

      const configParsed = AdapterConfigSchema.safeParse(adapter_config);
      if (!configParsed.success) {
        return reply.code(400).send({ error_class: "validation_failed", details: configParsed.error.flatten() });
      }

      const result = await withTenantTx(tenantId, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `WITH deactivated AS (
             UPDATE ingestion_mappings
                SET active = false
              WHERE tenant_id = $1 AND source_name = $2 AND active = true
              RETURNING id
           )
           INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
           VALUES ($1, $2, $3, $3, $4::jsonb, '{}'::jsonb, true)
           RETURNING id`,
          [tenantId, source_name, adapter_type, JSON.stringify(configParsed.data)],
        );
        return rows[0]!;
      });

      await auditLog(tenantId, userId, "admin.ingestion_mappings.upsert", {
        id: result.id,
        source_name,
        adapter_type,
      });

      return reply.code(201).send({ id: result.id, source_name, adapter_type });
    },
  );

  app.patch<{ Params: { tenantSlug: string; id: string } }>(
    "/admin/tenants/:tenantSlug/ingestion-mappings/:id",
    async (req, reply) => {
      const ctx = getTenantContext();
      if (!ctx.isSuperAdmin) return reply.code(403).send({ error_class: "forbidden" });
      const { tenantId, userId } = ctx;
      const parsed = PatchBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error_class: "validation_failed", details: parsed.error.flatten() });
      }

      const { active, adapter_config } = parsed.data;

      let validatedConfig: unknown;
      if (adapter_config !== undefined) {
        const v = AdapterConfigSchema.safeParse(adapter_config);
        if (!v.success) {
          return reply.code(400).send({ error_class: "validation_failed", details: v.error.flatten() });
        }
        validatedConfig = v.data;
      }

      await withTenantTx(tenantId, async (c) => {
        const sets: string[] = [];
        const params: unknown[] = [tenantId, req.params.id];
        let p = 3;
        if (active !== undefined) {
          sets.push(`active=$${p++}`);
          params.push(active);
        }
        if (validatedConfig !== undefined) {
          sets.push(`adapter_config=$${p++}::jsonb`);
          params.push(JSON.stringify(validatedConfig));
        }
        if (sets.length === 0) return;
        await c.query(
          `UPDATE ingestion_mappings SET ${sets.join(", ")} WHERE tenant_id=$1 AND id=$2`,
          params,
        );
      });

      await auditLog(tenantId, userId, "admin.ingestion_mappings.update", {
        id: req.params.id,
        active,
      });

      return { ok: true };
    },
  );

  app.delete<{ Params: { tenantSlug: string; id: string } }>(
    "/admin/tenants/:tenantSlug/ingestion-mappings/:id",
    async (req, reply) => {
      const ctx = getTenantContext();
      if (!ctx.isSuperAdmin) return reply.code(403).send({ error_class: "forbidden" });
      const { tenantId, userId } = ctx;
      await withTenantTx(tenantId, async (c) => {
        await c.query(
          `UPDATE ingestion_mappings SET active=false WHERE tenant_id=$1 AND id=$2`,
          [tenantId, req.params.id],
        );
      });
      await auditLog(tenantId, userId, "admin.ingestion_mappings.soft_delete", {
        id: req.params.id,
      });
      return { ok: true };
    },
  );
}
