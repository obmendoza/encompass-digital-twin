// ── Learning & Metrics Engine — Types ────────────────────────────

// ── Override Reason Taxonomy ──────────────────────────────────────
export type OverrideReasonCategory =
  | "dti_exception"
  | "income_adjustment"
  | "credit_reassessment"
  | "doc_sufficiency"
  | "compliance_exception"
  | "guideline_exception"
  | "risk_tolerance"
  | "data_error"
  | "other";

export const OVERRIDE_REASON_LABELS: Record<OverrideReasonCategory, string> = {
  dti_exception: "DTI Exception",
  income_adjustment: "Income Adjustment",
  credit_reassessment: "Credit Reassessment",
  doc_sufficiency: "Document Sufficiency",
  compliance_exception: "Compliance Exception",
  guideline_exception: "Guideline Exception",
  risk_tolerance: "Risk Tolerance",
  data_error: "Data Error",
  other: "Other",
};

// ── Decision Types ────────────────────────────────────────────────
export type DecisionType = "accepted" | "overridden" | "manual";

// ── Pattern Status ────────────────────────────────────────────────
export type PatternStatus =
  | "new"
  | "analyzing"
  | "suggestion_ready"
  | "applied"
  | "dismissed"
  | "analysis_failed";

// ── Suggestion Status ─────────────────────────────────────────────
export type SuggestionStatus = "pending" | "approved" | "rejected" | "applied";

// ── Suggestion Visibility ─────────────────────────────────────────
export type SuggestionVisibility = "admin" | "compliance_only";

// ── Compliance ────────────────────────────────────────────────────
export type ComplianceCheckType =
  | "disparate_impact"
  | "adverse_action_preservation"
  | "threshold_reasonableness";

export type ComplianceCheckResult = "pass" | "warn" | "block";

// ── Decision Record ───────────────────────────────────────────────
export interface DecisionRecord {
  id: string;
  tenantId: string;
  loanId: string;
  loanProgram: string;
  decisionType: DecisionType;
  agentRecommendation?: string;
  agentConfidence?: number;
  finalDecision: string;
  overrideReason?: OverrideReasonCategory;
  rationale?: string;
  guidelineVersionId: string;
  agentVersion: string;
  promptVersion: string;
  modelId: string;
  investorId?: string;
  poolId?: string;
  ingestedAt: string;
  decidedAt: string;
  decisionTimeSeconds: number;
  recordedBy: string;
}

// ── Detected Pattern ──────────────────────────────────────────────
export interface DetectedPattern {
  id: string;
  tenantId: string;
  ruleName: string;
  program?: string;
  overrideReason?: OverrideReasonCategory;
  metricsSnapshot: Record<string, unknown>;
  status: PatternStatus;
  suppressedUntil?: string;
  statusHistory: Array<{
    status: PatternStatus;
    at: string;
    by?: string;
    reason?: string;
  }>;
  detectedAt: string;
  updatedAt: string;
}

// ── Specific Change ───────────────────────────────────────────────
export interface SpecificChange {
  operation: string;
  path: string;
  from?: unknown;
  to: unknown;
  scope: string;
}

// ── Pattern Suggestion ────────────────────────────────────────────
export interface PatternSuggestion {
  id: string;
  tenantId: string;
  patternId: string;
  suggestionType: string;
  rootCause: string;
  specificChange: SpecificChange;
  confidence: number;
  riskAssessment: string;
  generatedBy: string;
  redactionApplied: boolean;
  redactionVersion: string;
  status: SuggestionStatus;
  visibility: SuggestionVisibility;
  reviewedBy?: string;
  complianceReviewedBy?: string;
  expiresAt: string;
  createdAt: string;
}

// ── Compliance Check ──────────────────────────────────────────────
export interface ComplianceCheck {
  id: string;
  suggestionId: string;
  checkType: ComplianceCheckType;
  result: ComplianceCheckResult;
  details: Record<string, unknown>;
  checkedAt: string;
}

// ── Daily Metrics Snapshot ────────────────────────────────────────
export interface DailyMetricsSnapshot {
  alignment: {
    total: number;
    accepted: number;
    overridden: number;
    manual: number;
    alignmentRate: number;
  };
  overridesByReason: Record<OverrideReasonCategory, number>;
  overridesByProgram: Record<string, number>;
  calibration: {
    brierScore: number;
    buckets: Array<{
      range: [number, number];
      predicted: number;
      actual: number;
      count: number;
    }>;
  };
  throughput: {
    loansDecided: number;
    avgDecisionTimeSeconds: number;
    p95DecisionTimeSeconds: number;
  };
  sla: {
    withinSla: number;
    breached: number;
    slaComplianceRate: number;
  };
}

// ── Detection Rules Config ────────────────────────────────────────
export interface DetectionRuleConfig {
  minSample: number;
  threshold: number;
  windowDays: number;
}

export const DETECTION_RULES: Record<string, DetectionRuleConfig> = {
  high_override_rate: {
    minSample: 20,
    threshold: 0.25,
    windowDays: 30,
  },
  reason_concentration: {
    minSample: 10,
    threshold: 0.5,
    windowDays: 30,
  },
  confidence_drift: {
    minSample: 30,
    threshold: 0.1,
    windowDays: 14,
  },
  program_outlier: {
    minSample: 15,
    threshold: 0.3,
    windowDays: 30,
  },
};
