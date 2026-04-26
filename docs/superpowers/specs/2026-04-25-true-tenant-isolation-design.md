# True Tenant Isolation — Design Spec

> **Goal:** Replace the cosmetic tenant-switching UI with real data isolation enforced by JWT at every layer. Regular users are automatically scoped to their tenant — no switcher, no URL prefix, no way to see another tenant's data. Super admin retains cross-tenant access via explicit `/t/:slug/` URLs.

> **Architecture:** JWT `app_metadata.tenant_id` is the single source of truth for tenant context. Middleware extracts it on every request and injects into AsyncLocalStorage. API routes filter all data by `getTenantId()` before returning. Demo tenant loads fixtures from `@twin/fixtures` on boot (ephemeral, never persisted). Production tenants load from Postgres only. No tenant switcher for regular users — their experience is seamless within their lender's context.

> **Tech Stack:** Existing stack. No new dependencies. Changes are to middleware, API route filtering, boot sequence, and auth — not infrastructure.

---

## 1. Tenant Types

### 1.1 Two Tenant Types

```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'production'
  CHECK (type IN ('demo', 'production'));
```

| Type | Purpose | Data Source | Persistence |
|------|---------|------------|-------------|
| `demo` | Platform demos, internal testing | `@twin/fixtures` loaded on boot | Never saved to Postgres |
| `production` | Real lender tenants | Postgres only | Always saved to Postgres |

### 1.2 Demo Tenant

The current "Default Tenant" (UUID `00000000-0000-0000-0000-000000000000`) is migrated:
- Name: "Default Tenant" → "Demo Tenant"
- Slug: `default` → `demo`
- Type: `production` → `demo`

Pre-seeded demo users (all bound to demo tenant via `app_metadata.tenant_id`):

| Email | Role | Purpose |
|-------|------|---------|
| `demo@platform.com` | demo | Read-only explorer |
| `va@platform.com` | va | Demonstrate VA workflow |
| `uw@platform.com` | uw | Demonstrate UW decisions |
| `admin@platform.com` | admin | Demonstrate admin features |

### 1.3 Production Tenants

Created via the onboarding module (Spec E). Start with zero loans. All data persisted to Postgres. Example: Quicken Loans (`slug: quickel`, `type: production`).

---

## 2. User-Tenant Binding

### 2.1 JWT as Source of Truth

Every user has `tenant_id` in their Supabase `app_metadata`:

```json
{
  "app_metadata": {
    "tenant_id": "94aa0139-a5c5-4b75-a0bd-e72b8f69eeb6",
    "role": "uw",
    "is_super_admin": false
  }
}
```

- Set at user creation, immutable except by super_admin
- The JWT carries `tenant_id` on every request — no client-side headers needed
- `getUser()` helper extracts `tenantId` from JWT — never from `x-tenant-id` header

### 2.2 User Types

| User Type | Tenant Binding | Switcher | URL Pattern |
|-----------|---------------|----------|-------------|
| Regular (va, uw, admin, compliance_officer) | Locked to one tenant | None — automatic | `/uw`, `/metrics`, `/loan/123` |
| Super admin | Has own tenant + cross-tenant access | Via `/t/:slug/` URLs | `/t/quickel/uw`, `/platform/tenants` |
| Demo users | Locked to demo tenant | None — automatic | `/uw`, `/metrics` (demo data) |

### 2.3 Enforcement

- A regular user CANNOT access another tenant's data — 403 at middleware level
- A regular user visiting `/t/other-slug/` gets 403 (unless slug matches their tenant)
- A super_admin visiting `/t/:slug/` gets that tenant's context (explicit override)
- No header spoofing possible — server reads tenant from JWT, never from client headers

---

## 3. Middleware — JWT-First Tenant Resolution

### 3.1 Web Middleware (Next.js)

