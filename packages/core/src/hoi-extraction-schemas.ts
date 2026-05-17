import { z } from "zod";

export const HOI_SCHEMA_VERSION = 1;

const AddressSchema = z.object({
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
});

const EvidenceSchema = z.object({
  fieldPath: z.string(),
  documentPage: z.number().int(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(),
});

const ProseBooleanFieldSchema = z.object({
  included: z.boolean(),
  wording: z.string().nullable(),
  separatePolicy: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const ActualCostSustainedSchema = z.object({
  detected: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const PremiumPaidSchema = z.object({
  paid: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const WallsInSchema = z.object({
  included: z.boolean(),
  confidence: z.number().min(0).max(1),
});

const Ho6PolicySchema = z.object({
  present: z.boolean(),
  deductiblePct: z.number().nullable(),
  coverageAmount: z.number().nullable(),
});

export const HoiPolicyFieldsSchema = z.object({
  carrier: z.string().nullable(),
  policyNumber: z.string().nullable(),
  namedInsured: z.string().nullable(),
  propertyAddress: AddressSchema.nullable(),
  effectiveDate: z.string().nullable(),
  expirationDate: z.string().nullable(),
  termMonths: z.number().int().nullable(),
  lossPayeeClause: z.string().nullable(),
  loanNumberOnPolicy: z.string().nullable(),
  coverageAmount: z.number().nullable(),
  replacementCost: z.number().nullable(),
  deductiblePct: z.number().nullable(),
  deductibleAmount: z.number().nullable(),
  windHailHurricane: ProseBooleanFieldSchema.nullable(),
  rentLossCoverageMonths: z.number().int().nullable(),
  rentLossWording: z.string().nullable(),
  rentLossActualCostSustained: ActualCostSustainedSchema.nullable(),
  occupancyOnPolicy: z.string().nullable(),
  premiumPaidInFull: PremiumPaidSchema.nullable(),
  premiumDueDays: z.number().int().nullable(),
  wallsInCoverage: WallsInSchema.nullable(),
  ho6Policy: Ho6PolicySchema.nullable(),
  evidence: z.array(EvidenceSchema),
});
export type HoiPolicyFields = z.infer<typeof HoiPolicyFieldsSchema>;

export const FloodCertFieldsSchema = z.object({
  carrier: z.string().nullable(),
  policyNumber: z.string().nullable(),
  namedInsured: z.string().nullable(),
  propertyAddress: AddressSchema.nullable(),
  effectiveDate: z.string().nullable(),
  expirationDate: z.string().nullable(),
  termMonths: z.number().int().nullable(),
  floodZone: z.string().nullable(),
  floodCoverage: z.number().nullable(),
  floodDeductible: z.number().nullable(),
  isNfip: z.boolean().nullable(),
  nfipMaxApplied: z.boolean().nullable(),
  evidence: z.array(EvidenceSchema),
});
export type FloodCertFields = z.infer<typeof FloodCertFieldsSchema>;

export const ValidationFindingSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(["fail", "warn"]),
  currentValue: z.string().nullable(),
  expectedValue: z.string().nullable(),
  evidence: z.object({
    documentId: z.string().uuid(),
    extractionId: z.string().uuid(),
    fieldPath: z.string(),
    documentPage: z.number().int().nullable(),
  }),
});
export type ValidationFinding = z.infer<typeof ValidationFindingSchema>;
