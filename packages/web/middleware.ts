import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const response = NextResponse.next({ request: { headers: requestHeaders } });

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

  // Extract tenant info from JWT app_metadata (rendering-only — API verifies JWT independently)
  const appMeta = user?.app_metadata ?? {};
  const tenantId = appMeta.tenant_id ?? "";
  const role = appMeta.role ?? "demo";
  const isSuperAdmin = appMeta.is_super_admin === true;

  requestHeaders.set("x-user-tenant-id", tenantId);
  requestHeaders.set("x-user-role", role);
  requestHeaders.set("x-is-super-admin", String(isSuperAdmin));

  // Enforce /platform/* access for super_admin only
  if (request.nextUrl.pathname.startsWith("/platform/") && !isSuperAdmin) {
    return NextResponse.redirect(new URL("/", request.url));
  }

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
