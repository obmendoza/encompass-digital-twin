// HOI Validator resolver for PC v2. Reads document_extractions rows for the
// given loan, evaluates all 14 HOI/Flood rules, and returns Findings with
// sourceList='hoi-validator'. Also emits a Misc Review finding when
// aggregate-confidence is low (spec §6.3 / C6 hatch).
//
// Called by service.ts (Task 19) during the normal run() cycle for tenants
// with validators.hoi.enabled=true.

import type pg from "pg";
import type { LoanContext } from "../../doc-requirements.js";
import type { Finding, KbVersionContext } from "../pre-underwriter.js";
import { HOI_RULES } from "../../validators/hoi/rules/index.js";
import type { DocumentRef } from "../../validators/hoi/rules/types.js";
import { HOI_SCHEMA_VERSION, type HoiPolicyFields, type FloodCertFields, type ValidationFinding } from "@twin/core";

interface ExtractionRow {
  id: string;
  document_id: string;
  extractor_kind: "hoi-policy" | "flood-cert";
  fields: HoiPolicyFields | FloodCertFields;
  extraction_confidence: number | null;
}

const HOI_RULE_DESCRIPTIONS: Record<string, string> = {
  "hoi.loss-payee.match": "Hazard Insurance: Loss payee clause does not match required text",
  "hoi.named-insured.match": "Hazard Insurance: Named insured does not match borrower/entity",
  "hoi.property-address.match": "Hazard Insurance: Property address does not match subject",
  "hoi.effective-date.window": "Hazard Insurance: Effective date outside required window",
  "hoi.term.12-months": "Hazard Insurance: Term shorter than 12 months",
  "hoi.premium.paid-in-full": "Hazard Insurance: Premium not paid in full",
  "hoi.deductible.cap": "Hazard Insurance: Deductible exceeds 5% of face value",
  "hoi.wind-hail-hurricane.included": "Hazard Insurance: Wind/hail/hurricane coverage not confirmed",
  "hoi.coverage.minimum": "Hazard Insurance: Coverage below required minimum",
  "hoi.dscr.rent-loss-coverage": "Hazard Insurance: DSCR rent-loss coverage insufficient",
  "hoi.condo.walls-in-or-ho6": "Hazard Insurance: Condo walls-in coverage or HO6 missing",
  "hoi.occupancy.match": "Hazard Insurance: Policy occupancy inconsistent with transaction",
  "flood.deductible.cap": "Flood Insurance: Deductible exceeds limit",
  "flood.coverage.minimum": "Flood Insurance: Coverage below required minimum",
  "hoi.review.low-confidence": "HOI Policy: Manual Review Required",
};

export async function resolveHoiValidatorFindings(
  c: pg.PoolClient,
  tenantId: string,
  _kbCtx: KbVersionContext,
  loan: LoanContext,
  args: { hoiEnabled: boolean; loanExternalId: string; loanNumber: string },
): Promise<Finding[]> {
  if (!args.hoiEnabled) return [];

  const { rows } = await c.query<ExtractionRow>(
    `SELECT id, document_id, extractor_kind, fields, extraction_confidence
       FROM document_extractions
      WHERE tenant_id = $1 AND loan_id = $2 AND schema_version = $3 AND superseded_at IS NULL`,
    [tenantId, args.loanExternalId, HOI_SCHEMA_VERSION],
  );

  const hoiRow = rows.find((r) => r.extractor_kind === "hoi-policy") ?? null;
  const floodRow = rows.find((r) => r.extractor_kind === "flood-cert") ?? null;
  if (!hoiRow && !floodRow) return [];

  const documents: { hoi: DocumentRef | null; floodCert: DocumentRef | null } = {
    hoi: hoiRow
      ? {
          tenantId,
          loanId: args.loanExternalId,
          documentId: hoiRow.document_id,
          category: "hoi-policy",
          storageUrl: "",
        }
      : null,
    floodCert: floodRow
      ? {
          tenantId,
          loanId: args.loanExternalId,
          documentId: floodRow.document_id,
          category: "flood-cert",
          storageUrl: "",
        }
      : null,
  };

  const ctx = {
    hoi: hoiRow ? (hoiRow.fields as HoiPolicyFields) : null,
    flood: floodRow ? (floodRow.fields as FloodCertFields) : null,
    loan,
    documents,
    hoiExtractionId: hoiRow?.id ?? null,
    floodExtractionId: floodRow?.id ?? null,
    loanNumber: args.loanNumber,
  };

  const findings: Finding[] = [];
  for (const rule of HOI_RULES) {
    const r = rule(ctx);
    if (r.fired && r.finding) {
      findings.push({
        description: HOI_RULE_DESCRIPTIONS[r.ruleId] ?? `Hazard Insurance: ${r.ruleId}`,
        note: r.finding.expectedValue,
        category: "PTD",
        sourceList: "hoi-validator",
        sourceRuleTable: "hoi_validator_rules",
        sourceRuleId: r.ruleId,
        emissionKind: "deterministic",
        metadata: {
          validationFindings: [r.finding],
          extractionId: r.finding.evidence.extractionId,
        },
      });
    }
  }

  // Aggregate-confidence Misc HOI Policy Review hatch (C6 / spec §6.3).
  // Fires when either the aggregate confidence is very low, or 3+ prose-derived
  // fields individually fall below the 0.4 skip threshold.
  const lowConfFields = countLowConfidenceFields(ctx.hoi);
  const aggConf = hoiRow?.extraction_confidence ?? null;
  if (hoiRow && ((aggConf != null && aggConf < 0.4) || lowConfFields >= 3)) {
    findings.push(buildReviewFinding(hoiRow, aggConf ?? 0, lowConfFields));
  }

  return findings;
}

function countLowConfidenceFields(hoi: HoiPolicyFields | null): number {
  if (!hoi) return 0;
  let n = 0;
  if (hoi.windHailHurricane && hoi.windHailHurricane.confidence < 0.4) n++;
  if (hoi.rentLossActualCostSustained && hoi.rentLossActualCostSustained.confidence < 0.4) n++;
  if (hoi.premiumPaidInFull && hoi.premiumPaidInFull.confidence < 0.4) n++;
  if (hoi.wallsInCoverage && hoi.wallsInCoverage.confidence < 0.4) n++;
  return n;
}

function buildReviewFinding(row: ExtractionRow, agg: number, lowConfCount: number): Finding {
  const vf: ValidationFinding = {
    ruleId: "hoi.review.low-confidence",
    severity: "warn",
    currentValue: `aggregate_confidence=${agg.toFixed(2)}`,
    expectedValue: null,
    evidence: {
      documentId: row.document_id,
      extractionId: row.id,
      fieldPath: "<aggregate>",
      documentPage: null,
    },
  };
  return {
    description: HOI_RULE_DESCRIPTIONS["hoi.review.low-confidence"]!,
    note: `Automated extraction confidence ${agg.toFixed(2)} (${lowConfCount} prose-derived field(s) below 0.4). Verify per-field details manually before clearing the Hazard Insurance condition.`,
    category: "PTD",
    sourceList: "hoi-validator",
    sourceRuleTable: "hoi_validator_rules",
    sourceRuleId: "hoi.review.low-confidence",
    emissionKind: "deterministic",
    metadata: {
      validationFindings: [vf],
      extractionId: row.id,
    },
  };
}
