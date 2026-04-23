import { headers } from "next/headers";
import { DEFAULT_TENANT_SLUG } from "@twin/core";

export function getTenantSlugFromPath(pathname: string): string {
  const match = pathname.match(/^\/t\/([a-z0-9][a-z0-9-]{1,30})\//);
  return match?.[1] ?? DEFAULT_TENANT_SLUG;
}

export function tenantPath(slug: string, path: string): string {
  if (slug === DEFAULT_TENANT_SLUG) return path;
  return `/t/${slug}${path}`;
}

/** Read tenant slug from request headers (set by middleware). Server components only. */
export async function getTenantSlug(): Promise<string> {
  const h = await headers();
  return h.get("x-tenant-slug") ?? DEFAULT_TENANT_SLUG;
}
