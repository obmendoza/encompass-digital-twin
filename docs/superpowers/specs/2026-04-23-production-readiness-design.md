# Production Readiness Sprint — Design Spec

> **Goal:** Close the 12 critical and important gaps between "architecturally complete" and "ready to onboard the first lender" — UI migration to tenant-scoped routes, tenant onboarding wizard + settings, LLM insight generator with PII redaction, and compliance officer two-key approval flow with RFC 6902 guideline patching.

> **Architecture:** Route group with middleware-based tenant resolution (zero file duplication). Minimal wizard + full settings page for tenant management. LLM insights via Anthropic SDK tool_use inside the existing learning worker. Two-key approval with JSON Patch apply and preview.

> **Tech Stack:** Existing stack + `@anthropic-ai/sdk` (for insight generation). No new infrastructure.

---

## 1. UI Migration — Route Group with Tenant Context

### 1.1 Middleware Tenant Resolution

The existing `packages/web/middleware.ts` is extended to resolve tenant context on every request:

- `/t/acme/loan/123` → sets `x-tenant-slug: acme` response header
- `/loan/123` → sets `x-tenant-slug: default` response header
- `/va`, `/uw`, `/metrics`, `/admin` → sets `x-tenant-slug: default` response header

The header is readable by all server components via Next.js `headers()` API.

### 1.2 Server Helper

```typescript
// packages/web/lib/tenant.ts — add:
import { headers } from "next/headers";

export async function getTenantSlug(): Promise<string> {
  const h = await headers();
  return h.get("x-tenant-slug") ?? DEFAULT_TENANT_SLUG;
}
```

### 1.3 API Client Tenant Header

`packages/web/lib/api-client.ts` gains an optional `tenantId` parameter on the internal `req()` function. When set, it adds `X-Tenant-Id` header to API requests. Server components pass the resolved tenant ID through.

### 1.4 Tenant-Scoped Route Group

Create full route mirrors under `/t/[tenantSlug]/`:

```
/t/[tenantSlug]/
  layout.tsx              — Tenant shell (resolves tenant, passes context)
  page.tsx                — Pipeline view (mirrors /)
  loan/[loanId]/
    layout.tsx            — Loan shell (mirrors existing)
    transmittal/page.tsx  — Mirrors existing
    ... (all existing loan sub-routes)
  va/page.tsx             — Mirrors /va
  uw/page.tsx             — Mirrors /uw
  metrics/page.tsx        — Enhanced metrics (already exists from Spec B)
  admin/
    page.tsx              — Tenant admin
    settings/page.tsx     — Tenant settings (new — Section 2)
  hitl/page.tsx           — Mirrors /hitl
  workshop/page.tsx       — Mirrors /workshop
```

Each page imports the same components as the legacy route but passes `tenantSlug` through context. **No file duplication** — the page files are thin wrappers that:
1. Call `getTenantSlug()` to resolve tenant
2. Fetch data via API client with tenant header
3. Render the same component tree

### 1.5 Legacy Route Preservation

Existing routes (`/loan/123`, `/va`, `/uw`, etc.) continue working unchanged. They resolve to `default` tenant via middleware. No redirects, no breaking changes.

---

## 2. Tenant Onboarding Wizard + Settings

### 2.1 Minimal Wizard

Located at `/platform/tenants`. Super_admin only.

**Create Tenant modal — 3 fields:**
- **Name**: free text (e.g., "Acme Lending")
- **Slug**: auto-generated from name (lowercase, hyphenated), editable. Validated against `TenantSlugSchema` + reserved slugs.
- **Admin Email**: email address for the initial tenant admin user

**On submit:**
1. `POST /tenants` — creates tenant with status `onboarding`
2. Creates user in Supabase Auth with `app_metadata: { tenant_id: <uuid>, role: "admin" }`
3. Redirects to `/t/:slug/admin/settings`

### 2.2 Platform Tenants List

`/platform/tenants` page (super_admin only):

