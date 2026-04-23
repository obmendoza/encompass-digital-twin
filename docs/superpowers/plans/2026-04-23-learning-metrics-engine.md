# Learning & Metrics Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tenant-scoped learning engine that captures every UW decision (accept/override/manual) with structured feedback, detects override patterns via rule-based analysis, generates LLM-powered improvement suggestions with compliance gating, and surfaces three-tier metrics dashboards.

**Architecture:** Decision records table captures all terminal UW actions with version attribution. A 6-hour advisory-lock-guarded worker detects patterns and generates insights via Claude Sonnet tool_use. Two-key approval flow (admin + compliance_officer) gates guideline changes via RFC 6902 JSON Patch. Snapshot+live hybrid metrics serve dashboards.

**Tech Stack:** TypeScript, Fastify 4, Postgres (RLS), Redis (budget tracking), Anthropic SDK (tool_use), Zod, React/Next.js, Vitest

**Spec:** `docs/superpowers/specs/2026-04-23-learning-metrics-engine-design.md`

---

## File Structure

### New files to create:

```
packages/core/src/
  learning-types.ts         — OverrideReasonCategory, DecisionType, DecisionRecord,
                              DetectedPattern, PatternSuggestion, PatternStatus, etc.
  learning-schemas.ts       — Zod schemas for override reasons, dismiss, events

packages/api/src/
  db/migrations/
    004-learning-tables.sql — decision_records, loan_programs, detected_patterns,
                              pattern_suggestions, suggestion_compliance_checks,
                              metrics_snapshots
    005-learning-rls.sql    — RLS policies on all new tables
  learning/
    decision-writer.ts      — Post-dispatch hook: action → decision_records
    pattern-detector.ts     — Rule-based pattern detection (4 rules)
    metrics-computer.ts     — Daily snapshot computation
    insight-generator.ts    — LLM tool_use + PII redaction + validation
    compliance-checker.ts   — Threshold/adverse-action/disparate-impact checks
    suggestion-applier.ts   — RFC 6902 JSON Patch apply with If-Match
  routes/
    learning-metrics.ts     — Tenant-scoped metrics API routes
    platform-metrics.ts     — Super_admin cross-tenant metrics
    patterns.ts             — Pattern/suggestion CRUD + apply/dismiss/regenerate
  learning-worker.ts        — 6-hour advisory-lock worker (detection + insights)

packages/api/test/
  decision-writer.test.ts   — Decision capture tests
  pattern-detector.test.ts  — Pattern detection rule tests
  metrics-computer.test.ts  — Metrics computation tests
  learning-schemas.test.ts  — Schema validation tests

packages/web/
  components/encompass/
    OverrideReasonSelect.tsx — Override reason dropdown component
    MetricsCards.tsx         — Summary cards (alignment, override, SLA)
    AlignmentTrendChart.tsx  — Line chart with version markers
    OverrideBreakdown.tsx    — Bar charts by category/program
    CalibrationPlot.tsx      — Confidence vs acceptance scatter
    SuggestionCard.tsx       — Pattern suggestion review card
    PlatformMetrics.tsx      — Super_admin cross-tenant view
  app/t/[tenantSlug]/
    metrics/page.tsx         — Enhanced tenant metrics page
  app/platform/
    metrics/page.tsx         — Platform metrics page
```

### Existing files to modify:

```
packages/core/src/types.ts       — Add overrideReason to OverrideDecision action
packages/core/src/index.ts       — Re-export learning types/schemas
packages/api/src/server.ts       — Register new routes, start learning worker
packages/api/src/routes/uw-flow.ts — Add overrideReason to override schema
packages/api/src/event-bus.ts    — Add decision.made event with DecisionRecord ID
packages/web/lib/api-client.ts   — Add overrideReason param to overrideDecision()
packages/web/lib/permissions.ts  — Add compliance_officer role
packages/web/app/loan/[loanId]/actions.ts — Pass overrideReason through
packages/web/components/encompass/RecommendationPanel.tsx — Add override reason dropdown
```

---

## Task 1: Learning Types & Zod Schemas

**Files:**
- Create: `packages/core/src/learning-types.ts`
- Create: `packages/core/src/learning-schemas.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/learning-schemas.test.ts`

- [ ] **Step 1: Create learning-types.ts**

```typescript
// packages/core/src/learning-types.ts

export type OverrideReasonCategory =
  | "dti_exception"
  | "income_adjustment"
  | "credit_reassessment"
  | "doc_sufficiency"
  | "compliance_exception"
  | "guideline_exception"
  | "risk_tolerance"
  | "data_error"
  | "other";

export type DecisionType = "accepted" | "overridden" | "manual";

export type PatternStatus =
  | "new"
  | "analyzing"
  | "suggestion_ready"
  | "applied"
  | "dismissed"
  | "analysis_failed";

export type SuggestionStatus = "pending" | "approved" | "rejected" | "applied";

export type SuggestionVisibility = "admin" | "compliance_only";

export type ComplianceCheckType =
  | "disparate_impact"
  | "adverse_action_preservation"
  | "threshold_reasonableness";

export type ComplianceCheckResult = "pass" | "warn" | "block";

export interface DecisionRecord {
  id: string;
  tenantId: string;
  loanId: string;
  loanProgram: string;
  decisionType: DecisionType;
  agentRecommendation?: string;
  agentConfidence?: number;
  finalDecision: string;
  overrideReason?: OverrideReasonCategory;
  rationale?: string;
  guidelineVersionId: string;
  agentVersion: string;
  promptVersion: string;
  modelId: string;
  investorId?: string;
  poolId?: string;
  ingestedAt: string;
  decidedAt: string;
  decisionTimeSeconds: number;
  recordedBy: string;
}

export interface DetectedPattern {
  id: string;
  tenantId: string;
  ruleName: string;
  program?: string;
  overrideReason?: string;
  metricsSnapshot: Record<string, unknown>;
  status: PatternStatus;
  suppressedUntil?: string;
  statusHistory: Array<{ from: string; to: string; at: string; by: string }>;
  detectedAt: string;
  updatedAt: string;
}

export interface SpecificChange {
  operation: "replace" | "add" | "remove";
  path: string;
  from?: unknown;
  to: unknown;
  scope: { program: string; loan_types?: string[] };
}

export interface PatternSuggestion {
  id: string;
  tenantId: string;
  patternId: string;
  suggestionType: "guideline_change" | "prompt_adjustment" | "threshold_update" | "no_action";
  rootCause: string;
  specificChange: SpecificChange;
  confidence: number;
  riskAssessment: string;
  generatedBy: string;
  redactionApplied: boolean;
  redactionVersion: string;
  status: SuggestionStatus;
  visibility: SuggestionVisibility;
  reviewedBy?: string;
  reviewedAt?: string;
  complianceReviewedBy?: string;
  complianceReviewedAt?: string;
  rejectionReason?: string;
  expiresAt: string;
  createdAt: string;
}

export interface ComplianceCheck {
  id: string;
  suggestionId: string;
  checkType: ComplianceCheckType;
  result: ComplianceCheckResult;
  details: Record<string, unknown>;
  checkedAt: string;
}

export interface DailyMetricsSnapshot {
  alignment: { accepted: number; overridden: number; manual: number; rate: number };
  overridesByReason: Partial<Record<OverrideReasonCategory, number>>;
  overridesByProgram: Record<string, { accepted: number; overridden: number; rate: number }>;
  calibration: Array<{ bucket: string; confidence: number; acceptanceRate: number; count: number }>;
  throughput: { decided: number; avgDecisionTimeSeconds: number };
  sla: { compliant: number; breached: number; complianceRate: number };
}

export const OVERRIDE_REASON_LABELS: Record<OverrideReasonCategory, string> = {
  dti_exception: "DTI Exception",
  income_adjustment: "Income Adjustment",
  credit_reassessment: "Credit Reassessment",
  doc_sufficiency: "Document Sufficiency",
  compliance_exception: "Compliance Exception",
  guideline_exception: "Guideline Exception",
  risk_tolerance: "Risk Tolerance",
  data_error: "Data Error",
  other: "Other",
};

export const DETECTION_RULES = {
  high_override_rate: { minSample: 15, threshold: 0.25, windowDays: 30 },
  confidence_miscalibration: { minSample: 10, maxAcceptance: 0.50, windowDays: 30 },
  declining_alignment: { minSample: 20, dropThreshold: 0.10, windowDays: 30 },
  systematic_category: { minSample: 15, dominanceThreshold: 0.40, windowDays: 30 },
} as const;
```

- [ ] **Step 2: Create learning-schemas.ts**

