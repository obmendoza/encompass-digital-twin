import { z } from "zod";
import { RESERVED_SLUGS } from "./tenant-types.js";

// ── Tenant Slug ────────────────────────────────────────────────────
export const TenantSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,29}[a-z0-9]$/, "Slug must be 2-31 chars, lowercase alphanumeric + hyphens, cannot start/end with hyphen")
  .refine((s) => !RESERVED_SLUGS.has(s), "Slug is reserved");

// ── SLA Config ─────────────────────────────────────────────────────
export const SlaConfigSchema = z.object({
  maxQueueTimeMinutes: z.number().int().min(1).default(30),
  maxProcessingTimeMinutes: z.number().int().min(1).default(60),
  maxReviewTimeMinutes: z.number().int().min(1).default(120),
  maxTotalTimeMinutes: z.number().int().min(1).default(240),
});

// ── Webhook Config ─────────────────────────────────────────────────
export const WebhookEventTypeSchema = z.enum([
  "loan.received",
  "recommendation.staged",
  "decision.made",
  "sla.breached",
  "agent.started",
  "agent.completed",
  "document.extracted",
]);

export const WebhookConfigSchema = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  events: z.array(WebhookEventTypeSchema).min(1),
  secret: z.string().min(16),
  active: z.boolean().default(true),
});

// ── Tenant Settings ────────────────────────────────────────────────
export const TenantSettingsSchema = z.object({
  sla: SlaConfigSchema.default({
    maxQueueTimeMinutes: 30,
    maxProcessingTimeMinutes: 60,
    maxReviewTimeMinutes: 120,
    maxTotalTimeMinutes: 240,
  }),
  agentBehavior: z.object({
    riskTolerance: z.enum(["conservative", "moderate", "aggressive"]).default("moderate"),
    autoApproveThreshold: z.number().min(0).max(1).default(0.95),
    escalationTriggers: z.array(z.string()).default([]),
  }).default({}),
  webhooks: z.array(WebhookConfigSchema).default([]),
  branding: z.object({
    logoUrl: z.string().url().optional(),
    primaryColor: z.string().optional(),
    companyName: z.string().optional(),
  }).optional(),
});

// ── Create Tenant ──────────────────────────────────────────────────
export const CreateTenantSchema = z.object({
  name: z.string().min(1, "Tenant name is required").max(100),
  slug: TenantSlugSchema,
  settings: TenantSettingsSchema.optional(),
});

// ── Guideline Rules ────────────────────────────────────────────────
export const GuidelineRulesSchema = z.object({
  credit: z.object({
    minFico: z.number().int().min(300).max(850),
    maxFico: z.number().int().min(300).max(850),
    maxLatePayments30: z.number().int().min(0).optional(),
    maxLatePayments60: z.number().int().min(0).optional(),
    maxLatePayments90: z.number().int().min(0).optional(),
    minTradelineCount: z.number().int().min(0).optional(),
    minTradelineAge: z.number().int().min(0).optional(),
    housingEventSeasoning: z.number().int().min(0).optional(),
    bankruptcySeasoning: z.number().int().min(0).optional(),
    foreclosureSeasoning: z.number().int().min(0).optional(),
  }).refine((d) => d.minFico <= d.maxFico, {
    message: "minFico must be less than or equal to maxFico",
  }),
  income: z.object({
    methods: z.array(z.string()).min(1),
    minMonths: z.number().int().min(1).optional(),
    maxNsfCount: z.number().int().min(0).optional(),
    minExpenseFactor: z.number().min(0).max(1).optional(),
    maxExpenseFactor: z.number().min(0).max(1).optional(),
    requireCpaLetter: z.boolean().optional(),
  }),
  ltv: z.object({
    maxLtv: z.number().min(0).max(100),
    maxCltv: z.number().min(0).max(100),
    maxHcltv: z.number().min(0).max(100).optional(),
    maxLtvCashOut: z.number().min(0).max(100).optional(),
  }),
  reserves: z.object({
    minMonths: z.number().int().min(0),
    minMonthsInvestment: z.number().int().min(0).optional(),
    liquidOnly: z.boolean().optional(),
  }),
  documents: z.object({
    required: z.array(z.string()),
    conditional: z.array(z.object({
      document: z.string(),
      condition: z.string(),
    })).optional(),
  }),
  conditions: z.object({
    autoGenerate: z.array(z.string()).optional(),
    requiredCategories: z.array(z.string()).optional(),
  }),
  compliance: z.object({
    requireQm: z.boolean().optional(),
    requireAtr: z.boolean().optional(),
    maxPointsAndFees: z.number().min(0).optional(),
    stateLicenseCheck: z.boolean().optional(),
  }),
  tenantContext: z.object({
    overlayNotes: z.string().max(5000).optional(),
    lenderNotes: z.string().max(2000).optional(),
    customFields: z.record(z.unknown()).optional(),
  }).optional(),
});

// ── Ingest Loan Request ────────────────────────────────────────────
export const IngestLoanRequestSchema = z.object({
  source: z.string().min(1),
  externalId: z.string().min(1),
  loanData: z.record(z.unknown()),
  program: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ── Webhook Payload ────────────────────────────────────────────────
export const WebhookPayloadSchema = z.object({
  eventId: z.string().uuid(),
  event: WebhookEventTypeSchema,
  apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "apiVersion must be in YYYY-MM-DD format"),
  tenantId: z.string().uuid(),
  loanId: z.string(),
  externalId: z.string().optional(),
  timestamp: z.string().datetime(),
  data: z.record(z.unknown()),
});

// ── Ingestion Mapping ──────────────────────────────────────────────
export const IngestionMappingSchema = z.object({
  tenantId: z.string().uuid(),
  fieldMappings: z.record(z.string()),
  documentTypeMappings: z.record(z.string()).optional(),
  programMappings: z.record(z.string()).optional(),
  defaultValues: z.record(z.unknown()).optional(),
});

// ── Inferred Types (compile-time schema ↔ interface verification) ──
export type SlaConfigInferred = z.infer<typeof SlaConfigSchema>;
export type TenantSettingsInferred = z.infer<typeof TenantSettingsSchema>;
export type GuidelineRulesInferred = z.infer<typeof GuidelineRulesSchema>;
export type WebhookConfigInferred = z.infer<typeof WebhookConfigSchema>;
export type CreateTenantInput = z.infer<typeof CreateTenantSchema>;
export type IngestLoanRequest = z.infer<typeof IngestLoanRequestSchema>;
export type WebhookPayloadInput = z.infer<typeof WebhookPayloadSchema>;
export type IngestionMappingInput = z.infer<typeof IngestionMappingSchema>;

// ── Onboarding Schemas ────────────────────────────────────────────

export const CreateOnboardingSchema = z.object({
  tenantName: z.string().min(1).max(100),
  slug: TenantSlugSchema,
  contactEmail: z.string().email(),
  phone: z.string().optional(),
  lenderType: z.enum(["correspondent", "wholesale", "retail", "direct"]),
  programs: z.array(z.string()).min(1, "At least one program required"),
});

export const UpdateOnboardingSchema = z.object({
  currentStep: z.number().int().min(1).max(8).optional(),
  stepData: z.record(z.unknown()).optional(),
  notes: z.string().optional(),
});

export type CreateOnboardingInput = z.infer<typeof CreateOnboardingSchema>;
export type UpdateOnboardingInput = z.infer<typeof UpdateOnboardingSchema>;
