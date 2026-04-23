import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  tenantId: string;
  userId: string;
  isSuperAdmin: boolean;
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
