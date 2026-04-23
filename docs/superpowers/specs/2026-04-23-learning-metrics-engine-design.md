# Learning & Metrics Engine — Design Spec

> **Goal:** Build a tenant-scoped analytics and learning system that captures structured override feedback, detects systematic agent blind spots via rule-based pattern detection, generates actionable improvement suggestions via LLM analysis, and surfaces insights through tiered dashboards — making the platform measurably smarter with every UW decision.

> **Architecture:** Override feedback flows from UW actions into a denormalized analytics table. A periodic pattern detection engine (advisory-lock-guarded, 6-hour cycle) evaluates rules against trailing windows. When patterns are detected, Claude Sonnet generates root-cause analysis and specific guideline/prompt change suggestions. Admins review and apply suggestions, which create new guideline versions with full audit trail. Three-tier dashboards (tenant, platform, per-UW) surface metrics at appropriate access levels.

> **Tech Stack:** Existing stack — Fastify, Postgres (new tables with RLS), Redis (pub/sub events), Anthropic SDK (Claude Sonnet for insights), React/Next.js (dashboard components), Zod (validation). No new infrastructure dependencies.

---

## 1. Feedback Capture & Override Taxonomy

### 1.1 Override Reason Categories

When a UW overrides an agent recommendation, a reason category is required (dropdown in the override dialog):

| Category | Code | When to use |
|----------|------|-------------|
| DTI Exception | `dti_exception` | Compensating factors justify higher DTI |
| Income Adjustment | `income_adjustment` | Agent miscalculated or misclassified income |
| Credit Reassessment | `credit_reassessment` | Agent over/under-weighted credit risk |
| Document Sufficiency | `doc_sufficiency` | Docs are sufficient despite agent flagging gaps |
| Compliance Exception | `compliance_exception` | Regulatory flag is inapplicable or already mitigated |
| Guideline Exception | `guideline_exception` | Program guideline warrants exception for this loan |
| Risk Tolerance | `risk_tolerance` | Agent too conservative/aggressive for this lender's appetite |
| Data Error | `data_error` | Agent worked with incorrect or stale data |
| Other | `other` | Doesn't fit above categories (free text rationale required) |

```typescript
type OverrideReasonCategory =
  | "dti_exception"
  | "income_adjustment"
  | "credit_reassessment"
  | "doc_sufficiency"
  | "compliance_exception"
  | "guideline_exception"
  | "risk_tolerance"
  | "data_error"
  | "other";
```

### 1.2 Action Type Extension

The existing `OverrideDecision` action gains an `overrideReason` field:

```typescript
// Updated Action union member:
| {
    type: "OverrideDecision";
    loanId: LoanId;
    originalRecommendation: UwDecision;
    overrideDecision: UwDecision;
    overrideReason: OverrideReasonCategory;  // NEW — required
    rationale: string;
    actor: Actor;
  }
```

The `rationale` field (free text) remains for detailed explanation. Both are stored in the action log and written to the analytics table.

### 1.3 Feedback Records Table

Denormalized from the action log for analytics performance — no JOINs needed for dashboards:

```sql
CREATE TABLE feedback_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  loan_id TEXT NOT NULL,
  loan_program TEXT NOT NULL,
  original_decision TEXT NOT NULL,
  override_decision TEXT NOT NULL,
  override_reason TEXT NOT NULL,
  rationale TEXT,
  guideline_version_id UUID,
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_feedback_tenant_time ON feedback_records(tenant_id, recorded_at);
CREATE INDEX idx_feedback_tenant_program ON feedback_records(tenant_id, loan_program);
CREATE INDEX idx_feedback_tenant_reason ON feedback_records(tenant_id, override_reason);
```

RLS policy: `tenant_id = current_setting('app.current_tenant', true)::uuid`

### 1.4 Write Path