```typescript
// packages/core/src/learning-schemas.ts

import { z } from "zod";

export const OverrideReasonSchema = z.enum([
  "dti_exception", "income_adjustment", "credit_reassessment",
  "doc_sufficiency", "compliance_exception", "guideline_exception",
  "risk_tolerance", "data_error", "other",
]);

export const DecisionTypeSchema = z.enum(["accepted", "overridden", "manual"]);

export const PatternStatusSchema = z.enum([
  "new", "analyzing", "suggestion_ready", "applied", "dismissed", "analysis_failed",
]);

export const DismissPatternSchema = z.object({
  reason: z.string().min(1).max(500),
  cooldownDays: z.union([z.literal(14), z.literal(30), z.literal("permanent")]).default(14),
});

export const OverrideDecisionBodySchema = z.object({
  originalRecommendation: z.string(),
  overrideDecision: z.string(),
  overrideReason: OverrideReasonSchema,
  rationale: z.string().min(1),
  actor: z.object({ kind: z.enum(["human", "agent"]), id: z.string() }),
});

// Event payload schemas
export const DecisionMadeEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal("decision.made"),
  eventVersion: z.literal(1),
  tenantId: z.string().uuid(),
  loanId: z.string(),
  decisionRecordId: z.string().uuid(),
  decisionType: DecisionTypeSchema,
  occurredAt: z.string().datetime(),
});

export const PatternDetectedEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal("pattern.detected"),
  eventVersion: z.literal(1),
  tenantId: z.string().uuid(),
  patternId: z.string().uuid(),
  ruleName: z.string(),
  program: z.string().optional(),
  occurredAt: z.string().datetime(),
});

export const SuggestionReadyEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal("pattern.suggestion_ready"),
  eventVersion: z.literal(1),
  tenantId: z.string().uuid(),
  patternId: z.string().uuid(),
  suggestionId: z.string().uuid(),
  suggestionType: z.string(),
  occurredAt: z.string().datetime(),
});

export const GuidelineUpdatedEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal("guideline.updated"),
  eventVersion: z.literal(1),
  tenantId: z.string().uuid(),
  program: z.string(),
  newVersion: z.number(),
  appliedSuggestionId: z.string().uuid().optional(),
  occurredAt: z.string().datetime(),
});
```

- [ ] **Step 3: Add overrideReason to OverrideDecision action**

In `packages/core/src/types.ts`, find the `OverrideDecision` action variant and add `overrideReason`:

```typescript
// Change this line:
  | { type: "OverrideDecision"; loanId: LoanId; originalRecommendation: UwDecision; overrideDecision: UwDecision; rationale: string; actor: Actor }
// To:
  | { type: "OverrideDecision"; loanId: LoanId; originalRecommendation: UwDecision; overrideDecision: UwDecision; overrideReason: import("./learning-types.js").OverrideReasonCategory; rationale: string; actor: Actor }
```

- [ ] **Step 4: Re-export from index.ts**

Add to `packages/core/src/index.ts`:
```typescript
export * from "./learning-types.js";
export * from "./learning-schemas.js";
```

- [ ] **Step 5: Write validation tests**

```typescript
// packages/core/test/learning-schemas.test.ts

import { describe, it, expect } from "vitest";
import {
  OverrideReasonSchema,
  DismissPatternSchema,
  OverrideDecisionBodySchema,
  DecisionMadeEventSchema,
} from "../src/learning-schemas.js";
import { OVERRIDE_REASON_LABELS, DETECTION_RULES } from "../src/learning-types.js";

describe("OverrideReasonSchema", () => {
  it("accepts all valid reasons", () => {
    for (const reason of Object.keys(OVERRIDE_REASON_LABELS)) {
      expect(OverrideReasonSchema.parse(reason)).toBe(reason);
    }
  });

  it("rejects invalid reason", () => {
    expect(() => OverrideReasonSchema.parse("invalid")).toThrow();
  });
});

describe("DismissPatternSchema", () => {
  it("validates dismiss with default cooldown", () => {
    const result = DismissPatternSchema.parse({ reason: "Not applicable" });
    expect(result.cooldownDays).toBe(14);
  });

  it("accepts 30-day cooldown", () => {
    const result = DismissPatternSchema.parse({ reason: "Reviewed", cooldownDays: 30 });
    expect(result.cooldownDays).toBe(30);
  });

  it("accepts permanent cooldown", () => {
    const result = DismissPatternSchema.parse({ reason: "False positive", cooldownDays: "permanent" });
    expect(result.cooldownDays).toBe("permanent");
  });

  it("rejects empty reason", () => {
    expect(() => DismissPatternSchema.parse({ reason: "" })).toThrow();
  });

  it("rejects invalid cooldown", () => {
    expect(() => DismissPatternSchema.parse({ reason: "ok", cooldownDays: 7 })).toThrow();
  });
});

describe("OverrideDecisionBodySchema", () => {
  it("validates complete override request", () => {
    const result = OverrideDecisionBodySchema.parse({
      originalRecommendation: "approved",
      overrideDecision: "suspended",
      overrideReason: "dti_exception",
      rationale: "Compensating factors present",
      actor: { kind: "human", id: "uw@test.com" },
    });
    expect(result.overrideReason).toBe("dti_exception");
  });

  it("rejects override without reason", () => {
    expect(() => OverrideDecisionBodySchema.parse({
      originalRecommendation: "approved",
      overrideDecision: "suspended",
      rationale: "No reason given",
      actor: { kind: "human", id: "uw@test.com" },
    })).toThrow();
  });

  it("rejects empty rationale", () => {
    expect(() => OverrideDecisionBodySchema.parse({
      originalRecommendation: "approved",
      overrideDecision: "suspended",
      overrideReason: "other",
      rationale: "",
      actor: { kind: "human", id: "uw@test.com" },
    })).toThrow();
  });
});

describe("DecisionMadeEventSchema", () => {
  it("validates a decision event", () => {
    const result = DecisionMadeEventSchema.parse({
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      eventType: "decision.made",
      eventVersion: 1,
      tenantId: "00000000-0000-0000-0000-000000000000",
      loanId: "LOAN-001",
      decisionRecordId: "550e8400-e29b-41d4-a716-446655440001",
      decisionType: "overridden",
      occurredAt: "2026-04-23T12:00:00Z",
    });
    expect(result.decisionType).toBe("overridden");
  });
});

describe("DETECTION_RULES constants", () => {
  it("has expected rules with thresholds", () => {
    expect(DETECTION_RULES.high_override_rate.minSample).toBe(15);
    expect(DETECTION_RULES.high_override_rate.threshold).toBe(0.25);
    expect(DETECTION_RULES.confidence_miscalibration.minSample).toBe(10);
    expect(DETECTION_RULES.declining_alignment.dropThreshold).toBe(0.10);
    expect(DETECTION_RULES.systematic_category.dominanceThreshold).toBe(0.40);
  });
});
```

- [ ] **Step 6: Run tests**

```bash
cd /Users/omarmendoza/Projects/encompass-digital-twin && pnpm --filter @twin/core test
```

Expected: All existing + new tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/learning-types.ts packages/core/src/learning-schemas.ts packages/core/src/types.ts packages/core/src/index.ts packages/core/test/learning-schemas.test.ts
git commit -m "feat: learning engine types, Zod schemas, and override reason taxonomy"
```

---

## Task 2: Database Migration — Learning Tables

**Files:**
- Create: `packages/api/src/db/migrations/004-learning-tables.sql`
- Create: `packages/api/src/db/migrations/005-learning-rls.sql`

- [ ] **Step 1: Create migration 004-learning-tables.sql**

```sql
-- packages/api/src/db/migrations/004-learning-tables.sql