```
Request arrives
    ↓
Authenticated? (Supabase JWT in cookie)
    ├── YES → Extract tenant_id from JWT app_metadata
    │         ├── URL has /t/:slug/ prefix?
    │         │   ├── User is super_admin? → Use slug's tenant_id
    │         │   └── NOT super_admin? → slug matches JWT tenant?
    │         │       ├── YES → proceed
    │         │       └── NO → 403 Forbidden
    │         └── No /t/ prefix → Use JWT tenant_id automatically
    │
    └── NO → Public route? (/login, /auth/callback)
              ├── YES → proceed
              └── NO → redirect to /login
    ↓
Set request headers: x-tenant-id, x-user-role, x-is-super-admin
    ↓
Server components read tenant context from headers
```

### 3.2 API Middleware (Fastify)

The Fastify `preHandler` hook resolves tenant from the request:

**For authenticated requests (web → API):**
- Read `x-tenant-id` header set by Next.js middleware (trusted, from JWT)
- Set in AsyncLocalStorage: `tenantStore.enterWith({ tenantId, userId, isSuperAdmin })`

**For API key requests (external → API):**
- Existing `apiKeyAuthHook` resolves tenant from the API key (unchanged)

**For super_admin requests:**
- If `x-is-super-admin: true` AND `x-tenant-id` is set → use that tenant
- Super admin actions against other tenants are logged to `tenant_audit_log`

### 3.3 What Gets Removed

- `x-tenant-slug` header (replaced by `x-tenant-id` from JWT)
- `getTenantSlugFromPath()` as tenant resolver (URL is no longer the source)
- Client-side `TenantSwitcher.tsx` component
- `/api/tenants` proxy route (was only for the switcher)

---

## 4. API-Layer Tenant Filtering

### 4.1 Filter Helper

