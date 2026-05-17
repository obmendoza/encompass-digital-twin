import type { Rule, RuleContext, RuleResult } from "./types.js";

const CONF_FAIL_THRESHOLD = 0.7;
const CONF_SKIP_THRESHOLD = 0.4;

function isDscr(loan: RuleContext["loan"]): boolean {
  if (!loan.incomeDocType) return false;
  if (loan.incomeDocType.toUpperCase().includes("DSCR")) return true;
  return false;
}

function isCondo(loan: RuleContext["loan"]): boolean {
  return loan.propertyType === "Condo";
}

export const H10_dscrRentLoss: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.dscr.rent-loss-coverage", fired: false, finding: null };
  if (!isDscr(ctx.loan)) return skip;

  const monthsOk = ctx.hoi?.rentLossCoverageMonths != null && ctx.hoi.rentLossCoverageMonths >= 6;
  const acs = ctx.hoi?.rentLossActualCostSustained;
  const actualCostDetected =
    acs && acs.confidence >= CONF_SKIP_THRESHOLD ? acs.detected : false;

  if (monthsOk && !actualCostDetected) return skip;

  const severity: "fail" | "warn" =
    acs && acs.confidence < CONF_FAIL_THRESHOLD && acs.detected
      ? "warn"
      : "fail";
  return {
    ruleId: "hoi.dscr.rent-loss-coverage",
    fired: true,
    finding: {
      ruleId: "hoi.dscr.rent-loss-coverage",
      severity,
      currentValue: `${ctx.hoi?.rentLossCoverageMonths ?? "?"} mo; ${ctx.hoi?.rentLossWording ?? "no wording captured"}`,
      expectedValue: "≥ 6 months PITIA rent loss (not 'actual cost sustained')",
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.hoiExtractionId!,
        fieldPath: "rentLossCoverageMonths",
        documentPage: ctx.hoi!.evidence.find((e) => e.fieldPath === "rentLossCoverageMonths")?.documentPage ?? null,
      },
    },
  };
};

export const H11_condoWallsInOrHo6: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.condo.walls-in-or-ho6", fired: false, finding: null };
  if (!isCondo(ctx.loan)) return skip;

  const walls = ctx.hoi?.wallsInCoverage;
  const ho6 = ctx.hoi?.ho6Policy;

  if (walls && walls.confidence < CONF_SKIP_THRESHOLD && !ho6?.present) return skip;

  const wallsOk = walls && walls.included && walls.confidence >= CONF_FAIL_THRESHOLD;
  const ho6Ok = ho6?.present && (ho6.deductiblePct == null || ho6.deductiblePct <= 0.05);
  if (wallsOk || ho6Ok) return skip;

  const lowConfWallsClaim =
    walls && walls.included && walls.confidence < CONF_FAIL_THRESHOLD && !ho6Ok;
  const severity: "fail" | "warn" = lowConfWallsClaim ? "warn" : "fail";
  return {
    ruleId: "hoi.condo.walls-in-or-ho6",
    fired: true,
    finding: {
      ruleId: "hoi.condo.walls-in-or-ho6",
      severity,
      currentValue: walls?.included
        ? `walls-in claimed (confidence ${walls.confidence.toFixed(2)})`
        : ho6?.present
        ? `HO6 present, deductible ${ho6.deductiblePct != null ? (ho6.deductiblePct * 100).toFixed(2) + "%" : "?"}`
        : "no walls-in or HO6",
      expectedValue: "master policy walls-in coverage OR separate HO6 with deductible ≤ 5% of dwelling",
      evidence: {
        documentId: ctx.documents.hoi!.documentId,
        extractionId: ctx.hoiExtractionId!,
        fieldPath: "wallsInCoverage",
        documentPage: ctx.hoi!.evidence.find((e) => e.fieldPath === "wallsInCoverage")?.documentPage ?? null,
      },
    },
  };
};

export const H12_occupancyMatch: Rule = (ctx: RuleContext): RuleResult => {
  const skip: RuleResult = { ruleId: "hoi.occupancy.match", fired: false, finding: null };
  if (!ctx.hoi?.occupancyOnPolicy) return skip;
  const policyOcc = ctx.hoi.occupancyOnPolicy.toLowerCase();
  if (isDscr(ctx.loan)) {
    if (policyOcc.includes("primary") || policyOcc.includes("owner-occupied")) {
      return {
        ruleId: "hoi.occupancy.match",
        fired: true,
        finding: {
          ruleId: "hoi.occupancy.match",
          severity: "fail",
          currentValue: ctx.hoi.occupancyOnPolicy,
          expectedValue: "DSCR loans require non-owner-occupied policy (Investment / Rental)",
          evidence: {
            documentId: ctx.documents.hoi!.documentId,
            extractionId: ctx.hoiExtractionId!,
            fieldPath: "occupancyOnPolicy",
            documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "occupancyOnPolicy")?.documentPage ?? null,
          },
        },
      };
    }
  }
  if (!isDscr(ctx.loan) && ctx.loan.occupancy?.toLowerCase() === "primary" && !policyOcc.includes("primary") && !policyOcc.includes("owner")) {
    return {
      ruleId: "hoi.occupancy.match",
      fired: true,
      finding: {
        ruleId: "hoi.occupancy.match",
        severity: "fail",
        currentValue: ctx.hoi.occupancyOnPolicy,
        expectedValue: "policy occupancy should reflect Primary / Owner-Occupied for primary residence loans",
        evidence: {
          documentId: ctx.documents.hoi!.documentId,
          extractionId: ctx.hoiExtractionId!,
          fieldPath: "occupancyOnPolicy",
          documentPage: ctx.hoi.evidence.find((e) => e.fieldPath === "occupancyOnPolicy")?.documentPage ?? null,
        },
      },
    };
  }
  return skip;
};
