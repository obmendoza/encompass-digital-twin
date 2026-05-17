import type { Rule, RuleContext, RuleResult } from "./types.js";

const CONF_FAIL_THRESHOLD = 0.7;
const CONF_SKIP_THRESHOLD = 0.4;
const DAY = 24 * 60 * 60 * 1000;

export const H6_premiumPaidInFull: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.premium.paid-in-full", fired: false, finding: null };
  const p = ctx.hoi?.premiumPaidInFull;
  if (!p) return skip;
  if (p.confidence < CONF_SKIP_THRESHOLD) return skip; // grounding-pass already lowered confidence

  // Refi with premium due within 60d of closing must be paid
  const isRefi = ctx.loan.loanPurpose === "Rate & Term Refinance" || ctx.loan.loanPurpose === "Cash-Out Refinance";
  let dueWithin60d = false;
  if (isRefi && ctx.loan.closingDate && ctx.hoi?.premiumDueDays != null) {
    const close = new Date(ctx.loan.closingDate).getTime();
    const dueBy = Date.now() + ctx.hoi.premiumDueDays * DAY;
    dueWithin60d = dueBy <= close + 60 * DAY && dueBy >= close - 60 * DAY;
  }

  if (p.paid) {
    if (p.confidence < CONF_FAIL_THRESHOLD) {
      // Paid asserted but low confidence — warn rather than silently pass
      return {
        ruleId: "hoi.premium.paid-in-full",
        fired: true,
        finding: {
          ruleId: "hoi.premium.paid-in-full",
          severity: "warn",
          currentValue: `paid (confidence ${p.confidence.toFixed(2)})`,
          expectedValue: "paid in full (high confidence)",
          evidence: {
            documentId: ctx.documents.hoi!.documentId,
            extractionId: ctx.hoiExtractionId!,
            fieldPath: "premiumPaidInFull",
            documentPage: ctx.hoi!.evidence.find((e) => e.fieldPath === "premiumPaidInFull")?.documentPage ?? null,
          },
        },
      };
    }
    if (isRefi && dueWithin60d && !p.paid) {
      return failPremium(ctx, "refi premium due within 60d of closing must be paid prior/at closing");
    }
    return skip;
  }

  if (isRefi && dueWithin60d) {
    return failPremium(ctx, "refi premium due within 60d of closing must be paid prior/at closing");
  }
  return failPremium(ctx, "premium not paid in full");
};

function failPremium(ctx: RuleContext, reason: string): RuleResult {
  return {
    ruleId: "hoi.premium.paid-in-full",
    fired: true,
    finding: {
      ruleId: "hoi.premium.paid-in-full",
      severity: "fail",
      currentValue: ctx.hoi?.premiumPaidInFull?.paid ? "paid" : "not paid",
      expectedValue: reason,
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.hoiExtractionId!,
        fieldPath: "premiumPaidInFull",
        documentPage: ctx.hoi!.evidence.find((e) => e.fieldPath === "premiumPaidInFull")?.documentPage ?? null,
      },
    },
  };
}

export const H7_deductibleCap: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.deductible.cap", fired: false, finding: null };
  if (ctx.hoi?.deductiblePct == null) return skip;
  if (ctx.hoi.deductiblePct <= 0.05) return skip;
  return {
    ruleId: "hoi.deductible.cap",
    fired: true,
    finding: {
      ruleId: "hoi.deductible.cap",
      severity: "fail",
      currentValue: `${(ctx.hoi.deductiblePct * 100).toFixed(2)}%`,
      expectedValue: "≤ 5% of face value",
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.hoiExtractionId!,
        fieldPath: "deductiblePct",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "deductiblePct")?.documentPage ?? null,
      },
    },
  };
};

export const H8_windHailIncluded: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.wind-hail-hurricane.included", fired: false, finding: null };
  const w = ctx.hoi?.windHailHurricane;
  if (!w) return skip;
  if (w.confidence < CONF_SKIP_THRESHOLD) return skip;
  if (w.included && w.confidence >= CONF_FAIL_THRESHOLD) return skip;
  const severity: "fail" | "warn" =
    !w.included && w.confidence >= CONF_FAIL_THRESHOLD ? "fail" : "warn";
  return {
    ruleId: "hoi.wind-hail-hurricane.included",
    fired: true,
    finding: {
      ruleId: "hoi.wind-hail-hurricane.included",
      severity,
      currentValue: w.wording ?? (w.included ? "included" : "excluded"),
      expectedValue: "wind, hail, and hurricane coverage included (special form, all perils, or separate policy)",
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.hoiExtractionId!,
        fieldPath: "windHailHurricane",
        documentPage: ctx.hoi!.evidence.find((e) => e.fieldPath === "windHailHurricane")?.documentPage ?? null,
      },
    },
  };
};

export const H9_coverageMinimum: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.coverage.minimum", fired: false, finding: null };
  if (ctx.hoi?.coverageAmount == null) return skip;
  if (ctx.loan.loanAmount == null) return skip;
  const rc = ctx.hoi.replacementCost ?? ctx.loan.replacementCost;
  const required = rc != null ? Math.min(ctx.loan.loanAmount, rc) : ctx.loan.loanAmount;
  if (ctx.hoi.coverageAmount >= required) return skip;
  return {
    ruleId: "hoi.coverage.minimum",
    fired: true,
    finding: {
      ruleId: "hoi.coverage.minimum",
      severity: "fail",
      currentValue: `$${ctx.hoi.coverageAmount.toLocaleString()}`,
      expectedValue: `≥ $${required.toLocaleString()} (lesser of loan amount / replacement cost)`,
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.hoiExtractionId!,
        fieldPath: "coverageAmount",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "coverageAmount")?.documentPage ?? null,
      },
    },
  };
};
