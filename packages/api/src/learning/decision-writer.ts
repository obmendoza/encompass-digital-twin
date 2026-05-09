import { withTenantTx } from "../db/pool.js";
import { randomUUID } from "node:crypto";
import type { Action, Loan } from "@twin/core";
import type { DecisionType, OverrideReasonCategory } from "@twin/core";

interface DecisionWriteParams {
  tenantId: string;
  loanId: string;
  loan: Loan;
  action: Action;
  kbVersion?: number | null;
  chatbotConsultationId?: string | null;
}

export async function writeDecisionRecord(params: DecisionWriteParams): Promise<string | null> {
  const { tenantId, loanId, loan, action, kbVersion, chatbotConsultationId } = params;

  let decisionType: DecisionType;
  let agentRecommendation: string | null = null;
  let agentConfidence: number | null = null;
  let finalDecision: string;
  let overrideReason: OverrideReasonCategory | null = null;
  let rationale: string | null = null;
  let recordedBy: string;

  if (action.type === "AcceptRecommendation") {
    decisionType = "accepted";
    agentRecommendation = loan.pendingRecommendation?.recommendation ?? null;
    agentConfidence = loan.pendingRecommendation?.confidence ?? null;
    finalDecision = agentRecommendation ?? loan.decision;
    recordedBy = action.actor.id;
  } else if (action.type === "OverrideDecision") {
    decisionType = "overridden";
    agentRecommendation = action.originalRecommendation;
    agentConfidence = loan.pendingRecommendation?.confidence ?? null;
    finalDecision = action.overrideDecision;
    overrideReason = action.overrideReason ?? null;
    rationale = action.rationale;
    recordedBy = action.actor.id;
  } else if (action.type === "SetDecision" && !loan.pendingRecommendation) {
    decisionType = "manual";
    finalDecision = action.decision;
    rationale = action.rationale;
    recordedBy = action.actor.id;
  } else {
    return null;
  }

  const id = randomUUID();
  // Loans loaded via /world/load-scenario (test fixtures) don't carry a
  // guidelineVersionId. The schema requires UUID NOT NULL, so fall back to
  // the all-zeros UUID rather than the literal string "default" which fails
  // pg's UUID type check and silently dropped every test-mode decision record.
  const guidelineVersionId = loan.guidelineVersionId ?? "00000000-0000-0000-0000-000000000000";
  const agentVersion = "v1";
  const promptVersion = "v1";
  const modelId = "claude-sonnet-4-6";
  const ingestedAt = loan.milestones?.[0]?.at ?? new Date().toISOString();
  // decided_at + decision_time_seconds are NOT NULL per migration 004's schema.
  // The original INSERT statement omitted both — second latent bug uncovered
  // after the UUID/"default" issue was fixed.
  const decidedAt = new Date().toISOString();
  const decisionTimeSeconds = Math.max(0, (Date.parse(decidedAt) - Date.parse(ingestedAt)) / 1000);

  try {
    await withTenantTx(tenantId, async (client) => {
      await client.query(
        `INSERT INTO decision_records (
          id, tenant_id, loan_id, loan_program, decision_type,
          agent_recommendation, agent_confidence, final_decision,
          override_reason, rationale, guideline_version_id,
          agent_version, prompt_version, model_id,
          ingested_at, decided_at, decision_time_seconds,
          recorded_by, kb_version, chatbot_consultation_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [id, tenantId, loanId, loan.nqmProgram, decisionType,
         agentRecommendation, agentConfidence, finalDecision,
         overrideReason, rationale, guidelineVersionId,
         agentVersion, promptVersion, modelId,
         ingestedAt, decidedAt, decisionTimeSeconds,
         recordedBy, kbVersion ?? null, chatbotConsultationId ?? null]
      );
    });
    return id;
  } catch (e) {
    console.error("[decision-writer] Failed to write decision record:", e);
    return null;
  }
}