- Table: name, slug, status badge, loan count, created date
- "Create Tenant" button opens the wizard modal
- Click row → navigate to `/t/:slug/admin/settings`
- Status badges: onboarding (yellow), active (green), suspended (red), offboarding (gray)

### 2.3 Tenant Settings Page

`/t/:slug/admin/settings` page — accessible to tenant admin + super_admin.

**Six tabs:**

**General tab:**
- Edit tenant name
- Status controls: Activate (onboarding→active), Suspend (active→suspended), Resume (suspended→active)
- Branding: logo URL, primary color (deferred UI, fields saved)

**Guidelines tab:**
- List of programs with active guideline version
- "Upload Guidelines" button → JSON editor or file upload
- Version history per program with diff view
- Uses existing `POST /guidelines/:program` and `GET /guidelines/:program/history`

**SLA tab:**
- Four numeric inputs: queue, processing, review, total time (minutes)
- Save updates `tenant.settings.sla` via `PATCH /tenants/:slug`
- Shows current defaults when empty

**Ingestion tab:**
- List of configured source mappings
- "Add Mapping" form: source name, transformer type (dropdown: generic-json), field map (JSON editor)
- "Test Transformer" button: paste sample JSON, see transformed output
- Uses new `POST /ingestion-mappings` and `GET /ingestion-mappings` endpoints

**API Keys tab:**
- List of keys: name, prefix (first 8 chars), rate limit, created date, status (active/revoked)
- "Generate Key" button → shows plaintext key ONCE in a modal (copy-to-clipboard), stores hash
- "Revoke" button per key
- Uses new CRUD endpoints (Section 5.1)

**Users tab:**
- List of tenant users: email, role, last login
- "Invite User" form: email + role dropdown (admin/uw/va/compliance_officer/demo)
- Creates user in Supabase Auth with correct `app_metadata`
- Remove user button

### 2.4 New API Endpoints for Settings

```
POST /tenants/:slug/api-keys
  Body: { name: string, rateLimitPerMinute?: number }
  → { id, keyPrefix, key (plaintext, shown once), rateLimitPerMinute, createdAt }

GET /tenants/:slug/api-keys
  → [{ id, name, keyPrefix, rateLimitPerMinute, createdAt, revokedAt }]

DELETE /tenants/:slug/api-keys/:keyId
  → { revoked: true }

POST /tenants/:slug/ingestion-mappings
  Body: { sourceName, transformerType, fieldMap }
  → { id, sourceName, transformerType, fieldMap, createdAt }

GET /tenants/:slug/ingestion-mappings
  → [{ id, sourceName, transformerType, fieldMap, active, createdAt }]

POST /tenants/:slug/ingestion-mappings/test
  Body: { transformerType, fieldMap, sampleData }
  → { transformed: Partial<Loan>, validation: { valid, errors } }
```

---

## 3. LLM Insight Generator

### 3.1 Pipeline

Runs inside the existing learning worker's 6-hour cycle, after pattern detection:

```
For each pattern with status "new":
  1. Check LLM budget (per-tenant + global)
  2. Update pattern status: "new" → "analyzing"
  3. Load context:
     a. Tenant's active guideline for the affected program
     b. Stratified sample of 10 override records matching the pattern
     c. Agent reasoning traces for those loans
  4. PII redaction pass on all samples
  5. Call Claude Sonnet via tool_use
  6. Validate response against guideline schema (two-stage)
  7. Run threshold_reasonableness compliance check
  8. Write suggestion to pattern_suggestions
  9. Set visibility based on compliance check result
  10. Update pattern status: "analyzing" → "suggestion_ready"
  11. Publish "pattern.suggestion_ready" event
```

### 3.2 PII Redaction Module

`packages/api/src/learning/pii-redactor.ts`

**Whitelist approach** — only allow through:
- Numeric fields: DTI, LTV, FICO, loan amount, income, rates, reserves, appraisal value
- Categorical fields: program, occupancy, property type, decision type, override reason, loan purpose, amort type

