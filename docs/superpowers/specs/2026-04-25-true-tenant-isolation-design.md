# True Tenant Isolation — Design Spec (v2)

> **Goal:** Replace the cosmetic tenant-switching UI with real data isolation enforced by JWT verification at every layer. The API verifies JWTs directly — no trusted headers, no confused-deputy vulnerability. Regular users are automatically scoped to their tenant. Super admin retains cross-tenant access via explicit `/t/:slug/` URLs.

> **Architecture:** JWT `app_metadata.tenant_id` is the single source of truth. The **API tier verifies the JWT signature itself** using Supabase JWKS — it never trusts derived headers from the web tier. AsyncLocalStorage propagates the verified tenant context. API routes filter all data by `getTenantId()`. RLS on all tenant-scoped tables provides defense-in-depth. Demo tenant (real UUID, not nil) loads fixtures ephemerally. Production tenants load lazily from Postgres on first access. Single-replica deployment for v1 with documented path to Postgres-as-truth.

> **Tech Stack:** Existing stack + `jose` (JWT verification library). Changes span middleware, API route filtering, boot sequence, auth, and RLS policies.

---

## 1. Tenant Types & Lifecycle

### 1.1 Schema Changes

```sql
-- Add type and lifecycle columns
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'production'
  CHECK (type IN ('demo', 'production'));

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en-US';

-- Status already exists from Spec A: 'onboarding' | 'active' | 'suspended' | 'offboarding'
-- Add 'archived' for post-offboarding retention
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('onboarding', 'active', 'suspended', 'offboarding', 'archived'));
```

### 1.2 Two Tenant Types

| Type | Purpose | Data Source | Persistence |
|------|---------|------------|-------------|
| `demo` | Platform demos, internal testing | `@twin/fixtures` loaded on boot | Never saved to Postgres |
| `production` | Real lender tenants | Postgres only | Always saved to Postgres |

### 1.3 Demo Tenant

The current "Default Tenant" is migrated to a **real UUID** (not nil UUID — nil UUID creates default-coercion and test-fixture risks):

```sql
-- Migration: create demo tenant with a real UUID
-- The old nil-UUID row is renamed and re-IDed
DO $$ 
DECLARE
  new_demo_id UUID := gen_random_uuid();
BEGIN
  -- Update the existing default tenant
  UPDATE tenants
  SET id = new_demo_id, name = 'Demo Tenant', slug = 'demo', type = 'demo'
  WHERE slug = 'default';

  -- Update all references
  UPDATE world_state SET tenant_id = new_demo_id WHERE tenant_id = '00000000-0000-0000-0000-000000000000';
  UPDATE action_log SET tenant_id = new_demo_id WHERE tenant_id = '00000000-0000-0000-0000-000000000000';
  UPDATE decision_records SET tenant_id = new_demo_id WHERE tenant_id = '00000000-0000-0000-0000-000000000000';
  UPDATE detected_patterns SET tenant_id = new_demo_id WHERE tenant_id = '00000000-0000-0000-0000-000000000000';

  -- Store the demo tenant ID for application lookup
  -- Application reads: SELECT id FROM tenants WHERE type = 'demo' LIMIT 1
END $$;

-- Redirect old slug
-- Application: if slug === 'default', redirect to 'demo' for 90 days
```

**Application resolves demo tenant ID at boot:**
```typescript
// On startup, query once:
const { rows } = await client.query("SELECT id FROM tenants WHERE type = 'demo' LIMIT 1");
const DEMO_TENANT_ID = rows[0]?.id;
// Store in a module-level constant — never hardcode a UUID
```

### 1.4 Tenant Lifecycle States

| Status | Ingestion | User Login | Writes | Reads | Data |
|--------|-----------|-----------|--------|-------|------|
| `onboarding` | Rejected | Admin only | Allowed (config) | Allowed | Writable |
| `active` | Accepted | All roles | Allowed | Allowed | Writable |
| `suspended` | Rejected | Admin only (read-only banner) | Blocked | Allowed (export) | Read-only |
| `offboarding` | Rejected | Admin only | Blocked | Allowed (export) | Pending deletion |
| `archived` | Rejected | Blocked | Blocked | Blocked | Retained per policy, then purged |

