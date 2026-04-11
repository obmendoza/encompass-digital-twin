import { z } from "zod";

export const ActorSchema = z.object({
  kind: z.enum(["human", "agent"]),
  id: z.string().min(1),
});

export const LoadScenarioSchema = z.object({ scenarioId: z.string().min(1) });

export const DecisionSchema = z.object({
  decision: z.enum(["pending", "approved", "suspended", "counter", "denied"]),
  rationale: z.string().min(1),
  actor: ActorSchema,
});

export const MilestoneSchema = z.object({
  milestone: z.string().min(1),
  actor: ActorSchema,
});

export const QualifyingIncomeSchema = z.object({
  worksheet: z.object({
    method: z.enum([
      "BankStatementDeposits", "DSCRCoverage", "AssetDepletionMonths",
      "1099Gross", "PnLCPACertified", "TraditionalDocs",
    ]),
    monthsCovered: z.number().optional(),
    avgDeposits: z.number().optional(),
    expenseFactor: z.number().optional(),
    nsfCount: z.number().optional(),
    dscrNumerator: z.number().optional(),
    dscrDenominator: z.number().optional(),
    totalAssets: z.number().optional(),
    depletionMonths: z.number().optional(),
    gross1099: z.number().optional(),
    cpaCertifiedNetIncome: z.number().optional(),
    derivedMonthlyIncome: z.number(),
  }),
  actor: ActorSchema,
});

export const NewConditionSchema = z.object({
  condition: z.object({
    category: z.enum(["PTA", "PTD", "PTF", "PTP"]),
    source: z.enum(["UW", "AUS", "Compliance", "Investor"]),
    description: z.string().min(1),
    status: z.enum(["Open", "Requested", "Received", "Cleared", "Waived"]).optional(),
  }),
  actor: ActorSchema,
});

export const UpdateConditionSchema = z.object({
  patch: z.object({
    category: z.enum(["PTA", "PTD", "PTF", "PTP"]).optional(),
    source: z.enum(["UW", "AUS", "Compliance", "Investor"]).optional(),
    description: z.string().optional(),
    status: z.enum(["Open", "Requested", "Received", "Cleared", "Waived"]).optional(),
    notes: z.string().optional(),
  }),
  actor: ActorSchema,
});

export const ClearConditionSchema = z.object({
  notes: z.string().optional(),
  actor: ActorSchema,
});

export const WaiveConditionSchema = z.object({
  rationale: z.string().min(1),
  actor: ActorSchema,
});

export const ActorOnlySchema = z.object({ actor: ActorSchema });
