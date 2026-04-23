# Learning & Metrics Engine — Design Spec (v2)

> **Goal:** Build a tenant-scoped analytics and learning system that captures structured decision feedback (accepts + overrides), detects systematic agent blind spots via rule-based pattern detection, generates actionable improvement suggestions via LLM structured outputs, and surfaces insights through tiered dashboards — making the platform measurably smarter with every UW decision.

> **Architecture:** Every terminal UW decision (accept, override, manual) flows into a denormalized `decision_records` analytics table with full version attribution (agent, prompt, model, guideline). A periodic pattern detection engine (advisory-lock-guarded, 6-hour cycle) evaluates rules against trailing windows. When patterns are detected, Claude Sonnet generates root-cause analysis via Anthropic tool_use (structured outputs) with PII-redacted samples. Suggestions undergo compliance checks before surfacing to admins. Guideline changes require two-key approval (admin + compliance_officer) and apply via RFC 6902 JSON Patch with optimistic concurrency. Three-tier dashboards (tenant, platform, per-UW) surface metrics as "UW alignment rate" (not "accuracy" — true accuracy requires post-funding performance data).

> **Tech Stack:** Existing stack — Fastify, Postgres (new tables with RLS), Redis (pub/sub events + LLM budget tracking), Anthropic SDK (Claude Sonnet with tool_use for insights), React/Next.js (dashboard components), Zod (validation). No new infrastructure dependencies.

---

## 1. Decision Capture & Override Taxonomy

### 1.1 Override Reason Categories

When a UW overrides an agent recommendation, a reason category is required (dropdown):

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
  | "dti_exception" | "income_adjustment" | "credit_reassessment"
  | "doc_sufficiency" | "compliance_exception" | "guideline_exception"
  | "risk_tolerance" | "data_error" | "other";

type DecisionType = "accepted" | "overridden" | "manual";
```

### 1.2 Action Type Extension

The existing `OverrideDecision` action gains an `overrideReason` field:

```typescript
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

### 1.3 Decision Records Table

Captures **every** terminal UW action (accept + override + manual), not just overrides. This is required for computing alignment rates, calibration curves, and throughput.

```sql
CREATE TABLE decision_records (
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
  guideline_version_id UUID NOT NULL,
  agent_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  investor_id TEXT,
  pool_id TEXT,
  ingested_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decision_time_seconds INT GENERATED ALWAYS AS
    (EXTRACT(EPOCH FROM (decided_at - ingested_at))::INT) STORED,
  recorded_by TEXT NOT NULL,
  CONSTRAINT override_requires_reason
    CHECK (decision_type <> 'overridden' OR override_reason IS NOT NULL)
);

CREATE INDEX idx_dr_tenant_time ON decision_records(tenant_id, decided_at DESC);
CREATE INDEX idx_dr_tenant_program_time ON decision_records(tenant_id, loan_program, decided_at DESC);
CREATE INDEX idx_dr_tenant_reason ON decision_records(tenant_id, override_reason)
  WHERE override_reason IS NOT NULL;
CREATE INDEX idx_dr_tenant_confidence ON decision_records(tenant_id, agent_confidence)
  WHERE agent_confidence IS NOT NULL;
```

RLS policy: `tenant_id = current_setting('app.current_tenant', true)::uuid`

**Version attribution fields** enable tracking what changed when metrics move:
- `agent_version`: identifier for the agent pipeline version
- `prompt_version`: hash or tag of the specialist prompt templates
- `model_id`: Claude model used (e.g., "claude-sonnet-4-6")
- `guideline_version_id`: FK to the tenant_guidelines version active at decision time
- `investor_id` + `pool_id`: reserved for Phase C ground-truth joins (post-funding DPD/EPD, reps & warrants)

### 1.4 Write Path

The write hook fires on **any terminal UW decision**, not just overrides:

| Action | decision_type | agent_recommendation | override_reason |
|--------|--------------|---------------------|-----------------|
| `AcceptRecommendation` | `accepted` | from `pendingRecommendation` | NULL |
| `OverrideDecision` | `overridden` | `originalRecommendation` | required |
| `SetDecision` (no pending rec) | `manual` | NULL | NULL |

