import { describe, it, expect } from "vitest";
import { canTransition, isTerminalState, LEGAL_TRANSITIONS } from "../src/va-state-machine.js";

describe("VA state machine", () => {
  it("allows agent_review_pending → va_review_pending (RouteToVA)", () => {
    expect(canTransition("agent_review_pending", "va_review_pending")).toBe(true);
  });

  it("allows agent_review_pending → uw_review_pending (skip when va.required=false)", () => {
    expect(canTransition("agent_review_pending", "uw_review_pending")).toBe(true);
  });

  it("allows va_review_pending → va_in_review (claim)", () => {
    expect(canTransition("va_review_pending", "va_in_review")).toBe(true);
  });

  it("allows va_in_review → va_review_pending (release)", () => {
    expect(canTransition("va_in_review", "va_review_pending")).toBe(true);
  });

  it("allows va_in_review → uw_review_pending (concur)", () => {
    expect(canTransition("va_in_review", "uw_review_pending")).toBe(true);
  });

  it("allows va_in_review → va_doc_request_pending (request_docs)", () => {
    expect(canTransition("va_in_review", "va_doc_request_pending")).toBe(true);
  });

  it("allows va_doc_request_pending → agent_review_pending (docs returned)", () => {
    expect(canTransition("va_doc_request_pending", "agent_review_pending")).toBe(true);
  });

  it("allows uw_review_pending → decided (UW decides)", () => {
    expect(canTransition("uw_review_pending", "decided")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransition("decided", "agent_review_pending")).toBe(false);
    expect(canTransition("agent_review_pending", "decided")).toBe(false);
    expect(canTransition("va_review_pending", "decided")).toBe(false);
    expect(canTransition("va_in_review", "decided")).toBe(false);
    expect(canTransition("va_doc_request_pending", "uw_review_pending")).toBe(false);
  });

  it("decided is terminal", () => {
    expect(isTerminalState("decided")).toBe(true);
  });

  it("non-decided states are not terminal", () => {
    for (const s of ["agent_review_pending","va_review_pending","va_in_review","va_doc_request_pending","uw_review_pending"] as const) {
      expect(isTerminalState(s)).toBe(false);
    }
  });

  it("LEGAL_TRANSITIONS is exhaustive over all source states", () => {
    const allStates = ["agent_review_pending","va_review_pending","va_in_review","va_doc_request_pending","uw_review_pending","decided"] as const;
    for (const s of allStates) {
      expect(LEGAL_TRANSITIONS[s]).toBeDefined();
    }
  });
});
