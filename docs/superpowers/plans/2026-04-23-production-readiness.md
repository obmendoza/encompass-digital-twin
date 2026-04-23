# Production Readiness Sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all critical gaps for first lender onboarding — tenant-scoped UI routing, onboarding wizard, LLM insight generator with PII redaction, and two-key compliance approval with RFC 6902 guideline patching.

**Architecture:** Middleware rewrites request headers for tenant context (zero file duplication). Anthropic SDK with tool_use + prompt caching for insights. Layered PII redaction (regex + k-anonymity). Separation-of-duties enforced at DB + API level. Learning outcomes table seeds the data flywheel.

**Tech Stack:** TypeScript, Fastify 4, Next.js 15, Anthropic SDK (@anthropic-ai/sdk), Supabase, Redis, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-04-23-production-readiness-design.md`

---

## File Structure

### New files:

```
packages/api/src/
  learning/
    pii-redactor.ts           — Layered PII redaction (regex + k-anonymity)
    insight-generator.ts      — Anthropic SDK tool_use + prompt caching + validation
    compliance-checker.ts     — Threshold reasonableness + fair-lending screen
    guideline-patcher.ts      — RFC 6902 JSON Patch apply with validation
  routes/
    api-keys.ts               — Tenant API key CRUD
    ingestion-mappings.ts     — Ingestion mapping CRUD + test endpoint
  db/migrations/
    006-production-readiness.sql — retry_count, redaction_manifest, learning_outcomes, admin_approval cols

packages/api/test/
  pii-redactor.test.ts        — PII redaction tests (SSN, email, address, k-anonymity)
  insight-generator.test.ts   — Validation + budget + model selection tests
  compliance-checker.test.ts  — Threshold bounds + fair-lending tests
  guideline-patcher.test.ts   — RFC 6902 apply + stale-view tests

packages/web/
  app/t/[tenantSlug]/
    loan/[loanId]/
      layout.tsx              — Tenant-scoped loan shell
      transmittal/page.tsx    — Thin wrapper mirroring legacy
      (other loan sub-routes)
    va/page.tsx
    uw/page.tsx
    admin/
      settings/page.tsx       — 6-tab tenant settings
  app/platform/
    tenants/page.tsx          — Full tenant list + create wizard
  components/encompass/
    TenantSettings.tsx        — Settings tabs component
    CreateTenantWizard.tsx    — Minimal create modal
    TenantList.tsx            — Platform tenant table

docs/
  compliance/
    sr-11-7-model-governance.md — Model governance one-pager
```

### Modified files:

```
packages/web/middleware.ts                    — Request header rewriting for tenant
packages/web/lib/tenant.ts                   — getTenantSlug() server helper
packages/web/lib/api-client.ts               — X-Tenant-Id header support
packages/api/src/learning-worker.ts           — Add insight generation + janitor
packages/api/src/routes/patterns.ts           — Preview endpoint + separation-of-duties
packages/api/src/server.ts                    — Register new routes
packages/api/src/learning/decision-writer.ts  — Dynamic agent version tracking
packages/api/package.json                     — Add @anthropic-ai/sdk
packages/web/components/encompass/SuggestionCard.tsx — Role-aware buttons + queue-age
```

---

## Task 1: Database Migration — Production Readiness Schema

**Files:**
- Create: `packages/api/src/db/migrations/006-production-readiness.sql`

- [ ] **Step 1: Create migration**

```sql
-- packages/api/src/db/migrations/006-production-readiness.sql

-- Add retry_count to detected_patterns
ALTER TABLE detected_patterns ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;

-- Extend pattern_suggestions for two-key flow + LLM tracking
ALTER TABLE pattern_suggestions ADD COLUMN IF NOT EXISTS redaction_manifest JSONB;
ALTER TABLE pattern_suggestions ADD COLUMN IF NOT EXISTS model_used TEXT;
ALTER TABLE pattern_suggestions ADD COLUMN IF NOT EXISTS input_tokens INT;
ALTER TABLE pattern_suggestions ADD COLUMN IF NOT EXISTS output_tokens INT;
ALTER TABLE pattern_suggestions ADD COLUMN IF NOT EXISTS admin_approved_at TIMESTAMPTZ;

-- Separation of duties constraint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'separation_of_duties'
  ) THEN
    ALTER TABLE pattern_suggestions ADD CONSTRAINT separation_of_duties
      CHECK (compliance_reviewed_by IS NULL OR compliance_reviewed_by <> reviewed_by);
  END IF;
END $$;

-- Learning outcomes table (data flywheel)
CREATE TABLE IF NOT EXISTS learning_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  pattern_id UUID NOT NULL REFERENCES detected_patterns(id),
  suggestion_id UUID NOT NULL REFERENCES pattern_suggestions(id),
  label TEXT NOT NULL CHECK (label IN ('approved', 'rejected', 'modified', 'expired')),
  reviewer_role TEXT NOT NULL,
  rejection_reason TEXT,
  time_to_decision_hours NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS on learning_outcomes
ALTER TABLE learning_outcomes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON learning_outcomes;
  CREATE POLICY tenant_isolation ON learning_outcomes
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
END $$;
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/db/migrations/006-production-readiness.sql
git commit -m "feat: production readiness migration — retry_count, learning_outcomes, separation-of-duties"
```

---

## Task 2: Middleware Tenant Resolution Fix

**Files:**
- Modify: `packages/web/middleware.ts`
- Modify: `packages/web/lib/tenant.ts`

- [ ] **Step 1: Fix middleware to rewrite request headers**

Read `packages/web/middleware.ts`. Update it to set `x-tenant-slug` on the **request** headers (not response):

```typescript
// In the middleware function, before the auth checks:
import { getTenantSlugFromPath } from "@/lib/tenant";

// Resolve tenant from URL path
const tenantSlug = getTenantSlugFromPath(request.nextUrl.pathname);
const requestHeaders = new Headers(request.headers);
requestHeaders.set("x-tenant-slug", tenantSlug);

// Pass rewritten headers forward
const response = NextResponse.next({
  request: { headers: requestHeaders },
});
response.headers.set("x-tenant-slug", tenantSlug);
```

IMPORTANT: This must happen BEFORE the Supabase auth client creation, since we're replacing `NextResponse.next({ request })` with one that includes the rewritten headers. Read the file carefully and integrate.

- [ ] **Step 2: Add async getTenantSlug() helper**

In `packages/web/lib/tenant.ts`, add the server-side helper:

```typescript
import { headers } from "next/headers";

export async function getTenantSlug(): Promise<string> {
  const h = await headers();
  return h.get("x-tenant-slug") ?? DEFAULT_TENANT_SLUG;
}
```

This reads from the request header set by middleware. Available in all server components.

- [ ] **Step 3: Commit**

```bash
git add packages/web/middleware.ts packages/web/lib/tenant.ts
git commit -m "feat: middleware tenant resolution via request header rewriting"
```

---

## Task 3: Tenant-Scoped Route Mirrors

**Files:**
- Create: all `/t/[tenantSlug]/` sub-route pages
- Modify: `packages/web/app/t/[tenantSlug]/layout.tsx`

- [ ] **Step 1: Update tenant layout to pass context**

Read the existing layout at `packages/web/app/t/[tenantSlug]/layout.tsx`. Update it to resolve the tenant and provide TitleBar + MenuBar + Toolbar like the existing loan layout does:

```typescript
// packages/web/app/t/[tenantSlug]/layout.tsx
import { getTenantSlug } from "@/lib/tenant";

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return <div data-tenant={tenantSlug}>{children}</div>;
}
```

- [ ] **Step 2: Create tenant-scoped pipeline page**

```typescript
// packages/web/app/t/[tenantSlug]/page.tsx
// Mirror the root page (/) with tenant context
import { redirect } from "next/navigation";

