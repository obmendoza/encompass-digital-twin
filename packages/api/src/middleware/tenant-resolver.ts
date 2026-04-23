import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { tenantStore, type TenantContext } from "../tenant-context.js";
import { DEFAULT_TENANT_ID } from "@twin/core";

export function registerTenantResolver(app: FastifyInstance): void {
  app.addHook("preHandler", async (req: FastifyRequest, _reply: FastifyReply) => {
    const tenantId = (req.headers["x-tenant-id"] as string) ?? DEFAULT_TENANT_ID;
    const userId = (req.headers["x-user-id"] as string) ?? "system";
    const isSuperAdmin = req.headers["x-super-admin"] === "true";
    const ctx: TenantContext = { tenantId, userId, isSuperAdmin };
    tenantStore.enterWith(ctx);
  });
}
