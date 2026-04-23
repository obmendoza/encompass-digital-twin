import { createHash } from "node:crypto";
import { withDb } from "../db/pool.js";
import { isRedisEnabled, getRedisPub } from "../redis.js";
import type { FastifyRequest, FastifyReply } from "fastify";

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export interface ApiKeyInfo { tenantId: string; keyId: string; rateLimitPerMinute: number; }

export async function validateApiKey(key: string): Promise<ApiKeyInfo | null> {
  const hash = hashKey(key);
  const prefix = key.slice(0, 8);
  return withDb(async (client) => {
    const { rows } = await client.query(
      `SELECT k.id, k.tenant_id, k.rate_limit_per_minute, t.status
       FROM tenant_api_keys k JOIN tenants t ON t.id = k.tenant_id
       WHERE k.key_prefix = $1 AND k.key_hash = $2
       AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > NOW())`,
      [prefix, hash]
    );
    if (rows.length === 0) return null;
    if (rows[0].status !== "active") return null;
    return { tenantId: rows[0].tenant_id, keyId: rows[0].id, rateLimitPerMinute: rows[0].rate_limit_per_minute };
  });
}

export async function checkRateLimit(keyPrefix: string, limitPerMinute: number): Promise<boolean> {
  if (!isRedisEnabled()) return true;
  const redis = getRedisPub();
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `ratelimit:${keyPrefix}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 120);
  return count <= limitPerMinute;
}

export async function apiKeyAuthHook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return reply.code(401).send({ error: "Missing API key" });
  const key = authHeader.slice(7);
  const info = await validateApiKey(key);
  if (!info) return reply.code(401).send({ error: "Invalid or expired API key" });
  const allowed = await checkRateLimit(key.slice(0, 8), info.rateLimitPerMinute);
  if (!allowed) { reply.header("Retry-After", "60"); return reply.code(429).send({ error: "Rate limit exceeded" }); }
  (req as unknown as Record<string, unknown>).tenantId = info.tenantId;
  (req as unknown as Record<string, unknown>).apiKeyId = info.keyId;
}
