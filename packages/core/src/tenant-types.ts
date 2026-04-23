// ── Tenant Status ──────────────────────────────────────────────────
export type TenantStatus = "onboarding" | "active" | "suspended" | "offboarding";

// ── Webhook ────────────────────────────────────────────────────────
export type WebhookEventType =
  | "loan.received"
  | "recommendation.staged"
  | "decision.made"
  | "sla.breached"
  | "agent.started"
  | "agent.completed"
  | "document.extracted";

export interface WebhookConfig {
  id: string;
  url: string;
  events: WebhookEventType[];
  secret: string;
  active: boolean;
}

// ── SLA ────────────────────────────────────────────────────────────
export interface SlaConfig {
  maxQueueTimeMinutes: number;
  maxProcessingTimeMinutes: number;
  maxReviewTimeMinutes: number;
  maxTotalTimeMinutes: number;
}

export const DEFAULT_SLA_CONFIG: SlaConfig = {
  maxQueueTimeMinutes: 30,
  maxProcessingTimeMinutes: 60,
  maxReviewTimeMinutes: 120,
  maxTotalTimeMinutes: 240,
};

// ── Tenant Settings ────────────────────────────────────────────────
export interface TenantSettings {
  sla: SlaConfig;
  agentBehavior: {
    riskTolerance: "conservative" | "moderate" | "aggressive";
    autoApproveThreshold: number;
    escalationTriggers: string[];
  };
  webhooks: WebhookConfig[];
  branding?: {
    logoUrl?: string;
    primaryColor?: string;
    companyName?: string;
  };
}

// ── Tenant ─────────────────────────────────────────────────────────
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  settings: TenantSettings;
  createdAt: string;
  deletedAt?: string;
}

// ── SLA Deadlines ──────────────────────────────────────────────────
export interface SlaBreach {
  type: "queue" | "processing" | "review" | "total";
  deadline: string;
  breachedAt: string;
}

export interface SlaDeadlines {
  queuedDeadline?: string;
  processingDeadline?: string;
  reviewDeadline?: string;
  totalDeadline?: string;
  breaches: SlaBreach[];
}

// ── Guideline Rules ────────────────────────────────────────────────
export interface GuidelineRules {
  credit: {
    minFico: number;
    maxFico: number;
    maxLatePayments30?: number;
    maxLatePayments60?: number;
    maxLatePayments90?: number;
    minTradelineCount?: number;
    minTradelineAge?: number;
    housingEventSeasoning?: number;
    bankruptcySeasoning?: number;
    foreclosureSeasoning?: number;
  };
  income: {
    methods: string[];
    minMonths?: number;
    maxNsfCount?: number;
    minExpenseFactor?: number;
    maxExpenseFactor?: number;
    requireCpaLetter?: boolean;
  };
  ltv: {
    maxLtv: number;
    maxCltv: number;
    maxHcltv?: number;
    maxLtvCashOut?: number;
  };
  reserves: {
    minMonths: number;
    minMonthsInvestment?: number;
    liquidOnly?: boolean;
  };
  documents: {
    required: string[];
    conditional?: Array<{
      document: string;
      condition: string;
    }>;
  };
  conditions: {
    autoGenerate?: string[];
    requiredCategories?: string[];
  };
  compliance: {
    requireQm?: boolean;
    requireAtr?: boolean;
    maxPointsAndFees?: number;
    stateLicenseCheck?: boolean;
  };
  tenantContext?: {
    overlayNotes?: string;
    lenderNotes?: string;
    customFields?: Record<string, unknown>;
  };
}

// ── Tenant Guideline ───────────────────────────────────────────────
export interface TenantGuideline {
  id: string;
  tenantId: string;
  program: string;
  version: number;
  active: boolean;
  rules: GuidelineRules;
  createdAt: string;
}

// ── Store Event ────────────────────────────────────────────────────
export interface StoreEvent {
  id: string;
  tenantId: string;
  loanId: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

// ── Webhook Payload ────────────────────────────────────────────────
export interface WebhookPayload {
  eventId: string;
  event: WebhookEventType;
  apiVersion: string;
  tenantId: string;
  loanId: string;
  externalId?: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ── Constants ──────────────────────────────────────────────────────
export const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";
export const DEFAULT_TENANT_SLUG = "default";

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "platform",
  "loan",
  "ws",
  "public",
  "static",
  "health",
  "auth",
  "login",
  "register",
  "t",
  "metrics",
  "va",
  "uw",
  "workshop",
  "hitl",
  "system",
  "default",
]);
