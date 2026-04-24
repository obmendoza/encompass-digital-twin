# Encompass Digital Twin — Claude Code Guidelines

## Project Overview
Multi-tenant AI underwriting service platform for NQM (Non-Qualified Mortgage) lenders. Each tenant is a lender with isolated data, guidelines, workflows, and users. The platform leverages AI agents to automate 80% of underwriting decisions while humans provide judgment on edge cases.

## Architecture
- **Monorepo**: pnpm workspace with 4 packages
- **@twin/core**: Pure domain types, reducer, store, Zod schemas (zero runtime deps except zod)
- **@twin/fixtures**: 20 NQM loan scenarios (12 standard + 8 edge cases)
- **@twin/api**: Fastify 4 REST API with tenant-scoped RLS, Redis pub/sub, WebSocket
- **@twin/web**: Next.js 15 App Router, React 19, Tailwind CSS, Supabase Auth
- **Agent Service**: Python FastAPI at ~/Downloads/mortgage_uw_agent (separate repo)

## Build & Run
```bash
pnpm install                          # Install all deps
pnpm --filter @twin/core build        # Build core (required before api/web)
pnpm --filter @twin/fixtures build    # Build fixtures
pnpm --filter @twin/api dev           # API on :4000
pnpm --filter @twin/web dev           # Web on :3000
pnpm --filter @twin/core test         # Core tests (84 tests)
pnpm --filter @twin/api test          # API tests (98 tests)
```

## Deployment
- **Railway**: 3 services (api, web, redis) + Supabase (external)
- API: `railway up --service api --detach`
- Web: `railway up --service web --detach`
- Web Docker builds skip TypeScript checking (`ignoreBuildErrors: true` in next.config.ts)
- Always verify web build locally before deploying: `pnpm --filter @twin/web build`

## Multi-Tenant Patterns
- **RLS enforcement**: ALL database access goes through `withTenantTx(tenantId, fn)` — never query without tenant context
- **AsyncLocalStorage**: `getTenantId()` throws if called outside tenant context — this is intentional
- **Tenant resolution**: Middleware sets `x-tenant-slug` on request headers; server components read via `getTenantSlug()`
- **Default tenant**: UUID `00000000-0000-0000-0000-000000000000`, slug `default`
- **URL structure**: `/t/:tenantSlug/...` for tenant-scoped, legacy `/loan/...` resolves to default tenant

## Code Standards

### TypeScript
- Strict mode, no implicit any
- Zod for all API input validation — schemas in core package
- Types and schemas are the source of truth — derive from Zod with `z.infer<>` where possible
- Use `import type` for type-only imports

### API Routes
- Pattern: `registerXxxRoutes(app: FastifyInstance, store?: Store)`
- All registered in `buildServer()` in server.ts
- Tenant context: `getTenantId()` or `getTenantContext()` from AsyncLocalStorage
- DB access: `withTenantTx(tenantId, async (client) => { ... })` for tenant-scoped queries
- DB access: `withDb(async (client) => { ... })` for admin/migration queries

### Next.js Frontend
- Server components by default, `"use client"` only when needed
- API calls from server components use `process.env.API_URL` (internal Railway URL)
- API calls from client components use `process.env.NEXT_PUBLIC_API_URL`
- Encompass navy palette: text-[#1a2b4a], bg-[#1f4478], border-[#6b7a8f]
- Component classes: `enc-panel`, `enc-btn`, `enc-btn--primary`, `enc-input`
- No emojis in code or UI unless explicitly requested

### Testing
- Vitest for all tests
- Core tests: `packages/core/test/`
- API tests: `packages/api/test/`
- Tests must pass before deploying: 84 core + 98 API = 182 total
- Data integrity: `GET /system/integrity` checks 11 rules x 20 loans = 220 checks
- Behavioral tests: `POST /system/behavioral-test` runs 10 workflow tests

## Database
- **Supabase Postgres** via session pooler (port 5432, not transaction pooler)
- **14 tables** with RLS on all tenant-scoped tables
- Migrations: `packages/api/src/db/migrations/001-006.sql`, run automatically on boot
- Migration runner: `runMigrations()` in `packages/api/src/db/migrations.ts`
- Key tables: tenants, tenant_guidelines, decision_records, detected_patterns, pattern_suggestions, learning_outcomes

## Key Env Vars
- `DATABASE_URL`: Supabase session pooler connection string
- `REDIS_URL`: Railway Redis public URL
- `ANTHROPIC_API_KEY`: For LLM insight generation
- `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`: For Supabase JS client (persistence, auth)
- `API_URL`: Set on web service, points to API service (Railway internal)
- `NEXT_PUBLIC_API_URL`: Client-side API URL
- `AGENT_SERVICE_URL`: Python agent service URL

## Learning Engine
- **Decision records**: Every UW accept/override/manual decision captured with version attribution
- **Override reasons**: Required dropdown (9 categories) on every override
- **Pattern detection**: 4 rules, runs every 6 hours via advisory lock 43
- **LLM insights**: Claude Sonnet via tool_use with prompt caching, PII redaction, compliance pre-checks
- **Two-key approval**: Guideline changes require admin + compliance_officer sign-off
- **Separation of duties**: DB constraint prevents same user from providing both approvals

## Security
- PII redaction before LLM calls (regex + k-anonymity)
- Anthropic zero-data-retention header on all insight calls
- API keys: tenant-prefixed format (`slug_random32hex`), hashed with SHA-256
- Reserved tenant slugs validated at schema level
- Never commit .env files — use .env.example as template

## Don't Do
- Don't use `npm` — use `pnpm`
- Don't bypass RLS — always use `withTenantTx`
- Don't add emojis to UI unless asked
- Don't add features beyond what was asked (YAGNI)
- Don't mock the database in tests that verify tenant isolation
- Don't use `user_metadata` for auth — use `app_metadata` (server-settable)