When an `OverrideDecision` action is dispatched:
1. The reducer processes it normally (existing behavior)
2. The persistence layer writes to the action log (existing)
3. A new post-dispatch hook writes a denormalized record to `feedback_records` with the loan's program, guideline version, and override details
4. A `decision.made` event is published via Redis (existing)

---

## 2. Metrics Engine — Three Tiers

### 2.1 Tier 1: Tenant-Scoped Metrics

Visible to tenant admin and UW at `/t/:slug/metrics`.

**Agent accuracy rate:**
- % of decisions where UW accepted agent recommendation (no override)
- Rolling windows: 7d, 30d, 90d
- Formula: `accepted / (accepted + overridden) * 100`

**Override rate by category:**
- Count and percentage of overrides per `OverrideReasonCategory`
- Trailing 30 days

**Override rate by program:**
- Override rate per NQM program (BankStatement12, DSCR, etc.)
- Trailing 30 days

**Confidence calibration curve:**
- X axis: agent confidence buckets (0-10%, 10-20%, ..., 90-100%)
- Y axis: actual acceptance rate within each bucket
- A well-calibrated agent produces a diagonal line (80% confidence = 80% acceptance)

**Decision throughput:**
- Loans decided per day/week
- Average time from ingestion to decision

**SLA compliance rate:**
- % of loans decided within SLA, by stage
- Trailing 7d, 30d

### 2.2 Tier 2: Platform-Level Metrics

Visible to super_admin only at `/platform/metrics`.

- All Tier 1 metrics aggregated across all tenants
- **Per-tenant comparison table:** accuracy rate, override rate, throughput, SLA compliance — sortable columns
- **System-wide override heatmap:** override reason (rows) x NQM program (columns), colored by frequency
- **Agent improvement trend:** accuracy rate over time with markers when guideline or prompt changes were applied

### 2.3 Tier 3: Per-UW Metrics

Visible to super_admin only, embedded in platform admin panel.

- **Per-UW override rate:** how often each UW overrides vs. accepts
- **Decision consistency:** variance in decisions on similar loans over time
- **Agreement with peers:** when multiple UWs decide similar loan profiles, how often do they agree
- **Feedback quality signal:** UWs whose overrides consistently align with detected patterns are high-value feedback sources

### 2.4 Metrics Snapshots Table

Pre-computed daily metrics per tenant to avoid expensive real-time aggregation:

```sql
CREATE TABLE metrics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  snapshot_date DATE NOT NULL,
  metrics JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, snapshot_date)
);

CREATE INDEX idx_metrics_tenant_date ON metrics_snapshots(tenant_id, snapshot_date);
```

RLS policy: `tenant_id = current_setting('app.current_tenant', true)::uuid`

**Metrics JSONB structure:**

```typescript
interface DailyMetricsSnapshot {
  accuracy: { accepted: number; overridden: number; rate: number };
  overridesByReason: Record<OverrideReasonCategory, number>;
  overridesByProgram: Record<string, { accepted: number; overridden: number }>;
  calibration: Array<{ bucket: string; confidence: number; acceptanceRate: number; count: number }>;
  throughput: { decided: number; avgTimeToDecisionMinutes: number };
  sla: { compliant: number; breached: number; complianceRate: number };
}
```

Snapshots are computed nightly by the pattern detection worker (same advisory lock).

---

## 3. Pattern Detection — Rule-Based Triggers

### 3.1 Detection Engine

