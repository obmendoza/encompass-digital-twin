import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { tenantStore } from "../tenant-context.js";
import { extractJwt, verifyJwt } from "../auth/jwt-verifier.js";
import { getTenantIdBySlug, getTenantStatus, getDemoTenantId } from "../tenant-cache.js";
import { isRedisEnabled, getRedisPub } from "../redis.js";
import { isDbEnabled, withDb } from "../db/pool.js";
import { DEFAULT_TENANT_ID } from "@twin/core";

/** Paths that skip authentication entirely */
const PUBLIC_PATHS = new Set(["/health", "/openapi.json"]);

function isPublicPath(url: string): boolean {
  if (PUBLIC_PATHS.has(url)) return true;
  if (url.startsWith("/api/ingest/")) return true;
  if (url.startsWith("/system/")) return true;
  return false;
}

/** Extract slug from `/t/:slug/...` URLs */
function extractSlug(url: string): string | null {
  const match = url.match(/^\/t\/([^/]+)/);
  return match ? match[1] : null;
}

export function registerJwtTenantResolver(app: FastifyInstance): void {
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for public and ingestion paths
    if (isPublicPath(req.url)) return;

    // ── Dev/test fallback when Supabase is not configured ──
    if (!process.env.SUPABASE_URL) {
      const tenantId = (req.headers["x-tenant-id"] as string) ?? DEFAULT_TENANT_ID;
      const userId = (req.headers["x-user-id"] as string) ?? "dev-user";
      const isSuperAdmin = req.headers["x-super-admin"] === "true";
      tenantStore.enterWith({ tenantId, userId, isSuperAdmin });
      return;
    }

    // ── 1. Extract JWT ──
    const token = extractJwt(req);
    if (!token) {
      // Internal service-to-service calls (web server → API) use header-based auth
      // with an internal secret. This is for server component rendering.
      const internalSecret = process.env.INTERNAL_API_SECRET;
      const reqSecret = req.headers["x-internal-secret"] as string;
      if (internalSecret && reqSecret && internalSecret === reqSecret) {
        const tenantId = (req.headers["x-tenant-id"] as string) ?? "";
        const userId = (req.headers["x-user-id"] as string) ?? "web-server";
        const isSuperAdmin = req.headers["x-super-admin"] === "true";
        if (tenantId) {
          tenantStore.enterWith({ tenantId, userId, isSuperAdmin });
          return;
        }
      }

      // Fallback: allow header-based auth for routes that the web server calls
      // during server-side rendering (transitional — remove when web forwards JWT)
      if (req.headers["x-user-id"]) {
        let tenantId = (req.headers["x-tenant-id"] as string) ?? "";
        const userId = req.headers["x-user-id"] as string;
        const isSuperAdmin = req.headers["x-super-admin"] === "true";

        // If no tenant specified, default to demo tenant
        if (!tenantId) {
          try {
            tenantId = await getDemoTenantId();
            console.log(`[middleware] Demo tenant fallback resolved: ${tenantId}`);
          } catch (e) {
            console.error(`[middleware] getDemoTenantId() failed:`, e);
          }
        }

        if (tenantId) {
          tenantStore.enterWith({ tenantId, userId, isSuperAdmin });
          return;
        }
      }

      reply.status(401).send({ error: "Authentication required" });
      return reply;
    }

    // ── 2. Verify JWT ──
    let claims;
    try {
      claims = await verifyJwt(token);
    } catch {
      reply.status(401).send({ error: "Invalid or expired token" });
      return reply;
    }

    // ── 3. Check token revocation via Redis ──
    if (isRedisEnabled()) {
      try {
        const revoked = await getRedisPub().get(`revoked_users:${claims.sub}`);
        if (revoked) {
          reply.status(401).send({ error: "Token revoked" });
          return reply;
        }
      } catch {
        // Redis failure is non-fatal — log and continue
      }
    }

    // ── 4. Check tenant_changed_at vs iat ──
    if (claims.tenantChangedAt) {
      const changedAtTs = Math.floor(new Date(claims.tenantChangedAt).getTime() / 1000);
      if (claims.iat < changedAtTs) {
        reply.status(401).send({ error: "Tenant assignment changed — re-authenticate" });
        return reply;
      }
    }

    // ── 5. Resolve effective tenant ──
    let effectiveTenantId = claims.tenantId;
    const slug = extractSlug(req.url);

    if (slug) {
      const slugTenantId = await getTenantIdBySlug(slug);
      if (!slugTenantId) {
        reply.status(404).send({ error: "Not found" });
        return reply;
      }

      if (claims.isSuperAdmin) {
        // Super admin can access any tenant via slug
        effectiveTenantId = slugTenantId;
      } else if (slugTenantId !== claims.tenantId) {
        // Regular user accessing a different tenant's slug → 404 (no enumeration)
        reply.status(404).send({ error: "Not found" });
        return reply;
      }
    }

    // ── 6. Check tenant status ──
    if (isDbEnabled()) {
      const status = await getTenantStatus(effectiveTenantId);
      if (status === "archived") {
        reply.status(404).send({ error: "Not found" });
        return reply;
      }
      if (status === "suspended" && req.method !== "GET") {
        reply.status(403).send({ error: "Tenant suspended — read-only access" });
        return reply;
      }
    }

    // ── 7. Log cross-tenant access for super_admin ──
    if (claims.isSuperAdmin && effectiveTenantId !== claims.tenantId && isDbEnabled()) {
      withDb(async (client) => {
        await client.query(
          `INSERT INTO tenant_audit_log (tenant_id, actor_id, action, detail)
           VALUES ($1, $2, $3, $4)`,
          [effectiveTenantId, claims.sub, "cross_tenant_access", JSON.stringify({
            from: claims.tenantId,
            to: effectiveTenantId,
            path: req.url,
            method: req.method,
          })],
        );
      }).catch(() => {
        // Audit log failure is non-fatal
      });
    }

    // ── 8. Set AsyncLocalStorage context ──
    tenantStore.enterWith({
      tenantId: effectiveTenantId,
      userId: claims.sub,
      isSuperAdmin: claims.isSuperAdmin,
    });
  });
}
