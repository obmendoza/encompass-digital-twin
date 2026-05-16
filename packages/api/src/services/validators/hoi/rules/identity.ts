import type { Rule, RuleContext, RuleResult } from "./types.js";

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s.,]+/g, " ").trim();
}

function expectedLossPayee(loan: RuleContext["loan"]): string | null {
  if (loan.channel === "NDC") {
    if (!loan.lenderName) return null; // v1.1 deferred — skip
    return loan.lenderName;
  }
  // Wholesale + Retail use NQMF mortgagee clauses
  if (loan.state === "NY") return "Great Home Mortgage of New York";
  return "NQM Funding, LLC";
}

export const H1_lossPayeeMatch: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.loss-payee.match", fired: false, finding: null };
  if (!ctx.hoi?.lossPayeeClause) return skip;
  const expected = expectedLossPayee(ctx.loan);
  if (!expected) {
    // NDC channel without lenderName — graceful no-op per spec §5 P3.
    return skip;
  }
  const got = normalize(ctx.hoi.lossPayeeClause);
  const wantEntity = normalize(expected);
  const entityOk = got.includes(wantEntity);
  // Loan number is a separate extracted field, not embedded in the clause text.
  const loanOk =
    ctx.hoi.loanNumberOnPolicy != null &&
    normalize(ctx.hoi.loanNumberOnPolicy) === normalize(ctx.loanNumber);
  if (entityOk && loanOk) return skip;
  return {
    ruleId: "hoi.loss-payee.match",
    fired: true,
    finding: {
      ruleId: "hoi.loss-payee.match",
      severity: "fail",
      currentValue: ctx.hoi.lossPayeeClause,
      expectedValue: `${expected} (with loan number ${ctx.loanNumber})`,
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.extractionId,
        fieldPath: "lossPayeeClause",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "lossPayeeClause")?.documentPage ?? null,
      },
    },
  };
};
