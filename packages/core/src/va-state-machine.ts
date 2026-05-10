import type { LoanState } from "./types.js";

/**
 * Legal state transitions for the VA review lifecycle, per spec
 * docs/superpowers/specs/2026-05-10-va-review-layer-design.md §State Machine.
 *
 * `decided` is terminal (empty transition list).
 */
export const LEGAL_TRANSITIONS: Record<LoanState, ReadonlyArray<LoanState>> = {
  agent_review_pending: ["va_review_pending", "uw_review_pending"],
  va_review_pending: ["va_in_review"],
  va_in_review: ["va_review_pending", "uw_review_pending", "va_doc_request_pending"],
  va_doc_request_pending: ["agent_review_pending"],
  uw_review_pending: ["decided"],
  decided: [],
};

export function canTransition(from: LoanState, to: LoanState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

export function isTerminalState(s: LoanState): boolean {
  return LEGAL_TRANSITIONS[s].length === 0;
}