**Redact from free-text rationale:**
- SSN pattern: `/\b\d{3}-\d{2}-\d{4}\b/g` → `[SSN-REDACTED]`
- Email: `/\b[\w.-]+@[\w.-]+\.\w{2,}\b/g` → `[EMAIL-REDACTED]`
- Phone: `/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g` → `[PHONE-REDACTED]`
- Account numbers: `/\b\d{8,17}\b/g` → `[ACCT-REDACTED]`
- Names from borrower.fullName → replaced with `BORROWER_1`, `BORROWER_2`, etc.

**Output:** `{ redactedSamples, redactionApplied: true, redactionVersion: "1.0" }`

### 3.3 Stratified Sample Selection

For each pattern, select up to 10 overrides from the pattern window:
- 3 most recent (recency)
- 3 at highest agent confidence (most informative for miscalibration)
- 3 at lowest agent confidence (edge cases)
- 1 with longest rationale text (richest UW reasoning)

Cap total sample text at ~4,000 tokens. Trim oldest rationale text first.

### 3.4 Anthropic SDK Integration

Install `@anthropic-ai/sdk` in `packages/api`.

```typescript
// packages/api/src/learning/insight-generator.ts

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SUGGEST_TOOL = {
  name: "propose_guideline_change",
  description: "Propose a concrete guideline change to address the detected override pattern.",
  input_schema: {
    type: "object" as const,
    properties: {
      root_cause: { type: "string", description: "Why the agent is being overridden (1-2 sentences)" },
      suggestion_type: { type: "string", enum: ["guideline_change", "prompt_adjustment", "threshold_update", "no_action"] },
      specific_change: {
        type: "object",
        properties: {
          operation: { type: "string", enum: ["replace", "add", "remove"] },
          path: { type: "string", description: "JSON Pointer, e.g. /income/maxDtiBack" },
          from: { description: "Previous value for audit" },
          to: { description: "New value" },
          scope: {
            type: "object",
            properties: {
              program: { type: "string" },
              loan_types: { type: "array", items: { type: "string" } },
            },
          },
        },
        required: ["operation", "path", "to", "scope"],
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      risk_assessment: { type: "string", description: "What could go wrong if this change is applied" },
    },
    required: ["root_cause", "suggestion_type", "specific_change", "confidence", "risk_assessment"],
  },
};
```

**Call pattern:**
```typescript
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  tools: [SUGGEST_TOOL],
  tool_choice: { type: "tool", name: "propose_guideline_change" },
  messages: [{ role: "user", content: assembledPrompt }],
}, {
  headers: { "anthropic-beta": "zero-data-retention-2025-04-01" },
});
```

### 3.5 Two-Stage Validation

After receiving the tool_use response:

1. **Stage 1 — Schema validation:** Extract tool input, validate with Zod `SpecificChangeSchema`
2. **Stage 2 — Guideline compatibility:**
   a. Verify `specific_change.path` resolves to an existing field in the active guideline
   b. Verify `specific_change.to` is type-compatible with the field (number→number, etc.)
   c. Verify `specific_change.from` matches the current value at that path

On validation failure: retry once with error appended to prompt.
On second failure: pattern status → `analysis_failed`.

### 3.6 Compliance Pre-Check: threshold_reasonableness

Before surfacing a suggestion, validate proposed values are within sane bounds:

| Field path | Max/Min | Rationale |
|-----------|---------|-----------|
| `/income/maxDtiBack` | max 65% | Beyond this, no investor will purchase |
| `/income/maxDtiFront` | max 55% | Housing ratio ceiling |
| `/credit/minFico` | min 500 | Below 500 is not scorable |
| `/ltv/maxLtv` | max 97% | Exceeds conventional limits |
| `/compliance/maxPointsFeesPct` | max 8% | HOEPA threshold |
| `/reserves/minMonths` | min 0 | Cannot require negative reserves |

If any bound violated: `visibility = "compliance_only"`, routed to compliance officer only.
If all pass: `visibility = "admin"`, visible to tenant admin.

