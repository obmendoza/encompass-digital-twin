import type { Rule, RuleContext, RuleResult } from "./types.js";

const DAY = 24 * 60 * 60 * 1000;

export const H4_effectiveDateWindow: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.effective-date.window", fired: false, finding: null };
  if (!ctx.hoi?.effectiveDate || !ctx.loan.noteDate) return skip;
  const eff = new Date(ctx.hoi.effectiveDate).getTime();
  const note = new Date(ctx.loan.noteDate).getTime();
  if (Number.isNaN(eff) || Number.isNaN(note)) return skip;
  const isPurchase = ctx.loan.loanPurpose === "Purchase";
  const minEff = isPurchase ? note - 15 * DAY : -Infinity;
  const maxEff = isPurchase ? Infinity : note;
  if (eff >= minEff && eff <= maxEff) return skip;
  return {
    ruleId: "hoi.effective-date.window",
    fired: true,
    finding: {
      ruleId: "hoi.effective-date.window",
      severity: "fail",
      currentValue: ctx.hoi.effectiveDate,
      expectedValue: isPurchase
        ? `≥ ${new Date(minEff).toISOString().slice(0, 10)} (note date − 15 days)`
        : `≤ ${ctx.loan.noteDate} (note date)`,
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.hoiExtractionId!,
        fieldPath: "effectiveDate",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "effectiveDate")?.documentPage ?? null,
      },
    },
  };
};

export const H5_term12Months: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.term.12-months", fired: false, finding: null };
  if (ctx.hoi?.termMonths == null) return skip;
  if (ctx.hoi.termMonths >= 12) return skip;
  return {
    ruleId: "hoi.term.12-months",
    fired: true,
    finding: {
      ruleId: "hoi.term.12-months",
      severity: "fail",
      currentValue: `${ctx.hoi.termMonths} months`,
      expectedValue: "≥ 12 months",
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.hoiExtractionId!,
        fieldPath: "termMonths",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "termMonths")?.documentPage ?? null,
      },
    },
  };
};
