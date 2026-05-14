import { z } from "zod";

export const AdapterConfigSchema = z.object({
  programMapping: z.record(z.string(), z.string()).optional(),
  fieldPathOverrides: z.record(z.string(), z.string()).optional(),
  identityPrefix: z.string().regex(/^[A-Z]{2,8}-$/).optional().default("QL-"),
  documentTypeMapping: z.record(z.string(), z.string()).optional(),
  allowedFetchHosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)).default([]),
  maxFileBytes: z.number().int().positive().max(500_000_000).default(50_000_000),
  extras: z.record(z.string(), z.unknown()).optional(),
});

export type AdapterConfig = z.infer<typeof AdapterConfigSchema>;

export const LoanContextExtrasSchema = z.object({
  repFico: z.number().int().min(300).max(900).optional(),
  ltv: z.number().min(0).max(200).optional(),
  loanAmount: z.number().nonnegative().optional(),
  loanPurpose: z.enum(["Purchase", "Rate & Term Refinance", "Cash-Out Refinance"]).optional(),
  propertyType: z.string().optional(),
  dti: z.number().min(0).max(100).optional(),
  reservesMonths: z.number().nonnegative().optional(),
  noteRate: z.number().min(0).max(30).optional(),
  county: z.string().optional(),
  isItin: z.boolean().optional(),
  llcOrLegalEntity: z.boolean().optional(),
}).strict();

export type LoanContextExtras = z.infer<typeof LoanContextExtrasSchema>;