### 3.7 Cost Control

- Per-tenant daily cap: 5 calls, tracked in Redis `insight_calls:{tenantId}:{YYYY-MM-DD}` (48h TTL)
- Global daily cap: 40 calls, tracked in Redis `insight_calls:global:{YYYY-MM-DD}` (48h TTL)
- Priority queue: patterns sorted by `sample_count DESC, override_rate DESC`
- Skip patterns if budget exhausted — they'll be picked up in the next 6-hour cycle

### 3.8 Janitor (in same worker cycle)

- Patterns in `analyzing` > 1 hour → reset to `new` (increment retry counter in status_history)
- After 3 resets → `analysis_failed`
- Patterns in `analysis_failed` > 7 days without manual review → auto-dismissed with 30-day cooldown

---

## 4. Compliance Officer Flow — Two-Key Approval

### 4.1 Approval State Machine

For `guideline_change` and `threshold_update` suggestions:

```
pending (visible to admin)
  → admin clicks "Approve"
  → reviewed_by + reviewed_at set
  → still "pending" but now shows in compliance officer's review tab

pending (compliance officer sees it)
  → clicks "Confirm"
  → compliance_reviewed_by + compliance_reviewed_at set
  → RFC 6902 patch applied → new guideline version
  → status → "applied"

  OR clicks "Reject"
  → rejection_reason recorded
  → status → "rejected"
  → pattern → "dismissed" with cooldown
```

For `prompt_adjustment` suggestions: admin-only (single key).

### 4.2 RFC 6902 JSON Patch Apply

When both keys are present:

1. Load tenant's current active guideline for the affected program
2. Validate `specific_change.path` exists in the guideline JSON
3. Validate `specific_change.from` matches current value (stale-view protection)
4. Apply the operation:
   - `replace`: overwrite value at path
   - `add`: insert value at path
   - `remove`: delete value at path
5. Validate resulting guideline against `GuidelineRulesSchema`
6. If valid → create new guideline version via existing `POST /guidelines/:program` (deactivates old, creates new)
7. If invalid → reject with descriptive error, suggestion stays pending
8. Publish `guideline.updated` event with `appliedSuggestionId`

### 4.3 Preview Endpoint

```
POST /metrics/:tenantId/patterns/:patternId/preview
  → {
      before: { ...current guideline rules },
      after: { ...guideline rules with patch applied },
      diff: { path, operation, from, to }
    }
```

Available to both admin and compliance_officer. Shows the exact impact before any approval.

### 4.4 UI Changes to Metrics Page Suggestions Panel

The existing `SuggestionCards` component gains role-aware behavior:

- **Admin sees:**
  - Pending suggestions with "Preview" and "Approve" buttons
  - After approving: "Awaiting Compliance Review" badge
  - Applied suggestions with "Applied" badge + both reviewer names

- **Compliance officer sees:**
  - "Compliance Review" filter/tab showing suggestions with admin approval but awaiting compliance
  - "Preview", "Confirm", and "Reject" buttons
  - Reject requires a reason (text input)

- **Both see:**
  - Suggestion details: root cause, specific change (path: from → to), confidence, risk assessment
  - Preview diff (before/after)

---

## 5. Additional Deferred Items

### 5.1 API Key Management CRUD

New routes under `/tenants/:slug/api-keys`:

```
POST /tenants/:slug/api-keys
  Body: { name, rateLimitPerMinute? }
  Response: { id, name, keyPrefix, key (plaintext once), rateLimitPerMinute, createdAt }
  Implementation: generate 32-byte random key, hash with scrypt, store hash + prefix

GET /tenants/:slug/api-keys
  Response: [{ id, name, keyPrefix, rateLimitPerMinute, createdAt, revokedAt }]
  Note: never returns plaintext key

DELETE /tenants/:slug/api-keys/:keyId
  Response: { revoked: true }
  Implementation: sets revoked_at, does not delete row
```

### 5.2 Ingestion Mapping CRUD + Test

