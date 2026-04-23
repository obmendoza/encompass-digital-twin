import { z } from "zod";

// ── Learning & Metrics Engine — Zod Schemas ─────────────────────

// ── Override Reason ───────────────────────────────────────────────
export const OverrideReasonSchema = z.enum([
  "dti_exception",
  "income_adjustment",
  "credit_reassessment",
  "doc_sufficiency",
  "compliance_exception",
  "guideline_exception",
  "risk_tolerance",
  "data_error",
  "other",
]);

// ── Decision Type ─────────────────────────────────────────────────
export const DecisionTypeSchema = z.enum(["accepted", "overridden", "manual"]);

// ── Pattern Status ────────────────────────────────────────────────
export const PatternStatusSchema = z.enum([
  "new",
  "analyzing",
  "suggestion_ready",
  "applied",
  "dismissed",
  "analysis_failed",
]);

// ── Dismiss Pattern ───────────────────────────────────────────────
export const DismissPatternSchema = z.object({
  reason: z.string().min(1).max(500),
  cooldownDays: z.union([
    z.literal(14),
    z.literal(30),
    z.literal("permanent"),
  ]).default(14),
});

// ── Override Decision Body ────────────────────────────────────────
export const OverrideDecisionBodySchema = z.object({
  originalRecommendation: z.string(),
  overrideDecision: z.string(),
  overrideReason: OverrideReasonSchema,
  rationale: z.string().min(1),
  actor: z.string(),
});

// ── Domain Events ─────────────────────────────────────────────────
export const DecisionMadeEventSchema = z.object({
  eventType: z.literal("decision.made"),
  tenantId: z.string().uuid(),
  loanId: z.string(),
  decisionType: DecisionTypeSchema,
  agentConfidence: z.number().min(0).max(1).optional(),
  finalDecision: z.string(),
  overrideReason: OverrideReasonSchema.optional(),
  decidedAt: z.string().datetime(),
});

export const PatternDetectedEventSchema = z.object({
  eventType: z.literal("pattern.detected"),
  tenantId: z.string().uuid(),
  patternId: z.string().uuid(),
  ruleName: z.string(),
  program: z.string().optional(),
  detectedAt: z.string().datetime(),
});

export const SuggestionReadyEventSchema = z.object({
  eventType: z.literal("suggestion.ready"),
  tenantId: z.string().uuid(),
  suggestionId: z.string().uuid(),
  patternId: z.string().uuid(),
  suggestionType: z.string(),
  confidence: z.number().min(0).max(1),
  createdAt: z.string().datetime(),
});

export const GuidelineUpdatedEventSchema = z.object({
  eventType: z.literal("guideline.updated"),
  tenantId: z.string().uuid(),
  program: z.string(),
  version: z.number().int().positive(),
  appliedFromSuggestion: z.string().uuid().optional(),
  updatedAt: z.string().datetime(),
});

// ── Inferred Types ────────────────────────────────────────────────
export type DismissPatternInput = z.infer<typeof DismissPatternSchema>;
export type OverrideDecisionBody = z.infer<typeof OverrideDecisionBodySchema>;
export type DecisionMadeEvent = z.infer<typeof DecisionMadeEventSchema>;
export type PatternDetectedEvent = z.infer<typeof PatternDetectedEventSchema>;
export type SuggestionReadyEvent = z.infer<typeof SuggestionReadyEventSchema>;
export type GuidelineUpdatedEvent = z.infer<typeof GuidelineUpdatedEventSchema>;
