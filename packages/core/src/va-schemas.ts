import { z } from "zod";

export const VASpecialistKindSchema = z.enum(["doc","income","asset","credit","property","compliance"]);

export const VASpecialistSignoffSchema = z.object({
  specialist: VASpecialistKindSchema,
  signoff: z.enum(["concur", "disagree"]),
  notes: z.string().nullable(),
}).superRefine((v, ctx) => {
  if (v.signoff === "disagree" && (v.notes === null || v.notes.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "notes required when signoff is 'disagree'",
      path: ["notes"],
    });
  }
});

export const VAConditionActionSchema = z.object({
  conditionId: z.string().min(1),
  action: z.enum(["clear", "contest"]),
  note: z.string().nullable(),
}).superRefine((v, ctx) => {
  if (v.action === "contest" && (v.note === null || v.note.trim().length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "note required when action is 'contest'",
      path: ["note"],
    });
  }
});

export const VADocRequestItemSchema = z.object({
  docType: z.string().min(1),
  reason: z.string().min(1),
  required: z.boolean(),
});

export const VADocRequestSchema = z.object({
  docs: z.array(VADocRequestItemSchema).min(1),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}/, "deadline must start with YYYY-MM-DD"),
  messageToOriginator: z.string().min(1),
});

const SIX_SPECIALISTS = ["doc","income","asset","credit","property","compliance"] as const;

export const VAReviewSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  loanId: z.string().min(1),
  vaId: z.string().min(1),
  vaPoolId: z.string().uuid(),
  poolKind: z.enum(["internal", "bpo"]),
  verdict: z.enum(["concur", "request_docs"]),
  specialistSignoffs: z.array(VASpecialistSignoffSchema).length(6),
  conditionActions: z.array(VAConditionActionSchema),
  overallRationale: z.string().min(20),
  docRequest: VADocRequestSchema.nullable(),
  agentRecommendationId: z.string().uuid(),
  kbVersion: z.string().min(1),
  chatbotConsultationIds: z.array(z.string().uuid()),
  claimedAt: z.string(),
  submittedAt: z.string(),
  reviewTimeSeconds: z.number().int().nonnegative(),
}).superRefine((v, ctx) => {
  // Each of the six specialists must appear exactly once.
  const seen = new Set<string>();
  for (const s of v.specialistSignoffs) {
    if (seen.has(s.specialist)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "specialistSignoffs must be distinct",
        path: ["specialistSignoffs"],
      });
      return;
    }
    seen.add(s.specialist);
  }
  for (const required of SIX_SPECIALISTS) {
    if (!seen.has(required)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `missing signoff for specialist '${required}'`,
        path: ["specialistSignoffs"],
      });
      return;
    }
  }
  // verdict ↔ docRequest invariant.
  if ((v.verdict === "request_docs") !== (v.docRequest !== null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "docRequest must be non-null iff verdict='request_docs'",
      path: ["docRequest"],
    });
  }
});