```
POST /tenants/:slug/ingestion-mappings
  Body: { sourceName, transformerType, fieldMap }

GET /tenants/:slug/ingestion-mappings

POST /tenants/:slug/ingestion-mappings/test
  Body: { transformerType, fieldMap, sampleData }
  Response: { transformed, validation: { valid, errors } }
```

The test endpoint runs the transformer against sample data without persisting — lets admins verify their field mapping before going live.

### 5.3 Guideline Version Pinning

When a loan enters the pipeline:
- `InjectLoan` action in the reducer checks if `loan.guidelineVersionId` is set
- If not, queries the tenant's active guideline for `loan.nqmProgram` and sets the version ID
- All subsequent agent evaluations and decision records reference this pinned version
- Ensures mid-pipeline guideline changes don't affect in-flight loans

### 5.4 Dynamic Agent Version Tracking

Replace hardcoded `"v1"` in `decision-writer.ts`:
- `agent_version`: read from `pendingRecommendation.trace` metadata (agent service tags its version in step metadata)
- `prompt_version`: hash of the specialist prompt template content (computed once on agent service startup, passed through in trace metadata)
- `model_id`: read from agent step metadata `model` field

Fallback to `"unknown"` if metadata is not present (backward compatible with old agent output).

---

## 6. Testing Strategy

### 6.1 UI Migration Tests

```
- /t/acme/loan/123 renders with tenant context "acme"
- /loan/123 renders with tenant context "default"
- /t/acme/va renders VA dashboard scoped to "acme"
- Legacy URLs continue working after migration
- API requests include X-Tenant-Id header matching resolved tenant
```

### 6.2 Tenant Onboarding Tests

```
- Create tenant via wizard → tenant in DB with status "onboarding"
- Activate tenant → status "active", ingestion accepted
- Suspend tenant → status "suspended", ingestion rejected (423)
- Generate API key → key returned once, hash stored, prefix matches
- Revoke API key → subsequent requests with that key return 401
```

### 6.3 LLM Insight Tests

```
- PII redactor: SSN pattern → redacted, email → redacted, numeric fields preserved
- PII redactor: borrower name from fullName → replaced with BORROWER_1
- Budget check: 6th call for same tenant/day → skipped
- Budget check: 41st global call → skipped
- Validation: invalid path in response → retry once
- Validation: second failure → pattern status = analysis_failed
- Threshold check: maxDtiBack=70 → visibility = compliance_only
- Threshold check: maxDtiBack=50 → visibility = admin
```

### 6.4 Compliance Flow Tests

```
- Admin approves guideline_change → status stays pending, reviewed_by set
- Compliance officer confirms → patch applied, new guideline version, status = applied
- Compliance officer rejects → rejection_reason stored, status = rejected
- Admin approves prompt_adjustment → applied immediately (single key)
- Preview returns correct before/after diff
- Stale from value → patch rejected with error
- Invalid resulting guideline → patch rejected, suggestion stays pending
```

### 6.5 API Key Tests

```
- Generate key → plaintext returned, hash stored
- List keys → plaintext never returned, prefix shown
- Valid key → request authenticated, tenant resolved
- Revoked key → 401
- Expired key → 401
- Rate limit exceeded → 429 with Retry-After
```

---

## Non-Goals (Explicitly Out of Scope)

- **Supabase Auth OAuth provider integration** — The spec assumes Supabase Auth is already configured. User creation calls the Supabase Admin API to set `app_metadata`. Full OAuth flow (Google, email/password registration) is existing functionality.
- **Real-time collaboration** — Multiple users on same loan simultaneously. Deferred.
- **MISMO XML transformer** — Interface exists, implementation deferred until first MISMO integration.
- **Full disparate-impact analysis** — Only `threshold_reasonableness` compliance check in this sprint. Geographic proxy analysis is a follow-up.
- **Custom branding rendering** — Settings fields exist, full white-label UI rendering deferred.
- **RLS isolation integration tests** — Require live Supabase Postgres with RLS enabled. Covered by manual verification during staging deployment.