When dispatched:
1. Reducer processes normally (existing)
2. Action logged to `action_log` (existing)
3. Post-dispatch hook writes denormalized record to `decision_records` with loan program, guideline version, agent confidence, and version attribution
4. `decision.made` event published via Redis (existing)

---

## 2. Metrics Engine — Three Tiers

**Terminology:** All UI labels use **"UW alignment rate"** (not "accuracy"). True accuracy requires post-funding performance data (DPD/EPD), which is Phase C. Alignment rate = % of decisions where UW agreed with agent recommendation.

### 2.1 Tier 1: Tenant-Scoped Metrics

Visible to tenant admin and UW at `/t/:slug/metrics`.

- **UW alignment rate**: % of decisions where UW accepted agent recommendation, rolling 7d/30d/90d. Formula: `accepted / (accepted + overridden) * 100`
- **Override rate by category**: Bar chart of override reasons, trailing 30d
- **Override rate by program**: Override rate per NQM program, trailing 30d
- **Confidence calibration curve**: Agent confidence buckets (0-10%, ..., 90-100%) on X axis, actual acceptance rate on Y axis. Diagonal = well-calibrated.
- **Decision throughput**: Loans decided per day/week, avg `decision_time_seconds`
- **SLA compliance rate**: % decided within SLA, by stage, trailing 7d/30d
- **Active suggestions panel**: Cards showing pending pattern suggestions with "Review" action (admin only)

### 2.2 Tier 2: Platform-Level Metrics

Visible to super_admin only at `/platform/metrics`.

- All Tier 1 metrics aggregated across tenants
- **Per-tenant comparison table**: Alignment rate, override rate, throughput, SLA — sortable
- **System-wide override heatmap**: Override reason (rows) x NQM program (columns), colored by frequency
- **Agent improvement trend**: Alignment rate over time with markers for guideline/prompt/model changes (using version attribution from decision_records)

### 2.3 Tier 3: Per-UW Metrics

Visible to super_admin only, embedded in platform admin panel. **Minimum 20 decisions required** before metrics are shown — below threshold displays "insufficient data."

- **Per-UW override rate**: How often each UW overrides vs. accepts
- **Decision consistency**: Variance in decisions on similar loans over time
- **Agreement with peers**: When multiple UWs decide similar profiles, agreement rate
- **Feedback quality signal**: UWs whose overrides consistently align with detected patterns

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

### 2.5 Snapshot + Live Hybrid Query

Dashboard API composes historical snapshots with live "today" data:

```sql
-- Historical (from snapshots)
SELECT metrics FROM metrics_snapshots
WHERE tenant_id = $1 AND snapshot_date >= $2 AND snapshot_date < CURRENT_DATE
ORDER BY snapshot_date

UNION ALL

-- Today (live from decision_records)
SELECT json_build_object(
  'alignment', json_build_object(
    'accepted', COUNT(*) FILTER (WHERE decision_type = 'accepted'),
    'overridden', COUNT(*) FILTER (WHERE decision_type = 'overridden')
  )
) FROM decision_records
WHERE tenant_id = $1 AND decided_at >= CURRENT_DATE::TIMESTAMPTZ
```

All timestamps stored and queried in UTC. Dashboard UI converts to tenant's configured timezone for display.

---

## 3. Pattern Detection — Rule-Based Triggers

### 3.1 Detection Engine

