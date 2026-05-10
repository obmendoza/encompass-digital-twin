import { createRemoteJWKSet, jwtVerify } from "jose";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    const supabaseUrl = process.env.SUPABASE_URL;
    if (!supabaseUrl) throw new Error("SUPABASE_URL required for JWT verification");
    jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

export interface VerifiedClaims {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  isSuperAdmin: boolean;
  tenantChangedAt?: string;
  iat: number;
  exp: number;
}

export async function verifyJwt(token: string): Promise<VerifiedClaims> {
  const supabaseUrl = process.env.SUPABASE_URL;
  if (!supabaseUrl) throw new Error("SUPABASE_URL required");

  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: `${supabaseUrl}/auth/v1`,
    audience: "authenticated",
    clockTolerance: 30,
  });

  const appMeta = (payload as Record<string, unknown>).app_metadata as Record<string, unknown> | undefined;
  if (!appMeta?.tenant_id) {
    throw new Error("JWT missing tenant_id in app_metadata");
  }

  return {
    sub: payload.sub!,
    email: ((payload as Record<string, unknown>).email as string) ?? "",
    tenantId: appMeta.tenant_id as string,
    role: (appMeta.role as string) ?? "demo",
    isSuperAdmin: appMeta.is_super_admin === true,
    tenantChangedAt: appMeta.tenant_changed_at as string | undefined,
    iat: payload.iat!,
    exp: payload.exp!,
  };
}

export function extractJwt(req: { headers: Record<string, string | string[] | undefined>; cookies?: Record<string, string | undefined> }): string | null {
  // Authorization header (API clients, direct calls)
  const authHeader = req.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Supabase auth cookie (web clients via Next.js)
  if (req.cookies) {
    for (const [name, value] of Object.entries(req.cookies)) {
      if (name.includes("auth-token") && value) {
        try {
          const parsed = JSON.parse(value);
          if (parsed?.access_token) return parsed.access_token;
        } catch { /* not JSON */ }
        return value;
      }
    }
  }

  return null;
}