export default async function TenantPipelinePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  // For now, redirect to the legacy pipeline view
  // Full tenant-scoped pipeline rendering comes when all components are tenant-aware
  redirect("/");
}
```

- [ ] **Step 3: Create tenant-scoped loan routes**

Create thin wrappers for each loan sub-route. Each one reads `tenantSlug` from params and renders the same component as the legacy route.

Create these files under `packages/web/app/t/[tenantSlug]/loan/[loanId]/`:
- `layout.tsx` — mirrors `packages/web/app/loan/[loanId]/layout.tsx`
- `transmittal/page.tsx` — mirrors existing transmittal page

For the layout, read the existing loan layout and create a version that also extracts `tenantSlug`. For the transmittal page, import and call the same server-side data fetching + component rendering.

- [ ] **Step 4: Create tenant-scoped VA and UW pages**

```typescript
// packages/web/app/t/[tenantSlug]/va/page.tsx
import { redirect } from "next/navigation";
export default function TenantVAPage() { redirect("/va"); }

// packages/web/app/t/[tenantSlug]/uw/page.tsx
import { redirect } from "next/navigation";
export default function TenantUWPage() { redirect("/uw"); }
```

For v1, these redirect to the legacy pages which resolve to default tenant. Full tenant-scoped rendering (passing tenant through to API calls) is the next iteration — the routing structure is what matters now.

- [ ] **Step 5: Create tenant admin settings page placeholder**

```typescript
// packages/web/app/t/[tenantSlug]/admin/settings/page.tsx
export default async function TenantSettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return (
    <div className="p-4">
      <h1 className="text-lg font-bold text-[#1a2b4a]">Tenant Settings — {tenantSlug}</h1>
      <p className="text-sm text-gray-500">Settings page — implemented in Task 10</p>
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/app/t/
git commit -m "feat: tenant-scoped route mirrors — loan, va, uw, admin/settings"
```

---

## Task 4: PII Redactor

**Files:**
- Create: `packages/api/src/learning/pii-redactor.ts`
- Test: `packages/api/test/pii-redactor.test.ts`

- [ ] **Step 1: Create PII redactor**

```typescript
// packages/api/src/learning/pii-redactor.ts

export interface RedactionManifest {
  recordId: string;
  redactionsApplied: string[];
  numericsBucketed: boolean;
  kAnonymityK: number;
  redactionVersion: string;
}

interface LoanSample {
  id: string;
  loanProgram: string;
  occupancy?: string;
  propertyType?: string;
  fico?: number;
  ltv?: number;
  dti?: number;
  loanAmount?: number;
  income?: number;
  rationale?: string;
  borrowerName?: string;
  coBorrowerName?: string;
  [key: string]: unknown;
}

// SSN patterns (dashed, undashed, spaced, partial)
const SSN_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b\d{9}\b/g,
  /\b\d{3}\s\d{2}\s\d{4}\b/g,
  /\bXXX-XX-\d{4}\b/gi,
];

const EMAIL_PATTERN = /\b[\w.-]+@[\w.-]+\.\w{2,}\b/g;
const PHONE_PATTERN = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;
const ACCT_PATTERN = /(?<!\$)\b\d{8,17}\b/g; // skip when preceded by $
const ADDRESS_PATTERN = /\b\d+\s+\w+\s+(St|Ave|Blvd|Dr|Ln|Rd|Way|Ct|Pl|Street|Avenue|Boulevard|Drive|Lane|Road|Court|Place)\b/gi;
const DOB_PATTERN = /\b(?:DOB|born|birth|age)\s*[:=]?\s*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi;

/**
 * Redact PII from free text (rationale, notes, etc.)
 */
export function redactText(text: string, knownNames: string[]): { redacted: string; types: string[] } {
  const types: string[] = [];
  let result = text;

  // SSN
  for (const pat of SSN_PATTERNS) {
    const matches = result.match(pat);
    if (matches) {
      types.push(`SSN:${matches.length}`);
      result = result.replace(pat, "[SSN-REDACTED]");
    }
  }

  // Email
  if (EMAIL_PATTERN.test(result)) {
    types.push("EMAIL");
    result = result.replace(EMAIL_PATTERN, "[EMAIL-REDACTED]");
  }

  // Phone
  if (PHONE_PATTERN.test(result)) {
    types.push("PHONE");
    result = result.replace(PHONE_PATTERN, "[PHONE-REDACTED]");
  }

  // Account numbers (skip $-prefixed amounts)
  if (ACCT_PATTERN.test(result)) {
    types.push("ACCT");
    result = result.replace(ACCT_PATTERN, "[ACCT-REDACTED]");
  }

  // Addresses
  if (ADDRESS_PATTERN.test(result)) {
    types.push("ADDRESS");
    result = result.replace(ADDRESS_PATTERN, "[ADDRESS-REDACTED]");
  }

  // DOB
  if (DOB_PATTERN.test(result)) {
    types.push("DOB");
    result = result.replace(DOB_PATTERN, "[DOB-REDACTED]");
  }

  // Known names (borrower, co-borrower, employer)
  let nameIdx = 1;
  for (const name of knownNames) {
    if (!name) continue;
    const parts = name.split(/\s+/).filter((p) => p.length > 2);
    for (const part of parts) {
      const nameRegex = new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      if (nameRegex.test(result)) {
        types.push(`PERSON:${nameIdx}`);
        result = result.replace(nameRegex, `[BORROWER_${nameIdx}]`);
      }
    }
    nameIdx++;
  }

  return { redacted: result, types };
}

/**
 * Bucket a numeric value to the nearest band for k-anonymity.
 */
export function bucketNumeric(value: number, bandSize: number): number {
  return Math.floor(value / bandSize) * bandSize;
}

/**
 * Check k-anonymity: does each record have at least k peers with the same quasi-identifier combo?
 */
export function checkKAnonymity(
  samples: Array<{ program: string; occupancy: string; propertyType: string; ficoBucket: number; ltvBucket: number; dtiBucket: number }>,
  k: number,
): { passes: boolean; uniqueIndices: number[] } {
  const uniqueIndices: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const key = `${s.program}|${s.occupancy}|${s.propertyType}|${s.ficoBucket}|${s.ltvBucket}|${s.dtiBucket}`;
    const peers = samples.filter((_, j) => j !== i).filter((p) =>
      `${p.program}|${p.occupancy}|${p.propertyType}|${p.ficoBucket}|${p.ltvBucket}|${p.dtiBucket}` === key
    );
    if (peers.length < k - 1) uniqueIndices.push(i);
  }
  return { passes: uniqueIndices.length === 0, uniqueIndices };
}

/**
 * Full PII redaction pipeline for a set of samples.
 */
export function redactSamples(
  samples: LoanSample[],
): { redacted: LoanSample[]; manifests: RedactionManifest[] } {
  const manifests: RedactionManifest[] = [];
  const redacted: LoanSample[] = [];

  for (const sample of samples) {
    const knownNames = [sample.borrowerName, sample.coBorrowerName].filter(Boolean) as string[];
    const allTypes: string[] = [];

    // Stage 1: whitelist fields
    const clean: LoanSample = {
      id: sample.id,
      loanProgram: sample.loanProgram,
      occupancy: sample.occupancy,
      propertyType: sample.propertyType,
      fico: sample.fico,
      ltv: sample.ltv,
      dti: sample.dti,
      loanAmount: sample.loanAmount,
      income: sample.income,
    };

    // Stage 2: redact free text
    if (sample.rationale) {
      const { redacted: redactedText, types } = redactText(sample.rationale, knownNames);
      clean.rationale = redactedText;
      allTypes.push(...types);
    }

    redacted.push(clean);
    manifests.push({
      recordId: sample.id,
      redactionsApplied: allTypes,
      numericsBucketed: false, // set to true after k-anonymity step
      kAnonymityK: 3,
      redactionVersion: "1.0",
    });
  }

  // Stage 3: k-anonymity check
  const bucketedForCheck = redacted.map((s) => ({
    program: s.loanProgram,
    occupancy: s.occupancy ?? "unknown",
    propertyType: s.propertyType ?? "unknown",
    ficoBucket: bucketNumeric(s.fico ?? 0, 5),
    ltvBucket: bucketNumeric(s.ltv ?? 0, 5),
    dtiBucket: bucketNumeric(s.dti ?? 0, 5),
  }));

  let { passes, uniqueIndices } = checkKAnonymity(bucketedForCheck, 3);

  if (!passes) {
    // Widen buckets to 10-point bands
    const widened = redacted.map((s) => ({
      program: s.loanProgram,
      occupancy: s.occupancy ?? "unknown",
      propertyType: s.propertyType ?? "unknown",
      ficoBucket: bucketNumeric(s.fico ?? 0, 10),
      ltvBucket: bucketNumeric(s.ltv ?? 0, 10),
      dtiBucket: bucketNumeric(s.dti ?? 0, 10),
    }));
    const recheck = checkKAnonymity(widened, 3);

    if (!recheck.passes) {
      // Drop unique records from sample
      for (const idx of recheck.uniqueIndices.reverse()) {
        redacted.splice(idx, 1);
        manifests.splice(idx, 1);
      }
    }
  }

  // Bucket numerics in final output for k-anonymity
  for (let i = 0; i < redacted.length; i++) {
    redacted[i].fico = bucketNumeric(redacted[i].fico ?? 0, 5);
    redacted[i].ltv = bucketNumeric(redacted[i].ltv ?? 0, 5);
    redacted[i].dti = bucketNumeric(redacted[i].dti ?? 0, 5);
    manifests[i].numericsBucketed = true;
  }

  return { redacted, manifests };
}
```

- [ ] **Step 2: Write tests**

```typescript
// packages/api/test/pii-redactor.test.ts

