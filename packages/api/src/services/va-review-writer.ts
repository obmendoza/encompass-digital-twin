import { randomUUID } from "node:crypto";
import type { VAReview } from "@twin/core";
import { withTenantTx } from "../db/pool.js";

export interface SubmitVAReviewInput {
  tenantId: string;
  loanId: string;
  vaId: string;
  vaPoolId: string;
  poolKind: "internal" | "bpo";
  verdict: "concur" | "request_docs";
  specialistSignoffs: VAReview["specialistSignoffs"];
  conditionActions: VAReview["conditionActions"];
  overallRationale: string;
  docRequest: VAReview["docRequest"]; // null when verdict="concur"
  agentRecommendationId: string;
  kbVersion: string;
  chatbotConsultationIds: string[];
  claimedAt: string; // ISO timestamp; used to compute review_time_seconds
}

export interface SubmitVAReviewResult {
  reviewId: string;
  newState: "uw_review_pending" | "va_doc_request_pending";
  outboxEventId: string | null;
}

/**
 * Persist a VA review in a single tenant-scoped transaction:
 *   1. INSERT va_reviews
 *   2. UPDATE va_loan_state (must currently be 'va_in_review' — claim still held)
 *   3. INSERT va_event_outbox (only when verdict='request_docs')
 *
 * If the va_loan_state UPDATE matches zero rows (claim lost / state changed
 * concurrently) the function throws and the entire transaction rolls back —
 * no review row, no outbox event.
 */
export async function submitVAReview(
  input: SubmitVAReviewInput,
): Promise<SubmitVAReviewResult> {
  const reviewId = randomUUID();
  const submittedAt = new Date().toISOString();
  const reviewTimeSeconds = Math.max(
    0,
    Math.floor((Date.parse(submittedAt) - Date.parse(input.claimedAt)) / 1000),
  );
  const newState: SubmitVAReviewResult["newState"] =
    input.verdict === "concur" ? "uw_review_pending" : "va_doc_request_pending";

  return withTenantTx(input.tenantId, async (client) => {
    // 1. INSERT va_reviews
    await client.query(
      `INSERT INTO va_reviews (
         id, tenant_id, loan_id, va_id, va_pool_id, pool_kind, verdict,
         specialist_signoffs, condition_actions, overall_rationale, doc_request,
         agent_recommendation_id, kb_version, chatbot_consultation_ids,
         claimed_at, submitted_at, review_time_seconds
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8::jsonb, $9::jsonb, $10, $11::jsonb,
         $12, $13, $14,
         $15, $16, $17
       )`,
      [
        reviewId,
        input.tenantId,
        input.loanId,
        input.vaId,
        input.vaPoolId,
        input.poolKind,
        input.verdict,
        JSON.stringify(input.specialistSignoffs),
        JSON.stringify(input.conditionActions),
        input.overallRationale,
        input.docRequest ? JSON.stringify(input.docRequest) : null,
        input.agentRecommendationId,
        input.kbVersion,
        input.chatbotConsultationIds,
        input.claimedAt,
        submittedAt,
        reviewTimeSeconds,
      ],
    );

    // 2. UPDATE va_loan_state — must be currently va_in_review (claim still held).
    const updated = await client.query(
      `UPDATE va_loan_state
          SET va_state = $1,
              current_va_review_id = $2,
              va_id = NULL,
              claimed_at = NULL,
              updated_at = now()
        WHERE tenant_id = $3
          AND loan_id = $4
          AND va_state = 'va_in_review'`,
      [newState, reviewId, input.tenantId, input.loanId],
    );
    if (updated.rowCount !== 1) {
      throw new Error(
        `VA_REVIEW_STATE_LOST: expected va_loan_state row in va_in_review for ${input.loanId}; rowCount=${updated.rowCount}`,
      );
    }

    // 3. INSERT va_event_outbox row when request_docs.
    let outboxEventId: string | null = null;
    if (input.verdict === "request_docs" && input.docRequest) {
      outboxEventId = randomUUID();
      const payload = {
        docs: input.docRequest.docs,
        deadline: input.docRequest.deadline,
        messageToOriginator: input.docRequest.messageToOriginator,
        loanId: input.loanId,
        vaReviewId: reviewId,
      };
      await client.query(
        `INSERT INTO va_event_outbox (id, tenant_id, event_type, loan_id, payload)
         VALUES ($1, $2, 'va.doc_request_issued', $3, $4::jsonb)`,
        [outboxEventId, input.tenantId, input.loanId, JSON.stringify(payload)],
      );
    }

    return { reviewId, newState, outboxEventId };
  });
}
