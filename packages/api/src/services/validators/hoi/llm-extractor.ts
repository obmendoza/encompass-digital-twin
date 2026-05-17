import type Anthropic from "@anthropic-ai/sdk";
import {
  HoiPolicyFieldsSchema,
  FloodCertFieldsSchema,
  HOI_SCHEMA_VERSION,
  type HoiPolicyFields,
  type FloodCertFields,
} from "@twin/core";
import type { DocumentRef, HoiExtractionResult, HoiFieldExtractor } from "./extractor.js";
import { groundingPass } from "./grounding.js";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOL_HOI = {
  name: "emit_hoi_policy_fields",
  description:
    "Emit structured fields extracted from a Hazard Insurance policy declaration page. Use null for fields you cannot identify with high confidence; capture verbatim wording for prose-derived booleans.",
  input_schema: {
    type: "object" as const,
    properties: {
      carrier: { type: ["string", "null"] },
      policyNumber: { type: ["string", "null"] },
      namedInsured: { type: ["string", "null"] },
      propertyAddress: {
        type: ["object", "null"],
        properties: {
          line1: { type: "string" },
          line2: { type: ["string", "null"] },
          city: { type: "string" },
          state: { type: "string" },
          zip: { type: "string" },
        },
        required: ["line1", "city", "state", "zip"],
      },
      effectiveDate: { type: ["string", "null"] },
      expirationDate: { type: ["string", "null"] },
      termMonths: { type: ["integer", "null"] },
      lossPayeeClause: { type: ["string", "null"] },
      loanNumberOnPolicy: { type: ["string", "null"] },
      coverageAmount: { type: ["number", "null"] },
      replacementCost: { type: ["number", "null"] },
      deductiblePct: { type: ["number", "null"] },
      deductibleAmount: { type: ["number", "null"] },
      windHailHurricane: {
        type: ["object", "null"],
        properties: {
          included: { type: "boolean" },
          wording: { type: ["string", "null"] },
          separatePolicy: { type: "boolean" },
          confidence: { type: "number" },
        },
        required: ["included", "separatePolicy", "confidence"],
      },
      rentLossCoverageMonths: { type: ["integer", "null"] },
      rentLossWording: { type: ["string", "null"] },
      rentLossActualCostSustained: {
        type: ["object", "null"],
        properties: {
          detected: { type: "boolean" },
          confidence: { type: "number" },
        },
        required: ["detected", "confidence"],
      },
      occupancyOnPolicy: { type: ["string", "null"] },
      premiumPaidInFull: {
        type: ["object", "null"],
        properties: {
          paid: { type: "boolean" },
          confidence: { type: "number" },
        },
        required: ["paid", "confidence"],
      },
      premiumDueDays: { type: ["integer", "null"] },
      wallsInCoverage: {
        type: ["object", "null"],
        properties: {
          included: { type: "boolean" },
          confidence: { type: "number" },
        },
        required: ["included", "confidence"],
      },
      ho6Policy: {
        type: ["object", "null"],
        properties: {
          present: { type: "boolean" },
          deductiblePct: { type: ["number", "null"] },
          coverageAmount: { type: ["number", "null"] },
        },
        required: ["present"],
      },
      evidence: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fieldPath: { type: "string" },
            documentPage: { type: "integer" },
            bbox: { type: ["array", "null"] },
          },
          required: ["fieldPath", "documentPage"],
        },
      },
    },
    required: ["evidence"],
  },
} as const;

const TOOL_FLOOD = {
  name: "emit_flood_cert_fields",
  description:
    "Emit structured fields extracted from a Flood Certificate / NFIP policy.",
  input_schema: {
    type: "object" as const,
    properties: {
      carrier: { type: ["string", "null"] },
      policyNumber: { type: ["string", "null"] },
      namedInsured: { type: ["string", "null"] },
      propertyAddress: {
        type: ["object", "null"],
        properties: {
          line1: { type: "string" },
          line2: { type: ["string", "null"] },
          city: { type: "string" },
          state: { type: "string" },
          zip: { type: "string" },
        },
        required: ["line1", "city", "state", "zip"],
      },
      effectiveDate: { type: ["string", "null"] },
      expirationDate: { type: ["string", "null"] },
      termMonths: { type: ["integer", "null"] },
      floodZone: { type: ["string", "null"] },
      floodCoverage: { type: ["number", "null"] },
      floodDeductible: { type: ["number", "null"] },
      isNfip: { type: ["boolean", "null"] },
      nfipMaxApplied: { type: ["boolean", "null"] },
      evidence: {
        type: "array",
        items: {
          type: "object",
          properties: {
            fieldPath: { type: "string" },
            documentPage: { type: "integer" },
            bbox: { type: ["array", "null"] },
          },
          required: ["fieldPath", "documentPage"],
        },
      },
    },
    required: ["evidence"],
  },
} as const;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface LlmExtractionResult extends HoiExtractionResult {
  /** Set when extraction failed; absent on success. */
  extractionError?: string;
}