Middleware checks `tenants.status` on every request — not just at JWT issue time. Cached in Redis with 60s TTL, invalidated on status change.

### 1.5 Pre-Seeded Demo Users

| Email | Role | Purpose |
|-------|------|---------|
| `demo@platform.com` | demo | Read-only explorer |
| `va@platform.com` | va | Demonstrate VA workflow |
| `uw@platform.com` | uw | Demonstrate UW decisions |
| `admin@platform.com` | admin | Demonstrate admin features |

All bound to the demo tenant's UUID in `app_metadata.tenant_id`.

---

## 2. User-Tenant Binding & JWT Verification

### 2.1 JWT as Source of Truth

Every user has `tenant_id` in their Supabase `app_metadata`:

```json
{
  "app_metadata": {
    "tenant_id": "94aa0139-a5c5-4b75-a0bd-e72b8f69eeb6",
    "role": "uw",
    "is_super_admin": false,
    "tenant_changed_at": "2026-04-25T00:00:00Z"
  }
}
```

- Set at user creation, immutable except by super_admin
- `tenant_changed_at` updated whenever super_admin modifies a user's tenant — used for token revocation

### 2.2 User Types

| User Type | Tenant Binding | URL Pattern |
|-----------|---------------|-------------|
| Regular (va, uw, admin, compliance_officer) | Locked to one tenant | `/uw`, `/metrics` (clean URLs) |
| Super admin | Own tenant + cross-tenant via URL | `/t/quickel/uw`, `/platform/tenants` |
| Demo users | Locked to demo tenant | `/uw`, `/metrics` (demo data) |

### 2.3 JWT Verification (API Tier)

**The API verifies every JWT itself. It never trusts headers from the web tier.**

```typescript
// packages/api/src/auth/jwt-verifier.ts

import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS_URL = `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
const jwks = createRemoteJWKSet(new URL(JWKS_URL));

interface VerifiedClaims {
  sub: string;           // user ID
  email: string;
  tenantId: string;
  role: string;
  isSuperAdmin: boolean;
  tenantChangedAt?: string;
  iat: number;
  exp: number;
}

export async function verifyJwt(token: string): Promise<VerifiedClaims> {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `${process.env.SUPABASE_URL}/auth/v1`,
    audience: "authenticated",
    clockTolerance: 30,  // 30 seconds clock skew tolerance
  });

  const appMeta = (payload as Record<string, unknown>).app_metadata as Record<string, unknown> | undefined;
  if (!appMeta?.tenant_id) {
    throw new Error("JWT missing tenant_id in app_metadata");
  }

  return {
    sub: payload.sub!,
    email: (payload as Record<string, unknown>).email as string,
    tenantId: appMeta.tenant_id as string,
    role: (appMeta.role as string) ?? "demo",
    isSuperAdmin: appMeta.is_super_admin === true,
    tenantChangedAt: appMeta.tenant_changed_at as string | undefined,
    iat: payload.iat!,
    exp: payload.exp!,
  };
}
```

**Failure modes:**
- Invalid signature → 401 Unauthorized
- Expired token → 401 Unauthorized
- Missing `tenant_id` → 401 Unauthorized
- Clock skew > 30s → 401 Unauthorized
- No fallback to headers — 401 is the only response

**Library:** `jose` (zero-dependency, Edge-compatible, handles JWKS rotation automatically)

### 2.4 Token Revocation

JWTs are stateless — a user retains access until token expiry. When super_admin changes a user's tenant or revokes access:

**Revocation set in Redis:**
```
Key: revoked_users:{userId}
Value: timestamp of revocation
TTL: 24 hours (longer than max token lifetime)
```

**Middleware check on every request:**
```typescript
const revocationTime = await redis.get(`revoked_users:${claims.sub}`);
if (revocationTime && claims.iat < Number(revocationTime)) {
  return reply.code(401).send({ error: "Token revoked — please re-authenticate" });
}
```

**`tenant_changed_at` check:**
```typescript
if (claims.tenantChangedAt && claims.iat < new Date(claims.tenantChangedAt).getTime() / 1000) {
  return reply.code(401).send({ error: "Tenant assignment changed — please re-authenticate" });
}
```

**SLA:** Tenant changes take effect within 15 minutes worst case (Supabase access token lifetime), immediately on refresh.

### 2.5 Enforcement

- Regular user CANNOT access another tenant's data — 404 at middleware level (not 403, to prevent slug enumeration)
- A regular user visiting `/t/other-slug/` gets **404 Not Found** (regardless of whether slug exists)
- Super admin visiting `/t/:slug/` gets 404 only if slug doesn't exist
- No header spoofing possible — API reads tenant from verified JWT, never from `x-tenant-id`

---

## 3. API Middleware — JWT-First Resolution

### 3.1 Fastify Middleware (API Tier)

```typescript
// packages/api/src/middleware/jwt-tenant-resolver.ts

