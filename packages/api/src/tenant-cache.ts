import { isRedisEnabled, getRedisPub } from "./redis.js";
import { withDb } from "./db/pool.js";

const CACHE_TTL = 60; // seconds
const localCache = new Map<string, { value: string; expiresAt: number }>();

function getLocal(key: string): string | null {
  const entry = localCache.get(key);
  if (!entry || entry.expiresAt < Date.now()) { localCache.delete(key); return null; }
  return entry.value;
}

function setLocal(key: string, value: string): void {
  localCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL * 1000 });
}

export async function getTenantIdBySlug(slug: string): Promise<string | null> {
  const localHit = getLocal(`slug:${slug}`);
  if (localHit) return localHit;

  if (isRedisEnabled()) {
    const cached = await getRedisPub().get(`tenant_slug:${slug}`);
    if (cached) { setLocal(`slug:${slug}`, cached); return cached; }
  }

  return withDb(async (client) => {
    const { rows } = await client.query("SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL", [slug]);
    if (rows.length === 0) return null;
    const id = rows[0].id as string;
    setLocal(`slug:${slug}`, id);
    if (isRedisEnabled()) await getRedisPub().setex(`tenant_slug:${slug}`, CACHE_TTL, id);
    return id;
  });
}

export async function getTenantStatus(tenantId: string): Promise<string | null> {
  const localHit = getLocal(`status:${tenantId}`);
  if (localHit) return localHit;

  if (isRedisEnabled()) {
    const cached = await getRedisPub().get(`tenant_status:${tenantId}`);
    if (cached) { setLocal(`status:${tenantId}`, cached); return cached; }
  }

  return withDb(async (client) => {
    const { rows } = await client.query("SELECT status FROM tenants WHERE id = $1", [tenantId]);
    if (rows.length === 0) return null;
    const status = rows[0].status as string;
    setLocal(`status:${tenantId}`, status);
    if (isRedisEnabled()) await getRedisPub().setex(`tenant_status:${tenantId}`, CACHE_TTL, status);
    return status;
  });
}

export async function getTenantType(tenantId: string): Promise<string | null> {
  const localHit = getLocal(`type:${tenantId}`);
  if (localHit) return localHit;

  return withDb(async (client) => {
    const { rows } = await client.query("SELECT type FROM tenants WHERE id = $1", [tenantId]);
    if (rows.length === 0) return null;
    const type = rows[0].type as string;
    setLocal(`type:${tenantId}`, type);
    return type;
  });
}

export async function invalidateTenantCache(slug: string, tenantId: string): Promise<void> {
  localCache.delete(`slug:${slug}`);
  localCache.delete(`status:${tenantId}`);
  localCache.delete(`type:${tenantId}`);
  if (isRedisEnabled()) await getRedisPub().del(`tenant_slug:${slug}`, `tenant_status:${tenantId}`);
}

let demoTenantId: string | null = null;

export async function getDemoTenantId(): Promise<string> {
  if (demoTenantId) return demoTenantId;
  return withDb(async (client) => {
    const { rows } = await client.query("SELECT id FROM tenants WHERE type = 'demo' LIMIT 1");
    if (rows.length === 0) throw new Error("No demo tenant found — run migrations");
    demoTenantId = rows[0].id as string;
    return demoTenantId;
  });
}
