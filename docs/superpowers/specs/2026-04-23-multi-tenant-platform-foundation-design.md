# Multi-Tenant Platform Foundation — Design Spec

> **Goal:** Transform the single-lender Encompass Digital Twin into a fully isolated, multi-tenant underwriting service platform where each lender operates as an independent instance with their own guidelines, workflows, teams, and data — all on shared infrastructure.

> **Architecture:** Row-level tenant isolation using Supabase RLS. Every table gains a `tenant_id` column. Postgres enforces isolation at the query level. The in-memory store becomes tenant-scoped. A pluggable ingestion API accepts external loan data with per-tenant field mapping transformers. Real-time visibility via WebSocket replaces polling. SLA monitoring ensures processing commitments.

> **Tech Stack:** Supabase (RLS + Storage), Fastify (WebSocket via @fastify/websocket), Next.js 15 App Router (tenant-scoped routing), Zod (validation), existing @twin/core reducer pattern extended with tenant context.

---

## 1. Tenant Model & Data Architecture

### 1.1 Tenant Entity

A `Tenant` represents a lender organization. Each tenant is fully isolated — its users, loans, guidelines, documents, and agent activity are invisible to other tenants.

```typescript
interface Tenant {
  id: string;           // UUID
  name: string;         // "Acme Lending"
  slug: string;         // "acme" — used in URLs, unique
  status: "onboarding" | "active" | "suspended";
  settings: TenantSettings;
  createdAt: string;    // ISO timestamp
}

interface TenantSettings {
  sla: {
    maxQueueTimeMinutes: number;        // default: 30
    maxProcessingTimeMinutes: number;   // default: 60
    maxReviewTimeMinutes: number;       // default: 120
    maxTotalTimeMinutes: number;        // default: 240
  };
  agentBehavior: {
    riskTolerance: "conservative" | "moderate" | "aggressive";
    autoApproveThreshold: number;       // confidence above which auto-approve is allowed (0-1)
    escalationTriggers: string[];       // conditions that force HITL
  };
  webhooks: WebhookConfig[];
  branding?: {
    logoUrl?: string;
    primaryColor?: string;
  };
}

interface WebhookConfig {
  url: string;
  events: string[];     // ["loan.received", "recommendation.staged", "decision.made"]
  secret: string;       // HMAC signing secret
  active: boolean;
}
```

### 1.2 Database Schema Changes

**New tables:**

```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'onboarding' CHECK (status IN ('onboarding', 'active', 'suspended')),
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tenant_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,       -- first 8 chars for identification
  name TEXT NOT NULL,             -- "Production Ingest Key"
  rate_limit_per_minute INT DEFAULT 60,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tenant_guidelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  program TEXT NOT NULL,          -- "BankStatement12", "DSCR", etc.
  rules JSONB NOT NULL,           -- structured guideline rules
  version INT NOT NULL DEFAULT 1,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, program, version)
);

CREATE TABLE tenant_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  pipeline_config JSONB NOT NULL, -- stage-level config (which agents, thresholds)
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ingestion_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  source_name TEXT NOT NULL,      -- "encompass", "bytepro", "custom"
  transformer_type TEXT NOT NULL, -- "generic-json", "mismo-xml"
  field_map JSONB NOT NULL,       -- declarative field mapping
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Modified existing tables:**

```sql
-- Add tenant_id to world_state
ALTER TABLE world_state ADD COLUMN tenant_id UUID REFERENCES tenants(id);
ALTER TABLE world_state DROP CONSTRAINT world_state_pkey;
ALTER TABLE world_state ADD PRIMARY KEY (id, tenant_id);

-- Add tenant_id to action_log
ALTER TABLE action_log ADD COLUMN tenant_id UUID REFERENCES tenants(id);
CREATE INDEX idx_action_log_tenant ON action_log(tenant_id, logged_at);

-- RLS policies
ALTER TABLE world_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_world ON world_state
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE action_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_log ON action_log
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE tenant_guidelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_guidelines ON tenant_guidelines
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
```

### 1.3 In-Memory Store Changes

The current singleton `WorldState` becomes tenant-scoped:

```typescript
// Before: single store
const store = createStore();

// After: tenant-scoped store map
const stores: Map<string, Store> = new Map();

