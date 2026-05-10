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

/**
 * Map a fixture/runtime nqmProgram value to a canonical loan_programs.code.
 * The decision_records.loan_program column is a FK into loan_programs.code, so
 * any unmapped value would fail the FK constraint and silently drop the record.
 *
 * Two taxonomy generations live here:
 * - Pre-Phase-2 PascalCase (BankStatement12, DSCR, etc.) — kept for back-compat
 *   with any caller that still emits them.
 * - Active KB display names (Flex Select, Investor DSCR, etc.) — the current
 *   guidelines on demo + npnqm-twin tenants use these.
 *
 * If you add a new fixture program, add the mapping here AND seed the
 * corresponding loan_programs row, or decisions for it will silently drop.
 */
const PROGRAM_CODE_MAP: Record<string, string> = {
  // Active KB display names (Phase 2 fixtures, 2026-05-10):
  "Flex Select": "bank_statement",
  "Flex Supreme": "bank_statement",
  "Investor DSCR": "dscr",
  "Investor DSCR No Ratio": "dscr",
  "DSCR Supreme": "dscr",
  "DSCR Multi (5-8 Units)": "dscr",
  "Foreign National": "foreign_national",
  "Select ITIN": "itin",
  "Second Lien Select": "bank_statement", // closest existing code; "second_lien" doesn't exist in registry
  "Super Jumbo": "bank_statement", // closest existing code; "super_jumbo" doesn't exist in registry

  // Legacy PascalCase taxonomy (pre-Phase-2 fixtures — kept for back-compat):
  BankStatement12: "bank_statement",
  BankStatement24: "bank_statement",
  DSCR: "dscr",
  AssetDepletion: "asset_depletion",
  PnL: "profit_and_loss",
  "1099Only": "1099_income",
  ITIN: "itin",
  ForeignNational: "foreign_national",
  FullDocNonQM: "bank_statement",
};

function resolveLoanProgramCode(nqmProgram: string): string {
  // Fall back to "bank_statement" for unknown programs to keep the FK happy
  // and surface a console warning so the gap is visible during dev.
  const code = PROGRAM_CODE_MAP[nqmProgram];
  if (!code) {
    console.warn(
      `[decision-writer] unmapped nqmProgram "${nqmProgram}" — falling back to bank_statement. ` +
      `Add a mapping in decision-writer.ts:PROGRAM_CODE_MAP and ensure the loan_programs row exists.`
    );
    return "bank_statement";
  }
  return code;
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
        [id, tenantId, loanId, resolveLoanProgramCode(loan.nqmProgram), decisionType,
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