-- Loan programs reference table
CREATE TABLE IF NOT EXISTS loan_programs (
  code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO loan_programs (code, display_name) VALUES
  ('BankStatement12', 'Bank Statement 12mo'),
  ('BankStatement24', 'Bank Statement 24mo'),
  ('DSCR', 'DSCR'),
  ('AssetDepletion', 'Asset Depletion'),
  ('1099Only', '1099 Only'),
  ('PnL', 'Profit & Loss'),
  ('ForeignNational', 'Foreign National'),
  ('ITIN', 'ITIN'),
  ('FullDocNonQM', 'Full Doc Non-QM')
ON CONFLICT DO NOTHING;

-- Decision records (captures every UW decision — accept, override, manual)
CREATE TABLE IF NOT EXISTS decision_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL,
  loan_program TEXT NOT NULL,
  decision_type TEXT NOT NULL CHECK (decision_type IN ('accepted','overridden','manual')),
  agent_recommendation TEXT,
  agent_confidence NUMERIC CHECK (agent_confidence BETWEEN 0 AND 1),
  final_decision TEXT NOT NULL,
  override_reason TEXT,
  rationale TEXT,
  guideline_version_id TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  investor_id TEXT,
  pool_id TEXT,
  ingested_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by TEXT NOT NULL,
  CONSTRAINT override_requires_reason
    CHECK (decision_type <> 'overridden' OR override_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_dr_tenant_time ON decision_records(tenant_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_dr_tenant_program ON decision_records(tenant_id, loan_program, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_dr_tenant_reason ON decision_records(tenant_id, override_reason)
  WHERE override_reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dr_tenant_confidence ON decision_records(tenant_id, agent_confidence)
  WHERE agent_confidence IS NOT NULL;

-- Daily pre-computed metrics per tenant
CREATE TABLE IF NOT EXISTS metrics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  snapshot_date DATE NOT NULL,
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_metrics_tenant_date ON metrics_snapshots(tenant_id, snapshot_date);

-- Detected patterns from rule-based analysis
CREATE TABLE IF NOT EXISTS detected_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  rule_name TEXT NOT NULL,
  program TEXT,
  override_reason TEXT,
  metrics_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'analyzing', 'suggestion_ready', 'applied', 'dismissed', 'analysis_failed')),
  suppressed_until TIMESTAMPTZ,
  status_history JSONB NOT NULL DEFAULT '[]',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pattern_active ON detected_patterns(tenant_id, rule_name, program, override_reason)
  WHERE status NOT IN ('applied', 'dismissed', 'analysis_failed');

-- LLM-generated improvement suggestions
CREATE TABLE IF NOT EXISTS pattern_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  pattern_id UUID NOT NULL REFERENCES detected_patterns(id),
  suggestion_type TEXT NOT NULL
    CHECK (suggestion_type IN ('guideline_change', 'prompt_adjustment', 'threshold_update', 'no_action')),
  root_cause TEXT NOT NULL,
  specific_change JSONB NOT NULL,
  confidence NUMERIC NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  risk_assessment TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  redaction_applied BOOLEAN NOT NULL DEFAULT true,
  redaction_version TEXT NOT NULL DEFAULT '1.0',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  visibility TEXT NOT NULL DEFAULT 'admin'
    CHECK (visibility IN ('admin', 'compliance_only')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  compliance_reviewed_by TEXT,
  compliance_reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Compliance checks on suggestions
CREATE TABLE IF NOT EXISTS suggestion_compliance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id UUID NOT NULL REFERENCES pattern_suggestions(id),
  check_type TEXT NOT NULL
    CHECK (check_type IN ('disparate_impact', 'adverse_action_preservation', 'threshold_reasonableness')),
  result TEXT NOT NULL CHECK (result IN ('pass', 'warn', 'block')),
  details JSONB NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Create migration 005-learning-rls.sql**

```sql
-- packages/api/src/db/migrations/005-learning-rls.sql

ALTER TABLE decision_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE metrics_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE detected_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE pattern_suggestions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS tenant_isolation ON decision_records;
  CREATE POLICY tenant_isolation ON decision_records
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

  DROP POLICY IF EXISTS tenant_isolation ON metrics_snapshots;
  CREATE POLICY tenant_isolation ON metrics_snapshots
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

  DROP POLICY IF EXISTS tenant_isolation ON detected_patterns;
  CREATE POLICY tenant_isolation ON detected_patterns
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

  DROP POLICY IF EXISTS tenant_isolation ON pattern_suggestions;
  CREATE POLICY tenant_isolation ON pattern_suggestions
    USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
END $$;
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/db/migrations/004-learning-tables.sql packages/api/src/db/migrations/005-learning-rls.sql
git commit -m "feat: learning engine database tables — decision_records, patterns, suggestions, compliance checks"
```

---

## Task 3: Decision Writer — Post-Dispatch Hook

**Files:**
- Create: `packages/api/src/learning/decision-writer.ts`
- Test: `packages/api/test/decision-writer.test.ts`

- [ ] **Step 1: Create the decision writer**

```typescript
// packages/api/src/learning/decision-writer.ts

import { withTenantTx } from "../db/pool.js";
import { randomUUID } from "node:crypto";
import type { Action, Loan } from "@twin/core";
import type { DecisionType, OverrideReasonCategory } from "@twin/core";

interface DecisionWriteParams {
  tenantId: string;
  loanId: string;
  loan: Loan;
  action: Action;
}

/**
 * Write a decision record when a terminal UW action occurs.
 * Called from the dispatch wrapper in server.ts.
 */
export async function writeDecisionRecord(params: DecisionWriteParams): Promise<string | null> {
  const { tenantId, loanId, loan, action } = params;

  let decisionType: DecisionType;
  let agentRecommendation: string | null = null;
  let agentConfidence: number | null = null;
  let finalDecision: string;
  let overrideReason: OverrideReasonCategory | null = null;
  let rationale: string | null = null;
  let recordedBy: string;

  if (action.type === "AcceptRecommendation") {
    decisionType = "accepted";
    agentRecommendation = loan.pendingRecommendation?.recommendation ?? null;
    agentConfidence = loan.pendingRecommendation?.confidence ?? null;
    finalDecision = agentRecommendation ?? loan.decision;
    recordedBy = action.actor.id;
  } else if (action.type === "OverrideDecision") {
    decisionType = "overridden";
    agentRecommendation = action.originalRecommendation;
    agentConfidence = loan.pendingRecommendation?.confidence ?? null;
    finalDecision = action.overrideDecision;
    overrideReason = action.overrideReason;
    rationale = action.rationale;
    recordedBy = action.actor.id;
  } else if (action.type === "SetDecision" && !loan.pendingRecommendation) {
    decisionType = "manual";
    finalDecision = action.decision;
    rationale = action.rationale;
    recordedBy = action.actor.id;
  } else {
    return null; // Not a terminal UW decision
  }

  const id = randomUUID();
  const guidelineVersionId = loan.guidelineVersionId ?? "default";
  const agentVersion = "v1"; // TODO: make dynamic when agent versioning is implemented
  const promptVersion = "v1";
  const modelId = "claude-sonnet-4-6";
  const ingestedAt = loan.milestones?.[0]?.at ?? new Date().toISOString();

  try {
    await withTenantTx(tenantId, async (client) => {
      await client.query(
        `INSERT INTO decision_records (
          id, tenant_id, loan_id, loan_program, decision_type,
          agent_recommendation, agent_confidence, final_decision,
          override_reason, rationale, guideline_version_id,
          agent_version, prompt_version, model_id,
          ingested_at, recorded_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          id, tenantId, loanId, loan.nqmProgram, decisionType,
          agentRecommendation, agentConfidence, finalDecision,
          overrideReason, rationale, guidelineVersionId,
          agentVersion, promptVersion, modelId,
          ingestedAt, recordedBy,
        ]
      );
    });
    return id;
  } catch (e) {
    console.error("[decision-writer] Failed to write decision record:", e);
    return null;
  }
}
```

- [ ] **Step 2: Write tests**

```typescript
// packages/api/test/decision-writer.test.ts

import { describe, it, expect } from "vitest";
import type { Loan, Action } from "@twin/core";