function getStore(tenantId: string): Store {
  if (!stores.has(tenantId)) {
    stores.set(tenantId, createStore({ tenantId }));
  }
  return stores.get(tenantId)!;
}
```

Every action gains a `tenantId` field. The `dispatch()` function routes to the correct tenant store.

### 1.4 User-Tenant Binding

The `AuthUser` type gains a `tenantId` and `superAdmin` flag:

```typescript
interface AuthUser {
  id: string;
  email: string;
  displayName?: string;
  role: "demo" | "va" | "uw" | "admin";
  tenantId: string;
  isSuperAdmin?: boolean;  // platform-wide admin, not tenant-scoped
}
```

Supabase Auth user metadata stores `tenant_id` and `role`. The `getUser()` helper extracts these from the JWT.

### 1.5 URL Structure

```
Tenant-scoped routes:
  /t/:tenantSlug/              → Pipeline view for that tenant
  /t/:tenantSlug/loan/:loanId  → Loan detail
  /t/:tenantSlug/va            → VA Dashboard
  /t/:tenantSlug/uw            → UW Queue
  /t/:tenantSlug/metrics       → Metrics
  /t/:tenantSlug/admin         → Tenant admin

Platform admin (super_admin only):
  /platform/tenants            → Manage all tenants
  /platform/health             → Cross-tenant system health

Legacy (default tenant fallback):
  /loan/:loanId                → Resolves to default tenant
  /va, /uw, /metrics, /admin   → Resolves to default tenant
```

Next.js App Router implements this via a `[tenantSlug]` route group. Middleware resolves the tenant from the URL slug, validates the user belongs to that tenant, and injects `tenantId` into the request context.

---

## 2. Per-Lender Guidelines & Configurable Rules

### 2.1 Guidelines Structure

Each guideline record contains structured rules for one program within one tenant:

```typescript
interface TenantGuideline {
  id: string;
  tenantId: string;
  program: string;        // "BankStatement12", "DSCR", "AssetDepletion", etc.
  version: number;
  active: boolean;
  rules: GuidelineRules;
  createdAt: string;
}

interface GuidelineRules {
  credit: {
    minFico: number;
    maxLate30d: number;
    maxLate60d: number;
    maxLate90d: number;
    disputePolicy: "block" | "warn" | "ignore";
    maxOpenCollections: number;
  };
  income: {
    maxDtiFront: number;        // housing ratio %
    maxDtiBack: number;         // total DTI %
    qualifyingMethods: string[]; // ["bank_statement_12", "bank_statement_24", "dscr", "asset_depletion"]
    expenseFactors: Record<string, number>; // { "self_employed": 0.50, "rental": 0.75 }
    minDscrRatio?: number;      // for DSCR programs
  };
  ltv: {
    maxLtv: number;             // overall cap
    matrix: Array<{             // FICO-LTV matrix
      minFico: number;
      maxFico: number;
      maxLtv: number;
      occupancy?: string;       // "primary" | "investment" | "second_home"
    }>;
  };
  reserves: {
    minMonths: number;
    byLtvTier: Array<{
      maxLtv: number;
      minMonths: number;
    }>;
  };
  documents: {
    required: Array<{
      docType: string;
      description: string;
      expirationDays?: number;  // doc must be < N days old
    }>;
  };
  conditions: {
    defaultTemplates: Array<{
      category: "PTA" | "PTD" | "PTF" | "PTP";
      source: "UW" | "AUS" | "Compliance" | "Investor";
      description: string;
    }>;
  };
  compliance: {
    stateRestrictions: string[];          // states where this program is not offered
    geoOverlays: Record<string, string>; // state → overlay rule
    maxPointsFeesPct: number;
  };
  agentPromptOverrides?: {
    riskTolerance: string;               // injected into agent system prompts
    specialInstructions: string;         // lender-specific UW notes
  };
}
```

### 2.2 How Agents Use Guidelines

When the multi-agent pipeline runs:

1. Orchestrator fetches `tenant_guidelines` for `(tenantId, loan.nqmProgram, active=true)`
2. Guidelines are serialized and injected into each specialist's system prompt as a structured `## LENDER GUIDELINES` section
3. Each specialist evaluates the loan against the tenant's specific thresholds, not universal defaults
4. The Risk Agent scores against the tenant's LTV matrix and reserve tiers
5. The final recommendation is stamped with `guidelineVersion` for auditability

### 2.3 Guideline Versioning

- Updating a guideline creates a new version; the old version is marked `active: false`
- Loans decided under version N reference that version in their decision record
- Admin UI shows version history with diff view
- Rolling back = creating a new version with the old rules

---

## 3. External Loan Ingestion API

### 3.1 Ingestion Endpoint

