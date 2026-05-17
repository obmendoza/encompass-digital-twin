import type { Rule, RuleContext, RuleResult } from "./types.js";

const NFIP_MAX_SFR = 250_000;
const NFIP_MAX_OTHER = 500_000;

export const F1_floodDeductibleCap: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "flood.deductible.cap", fired: false, finding: null };
  if (!ctx.flood || !ctx.documents.floodCert) return skip;
  if (ctx.flood.floodDeductible == null) return skip;
  const propertyType = ctx.loan.propertyType ?? "SFR";
  const cap = propertyType === "Condo" || propertyType === "PUD" ? 25_000 : 10_000;
  if (ctx.flood.floodDeductible <= cap) return skip;
  return {
    ruleId: "flood.deductible.cap",
    fired: true,
    finding: {
      ruleId: "flood.deductible.cap",
      severity: "fail",
      currentValue: `$${ctx.flood.floodDeductible.toLocaleString()}`,
      expectedValue: `≤ $${cap.toLocaleString()} for ${propertyType}`,
      evidence: {
        documentId: ctx.documents.floodCert.documentId,
        extractionId: ctx.floodExtractionId!,
        fieldPath: "floodDeductible",
        documentPage: ctx.flood.evidence.find((e) => e.fieldPath === "floodDeductible")?.documentPage ?? null,
      },
    },
  };
};

export const F2_floodCoverageMinimum: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "flood.coverage.minimum", fired: false, finding: null };
  if (!ctx.flood || !ctx.documents.floodCert) return skip;
  if (ctx.flood.floodCoverage == null) return skip;
  const upb = ctx.loan.unpaidPrincipalBalance ?? ctx.loan.loanAmount;
  const rc = ctx.loan.replacementCost;
  const propertyType = ctx.loan.propertyType ?? "SFR";
  const nfipMax = propertyType === "Condo" || propertyType === "PUD" ? NFIP_MAX_OTHER : NFIP_MAX_SFR;
  const candidates = [upb, rc, nfipMax].filter((v): v is number => v != null);
  if (candidates.length === 0) return skip;
  const required = Math.min(...candidates);
  if (ctx.flood.floodCoverage >= required) return skip;
  return {
    ruleId: "flood.coverage.minimum",
    fired: true,
    finding: {
      ruleId: "flood.coverage.minimum",
      severity: "fail",
      currentValue: `$${ctx.flood.floodCoverage.toLocaleString()}`,
      expectedValue: `≥ $${required.toLocaleString()} (lesser of UPB / RC / NFIP max)`,
      evidence: {
        documentId: ctx.documents.floodCert.documentId,
        extractionId: ctx.floodExtractionId!,
        fieldPath: "floodCoverage",
        documentPage: ctx.flood.evidence.find((e) => e.fieldPath === "floodCoverage")?.documentPage ?? null,
      },
    },
  };
};
