import type { FastifyInstance } from "fastify";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { withDb } from "../db/pool.js";

export function registerApiKeyRoutes(app: FastifyInstance): void {
  // Generate a new API key for a tenant
  app.post<{ Params: { slug: string }; Body: { name: string; rateLimitPerMinute?: number } }>(
    "/tenants/:slug/api-keys",
    async (req, reply) => {
      const { slug } = req.params;
      const { name, rateLimitPerMinute } = req.body as { name: string; rateLimitPerMinute?: number };

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return reply.code(400).send({ error: "name is required" });
      }

      return withDb(async (client) => {
        // Verify tenant exists
        const { rows: tenantRows } = await client.query(
          "SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL",
          [slug],
        );
        if (tenantRows.length === 0) {
          return reply.code(404).send({ error: "Tenant not found" });
        }
        const tenantId = tenantRows[0].id;

        // Generate key: slug_<random hex>
        const rawHex = randomBytes(32).toString("hex");
        const key = `${slug}_${rawHex}`;

        // Hash for storage
        const keyHash = createHash("sha256").update(key).digest("hex");
        const keyPrefix = `${slug}_${rawHex.slice(0, 8)}`;

        const id = randomUUID();
        const rateLimit = rateLimitPerMinute ?? 60;

        await client.query(
          `INSERT INTO tenant_api_keys (id, tenant_id, key_hash, key_prefix, name, rate_limit_per_minute)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, tenantId, keyHash, keyPrefix, name.trim(), rateLimit],
        );

        const { rows } = await client.query(
          "SELECT id, key_prefix, name, rate_limit_per_minute, created_at FROM tenant_api_keys WHERE id = $1",
          [id],
        );

        return reply.code(201).send({
          id: rows[0].id,
          keyPrefix: rows[0].key_prefix,
          key, // plaintext — shown only once
          rateLimitPerMinute: rows[0].rate_limit_per_minute,
          createdAt: rows[0].created_at,
        });
      });
    },
  );

  // List API keys for a tenant (never returns plaintext)
  app.get<{ Params: { slug: string } }>(
    "/tenants/:slug/api-keys",
    async (req, reply) => {
      const { slug } = req.params;

      return withDb(async (client) => {
        const { rows: tenantRows } = await client.query(
          "SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL",
          [slug],
        );
        if (tenantRows.length === 0) {
          return reply.code(404).send({ error: "Tenant not found" });
        }
        const tenantId = tenantRows[0].id;

        const { rows } = await client.query(
          `SELECT id, key_prefix, name, rate_limit_per_minute, created_at, revoked_at
           FROM tenant_api_keys
           WHERE tenant_id = $1
           ORDER BY created_at DESC`,
          [tenantId],
        );

        return rows.map((r) => ({
          id: r.id,
          keyPrefix: r.key_prefix,
          name: r.name,
          rateLimitPerMinute: r.rate_limit_per_minute,
          createdAt: r.created_at,
          revokedAt: r.revoked_at,
        }));
      });
    },
  );

  // Revoke an API key
  app.delete<{ Params: { slug: string; keyId: string } }>(
    "/tenants/:slug/api-keys/:keyId",
    async (req, reply) => {
      const { slug, keyId } = req.params;

      return withDb(async (client) => {
        const { rows: tenantRows } = await client.query(
          "SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL",
          [slug],
        );
        if (tenantRows.length === 0) {
          return reply.code(404).send({ error: "Tenant not found" });
        }
        const tenantId = tenantRows[0].id;

        const { rowCount } = await client.query(
          `UPDATE tenant_api_keys SET revoked_at = NOW()
           WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL`,
          [keyId, tenantId],
        );

        if (rowCount === 0) {
          return reply.code(404).send({ error: "API key not found or already revoked" });
        }

        return { ok: true };
      });
    },
  );
}