```
POST /api/ingest/:tenantSlug/loans
Authorization: Bearer <tenant_api_key>
Content-Type: application/json | multipart/form-data

Request body (JSON mode):
{
  "source": "encompass",
  "externalId": "ENC-2024-00123",
  "loanData": { ... source-specific fields ... },
  "documents": [
    { "name": "1003.pdf", "url": "https://..." }
  ],
  "callbackUrl": "https://lender.com/webhook/decisions"
}

Response:
{
  "loanId": "2501000301",
  "tenantId": "uuid",
  "status": "queued",
  "estimatedProcessingMinutes": 15
}
```

### 3.2 Pluggable Transformers

```typescript
interface IngestionTransformer {
  name: string;                          // "generic-json", "mismo-xml"
  transform(raw: unknown, fieldMap: Record<string, string>): Partial<Loan>;
  validate(result: Partial<Loan>): ValidationResult;
}

// Registry
const transformers: Map<string, IngestionTransformer> = new Map();
transformers.set("generic-json", new GenericJsonTransformer());
transformers.set("mismo-xml", new MismoXmlTransformer());
```

**Generic JSON transformer** — declarative field mapping:
```json
{
  "borrowerName": "borrower.fullName",
  "borrowerSSN": "borrower.ssn",
  "loanAmt": "transaction.loanAmount",
  "appraisedVal": "property.appraisedValue",
  "creditScore": "credit.repScore",
  "tradelines[].creditor": "credit.tradelines[].creditorName",
  "tradelines[].balance": "credit.tradelines[].balance"
}
```

Dot notation for nested fields, `[]` for array mapping. Covers 80% of integrations. Complex cases (computed fields, conditional logic) use a custom transformer registered for that source.

### 3.3 Authentication

- API keys are generated per tenant via the admin UI
- Keys are hashed (SHA-256) before storage; only the prefix is stored in plain text for identification
- Rate limiting: configurable per key (default 60 requests/minute)
- Keys can be rotated (create new → deprecate old) without downtime

### 3.4 Document Ingestion

- Documents referenced by URL are fetched asynchronously and stored in tenant-scoped Supabase Storage: `documents/{tenantId}/{loanId}/{docId}`
- Multipart uploads go directly to storage
- After storage, IDP extraction can be triggered automatically based on tenant workflow config

### 3.5 Outbound Webhooks

When a tenant has webhooks configured:

```typescript
interface WebhookPayload {
  event: "loan.received" | "recommendation.staged" | "decision.made" | "sla.breached";
  tenantId: string;
  loanId: string;
  externalId?: string;    // the lender's own ID for correlation
  timestamp: string;
  data: Record<string, unknown>;  // event-specific payload
}
```

- Signed with HMAC-SHA256 using the webhook secret
- Retried 3 times with exponential backoff (1s, 10s, 60s)
- Failed deliveries logged for admin visibility

---

## 4. Real-Time Visibility (WebSocket)

### 4.1 Server Architecture

```typescript
// Fastify WebSocket setup
import websocket from "@fastify/websocket";

server.register(websocket);

server.get("/ws/:tenantId", { websocket: true }, (socket, req) => {
  const tenantId = req.params.tenantId;
  const user = authenticateWs(req);  // validate JWT from query param or header

  if (user.tenantId !== tenantId) {
    socket.close(4403, "Tenant mismatch");
    return;
  }

  channels.subscribe(tenantId, socket);

  socket.on("message", (msg) => {
    // Client can subscribe to specific loan channels
    const { action, loanId } = JSON.parse(msg);
    if (action === "subscribe") channels.subscribeLoan(tenantId, loanId, socket);
    if (action === "unsubscribe") channels.unsubscribeLoan(tenantId, loanId, socket);
  });

  socket.on("close", () => channels.unsubscribe(tenantId, socket));
});
```

### 4.2 Event Bus

The store emits events after every dispatch:

```typescript
interface StoreEvent {
  tenantId: string;
  loanId: string;
  type: string;       // "agent.step", "loan.updated", "decision.made", etc.
  payload: unknown;
  timestamp: string;
}
```

Event type mapping:

| Action Type | Event Type | Payload |
|-------------|-----------|---------|
| RecordAgentStep | `agent.step` | loanId, phase, content preview |
| SetDecision, AcceptRecommendation, OverrideDecision | `decision.made` | loanId, decision, actor |
| StageRecommendation | `recommendation.staged` | loanId, decision, confidence |
| AddCondition, ClearCondition, WaiveCondition | `condition.changed` | loanId, conditionId, status |
| AddDocument, UpdateDocumentStatus | `document.updated` | loanId, docId, status |
| AssignLoan, UpdateAssignment | `assignment.changed` | loanId, assignee, status |

### 4.3 Client Hook