Runs every 6 hours via `setInterval`, guarded by `pg_try_advisory_lock(43)` (separate from SLA monitor's lock 42). Computes daily metrics snapshots in the same cycle.

### 3.2 Detection Rules

| Rule | ID | Trigger Condition | Min Sample |
|------|----|-------------------|------------|
| High override rate | `high_override_rate` | Override rate for (program, reason) pair > 25% over trailing 30d | 15 overrides |
| Confidence miscalibration | `confidence_miscalibration` | Agent confidence bucket has acceptance rate < 50% over trailing 30d | 10 decisions |
| Declining alignment | `declining_alignment` | Alignment rate drops > 10 pp (trailing 30d vs prior 30d) | 20 decisions per period |
| Systematic category | `systematic_category` | Single override reason > 40% of all overrides in trailing 30d | 15 overrides |

Minimum sample sizes set high enough to avoid noise-floor false positives.

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
    CHECK (status IN ('new', 'analyzing', 'suggestion_ready', 'applied', 'dismissed', 'analysis_failed')),
  suppressed_until TIMESTAMPTZ,
  status_history JSONB NOT NULL DEFAULT '[]',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_pattern_active ON detected_patterns(tenant_id, rule_name, program, override_reason)
  WHERE status NOT IN ('applied', 'dismissed', 'analysis_failed');
```

RLS policy: `tenant_id = current_setting('app.current_tenant', true)::uuid`

### 3.4 Status State Machine

```
new
  → analyzing              (insight worker picks it up)
analyzing
  → suggestion_ready       (LLM returned valid suggestion + compliance checks pass/warn)
  → analysis_failed        (LLM failed validation twice — needs manual review)
suggestion_ready
  → applied                (admin + compliance_officer approve and apply)
  → dismissed              (admin dismisses with cooldown)
analysis_failed
  → new                    (janitor resets after 1 hour, max 3 retries)
  → dismissed              (manual dismissal)
dismissed
  [suppressed_until expires → eligible for re-detection as new pattern]
```

Every status transition is appended to `status_history` JSONB array: `[{ "from": "new", "to": "analyzing", "at": "...", "by": "system" }]`

### 3.5 Deduplication & Cooldown

- Active pattern exists (status not in applied/dismissed/analysis_failed) → update `metrics_snapshot` and `updated_at`, don't create duplicate
- When dismissing, admin selects cooldown: 14 days (default), 30 days, or permanent (requires compliance co-sign). Stored in `suppressed_until`.
- Detection engine skips patterns where `suppressed_until > NOW()`

### 3.6 Janitor

Patterns stuck in `analyzing` for > 1 hour are reset to `new` with retry counter. After 3 resets → `analysis_failed`.

---

## 4. LLM-Powered Insight Generation

### 4.1 PII Redaction

Before assembling LLM prompts, all sample data passes through a redaction module:

- **Whitelist approach**: Only pass numeric fields (income, DTI, LTV, FICO, loan amount) and categorical fields (program, occupancy, property type, decision)
- **Redact from rationale text**: Regex patterns for SSN (`\d{3}-\d{2}-\d{4}`), phone numbers, email addresses. NER pass for names and addresses.
- **Redaction manifest**: Each suggestion row stores `redaction_applied: true`, `redaction_version: "1.0"`
- **Zero-data-retention**: All insight LLM calls use Anthropic's zero-data-retention header

### 4.2 Stratified Sample Selection

For each pattern, select up to 10 samples from the pattern window:

- 3 most recent (recency)
- 3 at highest agent confidence (most informative for miscalibration)
- 3 at lowest agent confidence (edge cases)
- 1 with longest rationale text (richest UW reasoning)

Cap total sample text at ~4,000 tokens. Trim oldest rationale text first.

### 4.3 Structured Output via Tool Use

Instead of JSON-in-text prompting, use Anthropic tool_use for guaranteed schema conformance:

```typescript
const suggestGuidelineChangeTool = {
  name: "propose_guideline_change",
  description: "Propose a concrete guideline or prompt change to address the detected pattern.",
  input_schema: {
    type: "object",
    properties: {
      root_cause: { type: "string", maxLength: 500 },
      suggestion_type: {
        type: "string",
        enum: ["guideline_change", "prompt_adjustment", "threshold_update", "no_action"]
      },
      specific_change: {
        type: "object",
        properties: {
          operation: { type: "string", enum: ["replace", "add", "remove"] },
          path: { type: "string", description: "JSON Pointer path, e.g. /income/maxDtiBack" },
          from: { description: "Previous value (for audit)" },
          to: { description: "New value" },
          scope: {
            type: "object",
            properties: {
              program: { type: "string" },
              loan_types: { type: "array", items: { type: "string" } }
            }
          }
        },
        required: ["operation", "path", "to", "scope"]
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      risk_assessment: { type: "string", maxLength: 1000 }
    },
    required: ["root_cause", "suggestion_type", "specific_change", "confidence", "risk_assessment"]
  }
};
```

**Validation flow:**
1. Call Claude Sonnet with tool_use, force tool call via `tool_choice: { type: "tool", name: "propose_guideline_change" }`
2. Validate `specific_change.path` resolves against the active guideline's JSON schema
3. On validation failure: retry once with error appended to prompt
4. On second failure: mark pattern `analysis_failed`, surface for manual review

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
  redaction_applied BOOLEAN NOT NULL DEFAULT true,
  redaction_version TEXT NOT NULL DEFAULT '1.0',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  compliance_reviewed_by TEXT,
  compliance_reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  expires_at TIMESTAMPTZ GENERATED ALWAYS AS (created_at + INTERVAL '14 days') STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

RLS policy: `tenant_id = current_setting('app.current_tenant', true)::uuid`

### 4.5 Compliance Checks

Before a suggestion surfaces to admin, automated compliance checks run:

```sql
CREATE TABLE suggestion_compliance_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id UUID NOT NULL REFERENCES pattern_suggestions(id),
  check_type TEXT NOT NULL
    CHECK (check_type IN ('disparate_impact', 'adverse_action_preservation', 'threshold_reasonableness')),
  result TEXT NOT NULL CHECK (result IN ('pass', 'warn', 'block')),
  details JSONB NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Check types:**
- `threshold_reasonableness`: Validates the proposed change is within sane bounds (e.g., maxDtiBack can't exceed 65%, minFico can't drop below 500)
- `adverse_action_preservation`: Verifies the change doesn't remove the agent's ability to cite specific denial reasons mapping to ECOA categories
- `disparate_impact`: MVP uses coarse geographic proxy analysis — compares approval rate shift across state/zip groupings in recent decision data. Blocks if shift exceeds ±3 percentage points across groups.

Suggestions with any `block` result route to compliance_officer-only review. Suggestions with all `pass` or `warn` surface to admin.

### 4.6 Cost Control

- LLM analysis only runs when pattern status is `new`
- Uses Claude Sonnet (not Opus) for cost efficiency
- **Per-tenant cap:** 5 LLM calls per day per tenant
- **Global cap:** 40 LLM calls per day across all tenants
- **Priority queue:** patterns sorted by `(sample_count DESC, override_rate DESC)` — high-signal patterns run first
- Daily counters tracked in Redis: `insight_calls:global:{date}` and `insight_calls:{tenantId}:{date}` with 48-hour TTL

### 4.7 Two-Key Apply Flow

For `suggestion_type in ('guideline_change', 'threshold_update')`:

1. Admin clicks "Apply" → suggestion status moves to `approved`, `reviewed_by` + `reviewed_at` set
2. Compliance officer reviews and clicks "Confirm" → `compliance_reviewed_by` + `compliance_reviewed_at` set
3. Only after both reviews: the RFC 6902 JSON Patch is applied to create a new guideline version
4. Suggestion status → `applied`, pattern status → `applied`

For `suggestion_type = 'prompt_adjustment'`:
- Admin-only apply (single key)
- Compliance officer receives notification for retrospective review within 72 hours

**Apply mechanics — RFC 6902 JSON Patch:**
- `specific_change` uses JSON Pointer paths (`/income/maxDtiBack`)
- Operations: `replace`, `add`, `remove`
- **Preview endpoint:** `POST /metrics/:tenantId/patterns/:patternId/preview` returns before/after diff without persisting
- **Optimistic concurrency:** Apply requires `If-Match: <guideline_version_etag>` header. Returns 409 on version mismatch.
- **Expired suggestions:** Apply endpoint returns 410 Gone if `expires_at < NOW()`. Admin clicks "Regenerate" → new insight cycle.

---

## 5. Dashboard UI

### 5.1 Enhanced Tenant Metrics Page (`/t/:slug/metrics`)

```
┌─────────────────────────────────────────────────────────────┐
│  Summary Cards                                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Alignment│ │ Override │ │ Avg Time │ │ SLA      │       │
│  │ 87% (30d)│ │ Rate 13% │ │ 42 min   │ │ 96%      │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
├─────────────────────────────────────────────────────────────┤
│  Alignment Trend (90d line chart)                            │
│  [guideline/prompt/model change markers on timeline]         │
├──────────────────────────┬──────────────────────────────────┤
│  Override Breakdown      │  Confidence Calibration           │
│  [By Category|By Program]│  [scatter plot vs diagonal]       │
├──────────────────────────┴──────────────────────────────────┤
│  Active Suggestions (admin only)                             │
│  ┌──────────────────────────────────────────────────┐       │
│  │ ⚠ High override rate: DTI on DSCR loans (40%)    │       │
│  │ Root cause: Agent threshold too conservative      │       │
│  │ Suggestion: /income/maxDtiBack 43→50             │       │
│  │ Confidence: 78%  [Preview] [Apply] [Dismiss]      │       │
│  │ Expires: 7 days                                   │       │
│  └──────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Platform Metrics Page (`/platform/metrics`)

- Tenant comparison table (sortable by alignment rate, override rate, throughput, SLA)
- System-wide override heatmap: reason x program
- Per-UW performance table (super_admin only, min 20 decisions)
- Global alignment trend with version change markers

### 5.3 Override Dialog Modification

The existing override dialog gains:
- Required "Override Reason" dropdown (9 categories)
- "Other" requires non-empty rationale text
- Existing free-text rationale field remains below dropdown

### 5.4 Recommendation Panel Context

When viewing a staged recommendation, show calibration-aware framing:
- "When the agent is {confidence_bucket} confident on {program}, UWs agree {rate}% of the time"
- More actionable than raw alignment rate, less prone to anchoring bias

---

## 6. API Routes

### 6.1 Tenant-Scoped Metrics

```
GET /metrics/:tenantId/alignment?window=30
  → { rate, accepted, overridden, trend: [{date, rate}],
      calibration: [{bucket, acceptanceRate, count}] }

GET /metrics/:tenantId/overrides?window=30
  → { byReason: {...}, byProgram: {...} }

GET /metrics/:tenantId/patterns
  → [{ id, ruleName, program, reason, metricsSnapshot, status,
       suggestion?: { id, type, rootCause, specificChange, confidence, risk, expiresAt } }]

POST /metrics/:tenantId/patterns/:patternId/preview
  → { before: {...guidelineRules}, after: {...guidelineRules}, diff: [...patches] }

POST /metrics/:tenantId/patterns/:patternId/apply
  Headers: If-Match: <guideline_version_etag>
  → { guidelineVersionId, appliedChange }
  Errors: 409 (version mismatch), 410 (expired), 403 (compliance review required)

POST /metrics/:tenantId/patterns/:patternId/dismiss
  Body: { reason: string, cooldownDays: 14 | 30 | "permanent" }
  → { status: "dismissed", suppressedUntil }
```

### 6.2 Platform-Level Metrics (super_admin only)

```
GET /platform/metrics/summary
  → { tenants: [{ id, slug, alignmentRate, overrideRate, throughput, sla }] }

GET /platform/metrics/heatmap
  → { cells: [{ program, reason, count, rate }] }

GET /platform/metrics/uw-performance
  → [{ userId, tenantId, overrideRate, decisionCount, consistencyScore }]

GET /platform/metrics/alignment-trend?days=90
  → { trend: [{ date, rate, versionChanges: [...] }] }
```

### 6.3 Existing Route Modification

```
POST /loans/:loanId/override
  Body gains: overrideReason (required OverrideReasonCategory)
```

---

## 7. Types, Schemas & Events

### 7.1 Core Types

```typescript
type OverrideReasonCategory =
  | "dti_exception" | "income_adjustment" | "credit_reassessment"
  | "doc_sufficiency" | "compliance_exception" | "guideline_exception"
  | "risk_tolerance" | "data_error" | "other";

type DecisionType = "accepted" | "overridden" | "manual";

type PatternStatus = "new" | "analyzing" | "suggestion_ready" | "applied" | "dismissed" | "analysis_failed";

type SuggestionStatus = "pending" | "approved" | "rejected" | "applied";

interface DetectedPattern {
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
}

interface PatternSuggestion {
  id: string;
  tenantId: string;
  patternId: string;
  suggestionType: "guideline_change" | "prompt_adjustment" | "threshold_update" | "no_action";
  rootCause: string;
  specificChange: {
    operation: "replace" | "add" | "remove";
    path: string;
    from?: unknown;
    to: unknown;
    scope: { program: string; loan_types?: string[] };
  };
  confidence: number;
  riskAssessment: string;
  status: SuggestionStatus;
  expiresAt: string;
  reviewedBy?: string;
  complianceReviewedBy?: string;
}

interface DecisionRecord {
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
  cooldownDays: z.union([z.literal(14), z.literal(30), z.literal("permanent")]).default(14),
});

const ApplyPatternSchema = z.object({
  // Body is empty — guideline version validated via If-Match header
});
```

### 7.3 Event Payload Schemas

```typescript
const DecisionMadeEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal("decision.made"),
  eventVersion: z.literal(1),
  tenantId: z.string().uuid(),
  loanId: z.string(),
  decisionRecordId: z.string().uuid(),
  decisionType: z.enum(["accepted", "overridden", "manual"]),
  occurredAt: z.string().datetime(),
});

const PatternDetectedEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal("pattern.detected"),
  eventVersion: z.literal(1),
  tenantId: z.string().uuid(),
  patternId: z.string().uuid(),
  ruleName: z.string(),
  program: z.string().optional(),
  occurredAt: z.string().datetime(),
});

const SuggestionReadyEventSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.literal("pattern.suggestion_ready"),
  eventVersion: z.literal(1),
  tenantId: z.string().uuid(),
  patternId: z.string().uuid(),
  suggestionId: z.string().uuid(),
  suggestionType: z.string(),
  occurredAt: z.string().datetime(),
});

const GuidelineUpdatedEventSchema = z.object({
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

---

## 8. Roles & Access Control

### 8.1 New Role: compliance_officer

```
super_admin        → platform-wide, all capabilities
compliance_officer → tenant-scoped, reviews and approves guideline change suggestions
admin              → tenant-scoped, manages settings, reviews suggestions (first key)
uw                 → tenant-scoped, reviews loans, makes decisions with override reasons
va                 → tenant-scoped, processes loans
demo               → tenant-scoped, read-only
```

`compliance_officer` is a new role in the existing role hierarchy. They can:
- View all pattern suggestions for their tenant
- Approve/reject guideline_change and threshold_update suggestions (second key)
- View compliance check results
- Cannot create tenants, manage users, or make UW decisions

---

## 9. Background Workers

### 9.1 Pattern Detection + Metrics Snapshot Worker

- Runs every 6 hours via `setInterval`
- Guarded by `pg_try_advisory_lock(43)`
- Sequence per cycle:
  1. Compute `metrics_snapshots` for all active tenants (today's data)
  2. Evaluate 4 detection rules against `decision_records` per tenant
  3. Write/update `detected_patterns`
  4. Pick up patterns with status `new`, run LLM insight generation
  5. Run compliance checks on new suggestions
  6. Publish events for detected patterns and ready suggestions

### 9.2 Janitor (same worker)

- Patterns in `analyzing` > 1 hour → reset to `new` (max 3 resets, then `analysis_failed`)
- Patterns in `analysis_failed` > 7 days without manual review → dismissed with cooldown

---

## 10. Backfill Migration

On first deployment, `decision_records` is empty. Dashboards would show no data for 30 days.

**Backfill script:**
1. Scans `action_log` for trailing 90 days
2. Finds `AcceptRecommendation`, `OverrideDecision`, and `SetDecision` actions
3. Reconstructs `decision_records` rows:
   - `agent_recommendation` and `agent_confidence` from the loan's `pendingRecommendation` at that point (if available in action log)
   - `guideline_version_id` → uses current active version with sentinel `'backfilled'`
   - `agent_version`, `prompt_version`, `model_id` → `'backfilled_unknown'` sentinel
   - `ingested_at` → loan creation timestamp or action timestamp
4. Computes initial `metrics_snapshots` for trailing 30 days
5. Idempotent — re-runnable, skips existing records by `(tenant_id, loan_id, decided_at)` uniqueness

---

## 11. Observability

### 11.1 Learning Engine Metrics

Exposed via structured pino logs (parseable for Prometheus/Grafana):

- `learning.detection.run.duration_ms` — time per detection cycle
- `learning.detection.patterns_detected` — count per cycle, labels: rule, program
- `learning.insight.llm_call.duration_ms` — time per LLM call
- `learning.insight.llm_call.tokens` — input + output tokens per call
- `learning.insight.validation_failures` — count of LLM responses that failed schema validation
- `learning.suggestions.outcome` — applied vs rejected vs dismissed (meta-metric: is the AI's advice good?)
- `learning.compliance.blocked` — suggestions blocked by compliance checks

### 11.2 Health Check Extension

`GET /health` response gains:
```json
{
  "learningEngine": {
    "lastDetectionRun": "2026-04-23T12:00:00Z",
    "patternsActive": 3,
    "suggestionssPending": 1,
    "llmCallsToday": 12,
    "llmBudgetRemaining": 28
  }
}
```

---

## 12. Testing Strategy

### 12.1 Decision Capture Tests

```
- AcceptRecommendation → decision_record with type=accepted, agent_confidence captured
- OverrideDecision with valid reason → decision_record with type=overridden, override_reason set
- OverrideDecision with "other" but empty rationale → rejected (400)
- OverrideDecision without overrideReason → rejected (400)
- SetDecision without pending rec → decision_record with type=manual, agent fields NULL
- Version attribution fields populated correctly
```

### 12.2 Pattern Detection Tests

```
- 15 overrides at 30% rate for (DSCR, dti_exception) → pattern detected
- 14 overrides (below min 15) → no pattern
- Existing active pattern → metrics_snapshot updated, no duplicate
- Dismissed pattern within cooldown → not re-raised
- Dismissed pattern after cooldown expires → new pattern created
```

### 12.3 Metrics Computation Tests

```
- 10 accepted + 2 overridden → alignment rate 83.3%
- Calibration: 5 loans at 80% confidence, 4 accepted → bucket shows 80% acceptance
- Empty decision_records → all metrics return zeros
- Tenant A's decisions don't appear in tenant B's metrics (RLS)
- Snapshot + live hybrid returns consistent data across the date boundary
```

### 12.4 Suggestion Flow Tests

```
- Apply guideline_change → requires both admin + compliance_officer reviews
- Apply prompt_adjustment → admin-only (single key)
- Apply expired suggestion → 410 Gone
- Apply with wrong If-Match → 409 Conflict
- Preview returns valid before/after diff
- Dismiss with cooldown → suppressed_until set correctly
- Compliance block → suggestion not visible to admin, only to compliance_officer
```

### 12.5 PII Redaction Tests

```
- Rationale containing SSN pattern → redacted
- Rationale containing email → redacted
- Numeric fields (DTI, FICO, LTV) → preserved
- Categorical fields → preserved
```

---

## Non-Goals (Explicitly Out of Scope)

- **A/B testing framework** — Testing prompt variants against historical loans. Deferred until sufficient decision volume.
- **Automated prompt deployment** — All suggestions require human review. No auto-apply.
- **Real-time pattern detection** — 6-hour cycle, not per-decision. Adequate at current volumes.
- **Per-UW feedback visible to UWs** — Per-UW metrics are super_admin only.
- **Historical loan replay** — Replaying loans through updated guidelines. Phase C.
- **Custom detection rules** — 4 built-in rules. Tenant-configurable rules are Phase C.
- **Full disparate-impact analysis** — MVP uses geographic proxy. Full protected-class analysis requires HMDA data integration (post-origination).
- **Post-funding ground truth** — `investor_id` and `pool_id` fields are reserved but not used until DPD/EPD data is available.