```typescript
/**
 * Get all loans for the current tenant.
 * Every route that returns loan data MUST use this instead of store.getState().loans
 */
function getLoansForTenant(store: Store, tenantId: string): Loan[] {
  return Object.values(store.getState().loans)
    .filter(loan => loan.tenantId === tenantId);
}

/**
 * Get a single loan, verified to belong to the current tenant.
 * Returns null if the loan doesn't exist or belongs to another tenant.
 */
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
| `conditions.ts` | All condition CRUD | Verify loan ownership via `getLoanForTenant()` |
| `documents.ts` | All document CRUD | Verify loan ownership |
| `recommendation.ts` | Agent step, stage, accept, clear | Verify loan ownership |
| `uw-flow.ts` | Override, send-back | Verify loan ownership |
| `assignment.ts` | Assign, update, unassign, list | Filter by tenant |
| `uploads.ts` | File upload | Verify loan ownership |
| `metrics.ts` | `GET /metrics` | Aggregate only tenant's loans |
| `system-check.ts` | Health, integrity, behavioral | Scope to tenant |
| `world.ts` | Load scenario, reset | Scope to tenant (demo only for reset) |

### 4.3 Write Operations

When dispatching actions that create or modify loans:
- `InjectLoan`: loan MUST have `tenantId` set before injection
- `LoadScenario`: only allowed for demo tenant, fixtures tagged with demo tenant_id
- All other actions: verify `loan.tenantId === getTenantId()` before dispatch

### 4.4 Super Admin Override

When `isSuperAdmin` is true, the tenant filter uses the explicitly requested tenant (from `/t/:slug/` URL resolution), not the super admin's own tenant. This lets super admin view any tenant's data without modifying the filter logic — just the resolved `tenantId` changes.

---

## 5. URL Routing

### 5.1 Regular Users — Clean URLs

A Quicken Loans UW sees:

```
/              → Pipeline (quickel loans only)
/uw            → UW Queue (quickel loans only)
/va            → VA Dashboard (quickel loans only)
/metrics       → Metrics (quickel data only)
/loan/QL-123   → Loan detail (verified quickel ownership)
/admin         → Tenant admin for quickel
```

No `/t/quickel/` prefix. The tenant is invisible — it's infrastructure, not UI.

### 5.2 Super Admin — Explicit Tenant Context

```
/              → Pipeline for super admin's own tenant (demo)
/t/quickel/    → Pipeline filtered to quickel loans
/t/quickel/uw  → Quicken Loans UW Queue
/t/demo/       → Demo tenant pipeline (fixture loans)
/platform/tenants → Cross-tenant management
/platform/metrics → Cross-tenant metrics (future)
```

### 5.3 Access Control Matrix

| URL Pattern | Regular User (own tenant) | Regular User (other tenant) | Super Admin |
|-------------|------------------------|-----------------------------|-------------|
| `/uw` | Sees own tenant data | N/A | Sees own tenant data |
| `/t/:slug/uw` (own) | Allowed | — | Allowed |
| `/t/:slug/uw` (other) | **403 Forbidden** | **403 Forbidden** | Allowed |
| `/platform/*` | **403 Forbidden** | **403 Forbidden** | Allowed |
| `/loan/:id` (own tenant) | Allowed | — | Allowed |
| `/loan/:id` (other tenant) | **404 Not Found** | — | Must use `/t/:slug/` |

### 5.4 Route File Changes

The existing pages at `/uw/page.tsx`, `/va/page.tsx`, etc. stay where they are. They work for all users because data filtering happens at the API layer. No page-level tenant logic needed.

The `/t/[tenantSlug]/` routes become super_admin-only access points — same pages, different tenant context.

---

## 6. Boot Sequence & Data Loading

### 6.1 Server Startup

```
1. Connect to Postgres, run migrations
2. Connect to Redis
3. Load tenant list from Postgres
4. For each tenant:
     if type === "demo":
       Load fixtures from @twin/fixtures
       Tag each loan with tenantId = demo_tenant_uuid
       Store in memory (do NOT persist)
     if type === "production":
       Load loans from Postgres (world_state WHERE tenant_id = ?)
       Store in memory
5. Start SLA monitor, learning worker
6. Start listening
```

### 6.2 Dispatch Wrapper Updates

The persistence wrapper in `server.ts` becomes tenant-aware:

```typescript
(store as any).dispatch = (action) => {
  const result = _dispatch(action);
  
  // Determine the tenant for this action
  const loanId = (action as { loanId?: string }).loanId;
  const loan = loanId ? result.loans[loanId] : null;
  const tenantId = loan?.tenantId;
  
  if (action.type === "ResetWorld") {
    // Only allowed for demo tenant — clear and reload fixtures
  } else if (tenantId) {
    // Get tenant type
    const tenantType = getTenantType(tenantId); // lookup from tenants table
    
    if (tenantType === "production") {
      // Persist to Postgres
      persistence.saveState(result, tenantId).catch(() => {});
    }
    // Demo tenant: do NOT persist (ephemeral)
    
    // Publish event + write decision record (both tenant types)
    publishAction(tenantId, action).catch(() => {});
    
    if (isDecisionAction(action)) {
      writeDecisionRecord({ tenantId, loanId, loan, action }).catch(() => {});
    }
  }
  
  return result;
};
```

### 6.3 Reset Demo

Super admin action: `POST /system/reset-demo`
- Clears all demo tenant loans from the in-memory store
- Reloads fixtures from `@twin/fixtures` with `tenantId = demo_uuid`
- Does NOT touch Postgres or other tenants
- Useful between demo sessions

---

## 7. Migration Steps

### 7.1 Database Migration (008)

```sql
-- Add type column to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'production'
  CHECK (type IN ('demo', 'production'));

-- Migrate Default Tenant to Demo Tenant
UPDATE tenants
SET name = 'Demo Tenant', slug = 'demo', type = 'demo'
WHERE id = '00000000-0000-0000-0000-000000000000';

-- Update any references to old slug 'default' if needed
-- (ingested_loans, decision_records, etc. reference by tenant_id UUID, not slug)
```

### 7.2 Code Changes Summary

| File | Change |
|------|--------|
| `packages/api/src/server.ts` | Boot sequence: load fixtures for demo, Postgres for production. Dispatch wrapper: persist only production tenants |
| `packages/api/src/routes/loans.ts` | Filter by `getTenantId()` |
| `packages/api/src/routes/conditions.ts` | Verify loan ownership |
| `packages/api/src/routes/documents.ts` | Verify loan ownership |
| `packages/api/src/routes/recommendation.ts` | Verify loan ownership |
| `packages/api/src/routes/uw-flow.ts` | Verify loan ownership |
| `packages/api/src/routes/assignment.ts` | Filter by tenant |
| `packages/api/src/routes/uploads.ts` | Verify loan ownership |
| `packages/api/src/routes/metrics.ts` | Filter by tenant |
| `packages/api/src/routes/system-check.ts` | Scope checks to tenant |
| `packages/api/src/routes/world.ts` | LoadScenario: demo only. Reset: demo only |
| `packages/api/src/middleware/tenant-resolver.ts` | Resolve from JWT, not header |
| `packages/web/middleware.ts` | Extract tenant_id from JWT app_metadata, enforce access |
| `packages/web/lib/auth.ts` | `getUser()` returns tenantId from JWT |
| `packages/web/components/encompass/Toolbar.tsx` | Remove TenantSwitcher |
| `packages/core/src/tenant-types.ts` | Update DEFAULT_TENANT_ID to demo UUID, add TenantType |

### 7.3 What Gets Deleted

- `packages/web/components/encompass/TenantSwitcher.tsx`
- `packages/web/app/api/tenants/route.ts` (proxy for switcher)
- Hardcoded `DEFAULT_TENANT_ID` usage throughout (replaced by JWT-resolved tenant)
- `x-tenant-slug` header logic

---

## 8. Testing Strategy

### 8.1 Tenant Isolation Tests

```
- Demo user calls GET /loans → sees only demo tenant's 20 fixture loans
- Quicken Loans UW calls GET /loans → sees only quickel's ingested loans
- Quicken Loans UW calls GET /loans/:id for a demo loan → 404 Not Found
- Quicken Loans UW calls POST /loans/:id/decision on a demo loan → 403/404
- Super admin calls GET /loans → sees their own tenant's loans
- Super admin calls /t/quickel/ route → sees quickel loans
- Unauthenticated request → redirect to /login
```

### 8.2 URL Access Tests

```
- Regular user at /uw → 200, sees own tenant data
- Regular user at /t/own-slug/uw → 200, allowed
- Regular user at /t/other-slug/uw → 403 Forbidden
- Regular user at /platform/tenants → 403 Forbidden
- Super admin at /t/quickel/uw → 200, sees quickel data
- Super admin at /platform/tenants → 200, sees all tenants
```

### 8.3 Data Integrity Tests

```
- Boot: demo tenant has exactly 20 fixture loans
- Boot: production tenant has only its Postgres-persisted loans
- Dispatch on demo loan → NOT persisted to Postgres
- Dispatch on production loan → persisted to Postgres
- Reset demo → fixtures reloaded, no effect on production tenants
- Decision record from demo tenant tagged with demo tenant_id
- Decision record from production tenant tagged with production tenant_id
```

### 8.4 Auth Tests

```
- User with no tenant_id in app_metadata → rejected (no tenant context)
- User with tenant_id for suspended tenant → rejected
- API key auth → resolves correct tenant_id (unchanged)
- Super admin flag only from app_metadata, never from headers
```

---

## Non-Goals (Explicitly Out of Scope)

- **Postgres as source of truth for all reads** — In-memory store remains the primary read path, filtered by tenant. Full migration to Postgres reads is Spec F.
- **Per-tenant store instances** — Single global store with tenant filtering. Separate stores are a future optimization.
- **Tenant-scoped WebSocket channels** — WebSocket already supports tenant channels from Spec A. This spec doesn't change WebSocket behavior.
- **Onboarding module** — Spec E. This spec provides the isolation layer that onboarding builds on.
- **Agent customization per tenant** — Spec F. This spec ensures agents operate on the correct tenant's data.
- **Multi-tenant users** — Users belong to exactly one tenant. Consultants working for multiple lenders need multiple accounts.
