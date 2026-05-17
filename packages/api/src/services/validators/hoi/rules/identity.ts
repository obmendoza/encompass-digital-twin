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

export const H2_namedInsuredMatch: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.named-insured.match", fired: false, finding: null };
  if (!ctx.hoi?.namedInsured) return skip;
  const got = normalize(ctx.hoi.namedInsured);
  const expectedName = ctx.loan.entityName ?? ctx.loan.borrowerFullName;
  if (!expectedName) return skip;
  if (got.includes(normalize(expectedName))) return skip;
  return {
    ruleId: "hoi.named-insured.match",
    fired: true,
    finding: {
      ruleId: "hoi.named-insured.match",
      severity: "fail",
      currentValue: ctx.hoi.namedInsured,
      expectedValue: expectedName,
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.hoiExtractionId!,
        fieldPath: "namedInsured",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "namedInsured")?.documentPage ?? null,
      },
    },
  };
};

export const H3_propertyAddressMatch: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.property-address.match", fired: false, finding: null };
  if (!ctx.hoi?.propertyAddress || !ctx.loan.subjectPropertyAddress) return skip;
  const got = ctx.hoi.propertyAddress;
  const want = ctx.loan.subjectPropertyAddress;
  const lineOk = normalize(got.line1) === normalize(want.line1);
  const cityOk = normalize(got.city) === normalize(want.city);
  const stateOk = normalize(got.state) === normalize(want.state);
  const zipOk = got.zip.replace(/\D/g, "").slice(0, 5) === want.zip.replace(/\D/g, "").slice(0, 5);
  if (lineOk && cityOk && stateOk && zipOk) return skip;
  return {
    ruleId: "hoi.property-address.match",
    fired: true,
    finding: {
      ruleId: "hoi.property-address.match",
      severity: "fail",
      currentValue: `${got.line1}, ${got.city}, ${got.state} ${got.zip}`,
      expectedValue: `${want.line1}, ${want.city}, ${want.state} ${want.zip}`,
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.hoiExtractionId!,
        fieldPath: "propertyAddress",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "propertyAddress")?.documentPage ?? null,
      },
    },
  };
};

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
        extractionId: ctx.hoiExtractionId!,
        fieldPath: "lossPayeeClause",
        documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "lossPayeeClause")?.documentPage ?? null,
      },
    },
  };
};