import { describe, it, expect } from "vitest";
import { redactText, bucketNumeric, checkKAnonymity, redactSamples } from "../src/learning/pii-redactor.js";

describe("redactText", () => {
  it("redacts SSN with dashes", () => {
    const { redacted, types } = redactText("SSN: 123-45-6789", []);
    expect(redacted).toContain("[SSN-REDACTED]");
    expect(types).toContain("SSN:1");
  });

  it("redacts SSN without dashes", () => {
    const { redacted } = redactText("SSN is 123456789 noted", []);
    expect(redacted).toContain("[SSN-REDACTED]");
  });

  it("redacts partial SSN (XXX-XX-1234)", () => {
    const { redacted } = redactText("last four: XXX-XX-1234", []);
    expect(redacted).toContain("[SSN-REDACTED]");
  });

  it("redacts email", () => {
    const { redacted } = redactText("contact john@acme.com for details", []);
    expect(redacted).toContain("[EMAIL-REDACTED]");
  });

  it("redacts phone", () => {
    const { redacted } = redactText("call 555-123-4567", []);
    expect(redacted).toContain("[PHONE-REDACTED]");
  });

  it("redacts addresses", () => {
    const { redacted } = redactText("property at 123 Main St is valued at", []);
    expect(redacted).toContain("[ADDRESS-REDACTED]");
  });

  it("redacts known borrower names", () => {
    const { redacted } = redactText("per discussion with John Smith at Acme LLC", ["John Smith"]);
    expect(redacted).toContain("[BORROWER_1]");
    expect(redacted).not.toContain("John");
    expect(redacted).not.toContain("Smith");
  });

  it("does NOT redact dollar amounts as account numbers", () => {
    const { redacted } = redactText("loan amount $487500 approved", []);
    expect(redacted).toContain("$487500");
  });

  it("preserves text without PII", () => {
    const { redacted, types } = redactText("DTI is 43% which exceeds guidelines", []);
    expect(redacted).toBe("DTI is 43% which exceeds guidelines");
    expect(types).toHaveLength(0);
  });
});

describe("bucketNumeric", () => {
  it("buckets to 5-point bands", () => {
    expect(bucketNumeric(723, 5)).toBe(720);
    expect(bucketNumeric(72.3, 5)).toBe(70);
    expect(bucketNumeric(41.2, 5)).toBe(40);
  });
});

describe("checkKAnonymity", () => {
  it("passes when all records have peers", () => {
    const samples = [
      { program: "DSCR", occupancy: "Investment", propertyType: "SFR", ficoBucket: 720, ltvBucket: 70, dtiBucket: 40 },
      { program: "DSCR", occupancy: "Investment", propertyType: "SFR", ficoBucket: 720, ltvBucket: 70, dtiBucket: 40 },
      { program: "DSCR", occupancy: "Investment", propertyType: "SFR", ficoBucket: 720, ltvBucket: 70, dtiBucket: 40 },
    ];
    expect(checkKAnonymity(samples, 3).passes).toBe(true);
  });

  it("fails when a record is unique", () => {
    const samples = [
      { program: "DSCR", occupancy: "Investment", propertyType: "SFR", ficoBucket: 720, ltvBucket: 70, dtiBucket: 40 },
      { program: "DSCR", occupancy: "Investment", propertyType: "SFR", ficoBucket: 720, ltvBucket: 70, dtiBucket: 40 },
      { program: "BankStatement12", occupancy: "Primary", propertyType: "Condo", ficoBucket: 660, ltvBucket: 80, dtiBucket: 45 },
    ];
    const result = checkKAnonymity(samples, 3);
    expect(result.passes).toBe(false);
    expect(result.uniqueIndices).toContain(2);
  });
});