import { verifyJwt } from "../auth/jwt-verifier.js";
import { tenantStore } from "../tenant-context.js";
import { getTenantStatus, getTenantIdBySlug } from "../tenant-cache.js";

fastify.addHook("preHandler", async (req, reply) => {
  // Path 1: API key auth (external ingestion) — already handled by apiKeyAuthHook
  if (req.headers.authorization?.startsWith("Bearer ") && req.url.startsWith("/api/ingest/")) {
    return; // apiKeyAuthHook handles this path
  }

  // Path 2: JWT auth (web → API, or direct API calls)
  const token = extractJwt(req); // from Authorization header or cookie
  if (!token) {
    // Public endpoints (health, openapi) — no tenant context
    if (isPublicEndpoint(req.url)) return;
    return reply.code(401).send({ error: "Authentication required" });
  }

  let claims;
  try {
    claims = await verifyJwt(token);
  } catch (e) {
    return reply.code(401).send({ error: "Invalid or expired token" });
  }

  // Check token revocation
  const revoked = await checkRevocation(claims.sub, claims.iat);
  if (revoked) {
    return reply.code(401).send({ error: "Token revoked — please re-authenticate" });
  }

  // Resolve tenant
  let tenantId = claims.tenantId;

  // Super admin URL override: /t/:slug/ → resolve slug to tenant_id
  const slugMatch = req.url.match(/^\/t\/([a-z0-9][a-z0-9-]*)\//);
  if (slugMatch) {
    if (!claims.isSuperAdmin) {
      // Regular user — only allowed if slug matches their tenant
      const slugTenantId = await getTenantIdBySlug(slugMatch[1]);
      if (slugTenantId !== claims.tenantId) {
        return reply.code(404).send({ error: "Not found" }); // 404, not 403
      }
    } else {
      // Super admin — resolve slug to tenant_id
      const slugTenantId = await getTenantIdBySlug(slugMatch[1]);
      if (!slugTenantId) {
        return reply.code(404).send({ error: "Tenant not found" });
      }
      tenantId = slugTenantId;

      // Log cross-tenant access
      await logCrossTenantAccess(claims, slugMatch[1], tenantId, req);
    }
  }

  // Check tenant status
  const status = await getTenantStatus(tenantId);
  if (status === "archived") {
    return reply.code(403).send({ error: "Tenant is archived" });
  }
  if (status === "suspended" && req.method !== "GET") {
    return reply.code(403).send({ error: "Tenant is suspended — read-only access" });
  }

  // Set tenant context in AsyncLocalStorage
  tenantStore.enterWith({
    tenantId,
    userId: claims.sub,
    isSuperAdmin: claims.isSuperAdmin,
  });
});
```

### 3.2 Web Middleware (Next.js)

The web middleware forwards the JWT to the API — it does NOT set derived headers like `x-tenant-id`:

```typescript
// middleware.ts — simplified
const supabase = createServerClient(...);
const { data: { user } } = await supabase.auth.getUser();

if (!user && !isPublicPath) redirect("/login");

// Extract tenant from JWT for server component rendering
const appMeta = user?.app_metadata ?? {};
const tenantId = appMeta.tenant_id;
const role = appMeta.role ?? "demo";
const isSuperAdmin = appMeta.is_super_admin === true;

// Set on request headers for server components to read
// These are ONLY used for UI rendering decisions, NOT for data access
// The API verifies JWT independently
const requestHeaders = new Headers(request.headers);
requestHeaders.set("x-user-tenant-id", tenantId ?? "");
requestHeaders.set("x-user-role", role);
requestHeaders.set("x-is-super-admin", String(isSuperAdmin));

const response = NextResponse.next({ request: { headers: requestHeaders } });
```

**Critical distinction:** Web middleware headers are for **UI rendering only** (show/hide buttons, menu items). The API **never reads these headers** — it verifies the JWT itself.

### 3.3 Tenant Context for Background Workers

Workers (SLA monitor, learning engine, pattern detection) don't have HTTP requests. They must explicitly set tenant context:

```typescript
// In the worker loop:
for (const tenant of activeTenants) {
  await tenantStore.run(
    { tenantId: tenant.id, userId: "system-worker", isSuperAdmin: false },
    async () => {
      // All getTenantId() calls inside here return tenant.id
      await processPatternDetection();
      await computeMetricsSnapshot();
    }
  );
}
```

This is mandatory. Without it, workers see all tenants' data or fail with `getTenantId() throws`.

### 3.4 Tenant Cache (Slug → ID + Status)

```typescript
// packages/api/src/tenant-cache.ts

import { getRedisPub } from "./redis.js";
import { withDb } from "./db/pool.js";

const CACHE_TTL = 60; // seconds

export async function getTenantIdBySlug(slug: string): Promise<string | null> {
  const redis = getRedisPub();
  const cached = await redis.get(`tenant_slug:${slug}`);
  if (cached) return cached;

  return withDb(async (client) => {
    const { rows } = await client.query(
      "SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL", [slug]
    );
    if (rows.length === 0) return null;
    await redis.setex(`tenant_slug:${slug}`, CACHE_TTL, rows[0].id);
    return rows[0].id;
  });
}

export async function getTenantStatus(tenantId: string): Promise<string | null> {
  const redis = getRedisPub();
  const cached = await redis.get(`tenant_status:${tenantId}`);
  if (cached) return cached;

  return withDb(async (client) => {
    const { rows } = await client.query("SELECT status FROM tenants WHERE id = $1", [tenantId]);
    if (rows.length === 0) return null;
    await redis.setex(`tenant_status:${tenantId}`, CACHE_TTL, rows[0].status);
    return rows[0].status;
  });
}

// Call on tenant create/update/suspend to invalidate cache
export async function invalidateTenantCache(slug: string, tenantId: string): Promise<void> {
  const redis = getRedisPub();
  await redis.del(`tenant_slug:${slug}`, `tenant_status:${tenantId}`);
}
```

### 3.5 What Gets Removed

- `TenantSwitcher.tsx` component
- `/api/tenants` proxy route (was only for the switcher)
- `x-tenant-slug` header as tenant resolver
- `x-tenant-id` header as trusted input to the API
- Hardcoded `DEFAULT_TENANT_ID` constant (replaced by runtime lookup)
- `getTenantSlugFromPath()` as tenant resolver in API middleware

---

## 4. API-Layer Tenant Filtering

### 4.1 Filter Helpers

```typescript
function getLoansForTenant(store: Store, tenantId: string): Loan[] {
  return Object.values(store.getState().loans)
    .filter(loan => loan.tenantId === tenantId);
}

function getLoanForTenant(store: Store, loanId: string, tenantId: string): Loan | null {
  const loan = store.getLoan(loanId);
  if (!loan || loan.tenantId !== tenantId) return null;
  return loan;
}
```

### 4.2 Routes That Need Filtering

Every route handler that reads or writes loan data calls `getTenantId()` and filters:

| Route Module | Endpoints | Filter |
|-------------|-----------|--------|
| `loans.ts` | `GET /loans`, `GET /loans/:id` | `getLoansForTenant()`, `getLoanForTenant()` |
| `conditions.ts` | All condition CRUD | Verify loan ownership |
| `documents.ts` | All document CRUD | Verify loan ownership |
| `recommendation.ts` | Agent step, stage, accept, clear | Verify loan ownership |
| `uw-flow.ts` | Override, send-back | Verify loan ownership |
| `assignment.ts` | Assign, update, unassign, list | Filter by tenant |
| `uploads.ts` | File upload | Verify loan ownership |
| `metrics.ts` | `GET /metrics` | Aggregate only tenant's loans |
| `system-check.ts` | Health, integrity, behavioral | Scope to tenant |
| `world.ts` | Load scenario, reset | Demo tenant only |

### 4.3 Write Operation Enforcement

```typescript
// In the reducer or dispatch wrapper:
if (action.type === "InjectLoan") {
  if (!action.loan.tenantId) {
    throw new Error("InjectLoan requires tenantId on the loan object");
  }
  const currentTenant = getTenantId();
  if (action.loan.tenantId !== currentTenant) {
    throw new Error("Cannot inject loan into a different tenant");
  }
}
```

This is enforcement, not a comment. Tests verify: dispatching `InjectLoan` with mismatched tenant → throws.

### 4.4 Super Admin Override

When `isSuperAdmin` is true AND the request comes via `/t/:slug/`, the middleware resolves the slug's tenant_id and sets it in AsyncLocalStorage. The filter helpers don't need special super_admin logic — they filter by whatever `getTenantId()` returns.

### 4.5 Database RLS as Defense-in-Depth

Application-layer filtering is the primary control. RLS is the backstop — if a bug in `getLoansForTenant()` or a missed filter call occurs, the database still blocks cross-tenant reads.

```sql
-- Ensure RLS is enforced even for table owner
ALTER TABLE world_state FORCE ROW LEVEL SECURITY;
ALTER TABLE decision_records FORCE ROW LEVEL SECURITY;
ALTER TABLE detected_patterns FORCE ROW LEVEL SECURITY;
ALTER TABLE pattern_suggestions FORCE ROW LEVEL SECURITY;
ALTER TABLE metrics_snapshots FORCE ROW LEVEL SECURITY;

-- Policies use SET LOCAL app.current_tenant (set by withTenantTx)
-- WITH CHECK ensures writes also respect tenant isolation
CREATE POLICY tenant_rw ON world_state
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

The middleware sets `SET LOCAL app.current_tenant` at the start of every transaction (after JWT verification). Even if application code is buggy, the database returns nothing.

---

## 5. URL Routing & Access Control

### 5.1 Regular Users — Clean URLs

```
/              → Pipeline (own tenant's loans only)
/uw            → UW Queue (own tenant only)
/va            → VA Dashboard (own tenant only)
/metrics       → Metrics (own tenant only)
/loan/QL-123   → Loan detail (verified ownership, 404 if wrong tenant)
/admin         → Tenant admin
```

### 5.2 Super Admin

```
/              → Pipeline for own tenant (demo)
/t/quickel/    → Quicken Loans pipeline
/t/quickel/uw  → Quicken Loans UW Queue
/platform/tenants → Cross-tenant management
```

### 5.3 Access Control — Always 404 for Non-Super-Admin

| URL Pattern | Regular User (own) | Regular User (other) | Super Admin |
|-------------|-------------------|---------------------|-------------|
| `/uw` | 200 (own data) | N/A | 200 (own data) |
| `/t/:slug/` (own) | 200 | — | 200 |
| `/t/:slug/` (other) | **404 Not Found** | **404 Not Found** | 200 |
| `/platform/*` | **404 Not Found** | **404 Not Found** | 200 |
| `/loan/:id` (own) | 200 | — | 200 |
| `/loan/:id` (other) | **404 Not Found** | — | Must use `/t/:slug/` |

All non-super-admin access to other tenants returns **404** (not 403) to prevent tenant slug enumeration.

### 5.4 Slug Validation

- Lowercase canonical: `/t/Quickel/` → redirect to `/t/quickel/`
- Reserved slugs validated at creation (already implemented in Zod schema)
- Old `default` slug: 301 redirect to `demo` for 90 days post-migration

---

## 6. Boot Sequence & Data Loading

### 6.1 Server Startup — Lazy Loading

```
1. Connect to Postgres, run migrations
2. Connect to Redis
3. Load tenant list from Postgres (lightweight: id, slug, type, status only)
4. Resolve DEMO_TENANT_ID: SELECT id FROM tenants WHERE type = 'demo'
5. Load demo tenant fixtures from @twin/fixtures
   → Tag each loan with tenantId = DEMO_TENANT_ID
   → Store in memory (do NOT persist)
6. Production tenants: DO NOT load on boot (lazy load on first request)
7. Start SLA monitor, learning worker
8. Start listening
```

**Lazy loading for production tenants:**
```typescript
// On first request for a production tenant:
if (!store.hasTenantLoaded(tenantId)) {
  const saved = await persistence.loadState(tenantId);
  if (saved) {
    for (const loan of Object.values(saved.loans)) {
      store.dispatch({ type: "InjectLoan", loan: { ...loan, tenantId } });
    }
  }
  store.markTenantLoaded(tenantId);
}
```

This prevents boot time growing linearly with tenant count. Memory grows only for active tenants.

### 6.2 Deployment Model (v1)

**Single-replica deployment.** Documented explicitly:

- One Fastify API instance handles all requests
- In-memory store is consistent (single writer)
- No replica divergence possible
- Postgres is the persistence layer for production tenants
- Redis is used for cache, pub/sub, rate limiting — not for state

**Path to multi-replica (v2):**
- Postgres becomes source of truth for all reads
- In-memory store demoted to read-through cache with Redis invalidation
- This is a separate spec when tenant count exceeds single-replica capacity

### 6.3 Dispatch Wrapper — Rewritten with Explicit Error Handling

```typescript
const tenantTypeCache = new Map<string, string>(); // populated from DB, invalidated on change

(store as any).dispatch = (action) => {
  const result = _dispatch(action);

  // Resolve tenant for this action
  let tenantId: string | undefined;
  let loan: Loan | undefined;

  if ("loanId" in action && action.loanId) {
    loan = result.loans[action.loanId];
    tenantId = loan?.tenantId;
  } else if (action.type === "InjectLoan") {
    tenantId = action.loan.tenantId;
  } else if (action.type === "LoadScenario") {
    tenantId = DEMO_TENANT_ID; // scenarios only load into demo
  } else if (action.type === "ResetWorld") {
    // Clear demo tenant loans, reload fixtures
    resetDemoTenant(store);
    return result;
  }

  if (!tenantId) return result; // actions without tenant context (shouldn't happen in production)

  const tenantType = tenantTypeCache.get(tenantId) ?? "production";

  // Persist (production only)
  if (tenantType === "production") {
    persistence.saveState(result, tenantId).catch((e) => {
      console.error(`[persistence] FAILED for tenant ${tenantId}:`, e);
      // TODO: retry queue / DLQ for persistence failures
    });
  }

  // Publish event (both types)
  publishAction(tenantId, action).catch((e) => {
    console.error(`[event-bus] FAILED for tenant ${tenantId}:`, e);
  });

  // Decision record (both types — demo tagged for filtering)
  if (action.type === "AcceptRecommendation" || action.type === "OverrideDecision" || action.type === "SetDecision") {
    if (loan) {
      writeDecisionRecord({ tenantId, loanId: action.loanId, loan, action })
        .catch((e) => console.error(`[decision-writer] FAILED:`, e));
    }
  }

  return result;
};
```

**Key improvements over v1:**
- Explicit tenant resolution per action type (not just `loan?.tenantId`)
- `ResetWorld` handled explicitly (demo only)
- `LoadScenario` scoped to demo tenant
- Errors logged with tenant context (not swallowed silently)
- Tenant type cached with invalidation

### 6.4 Reset Demo

`POST /system/reset-demo` (super_admin only):
- Clears all demo tenant loans from in-memory store
- Reloads fixtures from `@twin/fixtures` with `tenantId = DEMO_TENANT_ID`
- Does NOT touch Postgres or other tenants
- Best-effort: concurrent demo users may see 404 on stale loan references (acceptable for demo)

---

## 7. Audit Logging

### 7.1 Tenant Audit Log Schema

```sql
CREATE TABLE IF NOT EXISTS tenant_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL,
  actor_tenant_id UUID NOT NULL,
  target_tenant_id UUID NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  request_method TEXT,
  request_path TEXT,
  request_ip INET,
  user_agent TEXT,
  jwt_iat TIMESTAMPTZ,
  metadata JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Append-only enforcement
CREATE RULE no_update_audit AS ON UPDATE TO tenant_audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit AS ON DELETE TO tenant_audit_log DO INSTEAD NOTHING;

CREATE INDEX idx_audit_actor_time ON tenant_audit_log(actor_user_id, occurred_at DESC);
CREATE INDEX idx_audit_target_time ON tenant_audit_log(target_tenant_id, occurred_at DESC);
```

**Retention:** 7 years (ECOA 25 months minimum, state mortgage record-keeping laws up to 7 years).

**What gets logged:**
- Every super_admin cross-tenant access (read or write)
- User tenant_id changes (before/after in metadata)
- Tenant status changes (activate, suspend, archive)
- API key creation/revocation
- Guideline version changes

---

## 8. Migration Plan

### 8.1 Feature Flag — Phased Rollout

```
Phase 1 (shadow mode):
  - JWT verification runs but logs mismatches instead of rejecting
  - Old header-based resolution continues as primary
  - Both paths run — log when they disagree
  - Duration: 1 week

Phase 2 (cutover):
  - JWT verification becomes authoritative
  - Header-based resolution removed
  - TenantSwitcher removed from UI
  - Feature flag: tenant_isolation_v2 = true

Rollback:
  - Set tenant_isolation_v2 = false
  - Reverts to header-based resolution
  - TenantSwitcher re-appears
  - Time to rollback: < 1 minute (env var change)
```

### 8.2 Database Migration (008)

```sql
-- 1. Add type column
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'production'
  CHECK (type IN ('demo', 'production'));

-- 2. Migrate Default Tenant to Demo Tenant with real UUID
DO $$ 
DECLARE
  new_demo_id UUID := gen_random_uuid();
BEGIN
  UPDATE tenants SET id = new_demo_id, name = 'Demo Tenant', slug = 'demo', type = 'demo'
  WHERE slug = 'default';
  UPDATE world_state SET tenant_id = new_demo_id WHERE tenant_id = '00000000-0000-0000-0000-000000000000';
  UPDATE action_log SET tenant_id = new_demo_id WHERE tenant_id = '00000000-0000-0000-0000-000000000000';
  UPDATE decision_records SET tenant_id = new_demo_id WHERE tenant_id = '00000000-0000-0000-0000-000000000000';
  UPDATE detected_patterns SET tenant_id = new_demo_id WHERE tenant_id = '00000000-0000-0000-0000-000000000000';
END $$;

-- 3. Add timezone/locale
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/New_York';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en-US';

-- 4. Add archived to status check
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_status_check
  CHECK (status IN ('onboarding', 'active', 'suspended', 'offboarding', 'archived'));

-- 5. Force RLS on all tenant-scoped tables
ALTER TABLE world_state FORCE ROW LEVEL SECURITY;
ALTER TABLE decision_records FORCE ROW LEVEL SECURITY;
ALTER TABLE detected_patterns FORCE ROW LEVEL SECURITY;
ALTER TABLE pattern_suggestions FORCE ROW LEVEL SECURITY;
ALTER TABLE metrics_snapshots FORCE ROW LEVEL SECURITY;
```

### 8.3 Code Changes Summary

| File | Change |
|------|--------|
| **New:** `packages/api/src/auth/jwt-verifier.ts` | JWT verification via JWKS |
| **New:** `packages/api/src/tenant-cache.ts` | Redis-cached slug→ID + status lookup |
| **Rewrite:** `packages/api/src/middleware/tenant-resolver.ts` | JWT-first resolution, drop header trust |
| **Modify:** `packages/api/src/server.ts` | Boot: lazy load, demo fixtures, dispatch wrapper rewrite |
| **Modify:** All route files in `packages/api/src/routes/` | Add tenant filtering |
| **Modify:** `packages/web/middleware.ts` | Forward JWT, set rendering-only headers |
| **Modify:** `packages/web/lib/auth.ts` | Read tenantId from JWT app_metadata |
| **Delete:** `packages/web/components/encompass/TenantSwitcher.tsx` | No longer needed |
| **Delete:** `packages/web/app/api/tenants/route.ts` | Proxy for deleted switcher |
| **Add:** `packages/api/package.json` | Add `jose` dependency |

### 8.4 What Gets Deleted

- `TenantSwitcher.tsx`
- `/api/tenants` proxy route
- `x-tenant-id` / `x-tenant-slug` header trust in API middleware
- `x-is-super-admin` header trust in API middleware
- Hardcoded `DEFAULT_TENANT_ID` / nil UUID references
- `getTenantSlugFromPath()` as tenant resolver in API

---

## 9. Testing Strategy

### 9.1 Tenant Isolation Tests

```
- Demo user GET /loans → sees only demo tenant's 20 fixture loans
- Quicken Loans UW GET /loans → sees only quickel's ingested loans
- Quicken Loans UW GET /loans/:id for demo loan → 404 Not Found
- Quicken Loans UW POST /loans/:id/decision on demo loan → 404
- Super admin GET /loans → sees own tenant (demo) loans
- Super admin GET /t/quickel/loans → sees quickel loans
```

### 9.2 URL Access Tests

```
- Regular user at /uw → 200, sees own tenant data
- Regular user at /t/own-slug/uw → 200, allowed
- Regular user at /t/other-slug/uw → 404 (not 403)
- Regular user at /platform/tenants → 404 (not 403)
- Super admin at /t/quickel/uw → 200
- Super admin at /platform/tenants → 200
```

### 9.3 Boot & Data Tests

```
- Boot: demo tenant has exactly 20 fixture loans
- Boot: production tenants have zero loans until first request (lazy load)
- First request for production tenant → loads from Postgres
- Dispatch on demo loan → NOT persisted to Postgres
- Dispatch on production loan → persisted to Postgres
- Reset demo → fixtures reloaded, production unaffected
```

### 9.4 Auth Tests

```
- No JWT → 401
- Invalid JWT signature → 401
- Expired JWT → 401
- JWT missing tenant_id → 401
- Valid JWT → tenant resolved correctly
- Revoked user (Redis set) → 401
- tenant_changed_at newer than JWT iat → 401
```

### 9.5 Adversarial Tests

```
- Direct API call with spoofed x-tenant-id header → ignored (JWT used instead)
- Direct API call with x-is-super-admin: true header → ignored
- JWT signed with wrong key → 401
- JWT replay: token from tenant A used after user moved to tenant B → 401 (revocation)
- SQL injection on slug parameter → sanitized by regex validation
- Path traversal /t/../platform/ → 404 (middleware rejects)
- WebSocket: send tenant_id for another tenant in payload → rejected at broker
- Concurrent demo reset + dispatch → best-effort 404 on stale references
```

### 9.6 Observability Counters

```
tenant.cross_access.count{actor_role, target_tenant}   — super_admin cross-tenant access
tenant.access_denied.count{reason, tenant_id}           — 404 by reason (wrong tenant, not found)
tenant.dispatch.persistence_failed.count{tenant_id}     — persistence errors
tenant.jwt_verification.failed.count{reason}            — JWT failures by type
tenant.in_memory_loans.gauge{tenant_id}                 — capacity planning
tenant.lazy_load.duration_ms{tenant_id}                 — first-request latency
```

---

## Non-Goals (Explicitly Out of Scope)

- **Postgres as source of truth for all reads** — Single-replica with in-memory store + Postgres persistence for v1. Multi-replica with Postgres reads is v2.
- **Per-tenant store instances** — Single global store with tenant filtering. Partitioned stores are a future optimization when total loans > 100K.
- **Multi-tenant users** — Users belong to exactly one tenant. Consultants need multiple accounts.
- **Subdomain-based tenant routing** — `quickel.platform.com` instead of `/t/quickel/`. Future phase.
- **Tenant offboarding / data deletion** — Spec E (Onboarding Module) covers the full lifecycle including offboarding.
- **Per-tenant credential vaults** — Outbound integration credentials stored per-tenant. Future phase when Encompass LOS integration is built.
- **Demo data isolation from analytics** — Demo decisions land in `decision_records` tagged with demo tenant_id. Analytics queries should filter `tenant.type = 'production'`. Separate schema is a future optimization.