```typescript
function useLiveUpdates(tenantId: string, loanId?: string): StoreEvent | null {
  // Connects to WebSocket, subscribes to tenant + optional loan channel
  // Returns latest event for triggering UI refresh
  // Calls router.refresh() on relevant events to refetch server components
}
```

### 4.4 Migration from Polling

- `AgentActivityFeed` switches from 3-second polling to WebSocket events
- VA Dashboard and UW Queue get live badge updates
- Existing polling code is removed once WebSocket is stable

---

## 5. Processing SLA Monitoring

### 5.1 SLA Configuration

Per-tenant SLA thresholds stored in `tenant.settings.sla`:

```typescript
interface SlaConfig {
  maxQueueTimeMinutes: number;        // queued → in_progress (default: 30)
  maxProcessingTimeMinutes: number;   // in_progress → report_ready (default: 60)
  maxReviewTimeMinutes: number;       // under_review → decided (default: 120)
  maxTotalTimeMinutes: number;        // ingestion → decision (default: 240)
}
```

### 5.2 SLA Tracking on Loans

Each loan gains an `slaDeadlines` field computed when it enters each stage:

```typescript
interface SlaDeadlines {
  queuedDeadline?: string;       // ISO timestamp
  processingDeadline?: string;
  reviewDeadline?: string;
  totalDeadline?: string;
  breaches: Array<{
    stage: string;
    deadline: string;
    breachedAt: string;
  }>;
}
```

### 5.3 Background Monitor

A `setInterval` in the API server runs every 60 seconds:

1. Iterate all active tenants
2. For each tenant, scan loans with active assignments
3. Compare current time against `slaDeadlines`
4. If warning threshold (75%) reached: push `sla.warning` event via WebSocket
5. If breached: push `sla.breached` event, auto-bump loan priority to "urgent", trigger webhook if configured

### 5.4 Dashboard Integration

- VA Dashboard: countdown timer on each loan card showing time remaining in current SLA stage
- UW Queue: breached loans sort to top with red indicator
- Metrics page: SLA compliance rate chart (% decided within SLA, by time period)
- Admin: tenant-level SLA health overview

---

## 6. Migration Path

### 6.1 Default Tenant

On first deployment after multi-tenant migration:

1. A `default` tenant is created with id `00000000-0000-0000-0000-000000000000`, slug `default`, status `active`
2. All existing `world_state` and `action_log` rows get `tenant_id = default`
3. All existing users get `tenant_id = default` in their auth metadata
4. Current NQM guideline assumptions are extracted from agent prompts into `tenant_guidelines` records for the `default` tenant
5. Current fixture scenarios are associated with the `default` tenant

### 6.2 URL Backward Compatibility

Next.js middleware handles both patterns:

- `/loan/123` → resolves to `default` tenant, renders loan 123
- `/t/acme/loan/456` → resolves to `acme` tenant, renders loan 456

Existing bookmarks and links continue to work.

### 6.3 Role Hierarchy

```
super_admin  → platform-wide, manages tenants, cross-tenant visibility
admin        → tenant-scoped, manages users/settings/guidelines within their tenant
uw           → tenant-scoped, reviews loans and makes decisions
va           → tenant-scoped, processes loans and runs agent pipeline
demo         → tenant-scoped, read-only access
```

`super_admin` is stored as a flag (`isSuperAdmin`) separate from the tenant-scoped `role`. A user can be `admin` of Tenant Acme AND `super_admin` of the platform.

### 6.4 Tenant Onboarding Flow

Admin UI wizard (super_admin only):

1. **Create tenant** — name, slug
2. **Upload guidelines** — JSON or guided form per program
3. **Configure workflow** — which agents to run, thresholds, escalation rules
4. **Set up ingestion** — source type, field mapping, API key generation
5. **Configure SLA** — thresholds per stage
6. **Create users** — initial admin + VA + UW accounts
7. **Activate** — tenant status → `active`, ready to receive loans

---

## Non-Goals (Explicitly Out of Scope)

- **Configurable pipeline stages** — Fixed pipeline (Intake → Doc → Income → Credit → Compliance → Risk → Decision). Configurable stages deferred to a future phase.
- **Cross-tenant analytics** — Super admin can view per-tenant health, but no cross-tenant data aggregation or comparison.
- **Real-time collaboration** — Multiple users on the same loan simultaneously (CRDT/OT). Deferred.
- **MISMO XML parser** — The transformer interface supports it, but the actual MISMO parser is built when the first MISMO integration is needed. Only `generic-json` is built in this phase.
- **Custom branding/white-label** — Tenant branding fields exist in settings, but full white-label UI is deferred.