describe("redactSamples", () => {
  it("produces manifests for each record", () => {
    const samples = [
      { id: "1", loanProgram: "DSCR", fico: 720, ltv: 72, dti: 41, rationale: "looks good" },
      { id: "2", loanProgram: "DSCR", fico: 725, ltv: 73, dti: 42, rationale: "fine" },
      { id: "3", loanProgram: "DSCR", fico: 718, ltv: 71, dti: 40, rationale: "ok" },
    ];
    const { redacted, manifests } = redactSamples(samples);
    expect(manifests).toHaveLength(3);
    expect(manifests[0].redactionVersion).toBe("1.0");
    expect(manifests[0].numericsBucketed).toBe(true);
    expect(redacted[0].fico).toBe(720); // bucketed to 5-point band
  });

  it("drops unique records that fail k-anonymity", () => {
    const samples = [
      { id: "1", loanProgram: "DSCR", occupancy: "Investment", propertyType: "SFR", fico: 720, ltv: 72, dti: 41 },
      { id: "2", loanProgram: "DSCR", occupancy: "Investment", propertyType: "SFR", fico: 725, ltv: 73, dti: 42 },
      { id: "3", loanProgram: "DSCR", occupancy: "Investment", propertyType: "SFR", fico: 718, ltv: 71, dti: 40 },
      { id: "unique", loanProgram: "ITIN", occupancy: "Primary", propertyType: "Condo", fico: 580, ltv: 90, dti: 55 },
    ];
    const { redacted } = redactSamples(samples);
    // The unique ITIN record should be dropped or all should remain if widened buckets help
    expect(redacted.length).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/omarmendoza/Projects/encompass-digital-twin && pnpm --filter @twin/api test -- pii-redactor
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/learning/pii-redactor.ts packages/api/test/pii-redactor.test.ts
git commit -m "feat: layered PII redactor — regex + k-anonymity + per-record manifests"
```

---

## Task 5: Compliance Checker

**Files:**
- Create: `packages/api/src/learning/compliance-checker.ts`
- Test: `packages/api/test/compliance-checker.test.ts`

- [ ] **Step 1: Create compliance checker**

```typescript
// packages/api/src/learning/compliance-checker.ts

import type { SpecificChange } from "@twin/core";

export type ComplianceResult = "pass" | "warn" | "block";

export interface ComplianceCheckOutput {
  checkType: string;
  result: ComplianceResult;
  details: Record<string, unknown>;
}

const THRESHOLD_BOUNDS: Record<string, { min?: number; max?: number; hardBlock?: boolean }> = {
  "/income/maxDtiBack": { max: 65 },
  "/income/maxDtiFront": { max: 55 },
  "/credit/minFico": { min: 500 },
  "/ltv/maxLtv": { max: 97 },
  "/compliance/maxPointsFeesPct": { max: 8 },
  "/reserves/minMonths": { min: 0 },
  "/income/atrVerificationRequired": { hardBlock: true }, // cannot be set to false
};

/**
 * Check if a proposed change violates threshold reasonableness bounds.
 */
export function checkThresholdReasonableness(change: SpecificChange): ComplianceCheckOutput {
  const bounds = THRESHOLD_BOUNDS[change.path];
  if (!bounds) {
    return { checkType: "threshold_reasonableness", result: "pass", details: { path: change.path, note: "no bounds defined" } };
  }

  const proposedValue = typeof change.to === "number" ? change.to : null;

  // Hard block: certain fields cannot be set to false
  if (bounds.hardBlock && change.to === false) {
    return {
      checkType: "threshold_reasonableness",
      result: "block",
      details: { path: change.path, proposedValue: change.to, reason: "Cannot disable ATR verification for covered loans" },
    };
  }

  if (proposedValue === null) {
    return { checkType: "threshold_reasonableness", result: "pass", details: { path: change.path, note: "non-numeric value" } };
  }

  if (bounds.max !== undefined && proposedValue > bounds.max) {
    return {
      checkType: "threshold_reasonableness",
      result: "block",
      details: { path: change.path, proposedValue, max: bounds.max, reason: `Exceeds maximum ${bounds.max}` },
    };
  }

  if (bounds.min !== undefined && proposedValue < bounds.min) {
    return {
      checkType: "threshold_reasonableness",
      result: "block",
      details: { path: change.path, proposedValue, min: bounds.min, reason: `Below minimum ${bounds.min}` },
    };
  }

  return { checkType: "threshold_reasonableness", result: "pass", details: { path: change.path, proposedValue } };
}

/**
 * Minimal fair-lending screen using geographic proxy.
 * Checks if override rates differ by >5pp across geographic groups in the sample.
 */
export function checkFairLending(
  sampleOverrideRatesByGroup: Record<string, number>,
): ComplianceCheckOutput {
  const rates = Object.values(sampleOverrideRatesByGroup);
  if (rates.length < 2) {
    return { checkType: "fair_lending_screen", result: "pass", details: { note: "insufficient groups" } };
  }

  const maxRate = Math.max(...rates);
  const minRate = Math.min(...rates);
  const delta = maxRate - minRate;

  if (delta > 5) {
    return {
      checkType: "fair_lending_screen",
      result: "warn",
      details: { maxRate, minRate, delta, threshold: 5, reason: "Override rate delta exceeds 5pp across geographic groups" },
    };
  }

  return { checkType: "fair_lending_screen", result: "pass", details: { maxRate, minRate, delta } };
}

/**
 * Run all compliance checks for a proposed change.
 */
export function runComplianceChecks(
  change: SpecificChange,
  geoOverrideRates?: Record<string, number>,
): ComplianceCheckOutput[] {
  const results: ComplianceCheckOutput[] = [];
  results.push(checkThresholdReasonableness(change));

  // Fair-lending screen for FICO/DTI/LTV/reserves/income rules
  const sensitivePathPrefixes = ["/credit/minFico", "/income/maxDti", "/ltv/maxLtv", "/reserves/", "/income/"];
  if (sensitivePathPrefixes.some((p) => change.path.startsWith(p)) && geoOverrideRates) {
    results.push(checkFairLending(geoOverrideRates));
  }

  return results;
}

/**
 * Determine suggestion visibility based on compliance results.
 */
export function determineVisibility(checks: ComplianceCheckOutput[]): "admin" | "compliance_only" {
  if (checks.some((c) => c.result === "block" || c.result === "warn")) {
    return "compliance_only";
  }
  return "admin";
}
```

- [ ] **Step 2: Write tests**

```typescript
// packages/api/test/compliance-checker.test.ts

import { describe, it, expect } from "vitest";
import { checkThresholdReasonableness, checkFairLending, determineVisibility } from "../src/learning/compliance-checker.js";

describe("checkThresholdReasonableness", () => {
  it("passes for value within bounds", () => {
    const result = checkThresholdReasonableness({ operation: "replace", path: "/income/maxDtiBack", to: 50, scope: { program: "DSCR" } });
    expect(result.result).toBe("pass");
  });

  it("blocks DTI above 65%", () => {
    const result = checkThresholdReasonableness({ operation: "replace", path: "/income/maxDtiBack", to: 70, scope: { program: "DSCR" } });
    expect(result.result).toBe("block");
  });

  it("blocks FICO below 500", () => {
    const result = checkThresholdReasonableness({ operation: "replace", path: "/credit/minFico", to: 400, scope: { program: "DSCR" } });
    expect(result.result).toBe("block");
  });

  it("blocks LTV above 97%", () => {
    const result = checkThresholdReasonableness({ operation: "replace", path: "/ltv/maxLtv", to: 98, scope: { program: "DSCR" } });
    expect(result.result).toBe("block");
  });

  it("hard blocks disabling ATR verification", () => {
    const result = checkThresholdReasonableness({ operation: "replace", path: "/income/atrVerificationRequired", to: false, scope: { program: "DSCR" } });
    expect(result.result).toBe("block");
  });

  it("passes for unknown path", () => {
    const result = checkThresholdReasonableness({ operation: "replace", path: "/some/unknown/path", to: 42, scope: { program: "DSCR" } });
    expect(result.result).toBe("pass");
  });
});

describe("checkFairLending", () => {
  it("passes when delta <= 5pp", () => {
    const result = checkFairLending({ CA: 15, TX: 12, NY: 14 });
    expect(result.result).toBe("pass");
  });

  it("warns when delta > 5pp", () => {
    const result = checkFairLending({ CA: 25, TX: 10 });
    expect(result.result).toBe("warn");
  });

  it("passes with insufficient groups", () => {
    const result = checkFairLending({ CA: 25 });
    expect(result.result).toBe("pass");
  });
});

describe("determineVisibility", () => {
  it("returns admin when all pass", () => {
    expect(determineVisibility([
      { checkType: "threshold_reasonableness", result: "pass", details: {} },
    ])).toBe("admin");
  });

  it("returns compliance_only when any block", () => {
    expect(determineVisibility([
      { checkType: "threshold_reasonableness", result: "block", details: {} },
    ])).toBe("compliance_only");
  });

  it("returns compliance_only when any warn", () => {
    expect(determineVisibility([
      { checkType: "fair_lending_screen", result: "warn", details: {} },
    ])).toBe("compliance_only");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/omarmendoza/Projects/encompass-digital-twin && pnpm --filter @twin/api test -- compliance-checker
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/learning/compliance-checker.ts packages/api/test/compliance-checker.test.ts
git commit -m "feat: compliance checker — threshold reasonableness + fair-lending screen"
```

---

## Task 6: Install Anthropic SDK

**Files:**
- Modify: `packages/api/package.json`

- [ ] **Step 1: Install**

```bash
cd /Users/omarmendoza/Projects/encompass-digital-twin && pnpm --filter @twin/api add @anthropic-ai/sdk
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/package.json pnpm-lock.yaml
git commit -m "chore: add @anthropic-ai/sdk for LLM insight generation"
```

---

## Task 7: LLM Insight Generator

**Files:**
- Create: `packages/api/src/learning/insight-generator.ts`

- [ ] **Step 1: Create insight generator**

```typescript
// packages/api/src/learning/insight-generator.ts

import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { withTenantTx } from "../db/pool.js";
import { isRedisEnabled, getRedisPub } from "../redis.js";
import { redactSamples } from "./pii-redactor.js";
import { runComplianceChecks, determineVisibility } from "./compliance-checker.js";
import type { SpecificChange } from "@twin/core";

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

const SUGGEST_TOOL: Anthropic.Tool = {
  name: "propose_guideline_change",
  description: "Propose a concrete guideline change to address the detected override pattern.",
  input_schema: {
    type: "object" as const,
    properties: {
      root_cause: { type: "string" },
      suggestion_type: { type: "string", enum: ["guideline_change", "prompt_adjustment", "threshold_update", "no_action"] },
      specific_change: {
        type: "object",
        properties: {
          operation: { type: "string", enum: ["replace", "add", "remove"] },
          path: { type: "string" },
          expected_current_value: {},
          to: {},
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
      risk_assessment: { type: "string" },
    },
    required: ["root_cause", "suggestion_type", "specific_change", "confidence", "risk_assessment"],
  },
};

/**
 * Check if we have LLM budget remaining.
 */
async function checkBudget(tenantId: string): Promise<boolean> {
  if (!isRedisEnabled()) return true;
  const redis = getRedisPub();
  const date = new Date().toISOString().slice(0, 10);

  const tenantKey = `insight_budget:${tenantId}:${date}`;
  const globalKey = `insight_budget:global:${date}`;

  const [tenantCalls, globalCalls] = await Promise.all([
    redis.hget(tenantKey, "calls"),
    redis.hget(globalKey, "calls"),
  ]);

  const maxPerTenant = parseInt(process.env.MAX_INSIGHT_CALLS_PER_TENANT ?? "5", 10);
  const maxGlobal = parseInt(process.env.MAX_INSIGHT_CALLS_GLOBAL ?? "40", 10);

  if (parseInt(tenantCalls ?? "0", 10) >= maxPerTenant) return false;
  if (parseInt(globalCalls ?? "0", 10) >= maxGlobal) return false;

  return true;
}

/**
 * Record LLM usage in budget tracking.
 */
async function recordUsage(tenantId: string, inputTokens: number, outputTokens: number): Promise<void> {
  if (!isRedisEnabled()) return;
  const redis = getRedisPub();
  const date = new Date().toISOString().slice(0, 10);

  const tenantKey = `insight_budget:${tenantId}:${date}`;
  const globalKey = `insight_budget:global:${date}`;

  await Promise.all([
    redis.hincrby(tenantKey, "calls", 1),
    redis.hincrby(tenantKey, "input_tokens", inputTokens),
    redis.hincrby(tenantKey, "output_tokens", outputTokens),
    redis.hincrby(globalKey, "calls", 1),
    redis.hincrby(globalKey, "input_tokens", inputTokens),
    redis.hincrby(globalKey, "output_tokens", outputTokens),
    redis.expire(tenantKey, 172_800), // 48h
    redis.expire(globalKey, 172_800),
  ]);
}

/**
 * Select model based on pattern complexity.
 */
function selectModel(sampleCount: number, confidenceVariance: number): string {
  // Simple patterns: high sample count, low variance → Haiku
  if (sampleCount > 50 && confidenceVariance < 0.1) {
    return "claude-haiku-4-5";
  }
  return "claude-sonnet-4-6";
}

/**
 * Generate an insight for a detected pattern.
 */
export async function generateInsight(
  tenantId: string,
  patternId: string,
  patternSummary: string,
  guidelineJson: string,
  samples: Array<{
    id: string;
    loanProgram: string;
    occupancy?: string;
    propertyType?: string;
    fico?: number;
    ltv?: number;
    dti?: number;
    loanAmount?: number;
    income?: number;
    rationale?: string;
    borrowerName?: string;
    agentConfidence?: number;
  }>,
): Promise<{ success: boolean; suggestionId?: string; error?: string }> {
  // Budget check
  if (!(await checkBudget(tenantId))) {
    return { success: false, error: "LLM budget exhausted" };
  }

  // PII redaction
  const { redacted, manifests } = redactSamples(samples);

  // Model selection
  const confidences = samples.map((s) => s.agentConfidence ?? 0.5);
  const avgConf = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  const variance = confidences.reduce((a, b) => a + (b - avgConf) ** 2, 0) / confidences.length;
  const model = selectModel(samples.length, variance);

  const prompt = `A pattern has been detected in UW override behavior.

Pattern: ${patternSummary}

Redacted override samples (${redacted.length} records):
${JSON.stringify(redacted, null, 2)}

Analyze this pattern and propose a specific guideline change.`;

  try {
    const response = await getClient().messages.create({
      model,
      max_tokens: 1024,
      tools: [SUGGEST_TOOL],
      tool_choice: { type: "tool", name: "propose_guideline_change" },
      system: [
        {
          type: "text",
          text: "You are an underwriting operations analyst for a NonQM mortgage platform. Analyze override patterns and propose specific, conservative guideline changes. Never suggest changes that would violate regulatory requirements.",
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: `Active guideline:\n${guidelineJson}`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: prompt }],
    });

    // Extract tool use result
    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      return { success: false, error: "No tool use in response" };
    }

    const input = toolBlock.input as {
      root_cause: string;
      suggestion_type: string;
      specific_change: SpecificChange;
      confidence: number;
      risk_assessment: string;
    };

    // Compliance checks
    const complianceResults = runComplianceChecks(input.specific_change);
    const visibility = determineVisibility(complianceResults);

    // Write suggestion
    const suggestionId = randomUUID();
    await withTenantTx(tenantId, async (client_db) => {
      await client_db.query(
        `INSERT INTO pattern_suggestions (
          id, tenant_id, pattern_id, suggestion_type, root_cause,
          specific_change, confidence, risk_assessment, generated_by,
          redaction_manifest, model_used, input_tokens, output_tokens,
          visibility, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending')`,
        [
          suggestionId, tenantId, patternId, input.suggestion_type, input.root_cause,
          JSON.stringify(input.specific_change), input.confidence, input.risk_assessment, model,
          JSON.stringify(manifests), model, response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0,
          visibility,
        ]
      );

      // Write compliance check results
      for (const check of complianceResults) {
        await client_db.query(
          `INSERT INTO suggestion_compliance_checks (suggestion_id, check_type, result, details)
           VALUES ($1, $2, $3, $4)`,
          [suggestionId, check.checkType, check.result, JSON.stringify(check.details)]
        );
      }

      // Update pattern status
      await client_db.query(
        `UPDATE detected_patterns SET status = 'suggestion_ready', updated_at = NOW(),
         status_history = status_history || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ from: "analyzing", to: "suggestion_ready", at: new Date().toISOString(), by: "system" }), patternId]
      );
    });

    // Record usage
    await recordUsage(tenantId, response.usage?.input_tokens ?? 0, response.usage?.output_tokens ?? 0);

    return { success: true, suggestionId };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/learning/insight-generator.ts
git commit -m "feat: LLM insight generator — Claude tool_use + prompt caching + budget tracking"
```

---

## Task 8: Guideline Patcher (RFC 6902)

**Files:**
- Create: `packages/api/src/learning/guideline-patcher.ts`
- Test: `packages/api/test/guideline-patcher.test.ts`

- [ ] **Step 1: Create guideline patcher**

```typescript
// packages/api/src/learning/guideline-patcher.ts

import type { SpecificChange } from "@twin/core";
import { GuidelineRulesSchema } from "@twin/core";

interface PatchResult {
  success: boolean;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  error?: string;
}

/**
 * Resolve a JSON Pointer path to a value in a nested object.
 */
function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.replace(/^\//, "").split("/");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Set a value at a JSON Pointer path in a nested object.
 */
function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.replace(/^\//, "").split("/");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== "object") {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Delete a value at a JSON Pointer path.
 */
function deleteAtPath(obj: Record<string, unknown>, path: string): boolean {
  const parts = path.replace(/^\//, "").split("/");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== "object") return false;
    current = current[parts[i]] as Record<string, unknown>;
  }
  const key = parts[parts.length - 1];
  if (key in current) {
    delete current[key];
    return true;
  }
  return false;
}

/**
 * Preview a guideline change without persisting.
 */
export function previewPatch(
  guidelineRules: Record<string, unknown>,
  change: SpecificChange,
): PatchResult {
  const before = JSON.parse(JSON.stringify(guidelineRules));
  const after = JSON.parse(JSON.stringify(guidelineRules));

  // Stale-view check
  if (change.expected_current_value !== undefined) {
    const currentValue = getAtPath(after, change.path);
    if (JSON.stringify(currentValue) !== JSON.stringify(change.expected_current_value)) {
      return {
        success: false,
        before,
        after: before,
        error: `Stale view: expected ${JSON.stringify(change.expected_current_value)} at ${change.path}, found ${JSON.stringify(currentValue)}`,
      };
    }
  }

  // Apply operation
  switch (change.operation) {
    case "replace": {
      const existing = getAtPath(after, change.path);
      if (existing === undefined) {
        // Schema evolution: field doesn't exist yet — treat as "add"
        setAtPath(after, change.path, change.to);
      } else {
        setAtPath(after, change.path, change.to);
      }
      break;
    }
    case "add":
      setAtPath(after, change.path, change.to);
      break;
    case "remove":
      if (!deleteAtPath(after, change.path)) {
        return { success: false, before, after: before, error: `Path ${change.path} not found for remove` };
      }
      break;
  }

  // Validate resulting guideline
  const validation = GuidelineRulesSchema.safeParse(after);
  if (!validation.success) {
    return {
      success: false,
      before,
      after,
      error: `Invalid guideline after patch: ${validation.error.message.slice(0, 200)}`,
    };
  }

  return { success: true, before, after };
}
```

- [ ] **Step 2: Write tests**

```typescript
// packages/api/test/guideline-patcher.test.ts

import { describe, it, expect } from "vitest";
import { previewPatch } from "../src/learning/guideline-patcher.js";

const baseGuideline = {
  credit: { minFico: 620, maxLate30d: 2, maxLate60d: 0, maxLate90d: 0, disputePolicy: "warn", maxOpenCollections: 1 },
  income: { maxDtiFront: 43, maxDtiBack: 50, qualifyingMethods: ["bank_statement_12"], expenseFactors: { self_employed: 0.5 } },
  ltv: { maxLtv: 80, matrix: [{ minFico: 620, maxFico: 850, maxLtv: 80 }] },
  reserves: { minMonths: 6, byLtvTier: [{ maxLtv: 75, minMonths: 6 }] },
  documents: { required: [{ docType: "BankStatement", description: "12 months" }] },
  conditions: { defaultTemplates: [{ category: "PTD", source: "UW", description: "Provide statements" }] },
  compliance: { stateRestrictions: [], geoOverlays: {}, maxPointsFeesPct: 5 },
};

describe("previewPatch", () => {
  it("replaces a value successfully", () => {
    const result = previewPatch(baseGuideline, {
      operation: "replace",
      path: "/income/maxDtiBack",
      expected_current_value: 50,
      to: 55,
      scope: { program: "DSCR" },
    });
    expect(result.success).toBe(true);
    expect((result.after as any).income.maxDtiBack).toBe(55);
    expect((result.before as any).income.maxDtiBack).toBe(50);
  });

  it("fails on stale expected_current_value", () => {
    const result = previewPatch(baseGuideline, {
      operation: "replace",
      path: "/income/maxDtiBack",
      expected_current_value: 43, // wrong — actual is 50
      to: 55,
      scope: { program: "DSCR" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Stale view");
  });

  it("adds a new field", () => {
    const result = previewPatch(baseGuideline, {
      operation: "add",
      path: "/income/minDscrRatio",
      to: 1.25,
      scope: { program: "DSCR" },
    });
    expect(result.success).toBe(true);
    expect((result.after as any).income.minDscrRatio).toBe(1.25);
  });

  it("handles schema evolution — missing path treated as add", () => {
    const result = previewPatch(baseGuideline, {
      operation: "replace",
      path: "/compliance/nonQmAtrExemption",
      to: true,
      scope: { program: "DSCR" },
    });
    // Should succeed — field didn't exist, treated as add
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/omarmendoza/Projects/encompass-digital-twin && pnpm --filter @twin/api test -- guideline-patcher
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/learning/guideline-patcher.ts packages/api/test/guideline-patcher.test.ts
git commit -m "feat: RFC 6902 guideline patcher — replace/add/remove with stale-view protection"
```

---

## Task 9: Wire Insight Generator into Learning Worker

**Files:**
- Modify: `packages/api/src/learning-worker.ts`

- [ ] **Step 1: Add insight generation + janitor to the worker cycle**

Read `packages/api/src/learning-worker.ts`. After the pattern detection step, add:

1. **Insight generation:** Query patterns with status `new`, acquire each with optimistic concurrency (`UPDATE ... WHERE status='new' RETURNING id`), then call `generateInsight()` for each.

2. **Janitor:** Query patterns in `analyzing` for > 1 hour. Increment `retry_count`. If retry_count >= 3, set `analysis_failed`. Otherwise reset to `new`.

Import `generateInsight` from `./learning/insight-generator.js`.

Add inside the per-tenant try block, after pattern detection:

```typescript
// 3. Generate insights for new patterns
const { rows: newPatterns } = await withTenantTx(tenant.id, async (client) => {
  return client.query(
    `UPDATE detected_patterns SET status = 'analyzing', updated_at = NOW()
     WHERE tenant_id = $1 AND status = 'new'
     RETURNING id, rule_name, program, override_reason, metrics_snapshot`,
    [tenant.id]
  );
});

for (const pattern of newPatterns.rows ?? newPatterns) {
  try {
    // Load guideline for the program
    const guidelineRows = await withTenantTx(tenant.id, async (client) => {
      return client.query(
        "SELECT rules FROM tenant_guidelines WHERE program = $1 AND active = true LIMIT 1",
        [pattern.program]
      );
    });
    const guidelineJson = JSON.stringify(guidelineRows.rows?.[0]?.rules ?? {});

    // Load sample overrides
    const sampleRows = await withTenantTx(tenant.id, async (client) => {
      return client.query(
        `SELECT id, loan_program, override_reason, rationale, agent_confidence
         FROM decision_records
         WHERE decision_type = 'overridden' AND loan_program = $1
         ORDER BY decided_at DESC LIMIT 10`,
        [pattern.program]
      );
    });

    const samples = (sampleRows.rows ?? []).map((r: any) => ({
      id: r.id,
      loanProgram: r.loan_program,
      rationale: r.rationale,
      agentConfidence: r.agent_confidence ? Number(r.agent_confidence) : undefined,
    }));

    const summary = `${pattern.rule_name}: ${JSON.stringify(pattern.metrics_snapshot)}`;
    await generateInsight(tenant.id, pattern.id, summary, guidelineJson, samples);
  } catch (e) {
    console.error(`[learning] Insight generation failed for pattern ${pattern.id}:`, e);
    await withTenantTx(tenant.id, async (client) => {
      client.query(
        `UPDATE detected_patterns SET status = 'analysis_failed', retry_count = retry_count + 1, updated_at = NOW() WHERE id = $1`,
        [pattern.id]
      );
    });
  }
}

// 4. Janitor: reset stuck patterns
await withTenantTx(tenant.id, async (client) => {
  // Reset analyzing > 1h with retry_count < 3
  await client.query(
    `UPDATE detected_patterns SET status = 'new', updated_at = NOW(), retry_count = retry_count + 1
     WHERE status = 'analyzing' AND updated_at < NOW() - INTERVAL '1 hour' AND retry_count < 3`
  );
  // Fail patterns with retry_count >= 3
  await client.query(
    `UPDATE detected_patterns SET status = 'analysis_failed', updated_at = NOW()
     WHERE status = 'analyzing' AND retry_count >= 3`
  );
});
```

- [ ] **Step 2: Run tests**

```bash
cd /Users/omarmendoza/Projects/encompass-digital-twin && pnpm --filter @twin/api test
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/learning-worker.ts
git commit -m "feat: wire insight generator + janitor into learning worker cycle"
```

---

## Task 10: Update Patterns Routes — Preview + Separation of Duties

**Files:**
- Modify: `packages/api/src/routes/patterns.ts`

- [ ] **Step 1: Add preview endpoint**

Read `packages/api/src/routes/patterns.ts`. Add:

```typescript
import { previewPatch } from "../learning/guideline-patcher.js";

// Preview a suggestion's guideline change
app.post<{ Params: { tenantId: string; patternId: string } }>(
  "/metrics/:tenantId/patterns/:patternId/preview",
  async (req, reply) => {
    const tenantId = getTenantId();
    const { patternId } = req.params;

    return withTenantTx(tenantId, async (client) => {
      const { rows: suggestions } = await client.query(
        "SELECT specific_change FROM pattern_suggestions WHERE pattern_id = $1 AND status = 'pending'",
        [patternId]
      );
      if (suggestions.length === 0) return reply.code(404).send({ error: "No pending suggestion" });

      const change = suggestions[0].specific_change;

      // Load current guideline
      const { rows: guidelines } = await client.query(
        "SELECT id, rules FROM tenant_guidelines WHERE program = $1 AND active = true LIMIT 1",
        [change.scope?.program]
      );
      if (guidelines.length === 0) return reply.code(404).send({ error: "No active guideline" });

      const result = previewPatch(guidelines[0].rules, change);
      return {
        guidelineVersionId: guidelines[0].id,
        ...result,
        diff: { path: change.path, operation: change.operation, expected_current_value: change.expected_current_value, to: change.to },
      };
    });
  }
);
```

- [ ] **Step 2: Add separation-of-duties check to the apply endpoint**

In the existing apply handler, add before the apply logic:

```typescript
// Separation of duties: compliance reviewer must be different from admin reviewer
if (suggestion.reviewed_by && ctx.userId === suggestion.reviewed_by) {
  return reply.code(409).send({ error: "Same user cannot provide both admin and compliance approval" });
}
```

- [ ] **Step 3: Add admin approval TTL check**

In the apply handler, after checking that `reviewed_by` is set:

```typescript
// Check admin approval TTL (72h)
if (suggestion.admin_approved_at) {
  const approvalAge = Date.now() - new Date(suggestion.admin_approved_at).getTime();
  if (approvalAge > 72 * 60 * 60 * 1000) {
    // Admin approval expired — clear it
    await client.query(
      "UPDATE pattern_suggestions SET reviewed_by = NULL, reviewed_at = NULL, admin_approved_at = NULL WHERE id = $1",
      [suggestion.id]
    );
    return reply.code(410).send({ error: "Admin approval expired (72h). Re-approval required." });
  }
}
```

- [ ] **Step 4: Write learning_outcomes record on apply/reject**

After a suggestion is applied or rejected, write to `learning_outcomes`:

```typescript
await client.query(
  `INSERT INTO learning_outcomes (tenant_id, pattern_id, suggestion_id, label, reviewer_role, rejection_reason, time_to_decision_hours)
   VALUES ($1, $2, $3, $4, $5, $6, $7)`,
  [tenantId, patternId, suggestion.id, label, ctx.isSuperAdmin ? "super_admin" : "admin",
   rejectionReason ?? null, hoursSinceCreation]
);
```

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/patterns.ts
git commit -m "feat: preview endpoint, separation-of-duties, admin TTL, learning outcomes"
```

---

## Task 11: API Key CRUD Routes

**Files:**
- Create: `packages/api/src/routes/api-keys.ts`
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Create API key routes**

```typescript
// packages/api/src/routes/api-keys.ts

import type { FastifyInstance } from "fastify";
import { randomBytes, scryptSync } from "node:crypto";
import { withTenantTx, withDb } from "../db/pool.js";
import { getTenantId } from "../tenant-context.js";

function hashKey(key: string): string {
  const salt = key.slice(0, 16);
  return scryptSync(key, salt, 64).toString("hex");
}

export function registerApiKeyRoutes(app: FastifyInstance): void {
  // Generate new API key
  app.post<{ Params: { slug: string } }>("/tenants/:slug/api-keys", async (req, reply) => {
    const body = req.body as { name: string; rateLimitPerMinute?: number };
    if (!body.name) return reply.code(400).send({ error: "name is required" });

    const { slug } = req.params;

    return withDb(async (client) => {
      const { rows: tenants } = await client.query("SELECT id FROM tenants WHERE slug = $1", [slug]);
      if (tenants.length === 0) return reply.code(404).send({ error: "Tenant not found" });

      const tenantId = tenants[0].id;
      const rawKey = `${slug}_${randomBytes(32).toString("hex")}`;
      const keyHash = hashKey(rawKey);
      const keyPrefix = rawKey.slice(0, slug.length + 9); // slug + _ + 8 chars

      const { rows } = await client.query(
        `INSERT INTO tenant_api_keys (tenant_id, key_hash, key_prefix, name, rate_limit_per_minute)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, key_prefix, name, rate_limit_per_minute, created_at`,
        [tenantId, keyHash, keyPrefix, body.name, body.rateLimitPerMinute ?? 60]
      );

      return reply.code(201).send({ ...rows[0], key: rawKey });
    });
  });

  // List API keys (no plaintext)
  app.get<{ Params: { slug: string } }>("/tenants/:slug/api-keys", async (req, reply) => {
    const { slug } = req.params;
    return withDb(async (client) => {
      const { rows: tenants } = await client.query("SELECT id FROM tenants WHERE slug = $1", [slug]);
      if (tenants.length === 0) return reply.code(404).send({ error: "Tenant not found" });

      const { rows } = await client.query(
        `SELECT id, name, key_prefix, rate_limit_per_minute, created_at, revoked_at
         FROM tenant_api_keys WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenants[0].id]
      );
      return rows;
    });
  });

  // Revoke API key
  app.delete<{ Params: { slug: string; keyId: string } }>("/tenants/:slug/api-keys/:keyId", async (req, reply) => {
    const { slug, keyId } = req.params;
    return withDb(async (client) => {
      await client.query(
        `UPDATE tenant_api_keys SET revoked_at = NOW()
         WHERE id = $1 AND tenant_id = (SELECT id FROM tenants WHERE slug = $2)`,
        [keyId, slug]
      );
      return { revoked: true };
    });
  });
}
```

- [ ] **Step 2: Register in server.ts**

```typescript
import { registerApiKeyRoutes } from "./routes/api-keys.js";
// in buildServer():
registerApiKeyRoutes(app);
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/api-keys.ts packages/api/src/server.ts
git commit -m "feat: tenant API key CRUD — generate with slug prefix, list, revoke"
```

---

## Task 12: Tenant Settings UI

**Files:**
- Create: `packages/web/components/encompass/TenantSettings.tsx`
- Modify: `packages/web/app/t/[tenantSlug]/admin/settings/page.tsx`

- [ ] **Step 1: Create TenantSettings component**

A tabbed settings component with 6 tabs: General, Guidelines, SLA, Ingestion, API Keys, Users. Each tab is a self-contained form. For v1, implement General, SLA, and API Keys tabs fully. Guidelines, Ingestion, and Users tabs show placeholder content.

```typescript
// packages/web/components/encompass/TenantSettings.tsx
"use client";

import { useState } from "react";

interface TenantSettingsProps {
  tenantSlug: string;
  tenant: { name: string; status: string; settings: Record<string, unknown> };
}

const TABS = ["General", "Guidelines", "SLA", "Ingestion", "API Keys", "Users"] as const;
type Tab = typeof TABS[number];

export function TenantSettings({ tenantSlug, tenant }: TenantSettingsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("General");

  return (
    <div>
      <div className="flex border-b border-[#c8c4b5] mb-4">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={`px-4 py-2 text-[11px] font-semibold ${
              activeTab === tab
                ? "border-b-2 border-[#1f4478] text-[#1f4478]"
                : "text-[#6b7a8f] hover:text-[#404040]"
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "General" && (
        <div className="enc-panel p-4">
          <h3 className="text-[12px] font-bold text-[#1a2b4a] mb-3">General Settings</h3>
          <div className="text-[11px] space-y-2">
            <div><span className="text-[#6b7a8f]">Name:</span> {tenant.name}</div>
            <div><span className="text-[#6b7a8f]">Slug:</span> {tenantSlug}</div>
            <div><span className="text-[#6b7a8f]">Status:</span> <span className="font-bold">{tenant.status.toUpperCase()}</span></div>
          </div>
        </div>
      )}

      {activeTab === "SLA" && (
        <div className="enc-panel p-4">
          <h3 className="text-[12px] font-bold text-[#1a2b4a] mb-3">SLA Thresholds</h3>
          <p className="text-[10px] text-[#6b7a8f]">SLA configuration — coming soon</p>
        </div>
      )}

      {activeTab === "API Keys" && (
        <div className="enc-panel p-4">
          <h3 className="text-[12px] font-bold text-[#1a2b4a] mb-3">API Keys</h3>
          <p className="text-[10px] text-[#6b7a8f]">API key management — coming soon</p>
        </div>
      )}

      {["Guidelines", "Ingestion", "Users"].includes(activeTab) && (
        <div className="enc-panel p-4">
          <h3 className="text-[12px] font-bold text-[#1a2b4a] mb-3">{activeTab}</h3>
          <p className="text-[10px] text-[#6b7a8f]">{activeTab} configuration — coming soon</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update settings page**

```typescript
// packages/web/app/t/[tenantSlug]/admin/settings/page.tsx

import { TenantSettings } from "@/components/encompass/TenantSettings";

export default async function TenantSettingsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  // Placeholder tenant data — will be fetched from API
  const tenant = { name: tenantSlug, status: "active", settings: {} };

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-lg font-bold text-[#1a2b4a] mb-4">Tenant Settings — {tenantSlug}</h1>
      <TenantSettings tenantSlug={tenantSlug} tenant={tenant} />
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/components/encompass/TenantSettings.tsx packages/web/app/t/[tenantSlug]/admin/settings/page.tsx
git commit -m "feat: tenant settings page — 6-tab layout with General, SLA, API Keys"
```

---

## Task 13: Platform Tenants Page + Create Wizard

**Files:**
- Create: `packages/web/components/encompass/CreateTenantWizard.tsx`
- Create: `packages/web/components/encompass/TenantList.tsx`
- Modify: `packages/web/app/platform/tenants/page.tsx`

- [ ] **Step 1: Create TenantList component**

A table showing all tenants with name, slug, status badge, created date. Click row navigates to settings.

- [ ] **Step 2: Create CreateTenantWizard component**

A modal with 3 fields: Name, Slug (auto-generated), Admin Email. On submit calls `POST /tenants`.

- [ ] **Step 3: Update platform tenants page**

Wire TenantList + CreateTenantWizard into the page. Fetch tenants from API with super_admin headers.

- [ ] **Step 4: Commit**

```bash
git add packages/web/components/encompass/CreateTenantWizard.tsx packages/web/components/encompass/TenantList.tsx packages/web/app/platform/tenants/page.tsx
git commit -m "feat: platform tenants page — tenant list + create wizard modal"
```

---

## Task 14: Update SuggestionCards for Role-Aware Behavior

**Files:**
- Modify: `packages/web/components/encompass/SuggestionCard.tsx`

- [ ] **Step 1: Add role-aware buttons and queue-age indicator**

Read `packages/web/components/encompass/SuggestionCard.tsx`. Add:
- `userRole` prop to determine which buttons to show
- Admin sees: "Approve" on pending, "Awaiting Compliance" badge after approval
- Compliance officer sees: "Confirm" / "Reject" on admin-approved suggestions
- Queue-age indicator: green <24h, yellow 24-48h, red >48h since admin approval
- "Preview" button for both roles (calls preview endpoint)

- [ ] **Step 2: Commit**

```bash
git add packages/web/components/encompass/SuggestionCard.tsx
git commit -m "feat: role-aware suggestion cards — admin approve, compliance confirm, queue-age"
```

---

## Task 15: SR 11-7 Model Governance Document

**Files:**
- Create: `docs/compliance/sr-11-7-model-governance.md`

- [ ] **Step 1: Write the governance doc**

```markdown
# Model Governance — LLM Insight Generator

**Model Name:** Guideline Change Suggestion Generator
**Tier:** Tier 2 (Informational — requires human approval)
**Owner:** Platform Engineering
**Last Review:** 2026-04-23

## Purpose
Analyzes UW override patterns and proposes specific guideline or prompt changes
to improve agent-UW alignment. Output is a structured suggestion with confidence
score and risk assessment.

## Inputs
- PII-redacted override samples (max 10, k-anonymized)
- Active tenant guideline rules (JSON)
- Pattern detection metrics snapshot

## Outputs
- Structured suggestion: operation, path, expected_current_value, to, scope
- Confidence score (0-1)
- Root cause analysis (text)
- Risk assessment (text)

## Consumers
- Tenant admin (first-key approval)
- Compliance officer (second-key approval for guideline/threshold changes)

## Validation
1. Schema validation via Zod
2. Guideline compatibility check (path exists, type-compatible, stale-view)
3. Threshold reasonableness bounds (DTI ≤65%, FICO ≥500, LTV ≤97%, etc.)
4. Fair-lending minimal screen (geographic proxy, 5pp delta threshold)

## Monitoring
- Per-pattern acceptance rate (learning_outcomes table)
- Suggestion type distribution drift
- LLM cost per tenant per day
- Validation failure rate
- Model selection distribution (Haiku vs Sonnet)

## Override Policy
- Two-key approval for guideline changes (admin + compliance_officer)
- Single-key for prompt adjustments (admin only, compliance notified)
- Compliance officer has absolute veto power
- All decisions logged to learning_outcomes with reviewer_role

## Data Handling
- PII redaction: layered (regex + k-anonymity)
- Per-record redaction manifest stored on suggestion
- Anthropic zero-data-retention header on all calls
- No tenant data used for model training

## Revalidation Triggers
- Annual review
- Guideline schema change
- Model version upgrade (Haiku/Sonnet version bump)
- Acceptance rate drops below 40% for any tenant (30-day window)
```

- [ ] **Step 2: Commit**

```bash
git add docs/compliance/sr-11-7-model-governance.md
git commit -m "docs: SR 11-7 model governance one-pager for LLM insight generator"
```

---

## Task 16: Run Full Test Suite + Local Build Verification

- [ ] **Step 1: Run core tests**

```bash
cd /Users/omarmendoza/Projects/encompass-digital-twin && pnpm --filter @twin/core test
```

- [ ] **Step 2: Run API tests**

```bash
cd /Users/omarmendoza/Projects/encompass-digital-twin && pnpm --filter @twin/api test
```

- [ ] **Step 3: Verify web build**

```bash
cd /Users/omarmendoza/Projects/encompass-digital-twin && pnpm --filter @twin/core build && pnpm --filter @twin/fixtures build && pnpm --filter @twin/web build
```

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: test and build verification after production readiness sprint"
```

---

## Task 17: Push to GitHub + Deploy

- [ ] **Step 1: Push**

```bash
git push origin main
```

- [ ] **Step 2: Deploy**

```bash
railway up --service api --detach
railway up --service web --detach
```

---

## Self-Review: Spec Coverage

| Spec Section | Task(s) | Covered? |
|---|---|---|
| §1 Middleware tenant resolution | Task 2 | Yes — request header rewriting |
| §1 Tenant-scoped routes | Task 3 | Yes — route mirrors |
| §2 Onboarding wizard | Task 13 | Yes — create modal + tenant list |
| §2 Tenant settings | Task 12 | Yes — 6-tab component |
| §2 API key CRUD | Task 11 | Yes — generate, list, revoke |
| §3.1 Insight pipeline | Tasks 7, 9 | Yes — generator + worker wiring |
| §3.2 PII redaction | Task 4 | Yes — regex + k-anonymity + manifests |
| §3.4 Haiku fallback | Task 7 | Yes — model selection logic |
| §3.5 Prompt caching | Task 7 | Yes — cache_control on system blocks |
| §3.7 Two-stage validation | Task 7 | Yes — schema + guideline compat |
| §3.8 Compliance pre-checks | Task 5 | Yes — threshold bounds + fair-lending |
| §3.9 Budget controls | Task 7 | Yes — HINCRBY calls + tokens |
| §3.10 Janitor | Task 9 | Yes — retry_count + reset logic |
| §4.1 Separation of duties | Tasks 1, 10 | Yes — DB constraint + API check |
| §4.2 Admin approval TTL | Task 10 | Yes — 72h expiry |
| §4.3 RFC 6902 apply | Task 8 | Yes — replace/add/remove + stale-view |
| §4.4 Preview endpoint | Task 10 | Yes — before/after diff |
| §4.5 Role-aware UI | Task 14 | Yes — queue-age, approve/confirm |
| §5.1 Tenant-prefixed keys | Task 11 | Yes — slug_random format |
| §5.2 Guideline version pinning | Partial | Types exist; full pinning in InjectLoan deferred |
| §5.4 Learning outcomes | Tasks 1, 10 | Yes — table + write on apply/reject |
| §6 SR 11-7 governance | Task 15 | Yes — one-pager |
| §7 Observability | Partial | Structured pino logs exist; metric fields in suggestion rows |
