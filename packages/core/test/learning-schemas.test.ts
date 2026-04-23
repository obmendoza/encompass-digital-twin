import { describe, expect, it } from "vitest";
import {
  OverrideReasonSchema,
  DismissPatternSchema,
  OverrideDecisionBodySchema,
  DecisionMadeEventSchema,
} from "../src/learning-schemas.js";
import { DETECTION_RULES, OVERRIDE_REASON_LABELS } from "../src/learning-types.js";

// ── OverrideReasonSchema ──────────────────────────────────────────
describe("OverrideReasonSchema", () => {
  it("accepts all valid override reasons", () => {
    const validReasons = [
      "dti_exception",
      "income_adjustment",
      "credit_reassessment",
      "doc_sufficiency",
      "compliance_exception",
      "guideline_exception",
      "risk_tolerance",
      "data_error",
      "other",
    ];
    for (const reason of validReasons) {
      expect(OverrideReasonSchema.parse(reason)).toBe(reason);
    }
  });

  it("rejects invalid override reason", () => {
    expect(() => OverrideReasonSchema.parse("invalid_reason")).toThrow();
    expect(() => OverrideReasonSchema.parse("")).toThrow();
    expect(() => OverrideReasonSchema.parse(42)).toThrow();
  });
});

// ── DismissPatternSchema ──────────────────────────────────────────
describe("DismissPatternSchema", () => {
  it("applies default cooldownDays of 14", () => {
    const result = DismissPatternSchema.parse({ reason: "Not relevant" });
    expect(result.cooldownDays).toBe(14);
    expect(result.reason).toBe("Not relevant");
  });

  it("accepts 30-day cooldown", () => {
    const result = DismissPatternSchema.parse({
      reason: "Seasonal pattern",
      cooldownDays: 30,
    });
    expect(result.cooldownDays).toBe(30);
  });

  it("accepts permanent cooldown", () => {
    const result = DismissPatternSchema.parse({
      reason: "Known exception",
      cooldownDays: "permanent",
    });
    expect(result.cooldownDays).toBe("permanent");
  });

  it("rejects empty reason", () => {
    expect(() =>
      DismissPatternSchema.parse({ reason: "" })
    ).toThrow();
  });

  it("rejects invalid cooldown value", () => {
    expect(() =>
      DismissPatternSchema.parse({ reason: "test", cooldownDays: 7 })
    ).toThrow();
    expect(() =>
      DismissPatternSchema.parse({ reason: "test", cooldownDays: "weekly" })
    ).toThrow();
  });
});

// ── OverrideDecisionBodySchema ────────────────────────────────────
describe("OverrideDecisionBodySchema", () => {
  const validBody = {
    originalRecommendation: "approve",
    overrideDecision: "deny",
    overrideReason: "dti_exception",
    rationale: "DTI exceeds guideline threshold after manual recalculation",
    actor: "underwriter-1",
  };

  it("validates a valid override request", () => {
    const result = OverrideDecisionBodySchema.parse(validBody);
    expect(result.overrideReason).toBe("dti_exception");
    expect(result.actor).toBe("underwriter-1");
  });

  it("rejects missing override reason", () => {
    const { overrideReason: _, ...noReason } = validBody;
    expect(() => OverrideDecisionBodySchema.parse(noReason)).toThrow();
  });

  it("rejects empty rationale", () => {
    expect(() =>
      OverrideDecisionBodySchema.parse({ ...validBody, rationale: "" })
    ).toThrow();
  });
});

// ── DecisionMadeEventSchema ───────────────────────────────────────
describe("DecisionMadeEventSchema", () => {
  it("validates a complete decision event", () => {
    const event = {
      eventType: "decision.made",
      tenantId: "550e8400-e29b-41d4-a716-446655440000",
      loanId: "LOAN-001",
      decisionType: "overridden",
      agentConfidence: 0.85,
      finalDecision: "deny",
      overrideReason: "credit_reassessment",
      decidedAt: "2026-04-23T10:00:00Z",
    };
    const result = DecisionMadeEventSchema.parse(event);
    expect(result.eventType).toBe("decision.made");
    expect(result.decisionType).toBe("overridden");
    expect(result.agentConfidence).toBe(0.85);
  });

  it("validates a minimal accepted decision", () => {
    const event = {
      eventType: "decision.made",
      tenantId: "550e8400-e29b-41d4-a716-446655440000",
      loanId: "LOAN-002",
      decisionType: "accepted",
      finalDecision: "approve",
      decidedAt: "2026-04-23T10:00:00Z",
    };
    const result = DecisionMadeEventSchema.parse(event);
    expect(result.agentConfidence).toBeUndefined();
    expect(result.overrideReason).toBeUndefined();
  });

  it("rejects invalid tenantId", () => {
    expect(() =>
      DecisionMadeEventSchema.parse({
        eventType: "decision.made",
        tenantId: "not-a-uuid",
        loanId: "LOAN-001",
        decisionType: "accepted",
        finalDecision: "approve",
        decidedAt: "2026-04-23T10:00:00Z",
      })
    ).toThrow();
  });

  it("rejects confidence out of range", () => {
    expect(() =>
      DecisionMadeEventSchema.parse({
        eventType: "decision.made",
        tenantId: "550e8400-e29b-41d4-a716-446655440000",
        loanId: "LOAN-001",
        decisionType: "accepted",
        agentConfidence: 1.5,
        finalDecision: "approve",
        decidedAt: "2026-04-23T10:00:00Z",
      })
    ).toThrow();
  });
});

// ── DETECTION_RULES ───────────────────────────────────────────────
describe("DETECTION_RULES", () => {
  it("has high_override_rate rule with expected values", () => {
    expect(DETECTION_RULES.high_override_rate).toEqual({
      minSample: 20,
      threshold: 0.25,
      windowDays: 30,
    });
  });

  it("has reason_concentration rule", () => {
    expect(DETECTION_RULES.reason_concentration.minSample).toBe(10);
    expect(DETECTION_RULES.reason_concentration.threshold).toBe(0.5);
  });

  it("has confidence_drift rule with 14-day window", () => {
    expect(DETECTION_RULES.confidence_drift.windowDays).toBe(14);
  });

  it("has program_outlier rule", () => {
    expect(DETECTION_RULES.program_outlier).toBeDefined();
    expect(DETECTION_RULES.program_outlier.minSample).toBe(15);
  });
});

// ── OVERRIDE_REASON_LABELS ────────────────────────────────────────
describe("OVERRIDE_REASON_LABELS", () => {
  it("has a label for every override reason", () => {
    const reasons = OverrideReasonSchema.options;
    for (const reason of reasons) {
      expect(OVERRIDE_REASON_LABELS[reason]).toBeDefined();
      expect(typeof OVERRIDE_REASON_LABELS[reason]).toBe("string");
    }
  });

  it("maps dti_exception to DTI Exception", () => {
    expect(OVERRIDE_REASON_LABELS.dti_exception).toBe("DTI Exception");
  });
});