// ---------------------------------------------------------------------------
// Extractor implementation
// ---------------------------------------------------------------------------

export class LlmHoiExtractor implements HoiFieldExtractor {
  constructor(
    private readonly anthropic: Anthropic,
    private readonly model = "claude-sonnet-4-6",
  ) {}

  async canExtract(doc: DocumentRef): Promise<boolean> {
    return doc.category === "hoi-policy" || doc.category === "flood-cert";
  }

  async extract(doc: DocumentRef): Promise<LlmExtractionResult> {
    const isHoi = doc.category === "hoi-policy";
    const tool = isHoi ? TOOL_HOI : TOOL_FLOOD;

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4096,
      tools: [tool as never],
      tool_choice: { type: "tool", name: tool.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "url", url: doc.storageUrl },
            } as never,
            {
              type: "text",
              text: isHoi
                ? "Extract structured fields from this Hazard Insurance policy declaration page. Use null for fields you cannot identify with high confidence. Capture verbatim wording on prose-derived booleans (windHailHurricane, premiumPaidInFull, etc.)."
                : "Extract structured fields from this Flood certificate. Use null for fields you cannot identify with high confidence.",
            },
          ],
        },
      ] as never,
    });

    // Find the tool_use block in the response
    type ContentBlock = { type: string; input?: unknown };
    const toolUseBlock = (response.content as ContentBlock[]).find(
      (c) => c.type === "tool_use",
    );

    if (!toolUseBlock) {
      return this.failedExtraction("no_tool_use_block");
    }

    // Zod-validate the tool input against the appropriate schema
    const schema = isHoi ? HoiPolicyFieldsSchema : FloodCertFieldsSchema;
    const parsed = schema.safeParse(toolUseBlock.input);

    if (!parsed.success) {
      const msg = parsed.error.message.slice(0, 200);
      return this.failedExtraction(`zod_validation_failed: ${msg}`);
    }

    // R1 grounding-pass — only for HOI policies (flood cert has no prose-derived booleans)
    const grounded = doc.category === "hoi-policy"
      ? groundingPass(parsed.data as HoiPolicyFields)
      : { fields: parsed.data, groundingErrors: [] as Array<{ field: string; conclusion: string; reason: string }> };

    const aggregateConfidence = computeAggregateConfidence(grounded.fields);

    return {
      fields: grounded.fields,
      source: "llm-extractor",
      confidence: aggregateConfidence,
      extractedBy: `worker:hoi-extractor:v${HOI_SCHEMA_VERSION}`,
      // extractionId intentionally empty — populated by the worker (Task 17)
      // after the DB INSERT returns the row's UUID.
      extractionId: "",
      schemaVersion: HOI_SCHEMA_VERSION,
      // Append grounding errors as extractionError if any were found
      ...(grounded.groundingErrors.length > 0 ? { extractionError: JSON.stringify(grounded.groundingErrors) } : {}),
    };
  }

  private failedExtraction(reason: string): LlmExtractionResult {
    return {
      fields: {} as never,
      source: "llm-extractor",
      confidence: 0,
      extractedBy: `worker:hoi-extractor:v${HOI_SCHEMA_VERSION}:error`,
      extractionId: "",
      schemaVersion: HOI_SCHEMA_VERSION,
      extractionError: reason,
    };
  }
}

// ---------------------------------------------------------------------------
// Aggregate confidence helper
// ---------------------------------------------------------------------------

/**
 * Computes aggregate confidence from the 4 prose-derived boolean fields.
 * Only HOI policy fields carry per-field confidence scores; flood fields do
 * not, so for flood documents this always returns 1 (no risk to aggregate).
 *
 * If none of the 4 confidence fields are present in the extraction, defaults
 * to 1 (no risk information available, assume high confidence).
 */
function computeAggregateConfidence(
  fields: HoiPolicyFields | FloodCertFields,
): number {
  const f = fields as Partial<HoiPolicyFields>;
  const confs = [
    f.windHailHurricane?.confidence,
    f.rentLossActualCostSustained?.confidence,
    f.premiumPaidInFull?.confidence,
    f.wallsInCoverage?.confidence,
  ].filter((v): v is number => typeof v === "number");

  if (confs.length === 0) return 1;
  return confs.reduce((sum, c) => sum + c, 0) / confs.length;
}
