// Public type surface for the predict-conditions service.
// See spec docs/superpowers/specs/2026-05-12-predictive-conditions-design.md §3.

export type PredictedConditionStatus = "pending" | "accepted" | "dismissed";
export type PredictedConditionCategory = "PTA" | "PTD" | "PTF" | "PTP";
export type PredictedConditionSourceList = "minimum" | "income";
export type PredictedConditionRole = "operator" | "va";

export interface PredictedCondition {
  id: string;
  tenantId: string;
  loanId: string;
  predictionRunId: string;
  sourceInputHash: string;
  predictedAt: string;
  predictedBy: string;
  kbVersionId: number;
  resolvedIncomeType: string;
  category: PredictedConditionCategory;
  description: string;
  note: string | null;
  sourceList: PredictedConditionSourceList;
  sourceOrder: number;
  status: PredictedConditionStatus;
  actedBy: string | null;
  actedAt: string | null;
  actedRole: PredictedConditionRole | null;
  dismissalReason: string | null;
  acceptedConditionId: string | null;
}

export type PredictionAlertErrorClass =
  | "NoActiveKbVersionError"
  | "KbVersionNotFoundError"
  | "IncomeTypeUnresolvedError";

export interface PredictionAlert {
  id: string;
  tenantId: string;
  loanId: string;
  alertedAt: string;
  errorClass: PredictionAlertErrorClass;
  errorPayload: Record<string, unknown>;
  remediationHint: string;
  clearedBy: string | null;
  clearedAt: string | null;
}

export interface RunResult {
  runId: string;
  predictionCount: number;
  alertCount: 0 | 1;
  reused: boolean;
}

export interface AcceptResult {
  conditionId: string;
  predictionId: string;
}

export interface DismissResult {
  predictionId: string;
}

export interface ClearAlertResult {
  alertId: string;
}

export type RunSource = "system:loan-ingest" | `system:manual-rerun:${string}`;
