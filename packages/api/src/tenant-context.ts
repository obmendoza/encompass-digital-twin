import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  tenantId: string;
  userId: string;
  isSuperAdmin: boolean;
  /**
   * Server-derived authorization role. Authoritative for any role-gated
   * decision the API makes (e.g., the VA-only gate on
   * predict-conditions /reopen-and-accept). Sourced from JWT
   * `app_metadata.role` on the verified-claims path; from `x-user-role`
   * header only on header-based internal-service-call bypass paths (where
   * the entire request is already trusted). Defaults to "operator" for any
   * non-VA role. Mirrors the DB CHECK on predicted_conditions.acted_role
   * (migration 018).
   */
  role: "operator" | "va";
}

export const tenantStore = new AsyncLocalStorage<TenantContext>();

export function getTenantId(): string {
  const ctx = tenantStore.getStore();
  if (!ctx) throw new Error("No tenant context — cannot proceed without tenant isolation");
  return ctx.tenantId;
}

export function getTenantContext(): TenantContext {
  const ctx = tenantStore.getStore();
  if (!ctx) throw new Error("No tenant context — cannot proceed without tenant isolation");
  return ctx;
}

export function runInTenantContext<T>(ctx: TenantContext, fn: () => T): T {
  return tenantStore.run(ctx, fn);
}
