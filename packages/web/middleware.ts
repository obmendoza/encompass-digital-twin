import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Inline tenant slug extraction (Edge runtime cannot import from @twin/core)
const DEFAULT_TENANT_SLUG = "default";
function getTenantSlugFromPath(pathname: string): string {
  const match = pathname.match(/^\/t\/([a-z0-9][a-z0-9-]{1,30})\//);
  return match?.[1] ?? DEFAULT_TENANT_SLUG;
}

export async function middleware(request: NextRequest) {
  // Resolve tenant from URL and propagate via request headers
  const tenantSlug = getTenantSlugFromPath(request.nextUrl.pathname);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-tenant-slug", tenantSlug);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-tenant-slug", tenantSlug);

  // Skip auth if env vars are not set (local dev without Supabase)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value);
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  // Public paths that don't require auth
  const publicPaths = ["/login", "/auth/callback", "/api/", "/t/"];
  const isPublic = publicPaths.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && request.nextUrl.pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
