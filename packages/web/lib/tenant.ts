import { headers } from "next/headers";

export function getTenantSlugFromPath(pathname: string): string {
  const match = pathname.match(/^\/t\/([a-z0-9][a-z0-9-]{1,30})\//);
  return match?.[1] ?? "default";
}

export function tenantPath(slug: string, path: string): string {
  if (slug === "default") return path;
  return `/t/${slug}${path}`;
}

/** Read tenant ID from request headers (set by middleware from JWT). Server components only. */
export async function getTenantId(): Promise<string> {
  const h = await headers();
  return h.get("x-user-tenant-id") ?? "";
}

/** Read tenant slug from request headers. Server components only. */
export async function getTenantSlug(): Promise<string> {
  const h = await headers();
  return h.get("x-tenant-slug") ?? "default";
}
