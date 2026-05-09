// scripts/e2e-harness/types.ts
// Shared types + Zod schemas for the E2E validation harness.

import { z } from "zod";

// --- Severity / Status ----------------------------------------------------

export const SeveritySchema = z.enum(["P0", "P1", "P2"]).nullable();
export type Severity = z.infer<typeof SeveritySchema>;

export const CellStatusSchema = z.enum(["pass", "fail", "skip", "partial_skip"]);
export type CellStatus = z.infer<typeof CellStatusSchema>;

// --- Assertion ------------------------------------------------------------

export const AssertionResultSchema = z.object({
  name: z.string(),
  expected: z.unknown(),
  actual: z.unknown(),
  ok: z.boolean(),
  subCell: z.string().optional(),
  auditClaim: z.string().nullable().optional(),
});
export type AssertionResult = z.infer<typeof AssertionResultSchema>;

// --- Evidence -------------------------------------------------------------

export const EvidenceBundleSchema = z.object({
  decisionRecordId: z.string().optional(),
  // kb_version in decision_records is INT (migration 012); allow number or
  // legacy string forms.
  kbVersion: z.union([z.string(), z.number()]).nullable().optional(),
  agentTraceLength: z.number().optional(),
  pipelineCostUsd: z.number().optional(),
  screenshotPath: z.string().nullable().optional(),
  errorFingerprint: z.string().nullable().optional(),
}).catchall(z.unknown());
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

// --- Cell -----------------------------------------------------------------

export const CellResultSchema = z.object({
  // Backfilled by the runner if omitted by the workflow:
  harnessRunId: z.string().optional(),
  specRefs: z.array(z.string()).optional(),
  // Required from the workflow:
  loanId: z.string().nullable(),
  fixture: z.string(),
  workflow: z.string(),
  status: CellStatusSchema,
  severity: SeveritySchema,
  durationMs: z.number(),
  assertions: z.array(AssertionResultSchema),
  evidence: EvidenceBundleSchema,
  error: z.object({
    code: z.string(),
    message: z.string(),
    stack: z.string().optional(),
  }).nullable(),
  // Optional / sub-cell metadata:
  auditClaim: z.string().nullable().optional(),
  skippedAssertions: z.array(z.string()).optional(),
  subCells: z.array(z.object({
    id: z.string(),
    status: CellStatusSchema,
    severity: SeveritySchema,
    assertionCount: z.number(),
  })).optional(),
});
export type CellResult = z.infer<typeof CellResultSchema>;

// --- Fixture / Run context ------------------------------------------------

export const FixtureMetaSchema = z.object({
  id: z.string(),
  loanId: z.string(),
  program: z.string(),
  isEdge: z.boolean(),
});
export type FixtureMeta = z.infer<typeof FixtureMetaSchema>;

export interface RunContext {
  harnessRunId: string;
  apiUrl: string;
  agentUrl: string;
  outDir: string;
  startedAt: string;
  pass: number;
}

// --- Workflow definition --------------------------------------------------

export interface WorkflowDef {
  id: string;
  name: string;
  specRefs: string[];
  appliesTo: (fixture: FixtureMeta) => boolean;
  run: (fixture: FixtureMeta, ctx: RunContext) => Promise<CellResult>;
}

// --- Audit claim ----------------------------------------------------------

export const AuditClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  expectedVerdict: z.enum(["confirmed", "contradicted", "inconclusive"]).optional(),
});
export type AuditClaim = z.infer<typeof AuditClaimSchema>;

// --- Run report -----------------------------------------------------------

export const RunReportSchema = z.object({
  harnessRunId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number(),
  totalCells: z.number(),
  executed: z.number(),
  partialSkipped: z.number(),
  fullSkipped: z.number(),
  passed: z.number(),
  failed: z.number(),
  bySeverity: z.object({
    P0: z.number(),
    P1: z.number(),
    P2: z.number(),
  }),
  totalLlmCostUsd: z.number(),
  totalAssertionsRun: z.number(),
  passes: z.number(),
  flakeCells: z.array(z.string()).default([]),
  aborted: z.boolean(),
  abortReason: z.string().nullable(),
  cells: z.array(CellResultSchema),
});
export type RunReport = z.infer<typeof RunReportSchema>;