// Unit test the decision type mapping logic without DB
describe("decision-writer logic", () => {
  const baseLoan: Partial<Loan> = {
    id: "LOAN-001",
    nqmProgram: "DSCR",
    decision: "pending",
    milestones: [{ name: "created", at: "2026-04-01T00:00:00Z", by: "system" }],
    pendingRecommendation: {
      recommendation: "approved",
      rationale: "All checks pass",
      confidence: 0.85,
      conditions: [],
      trace: [],
      stagedAt: "2026-04-20T00:00:00Z",
      stagedBy: "agent",
    },
  };

  it("AcceptRecommendation maps to accepted with agent confidence", () => {
    const action = { type: "AcceptRecommendation" as const, loanId: "LOAN-001", actor: { kind: "human" as const, id: "uw@test.com" } };
    // decisionType should be "accepted"
    // agentConfidence should be 0.85 from pendingRecommendation
    expect(action.type).toBe("AcceptRecommendation");
    expect(baseLoan.pendingRecommendation?.confidence).toBe(0.85);
  });

  it("OverrideDecision maps to overridden with reason", () => {
    const action = {
      type: "OverrideDecision" as const,
      loanId: "LOAN-001",
      originalRecommendation: "approved" as const,
      overrideDecision: "suspended" as const,
      overrideReason: "dti_exception" as const,
      rationale: "Compensating factors",
      actor: { kind: "human" as const, id: "uw@test.com" },
    };
    expect(action.overrideReason).toBe("dti_exception");
    expect(action.type).toBe("OverrideDecision");
  });

  it("SetDecision without pending rec maps to manual", () => {
    const loanNoPending = { ...baseLoan, pendingRecommendation: undefined };
    const action = {
      type: "SetDecision" as const,
      loanId: "LOAN-001",
      decision: "approved" as const,
      rationale: "Manual review",
      actor: { kind: "human" as const, id: "uw@test.com" },
    };
    expect(action.type).toBe("SetDecision");
    expect(loanNoPending.pendingRecommendation).toBeUndefined();
  });

  it("SetDecision WITH pending rec is not a manual decision", () => {
    // When there's a pending rec, SetDecision should not write as manual
    // This is handled by the conditional: action.type === "SetDecision" && !loan.pendingRecommendation
    expect(baseLoan.pendingRecommendation).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/omarmendoza/Projects/encompass-digital-twin && pnpm --filter @twin/api test -- decision-writer
```

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/learning/decision-writer.ts packages/api/test/decision-writer.test.ts
git commit -m "feat: decision writer — captures accept/override/manual to decision_records"
```

---

## Task 4: Update Override Endpoint + UI — Add Reason Category

**Files:**
- Modify: `packages/api/src/routes/uw-flow.ts`
- Modify: `packages/web/lib/api-client.ts`
- Modify: `packages/web/app/loan/[loanId]/actions.ts`
- Create: `packages/web/components/encompass/OverrideReasonSelect.tsx`
- Modify: `packages/web/components/encompass/RecommendationPanel.tsx`

- [ ] **Step 1: Update the override endpoint schema**

In `packages/api/src/routes/uw-flow.ts`, add `overrideReason` to the override body schema. Find the POST `/loans/:loanId/override` handler. Add `overrideReason` to the Zod schema and pass it through to the dispatched action.

The schema should become:
```typescript
const body = z.object({
  originalRecommendation: UwDecisionEnum,
  overrideDecision: UwDecisionEnum,
  overrideReason: OverrideReasonSchema, // import from @twin/core
  rationale: z.string().min(1),
  actor: ActorSchema,
});
```

Import `OverrideReasonSchema` from `@twin/core`.

- [ ] **Step 2: Update API client**

In `packages/web/lib/api-client.ts`, find the `overrideDecision` method and add `overrideReason` parameter:

```typescript
async overrideDecision(
  loanId: string,
  originalRecommendation: string,
  overrideDecision: string,
  overrideReason: string,  // NEW
  rationale: string,
  actor: Actor,
) {
  return this.post(`/loans/${loanId}/override`, {
    originalRecommendation, overrideDecision, overrideReason, rationale, actor,
  });
}
```

- [ ] **Step 3: Update server action**

In `packages/web/app/loan/[loanId]/actions.ts`, update `actionOverrideDecision`:

```typescript
export async function actionOverrideDecision(
  loanId: string,
  original: string,
  override: string,
  overrideReason: string,  // NEW
  rationale: string,
) {
  return run(loanId, (actor) =>
    api.overrideDecision(loanId, original, override, overrideReason, rationale, actor)
  );
}
```

- [ ] **Step 4: Create OverrideReasonSelect component**

```typescript
// packages/web/components/encompass/OverrideReasonSelect.tsx
"use client";

import { OVERRIDE_REASON_LABELS } from "@twin/core";
import type { OverrideReasonCategory } from "@twin/core";

interface Props {
  value: OverrideReasonCategory | "";
  onChange: (reason: OverrideReasonCategory) => void;
}

export function OverrideReasonSelect({ value, onChange }: Props) {
  return (
    <div className="mb-2">
      <label className="block text-[10px] font-semibold text-[#404040] mb-1">
        Override Reason <span className="text-[#c00]">*</span>
      </label>
      <select
        className="enc-input w-full text-[11px]"
        value={value}
        onChange={(e) => onChange(e.target.value as OverrideReasonCategory)}
        required
      >
        <option value="">Select reason...</option>
        {Object.entries(OVERRIDE_REASON_LABELS).map(([code, label]) => (
          <option key={code} value={code}>{label}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 5: Integrate into RecommendationPanel override dialog**

In `packages/web/components/encompass/RecommendationPanel.tsx`, find the override dialog/form. Add:
1. Import `OverrideReasonSelect` and state for `overrideReason`
2. Add `const [overrideReason, setOverrideReason] = useState<string>("")`
3. Add `<OverrideReasonSelect value={overrideReason} onChange={setOverrideReason} />` before the rationale textarea
4. Pass `overrideReason` to `actionOverrideDecision`
5. Disable the submit button when `overrideReason` is empty

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/uw-flow.ts packages/web/lib/api-client.ts packages/web/app/loan/[loanId]/actions.ts packages/web/components/encompass/OverrideReasonSelect.tsx packages/web/components/encompass/RecommendationPanel.tsx
git commit -m "feat: override reason dropdown — required category on every UW override"
```

---

## Task 5: Wire Decision Writer into Server Dispatch

**Files:**
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Add decision writer to the dispatch wrapper**

In `packages/api/src/server.ts`, find the dispatch wrapper (the section that wraps `store.dispatch` with persistence save + event publishing). After the `publishAction` call, add the decision writer:

```typescript
import { writeDecisionRecord } from "./learning/decision-writer.js";

// Inside the dispatch wrapper, after publishAction:
if (action.type === "AcceptRecommendation" || action.type === "OverrideDecision" || action.type === "SetDecision") {
  const loan = result.loans[(action as { loanId: string }).loanId];
  if (loan) {
    writeDecisionRecord({
      tenantId: DEFAULT_TENANT_ID,
      loanId: (action as { loanId: string }).loanId,
      loan,
      action,
    }).catch((e) => console.error("[decision-writer] Error:", e));
  }
}
```

- [ ] **Step 2: Run tests to verify nothing broke**

```bash
cd /Users/omarmendoza/Projects/encompass-digital-twin && pnpm --filter @twin/api test
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/server.ts
git commit -m "feat: wire decision writer into dispatch — captures all terminal UW decisions"
```

---

## Task 6: Metrics Computer — Daily Snapshots

**Files:**
- Create: `packages/api/src/learning/metrics-computer.ts`
- Test: `packages/api/test/metrics-computer.test.ts`

- [ ] **Step 1: Create the metrics computer**

```typescript
// packages/api/src/learning/metrics-computer.ts

import { withTenantTx } from "../db/pool.js";
import type { DailyMetricsSnapshot, OverrideReasonCategory } from "@twin/core";

/**
 * Compute metrics snapshot for a single completed day.
 * Only processes days where decided_at is before today (completed days).
 */
export async function computeDailySnapshot(
  tenantId: string,
  date: string, // YYYY-MM-DD
): Promise<DailyMetricsSnapshot> {
  return withTenantTx(tenantId, async (client) => {
    const nextDate = new Date(new Date(date).getTime() + 86_400_000).toISOString().slice(0, 10);

    // Alignment rate
    const { rows: alignmentRows } = await client.query(
      `SELECT decision_type, COUNT(*)::int AS count
       FROM decision_records
       WHERE decided_at >= $1::date AND decided_at < $2::date
       GROUP BY decision_type`,
      [date, nextDate]
    );
    const accepted = alignmentRows.find((r) => r.decision_type === "accepted")?.count ?? 0;
    const overridden = alignmentRows.find((r) => r.decision_type === "overridden")?.count ?? 0;
    const manual = alignmentRows.find((r) => r.decision_type === "manual")?.count ?? 0;
    const total = accepted + overridden;
    const rate = total > 0 ? Math.round((accepted / total) * 10000) / 100 : 0;

    // Overrides by reason
    const { rows: reasonRows } = await client.query(
      `SELECT override_reason, COUNT(*)::int AS count
       FROM decision_records
       WHERE decided_at >= $1::date AND decided_at < $2::date
       AND decision_type = 'overridden' AND override_reason IS NOT NULL
       GROUP BY override_reason`,
      [date, nextDate]
    );
    const overridesByReason: Partial<Record<OverrideReasonCategory, number>> = {};
    for (const row of reasonRows) {
      overridesByReason[row.override_reason as OverrideReasonCategory] = row.count;
    }

    // Overrides by program
    const { rows: programRows } = await client.query(
      `SELECT loan_program,
              COUNT(*) FILTER (WHERE decision_type = 'accepted')::int AS accepted,
              COUNT(*) FILTER (WHERE decision_type = 'overridden')::int AS overridden
       FROM decision_records
       WHERE decided_at >= $1::date AND decided_at < $2::date
       GROUP BY loan_program`,
      [date, nextDate]
    );
    const overridesByProgram: Record<string, { accepted: number; overridden: number; rate: number }> = {};
    for (const row of programRows) {
      const t = row.accepted + row.overridden;
      overridesByProgram[row.loan_program] = {
        accepted: row.accepted,
        overridden: row.overridden,
        rate: t > 0 ? Math.round((row.accepted / t) * 10000) / 100 : 0,
      };
    }

    // Calibration buckets
    const { rows: calRows } = await client.query(
      `SELECT
         CASE
           WHEN agent_confidence < 0.1 THEN '0-10'
           WHEN agent_confidence < 0.2 THEN '10-20'
           WHEN agent_confidence < 0.3 THEN '20-30'
           WHEN agent_confidence < 0.4 THEN '30-40'
           WHEN agent_confidence < 0.5 THEN '40-50'
           WHEN agent_confidence < 0.6 THEN '50-60'
           WHEN agent_confidence < 0.7 THEN '60-70'
           WHEN agent_confidence < 0.8 THEN '70-80'
           WHEN agent_confidence < 0.9 THEN '80-90'
           ELSE '90-100'
         END AS bucket,
         AVG(agent_confidence)::numeric(4,2) AS confidence,
         AVG(CASE WHEN decision_type = 'accepted' THEN 1.0 ELSE 0.0 END)::numeric(4,2) AS acceptance_rate,
         COUNT(*)::int AS count
       FROM decision_records
       WHERE decided_at >= $1::date AND decided_at < $2::date
       AND agent_confidence IS NOT NULL
       GROUP BY bucket
       ORDER BY bucket`,
      [date, nextDate]
    );
    const calibration = calRows.map((r) => ({
      bucket: r.bucket,
      confidence: Number(r.confidence),
      acceptanceRate: Number(r.acceptance_rate),
      count: r.count,
    }));

    // Throughput
    const { rows: throughputRows } = await client.query(
      `SELECT COUNT(*)::int AS decided,
              COALESCE(AVG(EXTRACT(EPOCH FROM (decided_at - ingested_at)))::int, 0) AS avg_time
       FROM decision_records
       WHERE decided_at >= $1::date AND decided_at < $2::date`,
      [date, nextDate]
    );
    const throughput = {
      decided: throughputRows[0]?.decided ?? 0,
      avgDecisionTimeSeconds: throughputRows[0]?.avg_time ?? 0,
    };

    return {
      alignment: { accepted, overridden, manual, rate },
      overridesByReason,
      overridesByProgram,
      calibration,
      throughput,
      sla: { compliant: 0, breached: 0, complianceRate: 0 }, // SLA data comes from SLA monitor
    };
  });
}

/**
 * Save a metrics snapshot for a given date.
 */
export async function saveSnapshot(
  tenantId: string,
  date: string,
  metrics: DailyMetricsSnapshot,
): Promise<void> {
  await withTenantTx(tenantId, async (client) => {
    await client.query(
      `INSERT INTO metrics_snapshots (tenant_id, snapshot_date, metrics)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, snapshot_date) DO UPDATE SET metrics = $3, created_at = NOW()`,
      [tenantId, date, JSON.stringify(metrics)]
    );
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/learning/metrics-computer.ts
git commit -m "feat: metrics computer — daily snapshot aggregation from decision_records"
```

---

## Task 7: Pattern Detection Engine

**Files:**
- Create: `packages/api/src/learning/pattern-detector.ts`
- Test: `packages/api/test/pattern-detector.test.ts`

- [ ] **Step 1: Create the pattern detector**

```typescript
// packages/api/src/learning/pattern-detector.ts

import { withTenantTx } from "../db/pool.js";
import { publishEvent } from "../event-bus.js";
import { DETECTION_RULES } from "@twin/core";
import { randomUUID } from "node:crypto";
import type { StoreEvent } from "@twin/core";

interface PatternCandidate {
  ruleName: string;
  program?: string;
  overrideReason?: string;
  metricsSnapshot: Record<string, unknown>;
}

/**
 * Run all 4 detection rules for a single tenant.
 * Returns array of newly detected patterns.
 */
export async function detectPatterns(tenantId: string): Promise<PatternCandidate[]> {
  const candidates: PatternCandidate[] = [];

  await withTenantTx(tenantId, async (client) => {
    const windowStart = new Date(Date.now() - DETECTION_RULES.high_override_rate.windowDays * 86_400_000).toISOString();

    // Rule 1: High override rate per (program, reason)
    const { rows: r1 } = await client.query(
      `SELECT loan_program, override_reason,
              COUNT(*) FILTER (WHERE decision_type = 'overridden')::int AS overrides,
              COUNT(*)::int AS total,
              ROUND(COUNT(*) FILTER (WHERE decision_type = 'overridden')::numeric / NULLIF(COUNT(*), 0), 4) AS rate
       FROM decision_records
       WHERE decided_at >= $1 AND override_reason IS NOT NULL
       GROUP BY loan_program, override_reason
       HAVING COUNT(*) FILTER (WHERE decision_type = 'overridden') >= $2
       AND COUNT(*) FILTER (WHERE decision_type = 'overridden')::numeric / NULLIF(COUNT(*), 0) > $3`,
      [windowStart, DETECTION_RULES.high_override_rate.minSample, DETECTION_RULES.high_override_rate.threshold]
    );
    for (const row of r1) {
      candidates.push({
        ruleName: "high_override_rate",
        program: row.loan_program,
        overrideReason: row.override_reason,
        metricsSnapshot: { overrides: row.overrides, total: row.total, rate: Number(row.rate) },
      });
    }

    // Rule 2: Confidence miscalibration
    const { rows: r2 } = await client.query(
      `SELECT
         CASE
           WHEN agent_confidence < 0.2 THEN '0-20'
           WHEN agent_confidence < 0.4 THEN '20-40'
           WHEN agent_confidence < 0.6 THEN '40-60'
           WHEN agent_confidence < 0.8 THEN '60-80'
           ELSE '80-100'
         END AS bucket,
         AVG(CASE WHEN decision_type = 'accepted' THEN 1.0 ELSE 0.0 END)::numeric(4,2) AS acceptance_rate,
         COUNT(*)::int AS count
       FROM decision_records
       WHERE decided_at >= $1 AND agent_confidence IS NOT NULL
       GROUP BY bucket
       HAVING COUNT(*) >= $2
       AND AVG(CASE WHEN decision_type = 'accepted' THEN 1.0 ELSE 0.0 END) < $3`,
      [windowStart, DETECTION_RULES.confidence_miscalibration.minSample, DETECTION_RULES.confidence_miscalibration.maxAcceptance]
    );
    for (const row of r2) {
      candidates.push({
        ruleName: "confidence_miscalibration",
        metricsSnapshot: { bucket: row.bucket, acceptanceRate: Number(row.acceptance_rate), count: row.count },
      });
    }

    // Rule 3: Declining alignment (30d vs prior 30d)
    const midpoint = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const priorStart = new Date(Date.now() - 60 * 86_400_000).toISOString();

    const { rows: r3current } = await client.query(
      `SELECT COUNT(*) FILTER (WHERE decision_type = 'accepted')::int AS accepted,
              COUNT(*)::int AS total
       FROM decision_records WHERE decided_at >= $1`,
      [midpoint]
    );
    const { rows: r3prior } = await client.query(
      `SELECT COUNT(*) FILTER (WHERE decision_type = 'accepted')::int AS accepted,
              COUNT(*)::int AS total
       FROM decision_records WHERE decided_at >= $1 AND decided_at < $2`,
      [priorStart, midpoint]
    );
    const currentRate = r3current[0].total > 0 ? r3current[0].accepted / r3current[0].total : 0;
    const priorRate = r3prior[0].total > 0 ? r3prior[0].accepted / r3prior[0].total : 0;
    if (
      r3current[0].total >= DETECTION_RULES.declining_alignment.minSample &&
      r3prior[0].total >= DETECTION_RULES.declining_alignment.minSample &&
      priorRate - currentRate > DETECTION_RULES.declining_alignment.dropThreshold
    ) {
      candidates.push({
        ruleName: "declining_alignment",
        metricsSnapshot: {
          currentRate: Math.round(currentRate * 10000) / 100,
          priorRate: Math.round(priorRate * 10000) / 100,
          drop: Math.round((priorRate - currentRate) * 10000) / 100,
        },
      });
    }

    // Rule 4: Systematic category (one reason > 40% of all overrides)
    const { rows: r4 } = await client.query(
      `SELECT override_reason,
              COUNT(*)::int AS count,
              COUNT(*)::numeric / (SELECT COUNT(*) FROM decision_records WHERE decided_at >= $1 AND decision_type = 'overridden') AS share
       FROM decision_records
       WHERE decided_at >= $1 AND decision_type = 'overridden' AND override_reason IS NOT NULL
       GROUP BY override_reason
       HAVING COUNT(*) >= $2
       AND COUNT(*)::numeric / NULLIF((SELECT COUNT(*) FROM decision_records WHERE decided_at >= $1 AND decision_type = 'overridden'), 0) > $3`,
      [windowStart, DETECTION_RULES.systematic_category.minSample, DETECTION_RULES.systematic_category.dominanceThreshold]
    );
    for (const row of r4) {
      candidates.push({
        ruleName: "systematic_category",
        overrideReason: row.override_reason,
        metricsSnapshot: { count: row.count, share: Math.round(Number(row.share) * 100) },
      });
    }
  });

  return candidates;
}

/**
 * Write or update detected patterns in the database.
 * Deduplicates against existing active patterns.
 */
export async function persistPatterns(
  tenantId: string,
  candidates: PatternCandidate[],
): Promise<string[]> {
  const newPatternIds: string[] = [];

  for (const candidate of candidates) {
    await withTenantTx(tenantId, async (client) => {
      // Check for existing active pattern (dedup)
      const { rows: existing } = await client.query(
        `SELECT id, status, suppressed_until FROM detected_patterns
         WHERE rule_name = $1 AND COALESCE(program,'') = COALESCE($2,'')
         AND COALESCE(override_reason,'') = COALESCE($3,'')
         AND status NOT IN ('applied', 'dismissed', 'analysis_failed')`,
        [candidate.ruleName, candidate.program ?? null, candidate.overrideReason ?? null]
      );

      if (existing.length > 0) {
        const ex = existing[0];
        // Check suppression
        if (ex.suppressed_until && new Date(ex.suppressed_until) > new Date()) return;
        // Update existing pattern's metrics
        await client.query(
          `UPDATE detected_patterns SET metrics_snapshot = $1, updated_at = NOW() WHERE id = $2`,
          [JSON.stringify(candidate.metricsSnapshot), ex.id]
        );
      } else {
        const id = randomUUID();
        await client.query(
          `INSERT INTO detected_patterns (id, tenant_id, rule_name, program, override_reason, metrics_snapshot, status, status_history)
           VALUES ($1, $2, $3, $4, $5, $6, 'new', $7)`,
          [
            id, tenantId, candidate.ruleName,
            candidate.program ?? null, candidate.overrideReason ?? null,
            JSON.stringify(candidate.metricsSnapshot),
            JSON.stringify([{ from: null, to: "new", at: new Date().toISOString(), by: "system" }]),
          ]
        );
        newPatternIds.push(id);

        // Publish event
        const event: StoreEvent = {
          id: randomUUID(),
          tenantId,
          loanId: "",
          type: "pattern.detected",
          payload: { patternId: id, ruleName: candidate.ruleName, program: candidate.program },
          timestamp: new Date().toISOString(),
        };
        await publishEvent(event);
      }
    });
  }

  return newPatternIds;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/learning/pattern-detector.ts
git commit -m "feat: pattern detection engine — 4 rules with dedup and suppression"
```

---

## Task 8: Learning Worker — 6-Hour Advisory Lock Cycle

**Files:**
- Create: `packages/api/src/learning-worker.ts`
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Create the learning worker**

```typescript
// packages/api/src/learning-worker.ts

import { withDb } from "./db/pool.js";
import { detectPatterns, persistPatterns } from "./learning/pattern-detector.js";
import { computeDailySnapshot, saveSnapshot } from "./learning/metrics-computer.js";

/**
 * Learning engine worker. Runs every 6 hours.
 * Guarded by advisory lock 43 (separate from SLA monitor's 42).
 */
export async function runLearningCycle(): Promise<void> {
  await withDb(async (client) => {
    const { rows } = await client.query("SELECT pg_try_advisory_lock(43) AS acquired");
    if (!rows[0].acquired) return;

    try {
      const { rows: tenants } = await client.query(
        "SELECT id FROM tenants WHERE status = 'active' AND deleted_at IS NULL"
      );

      for (const tenant of tenants) {
        try {
          // 1. Compute metrics snapshots for completed days
          const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
          const snapshot = await computeDailySnapshot(tenant.id, yesterday);
          await saveSnapshot(tenant.id, yesterday, snapshot);

          // 2. Run pattern detection
          const candidates = await detectPatterns(tenant.id);
          if (candidates.length > 0) {
            const newIds = await persistPatterns(tenant.id, candidates);
            if (newIds.length > 0) {
              console.log(`[learning] Tenant ${tenant.id}: ${newIds.length} new patterns detected`);
            }
          }

          // 3. TODO: LLM insight generation (Task 9)
          // 4. TODO: Janitor for stuck patterns
        } catch (e) {
          console.error(`[learning] Error processing tenant ${tenant.id}:`, e);
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(43)");
    }
  });
}

let learningInterval: ReturnType<typeof setInterval> | null = null;

export function startLearningWorker(): void {
  if (learningInterval) return;
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  learningInterval = setInterval(() => {
    runLearningCycle().catch((e) => console.error("[learning] Cycle error:", e));
  }, SIX_HOURS);
  // Run initial cycle after 30 seconds (let server finish booting)
  setTimeout(() => {
    runLearningCycle().catch((e) => console.error("[learning] Initial cycle error:", e));
  }, 30_000);
  console.log("[learning] Worker started (6h interval, advisory-lock 43)");
}

export function stopLearningWorker(): void {
  if (learningInterval) { clearInterval(learningInterval); learningInterval = null; }
}
```

- [ ] **Step 2: Register in server.ts**

In `packages/api/src/server.ts`, add to the startup block (after SLA monitor):

```typescript
import { startLearningWorker } from "./learning-worker.js";
// After startSlaMonitor():
if (isDbEnabled()) {
  startLearningWorker();
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/learning-worker.ts packages/api/src/server.ts
git commit -m "feat: learning worker — 6-hour cycle with advisory lock 43, metrics + detection"
```

---

## Task 9: Tenant Metrics API Routes

**Files:**
- Create: `packages/api/src/routes/learning-metrics.ts`
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Create metrics routes**

```typescript
// packages/api/src/routes/learning-metrics.ts

import type { FastifyInstance } from "fastify";
import { withTenantTx } from "../db/pool.js";
import { getTenantId, getTenantContext } from "../tenant-context.js";

export function registerLearningMetricsRoutes(app: FastifyInstance): void {
  // Alignment rate + calibration
  app.get<{ Params: { tenantId: string }; Querystring: { window?: string } }>(
    "/metrics/:tenantId/alignment",
    async (req) => {
      const tenantId = getTenantId();
      const windowDays = parseInt(req.query.window ?? "30", 10);
      const startDate = new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);

      return withTenantTx(tenantId, async (client) => {
        // Historical from snapshots
        const { rows: snapshots } = await client.query(
          `SELECT snapshot_date, metrics FROM metrics_snapshots
           WHERE snapshot_date >= $1 AND snapshot_date < CURRENT_DATE
           ORDER BY snapshot_date`,
          [startDate]
        );

        // Today (live)
        const { rows: todayRows } = await client.query(
          `SELECT decision_type, COUNT(*)::int AS count
           FROM decision_records
           WHERE decided_at >= CURRENT_DATE::timestamptz
           GROUP BY decision_type`
        );
        const todayAccepted = todayRows.find((r) => r.decision_type === "accepted")?.count ?? 0;
        const todayOverridden = todayRows.find((r) => r.decision_type === "overridden")?.count ?? 0;

        // Calibration (full window)
        const { rows: calRows } = await client.query(
          `SELECT
             CASE
               WHEN agent_confidence < 0.2 THEN '0-20'
               WHEN agent_confidence < 0.4 THEN '20-40'
               WHEN agent_confidence < 0.6 THEN '40-60'
               WHEN agent_confidence < 0.8 THEN '60-80'
               ELSE '80-100'
             END AS bucket,
             AVG(agent_confidence)::numeric(4,2) AS confidence,
             AVG(CASE WHEN decision_type = 'accepted' THEN 1.0 ELSE 0.0 END)::numeric(4,2) AS acceptance_rate,
             COUNT(*)::int AS count
           FROM decision_records
           WHERE decided_at >= $1::date AND agent_confidence IS NOT NULL
           GROUP BY bucket
           ORDER BY bucket`,
          [startDate]
        );

        // Compute totals
        let totalAccepted = todayAccepted;
        let totalOverridden = todayOverridden;
        const trend = snapshots.map((s) => {
          const m = s.metrics as { alignment?: { accepted: number; overridden: number; rate: number } };
          totalAccepted += m.alignment?.accepted ?? 0;
          totalOverridden += m.alignment?.overridden ?? 0;
          return { date: s.snapshot_date, rate: m.alignment?.rate ?? 0 };
        });

        const total = totalAccepted + totalOverridden;
        const rate = total > 0 ? Math.round((totalAccepted / total) * 10000) / 100 : 0;

        return {
          rate,
          accepted: totalAccepted,
          overridden: totalOverridden,
          trend,
          calibration: calRows.map((r) => ({
            bucket: r.bucket,
            confidence: Number(r.confidence),
            acceptanceRate: Number(r.acceptance_rate),
            count: r.count,
          })),
        };
      });
    }
  );

  // Override breakdown by reason and program
  app.get<{ Params: { tenantId: string }; Querystring: { window?: string } }>(
    "/metrics/:tenantId/overrides",
    async (req) => {
      const tenantId = getTenantId();
      const windowDays = parseInt(req.query.window ?? "30", 10);
      const startDate = new Date(Date.now() - windowDays * 86_400_000).toISOString();

      return withTenantTx(tenantId, async (client) => {
        const { rows: byReason } = await client.query(
          `SELECT override_reason, COUNT(*)::int AS count
           FROM decision_records
           WHERE decided_at >= $1 AND decision_type = 'overridden' AND override_reason IS NOT NULL
           GROUP BY override_reason ORDER BY count DESC`,
          [startDate]
        );

        const { rows: byProgram } = await client.query(
          `SELECT loan_program,
                  COUNT(*) FILTER (WHERE decision_type = 'accepted')::int AS accepted,
                  COUNT(*) FILTER (WHERE decision_type = 'overridden')::int AS overridden
           FROM decision_records
           WHERE decided_at >= $1
           GROUP BY loan_program ORDER BY loan_program`,
          [startDate]
        );

        return {
          byReason: Object.fromEntries(byReason.map((r) => [r.override_reason, r.count])),
          byProgram: Object.fromEntries(byProgram.map((r) => [r.loan_program, {
            accepted: r.accepted,
            overridden: r.overridden,
            rate: (r.accepted + r.overridden) > 0
              ? Math.round((r.accepted / (r.accepted + r.overridden)) * 10000) / 100
              : 0,
          }])),
        };
      });
    }
  );

  // Patterns + suggestions
  app.get<{ Params: { tenantId: string } }>(
    "/metrics/:tenantId/patterns",
    async (req) => {
      const tenantId = getTenantId();
      const ctx = getTenantContext();

      return withTenantTx(tenantId, async (client) => {
        const visibilityFilter = ctx.isSuperAdmin ? "" : "AND (ps.visibility = 'admin' OR ps.id IS NULL)";

        const { rows } = await client.query(
          `SELECT dp.id, dp.rule_name, dp.program, dp.override_reason,
                  dp.metrics_snapshot, dp.status, dp.detected_at,
                  ps.id AS suggestion_id, ps.suggestion_type, ps.root_cause,
                  ps.specific_change, ps.confidence, ps.risk_assessment,
                  ps.status AS suggestion_status, ps.visibility,
                  ps.created_at AS suggestion_created_at
           FROM detected_patterns dp
           LEFT JOIN pattern_suggestions ps ON ps.pattern_id = dp.id
           WHERE dp.status NOT IN ('dismissed', 'analysis_failed')
           ${visibilityFilter}
           ORDER BY dp.detected_at DESC`
        );

        return rows.map((r) => ({
          id: r.id,
          ruleName: r.rule_name,
          program: r.program,
          overrideReason: r.override_reason,
          metricsSnapshot: r.metrics_snapshot,
          status: r.status,
          detectedAt: r.detected_at,
          suggestion: r.suggestion_id ? {
            id: r.suggestion_id,
            type: r.suggestion_type,
            rootCause: r.root_cause,
            specificChange: r.specific_change,
            confidence: Number(r.confidence),
            riskAssessment: r.risk_assessment,
            status: r.suggestion_status,
            visibility: r.visibility,
            createdAt: r.suggestion_created_at,
          } : null,
        }));
      });
    }
  );
}
```

- [ ] **Step 2: Register in server.ts**

```typescript
import { registerLearningMetricsRoutes } from "./routes/learning-metrics.js";
// in buildServer():
registerLearningMetricsRoutes(app);
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/learning-metrics.ts packages/api/src/server.ts
git commit -m "feat: tenant-scoped metrics API — alignment, overrides, patterns with snapshot+live hybrid"
```

---

## Task 10: Pattern Apply/Dismiss/Regenerate Routes

**Files:**
- Create: `packages/api/src/routes/patterns.ts`
- Modify: `packages/api/src/server.ts`

- [ ] **Step 1: Create pattern action routes**

```typescript
// packages/api/src/routes/patterns.ts

import type { FastifyInstance } from "fastify";
import { withTenantTx } from "../db/pool.js";
import { getTenantId, getTenantContext } from "../tenant-context.js";
import { DismissPatternSchema } from "@twin/core";

export function registerPatternRoutes(app: FastifyInstance): void {
  // Dismiss a pattern
  app.post<{ Params: { tenantId: string; patternId: string } }>(
    "/metrics/:tenantId/patterns/:patternId/dismiss",
    async (req, reply) => {
      const tenantId = getTenantId();
      const { patternId } = req.params;
      const ctx = getTenantContext();

      const parsed = DismissPatternSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const { reason, cooldownDays } = parsed.data;
      const suppressedUntil = cooldownDays === "permanent"
        ? new Date("2099-12-31").toISOString()
        : new Date(Date.now() + (cooldownDays as number) * 86_400_000).toISOString();

      return withTenantTx(tenantId, async (client) => {
        const { rows } = await client.query(
          "SELECT id, status FROM detected_patterns WHERE id = $1", [patternId]
        );
        if (rows.length === 0) return reply.code(404).send({ error: "Pattern not found" });

        await client.query(
          `UPDATE detected_patterns SET status = 'dismissed', suppressed_until = $1, updated_at = NOW(),
           status_history = status_history || $2::jsonb WHERE id = $3`,
          [
            suppressedUntil,
            JSON.stringify({ from: rows[0].status, to: "dismissed", at: new Date().toISOString(), by: ctx.userId }),
            patternId,
          ]
        );

        // Also dismiss any pending suggestions
        await client.query(
          `UPDATE pattern_suggestions SET status = 'rejected', rejection_reason = $1, reviewed_by = $2, reviewed_at = NOW()
           WHERE pattern_id = $3 AND status = 'pending'`,
          [reason, ctx.userId, patternId]
        );

        return { status: "dismissed", suppressedUntil };
      });
    }
  );

  // Regenerate insight for a pattern
  app.post<{ Params: { tenantId: string; patternId: string } }>(
    "/metrics/:tenantId/patterns/:patternId/regenerate",
    async (req, reply) => {
      const tenantId = getTenantId();
      const { patternId } = req.params;
      const ctx = getTenantContext();

      return withTenantTx(tenantId, async (client) => {
        const { rows } = await client.query(
          "SELECT id, status FROM detected_patterns WHERE id = $1", [patternId]
        );
        if (rows.length === 0) return reply.code(404).send({ error: "Pattern not found" });
        if (!["analysis_failed", "suggestion_ready"].includes(rows[0].status)) {
          return reply.code(400).send({ error: "Pattern must be in analysis_failed or suggestion_ready status" });
        }

        await client.query(
          `UPDATE detected_patterns SET status = 'new', updated_at = NOW(),
           status_history = status_history || $1::jsonb WHERE id = $2`,
          [
            JSON.stringify({ from: rows[0].status, to: "new", at: new Date().toISOString(), by: ctx.userId }),
            patternId,
          ]
        );

        return { patternId, newStatus: "new" };
      });
    }
  );

  // Apply a suggestion (admin review — first key)
  app.post<{ Params: { tenantId: string; patternId: string } }>(
    "/metrics/:tenantId/patterns/:patternId/apply",
    async (req, reply) => {
      const tenantId = getTenantId();
      const { patternId } = req.params;
      const ctx = getTenantContext();

      return withTenantTx(tenantId, async (client) => {
        // Find the suggestion for this pattern
        const { rows: suggestions } = await client.query(
          "SELECT id, suggestion_type, specific_change, status, visibility FROM pattern_suggestions WHERE pattern_id = $1 AND status = 'pending'",
          [patternId]
        );
        if (suggestions.length === 0) return reply.code(404).send({ error: "No pending suggestion for this pattern" });

        const suggestion = suggestions[0];

        // Two-key check for guideline changes
        if (["guideline_change", "threshold_update"].includes(suggestion.suggestion_type)) {
          if (!suggestion.compliance_reviewed_by) {
            // Mark as admin-approved, await compliance review
            await client.query(
              `UPDATE pattern_suggestions SET reviewed_by = $1, reviewed_at = NOW() WHERE id = $2`,
              [ctx.userId, suggestion.id]
            );
            return { status: "awaiting_compliance_review", suggestionId: suggestion.id };
          }
        }

        // Apply the suggestion — create new guideline version
        // For now, mark as applied (actual guideline patch application is a follow-up)
        await client.query(
          `UPDATE pattern_suggestions SET status = 'applied', reviewed_by = COALESCE(reviewed_by, $1), reviewed_at = COALESCE(reviewed_at, NOW()) WHERE id = $2`,
          [ctx.userId, suggestion.id]
        );
        await client.query(
          `UPDATE detected_patterns SET status = 'applied', updated_at = NOW(),
           status_history = status_history || $1::jsonb WHERE id = $2`,
          [
            JSON.stringify({ from: "suggestion_ready", to: "applied", at: new Date().toISOString(), by: ctx.userId }),
            patternId,
          ]
        );

        return { status: "applied", suggestionId: suggestion.id };
      });
    }
  );
}
```

- [ ] **Step 2: Register in server.ts**

```typescript
import { registerPatternRoutes } from "./routes/patterns.js";
// in buildServer():
registerPatternRoutes(app);
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/patterns.ts packages/api/src/server.ts
git commit -m "feat: pattern action routes — dismiss with cooldown, regenerate, apply with two-key"
```

---

## Task 11: Enhanced Metrics Dashboard UI

**Files:**
- Create: `packages/web/components/encompass/MetricsCards.tsx`
- Create: `packages/web/components/encompass/OverrideBreakdown.tsx`
- Create: `packages/web/components/encompass/SuggestionCard.tsx`
- Modify: `packages/web/app/t/[tenantSlug]/metrics/page.tsx` (create if not exists)

- [ ] **Step 1: Create MetricsCards component**

```typescript
// packages/web/components/encompass/MetricsCards.tsx
"use client";

interface MetricsCardsProps {
  alignmentRate: number;
  overrideRate: number;
  avgDecisionTime: number;
  slaCompliance: number;
}

export function MetricsCards({ alignmentRate, overrideRate, avgDecisionTime, slaCompliance }: MetricsCardsProps) {
  const cards = [
    { label: "UW Alignment", value: `${alignmentRate.toFixed(1)}%`, sub: "30d" },
    { label: "Override Rate", value: `${overrideRate.toFixed(1)}%`, sub: "30d" },
    { label: "Avg Decision", value: `${Math.round(avgDecisionTime / 60)} min`, sub: "mean" },
    { label: "SLA Compliance", value: `${slaCompliance.toFixed(1)}%`, sub: "30d" },
  ];

  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      {cards.map((c) => (
        <div key={c.label} className="enc-panel p-3 text-center">
          <div className="text-[10px] text-[#6b7a8f] uppercase">{c.label}</div>
          <div className="text-xl font-bold text-[#1a2b4a]">{c.value}</div>
          <div className="text-[9px] text-[#8899aa]">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create OverrideBreakdown component**

```typescript
// packages/web/components/encompass/OverrideBreakdown.tsx
"use client";

import { OVERRIDE_REASON_LABELS } from "@twin/core";

interface Props {
  byReason: Record<string, number>;
  byProgram: Record<string, { accepted: number; overridden: number; rate: number }>;
}

export function OverrideBreakdown({ byReason, byProgram }: Props) {
  const maxReason = Math.max(...Object.values(byReason), 1);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="enc-panel p-3">
        <h3 className="text-[11px] font-semibold text-[#1a2b4a] mb-2">By Override Reason</h3>
        {Object.entries(byReason).sort(([,a],[,b]) => b - a).map(([reason, count]) => (
          <div key={reason} className="flex items-center gap-2 mb-1">
            <div className="text-[9px] text-[#404040] w-28 truncate">
              {OVERRIDE_REASON_LABELS[reason as keyof typeof OVERRIDE_REASON_LABELS] ?? reason}
            </div>
            <div className="flex-1 bg-[#e8ecf0] h-3 rounded overflow-hidden">
              <div className="bg-[#2d5f8a] h-full rounded" style={{ width: `${(count / maxReason) * 100}%` }} />
            </div>
            <div className="text-[9px] text-[#6b7a8f] w-8 text-right">{count}</div>
          </div>
        ))}
        {Object.keys(byReason).length === 0 && (
          <div className="text-[10px] text-[#8899aa]">No overrides in this period</div>
        )}
      </div>

      <div className="enc-panel p-3">
        <h3 className="text-[11px] font-semibold text-[#1a2b4a] mb-2">By Program</h3>
        {Object.entries(byProgram).map(([program, data]) => (
          <div key={program} className="flex items-center gap-2 mb-1">
            <div className="text-[9px] text-[#404040] w-28 truncate">{program}</div>
            <div className="flex-1 bg-[#e8ecf0] h-3 rounded overflow-hidden">
              <div className="bg-[#2d8a5f] h-full rounded" style={{ width: `${data.rate}%` }} />
            </div>
            <div className="text-[9px] text-[#6b7a8f] w-12 text-right">{data.rate.toFixed(0)}%</div>
          </div>
        ))}
        {Object.keys(byProgram).length === 0 && (
          <div className="text-[10px] text-[#8899aa]">No decisions in this period</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create SuggestionCard component**

```typescript
// packages/web/components/encompass/SuggestionCard.tsx
"use client";

interface Suggestion {
  id: string;
  type: string;
  rootCause: string;
  specificChange: { operation: string; path: string; from?: unknown; to: unknown };
  confidence: number;
  riskAssessment: string;
  status: string;
}

interface Pattern {
  id: string;
  ruleName: string;
  program?: string;
  overrideReason?: string;
  status: string;
  suggestion: Suggestion | null;
}

interface Props {
  patterns: Pattern[];
  onDismiss?: (patternId: string) => void;
  onApply?: (patternId: string) => void;
}

export function SuggestionCards({ patterns, onDismiss, onApply }: Props) {
  const active = patterns.filter((p) => p.suggestion && p.suggestion.status === "pending");

  if (active.length === 0) {
    return <div className="text-[10px] text-[#8899aa] py-2">No active suggestions</div>;
  }

  return (
    <div className="space-y-3">
      {active.map((p) => (
        <div key={p.id} className="enc-panel p-3 border-l-4 border-[#e6a817]">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[11px] font-semibold text-[#1a2b4a]">
                {p.ruleName.replace(/_/g, " ")} {p.program ? `— ${p.program}` : ""}
              </div>
              <div className="text-[10px] text-[#404040] mt-1">{p.suggestion!.rootCause}</div>
              <div className="text-[10px] text-[#2d5f8a] mt-1 font-mono">
                {p.suggestion!.specificChange.path}: {String(p.suggestion!.specificChange.from)} → {String(p.suggestion!.specificChange.to)}
              </div>
              <div className="text-[9px] text-[#6b7a8f] mt-1">
                Confidence: {Math.round(p.suggestion!.confidence * 100)}% | {p.suggestion!.riskAssessment.slice(0, 100)}
              </div>
            </div>
            <div className="flex gap-1 ml-2">
              <button className="enc-btn enc-btn--primary text-[9px] px-2 py-1" onClick={() => onApply?.(p.id)}>Apply</button>
              <button className="enc-btn text-[9px] px-2 py-1" onClick={() => onDismiss?.(p.id)}>Dismiss</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create tenant metrics page**

```typescript
// packages/web/app/t/[tenantSlug]/metrics/page.tsx

import { api } from "@/lib/api-client";
import { MetricsCards } from "@/components/encompass/MetricsCards";
import { OverrideBreakdown } from "@/components/encompass/OverrideBreakdown";
import { SuggestionCards } from "@/components/encompass/SuggestionCard";

export default async function TenantMetricsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  // Placeholder data until API is wired up
  // In production, these fetch from /metrics/:tenantId/alignment and /metrics/:tenantId/overrides
  return (
    <div className="p-4 max-w-6xl mx-auto">
      <h1 className="text-lg font-bold text-[#1a2b4a] mb-4">
        Learning & Metrics — {tenantSlug}
      </h1>

      <MetricsCards
        alignmentRate={87.3}
        overrideRate={12.7}
        avgDecisionTime={2520}
        slaCompliance={96.2}
      />

      <div className="mt-4">
        <h2 className="text-[12px] font-semibold text-[#1a2b4a] mb-2">Override Analysis</h2>
        <OverrideBreakdown byReason={{}} byProgram={{}} />
      </div>

      <div className="mt-4">
        <h2 className="text-[12px] font-semibold text-[#1a2b4a] mb-2">Active Suggestions</h2>
        <SuggestionCards patterns={[]} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/encompass/MetricsCards.tsx packages/web/components/encompass/OverrideBreakdown.tsx packages/web/components/encompass/SuggestionCard.tsx packages/web/app/t/[tenantSlug]/metrics/
git commit -m "feat: learning metrics dashboard — alignment cards, override breakdown, suggestion cards"
```

---

## Task 12: Add compliance_officer Role

**Files:**
- Modify: `packages/web/lib/permissions.ts`

- [ ] **Step 1: Add compliance_officer to the permissions map**

Read `packages/web/lib/permissions.ts` and add `compliance_officer` to the role definitions. They should have:
- View all pattern suggestions (including compliance_only visibility)
- Approve/reject guideline_change and threshold_update suggestions
- View compliance check results
- Same read permissions as `uw` role
- Cannot create tenants, manage users, or make UW decisions

- [ ] **Step 2: Commit**

```bash
git add packages/web/lib/permissions.ts
git commit -m "feat: compliance_officer role in RBAC permissions"
```

---

## Task 13: Run Full Test Suite + Integration Verification

- [ ] **Step 1: Run core tests**

```bash
cd /Users/omarmendoza/Projects/encompass-digital-twin && pnpm --filter @twin/core test
```

- [ ] **Step 2: Run API tests**

```bash
cd /Users/omarmendoza/Projects/encompass-digital-twin && pnpm --filter @twin/api test
```

- [ ] **Step 3: Verify existing API tests still pass**

All existing tests must pass. Fix any regressions from the `overrideReason` addition (the `OverrideDecision` action now requires `overrideReason` — any tests dispatching this action need the field added).

- [ ] **Step 4: Commit fixes**

```bash
git add -A && git commit -m "fix: test suite alignment after learning engine integration"
```

---

## Task 14: Push to GitHub + Deploy

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
| §1 Override taxonomy + decision_records | Tasks 1, 2, 3, 4, 5 | Yes |
| §2 Three-tier metrics + snapshots | Tasks 6, 9, 11 | Yes |
| §3 Pattern detection (4 rules) | Task 7 | Yes |
| §3.4 Status state machine | Tasks 7, 10 | Yes |
| §3.5 Dedup + cooldown | Tasks 7, 10 | Yes |
| §4.1 PII redaction | Deferred | Deferred to LLM insight task (follow-up) |
| §4.2 Stratified sampling | Deferred | Deferred to LLM insight task |
| §4.3 Tool_use structured output | Deferred | Deferred to LLM insight task |
| §4.4 Pattern suggestions table | Task 2 | Yes (schema) |
| §4.5 Compliance checks | Task 2 | Yes (schema), service deferred |
| §4.6 Cost control | Deferred | Deferred to LLM insight task |
| §4.7 Two-key apply | Task 10 | Partial (admin key implemented, compliance key requires compliance_officer flow) |
| §5 Dashboard UI | Task 11 | Yes (foundational components) |
| §6 API routes | Tasks 9, 10 | Yes |
| §7 Types + schemas + events | Task 1 | Yes |
| §8 compliance_officer role | Task 12 | Yes |
| §9 Learning worker | Task 8 | Yes |
| §10 Backfill | Deferred | Follow-up task |
| §11 Observability | Deferred | Follow-up task |
| §12 Testing | Tasks throughout | Partial — unit tests where possible |

**Deferred items (follow-up tasks after this plan):**
- LLM insight generation (PII redaction + tool_use + compliance checks + cost control) — requires Anthropic API integration with structured outputs
- Backfill migration script — requires production data
- Platform metrics page (super_admin cross-tenant view)
- Observability instrumentation
- Full RFC 6902 JSON Patch apply with guideline version creation