Runs every 6 hours, guarded by Postgres advisory lock (`pg_try_advisory_lock(43)` — separate from the SLA monitor's lock 42) to prevent duplicate execution across API replicas.

### 3.2 Detection Rules

| Rule | ID | Trigger Condition | Min Sample |
|------|----|-------------------|------------|
| High override rate | `high_override_rate` | Override rate for (program, reason) pair > 25% over trailing 30 days | 5 overrides |
| Confidence miscalibration | `confidence_miscalibration` | Agent confidence bucket (e.g., 70-80%) has actual acceptance rate < 50% over trailing 30 days | 10 decisions |
| Declining accuracy | `declining_accuracy` | Accuracy drops > 10 percentage points (trailing 30d vs. prior 30d) | 20 decisions per period |
| Systematic category | `systematic_category` | Single override reason > 40% of all overrides in trailing 30 days | 8 overrides |

### 3.3 Detected Patterns Table

```sql
CREATE TABLE detected_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  rule_name TEXT NOT NULL,
  program TEXT,
  override_reason TEXT,
  metrics_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'analyzing', 'suggestion_ready', 'applied', 'dismissed')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_pattern_active ON detected_patterns(tenant_id, rule_name, program, override_reason)
  WHERE status NOT IN ('applied', 'dismissed');
```

RLS policy: `tenant_id = current_setting('app.current_tenant', true)::uuid`

### 3.4 Deduplication

If the same `(tenant, rule, program, reason)` combination already has an active pattern (status not in `applied` or `dismissed`), the existing pattern's `metrics_snapshot` and `updated_at` are updated instead of creating a duplicate.

### 3.5 On Detection

1. Write/update `detected_patterns` record
2. Set status to `new`
3. Publish `pattern.detected` event via Redis pub/sub
4. Pattern queued for LLM analysis

---

## 4. LLM-Powered Insight Generation

### 4.1 Analysis Trigger

When a pattern has status `new`, the insight generator picks it up (runs in the same 6-hour cycle, after pattern detection).

### 4.2 LLM Input Assembly

For each new pattern, the system assembles:

1. **Pattern context:** rule name, metrics snapshot, program, override reason
2. **Active guideline:** the tenant's current guideline rules for the affected program (from `tenant_guidelines`)
3. **Sample overrides:** 5-10 most recent `feedback_records` matching this pattern, including the UW's rationale
4. **Agent traces:** the `pendingRecommendation.trace` from those loans (agent reasoning)

### 4.3 Prompt Structure

```
You are an underwriting operations analyst. A pattern has been detected
in how underwriters are overriding AI agent decisions.

Pattern: {rule_name} — {human_readable_summary}
Program: {program}
Override reason: {override_reason}
Override rate: {rate}% over {period} ({count} overrides)

Current guideline thresholds:
{relevant_guideline_fields_as_json}

Sample overrides (UW rationale + loan context):
{samples_json}

Agent reasoning on these loans:
{traces_json}

Analyze this pattern and respond with ONLY a JSON object:
{
  "root_cause": "Why the agent is being overridden (1-2 sentences)",
  "suggestion_type": "guideline_change" | "prompt_adjustment" | "threshold_update" | "no_action",
  "specific_change": { "field": "income.maxDtiBack", "from": 43, "to": 50, "scope": "DSCR loans only" },
  "confidence": 0.0-1.0,
  "risk_assessment": "What could go wrong if this change is applied"
}
```

### 4.4 Pattern Suggestions Table

```sql
CREATE TABLE pattern_suggestions (
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
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

RLS policy: `tenant_id = current_setting('app.current_tenant', true)::uuid`

### 4.5 Cost Control

- LLM analysis only runs when pattern status is `new` (not on every metrics update)
- Uses Claude Sonnet (not Opus) for cost efficiency
- Hard cap: 20 LLM analysis calls per day across all tenants (configurable via env var `MAX_INSIGHT_CALLS_PER_DAY`)
- Daily counter tracked in Redis key `insight_calls:{date}` with 48-hour TTL

### 4.6 Human-in-the-Loop for Suggestions

Suggestions surface in the tenant admin dashboard:

- **Review view:** root cause, specific change, confidence score, risk assessment
- **Actions:**
  - "Apply" → creates a new guideline version with the suggested change (full audit trail via existing guideline versioning from Spec A)
  - "Reject" → requires a reason (stored in `rejection_reason`), pattern status → `dismissed`
  - "Defer" → leaves in `pending` status for later review

When "Apply" is selected:
1. The `specific_change` JSONB is merged into the current active guideline rules
2. A new guideline version is created via the existing guideline CRUD (Task 7 from Spec A)
3. The suggestion status → `applied`, pattern status → `applied`
4. `reviewed_by` and `reviewed_at` are set
5. A `guideline.updated` event is published

---

## 5. Dashboard UI

### 5.1 Enhanced Tenant Metrics Page (`/t/:slug/metrics`)

**Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│  Summary Cards                                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Accuracy │ │ Override │ │ Avg Time │ │ SLA      │       │
│  │ 87% (30d)│ │ Rate 13% │ │ 42 min   │ │ 96%      │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├─────────────────────────────────────────────────────────────┤
│  Accuracy Trend (90d line chart)                             │
│  ───────────────────────────────────────                     │
│  [guideline change markers on timeline]                      │
├─────────────────────────────────────────────────────────────┤
│  Override Breakdown          │  Confidence Calibration       │
│  [By Category | By Program]  │  [scatter plot]               │
│  ┌─ dti_exception ████ 34%  │                               │
│  ├─ income_adj    ███  22%  │                               │
│  ├─ credit_reass  ██   15%  │                               │
│  └─ ...                     │                               │
├─────────────────────────────────────────────────────────────┤
│  Active Suggestions (admin only)                             │
│  ┌──────────────────────────────────────────────────┐       │
│  │ ⚠ High override rate: DTI on DSCR loans (40%)    │       │
│  │ Suggestion: Increase maxDtiBack 43→50             │       │
│  │ Confidence: 78%  [Review] [Dismiss]               │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Platform Metrics Page (`/platform/metrics`)

- Tenant comparison table (sortable)
- System-wide override heatmap
- Per-UW performance table (super_admin only)
- Global accuracy trend with guideline change markers

### 5.3 Override Dialog Modification

The existing override dialog in the UW Dashboard/Recommendation Panel gains:
- Required "Override Reason" dropdown with the 9 categories
- The existing free-text rationale field remains below the dropdown
- "Other" reason requires non-empty rationale text

### 5.4 Recommendation Panel Context

When viewing a staged recommendation, show a small accuracy badge:
- "Agent accuracy for {program}: {rate}% (30d)" — helps UW calibrate trust

---

## 6. API Routes

### 6.1 Tenant-Scoped Metrics

```
GET /metrics/:tenantId/accuracy?window=30
  → { rate, accepted, overridden, trend: [{date, rate}], calibration: [{bucket, rate, count}] }

GET /metrics/:tenantId/overrides?window=30
  → { byReason: {...}, byProgram: {...} }

GET /metrics/:tenantId/patterns
  → [{ id, ruleName, program, reason, metricsSnapshot, status, suggestion? }]

POST /metrics/:tenantId/patterns/:patternId/apply
  → { guidelineVersionId, appliedChange }

POST /metrics/:tenantId/patterns/:patternId/dismiss
  Body: { reason: string }
  → { status: "dismissed" }
```

### 6.2 Platform-Level Metrics (super_admin only)

```
GET /platform/metrics/summary
  → { tenants: [{ id, slug, accuracy, overrideRate, throughput, sla }] }

GET /platform/metrics/heatmap
  → { cells: [{ program, reason, count, rate }] }

GET /platform/metrics/uw-performance
  → [{ userId, tenantId, overrideRate, decisionCount, consistencyScore }]

GET /platform/metrics/accuracy-trend?days=90
  → { trend: [{ date, rate, guidelineChanges: [...] }] }
```

### 6.3 Existing Route Modifications

```
POST /loans/:loanId/override
  Body gains: overrideReason (required OverrideReasonCategory)
```

---

## 7. Type & Schema Additions

### 7.1 Core Types

```typescript
// Add to @twin/core types
type OverrideReasonCategory =
  | "dti_exception" | "income_adjustment" | "credit_reassessment"
  | "doc_sufficiency" | "compliance_exception" | "guideline_exception"
  | "risk_tolerance" | "data_error" | "other";

interface DetectedPattern {
  id: string;
  tenantId: string;
  ruleName: string;
  program?: string;
  overrideReason?: string;
  metricsSnapshot: Record<string, unknown>;
  status: "new" | "analyzing" | "suggestion_ready" | "applied" | "dismissed";
  detectedAt: string;
}

interface PatternSuggestion {
  id: string;
  tenantId: string;
  patternId: string;
  suggestionType: "guideline_change" | "prompt_adjustment" | "threshold_update" | "no_action";
  rootCause: string;
  specificChange: Record<string, unknown>;
  confidence: number;
  riskAssessment: string;
  status: "pending" | "approved" | "rejected" | "applied";
  reviewedBy?: string;
  reviewedAt?: string;
}
```

### 7.2 Zod Schemas

```typescript
const OverrideReasonSchema = z.enum([
  "dti_exception", "income_adjustment", "credit_reassessment",
  "doc_sufficiency", "compliance_exception", "guideline_exception",
  "risk_tolerance", "data_error", "other",
]);

const DismissPatternSchema = z.object({
  reason: z.string().min(1).max(500),
});
```

---

## 8. Background Workers

### 8.1 Pattern Detection Worker

- Runs every 6 hours via `setInterval` in the API server
- Guarded by `pg_try_advisory_lock(43)` (lock ID 43, separate from SLA monitor's 42)
- Scans `feedback_records` per active tenant
- Evaluates 4 detection rules against trailing windows
- Writes/updates `detected_patterns`
- Triggers LLM insight generation for new patterns
- Also computes and writes `metrics_snapshots` for the current day

### 8.2 Metrics Snapshot Worker

- Runs as part of the pattern detection cycle (same worker, same lock)
- Computes daily metrics from `feedback_records` + `action_log`
- Writes to `metrics_snapshots` table
- Dashboards read from snapshots for fast rendering; real-time data supplements for "today"

---

## 9. Testing Strategy

### 9.1 Feedback Capture Tests

```
- Override with valid reason → feedback_record created with correct fields
- Override with "other" reason but empty rationale → rejected
- Override without reason → rejected (400)
- Feedback record has correct loan_program and guideline_version_id
```

### 9.2 Pattern Detection Tests

```
- 5 overrides at 30% rate for (DSCR, dti_exception) → high_override_rate pattern detected
- 4 overrides (below threshold) → no pattern detected
- Existing active pattern → metrics_snapshot updated, no duplicate
- Pattern already dismissed → new pattern created (not deduplicated against dismissed)
```

### 9.3 Metrics Computation Tests

```
- 10 accepted + 2 overridden → accuracy 83.3%
- Calibration: 5 loans at 80% confidence, 4 accepted → bucket shows 80% acceptance
- Empty feedback → all metrics return zeros, no errors
- Metrics are tenant-scoped: tenant A's overrides don't appear in tenant B's metrics
```

### 9.4 Suggestion Application Tests

```
- Apply suggestion → new guideline version created with merged change
- Apply suggestion → suggestion status = applied, pattern status = applied
- Dismiss suggestion → reason required, status = dismissed
- Non-admin cannot apply/dismiss suggestions
```

---

## Non-Goals (Explicitly Out of Scope)

- **A/B testing framework** — Testing prompt variants against historical loans. Deferred until sufficient decision volume exists for statistical significance.
- **Automated prompt deployment** — Suggestions require human review and approval. No auto-apply.
- **Real-time pattern detection** — Detection runs every 6 hours, not on every override. Real-time would add complexity without value at current volumes.
- **Per-UW feedback to UWs** — Per-UW metrics are visible to super_admin only, not to the UWs themselves or their tenant admin.
- **Historical loan replay** — Replaying past loans through updated guidelines to measure improvement. Deferred to Phase C (full closed-loop learning).
- **Custom detection rules** — Tenants cannot define their own pattern detection rules. The 4 built-in rules cover the key scenarios.
