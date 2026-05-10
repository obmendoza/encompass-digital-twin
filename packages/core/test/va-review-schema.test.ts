import { describe, it, expect } from "vitest";
import { VAReviewSchema, VASpecialistSignoffSchema } from "../src/va-schemas.js";

const validReview = {
  id: "00000000-0000-0000-0000-000000000001",
  tenantId: "00000000-0000-0000-0000-000000000002",
  loanId: "L1",
  vaId: "u1",
  vaPoolId: "00000000-0000-0000-0000-000000000003",
  poolKind: "internal" as const,
  verdict: "concur" as const,
  specialistSignoffs: [
    { specialist: "doc", signoff: "concur", notes: null },
    { specialist: "income", signoff: "concur", notes: null },
    { specialist: "asset", signoff: "concur", notes: null },
    { specialist: "credit", signoff: "concur", notes: null },
    { specialist: "property", signoff: "concur", notes: null },
    { specialist: "compliance", signoff: "concur", notes: null },
  ],
  conditionActions: [],
  overallRationale: "All specialists concur. Loan presents no anomalies.",
  docRequest: null,
  agentRecommendationId: "00000000-0000-0000-0000-000000000099",
  kbVersion: "v7.10",
  chatbotConsultationIds: [],
  claimedAt: "2026-05-10T10:00:00Z",
  submittedAt: "2026-05-10T10:12:00Z",
  reviewTimeSeconds: 720,
};

describe("VAReviewSchema", () => {
  it("accepts a valid concur review", () => {
    expect(() => VAReviewSchema.parse(validReview)).not.toThrow();
  });

  it("rejects when specialistSignoffs has fewer than 6 entries", () => {
    const bad = { ...validReview, specialistSignoffs: validReview.specialistSignoffs.slice(0, 5) };
    expect(() => VAReviewSchema.parse(bad)).toThrow();
  });

  it("rejects when specialistSignoffs has duplicate specialists", () => {
    const bad = { ...validReview, specialistSignoffs: [
      ...validReview.specialistSignoffs.slice(0, 5),
      { specialist: "doc", signoff: "concur", notes: null },  // duplicate
    ] };
    expect(() => VAReviewSchema.parse(bad)).toThrow();
  });

  it("rejects when a disagree signoff has null notes", () => {
    const bad = { ...validReview, specialistSignoffs: [
      { specialist: "doc", signoff: "disagree", notes: null },
      ...validReview.specialistSignoffs.slice(1),
    ] };
    expect(() => VAReviewSchema.parse(bad)).toThrow();
  });

  it("rejects when overallRationale is shorter than 20 chars", () => {
    const bad = { ...validReview, overallRationale: "too short" };
    expect(() => VAReviewSchema.parse(bad)).toThrow();
  });

  it("rejects when verdict=request_docs but docRequest is null", () => {
    const bad = { ...validReview, verdict: "request_docs", docRequest: null };
    expect(() => VAReviewSchema.parse(bad)).toThrow();
  });

  it("accepts a valid request_docs review", () => {
    const good = {
      ...validReview,
      verdict: "request_docs" as const,
      docRequest: {
        docs: [{ docType: "Bank Statement (Personal)", reason: "Latest 3 months missing", required: true }],
        deadline: "2026-05-20",
        messageToOriginator: "Please upload 3 most recent personal bank statements.",
      },
    };
    expect(() => VAReviewSchema.parse(good)).not.toThrow();
  });

  it("rejects when verdict=request_docs has empty docs array", () => {
    const bad = {
      ...validReview,
      verdict: "request_docs",
      docRequest: { docs: [], deadline: "2026-05-20", messageToOriginator: "Need docs" },
    };
    expect(() => VAReviewSchema.parse(bad)).toThrow();
  });

  it("rejects when a contest condition action has null note", () => {
    const bad = { ...validReview, conditionActions: [
      { conditionId: "c1", action: "contest", note: null },
    ] };
    expect(() => VAReviewSchema.parse(bad)).toThrow();
  });
});
