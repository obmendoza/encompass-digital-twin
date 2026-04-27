// ── Claude Vision Processor — AI-based guideline extraction via tool_use ────

import Anthropic from "@anthropic-ai/sdk";
import https from "node:https";
import type { ProcessorInput, ProcessorOutput } from "@twin/core";
import type { GuidelineRules } from "@twin/core";
import { registerProcessor } from "./document-processor.js";
import type { DocumentProcessor } from "./document-processor.js";
import { detectNpi } from "./npi-detector.js";

// ── Lazy client init ────────────────────────────────────────────────
let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

// ── Model selection (config-driven) ─────────────────────────────────
const VISION_MODEL =
  process.env.CLAUDE_VISION_MODEL ?? "claude-sonnet-4-20250514";

// ── Cost estimation (per 1M tokens) ─────────────────────────────────
const COST_PER_1M_INPUT = 3.0;
const COST_PER_1M_OUTPUT = 15.0;

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * COST_PER_1M_INPUT +
    (outputTokens / 1_000_000) * COST_PER_1M_OUTPUT
  );
}

// ── Tool Schema — matches GuidelineRules structure ──────────────────

const EXTRACT_GUIDELINES_TOOL: Anthropic.Tool = {
  name: "extract_guideline_rules",
  description:
    "Extract underwriting guideline rules from a lender's product guideline document. Extract all fields you can identify with confidence.",
  input_schema: {
    type: "object" as const,
    properties: {
      credit: {
        type: "object",
        properties: {
          minFico: { type: "number", description: "Minimum FICO score required" },
          maxFico: { type: "number", description: "Maximum FICO score in range" },
          maxLatePayments30: { type: "number", description: "Max 30-day late payments allowed" },
          maxLatePayments60: { type: "number", description: "Max 60-day late payments allowed" },
          maxLatePayments90: { type: "number", description: "Max 90-day late payments allowed" },
          minTradelineCount: { type: "number", description: "Minimum tradeline count" },
          minTradelineAge: { type: "number", description: "Minimum tradeline age in months" },
          housingEventSeasoning: { type: "number", description: "Housing event seasoning in months" },
          bankruptcySeasoning: { type: "number", description: "Bankruptcy seasoning in months" },
          foreclosureSeasoning: { type: "number", description: "Foreclosure seasoning in months" },
          maxOpenCollections: { type: "number", description: "Maximum number of open collections allowed" },
          disputePolicy: { type: "string", description: "Policy for handling credit disputes (e.g. exclude_all, exclude_over_500, case_by_case, include_all)" },
        },
        required: ["minFico", "maxFico"],
      },
      income: {
        type: "object",
        properties: {
          methods: {
            type: "array",
            items: { type: "string" },
            description: "Qualifying income methods (e.g. BankStatementDeposits, DSCRCoverage)",
          },
          minMonths: { type: "number", description: "Minimum months of income documentation" },
          maxNsfCount: { type: "number", description: "Maximum NSF count allowed" },
          minExpenseFactor: { type: "number", description: "Minimum expense factor (0-1)" },
          maxExpenseFactor: { type: "number", description: "Maximum expense factor (0-1)" },
          requireCpaLetter: { type: "boolean", description: "Whether CPA letter is required" },
          maxDtiFront: { type: "number", description: "Maximum front-end DTI ratio percentage (0-100)" },
          maxDtiBack: { type: "number", description: "Maximum back-end DTI ratio percentage (0-100)" },
          expenseFactors: {
            type: "object",
            description: "Expense factor percentages by category (e.g. { 'selfEmployed': 0.5, 'rental': 0.75 })",
            additionalProperties: { type: "number" },
          },
          minDscrRatio: { type: "number", description: "Minimum DSCR ratio (e.g. 1.0, 1.25)" },
        },
        required: ["methods"],
      },
      ltv: {
        type: "object",
        properties: {
          maxLtv: { type: "number", description: "Maximum LTV percentage (0-100)" },
          maxCltv: { type: "number", description: "Maximum CLTV percentage (0-100)" },
          maxHcltv: { type: "number", description: "Maximum HCLTV percentage (0-100)" },
          maxLtvCashOut: { type: "number", description: "Maximum LTV for cash-out refi (0-100)" },
          matrix: {
            type: "array",
            description: "LTV/FICO matrix tiers extracted from rate sheets or guideline tables",
            items: {
              type: "object",
              properties: {
                minFico: { type: "number", description: "Minimum FICO for this tier" },
                maxFico: { type: "number", description: "Maximum FICO for this tier" },
                maxLtv: { type: "number", description: "Maximum LTV allowed for this tier (0-100)" },
                occupancy: { type: "string", description: "Occupancy type (Primary, Second, Investment)" },
              },
              required: ["minFico", "maxFico", "maxLtv"],
            },
          },
        },
        required: ["maxLtv", "maxCltv"],
      },
      reserves: {
        type: "object",
        properties: {
          minMonths: { type: "number", description: "Minimum months of reserves" },
          minMonthsInvestment: { type: "number", description: "Minimum months of reserves for investment properties" },
          liquidOnly: { type: "boolean", description: "Whether only liquid assets count" },
          byLtvTier: {
            type: "array",
            description: "Reserve requirements by LTV tier",
            items: {
              type: "object",
              properties: {
                maxLtv: { type: "number", description: "Maximum LTV for this tier" },
                minMonths: { type: "number", description: "Minimum months of reserves required" },
              },
              required: ["maxLtv", "minMonths"],
            },
          },
        },
        required: ["minMonths"],
      },
      documents: {
        type: "object",
        properties: {
          required: {
            type: "array",
            items: { type: "string" },
            description: "List of required document types",
          },
          conditional: {
            type: "array",
            items: {
              type: "object",
              properties: {
                document: { type: "string" },
                condition: { type: "string" },
              },
              required: ["document", "condition"],
            },
            description: "Conditionally required documents",
          },
        },
        required: ["required"],
      },
      conditions: {
        type: "object",
        properties: {
          autoGenerate: {
            type: "array",
            items: { type: "string" },
            description: "Conditions to auto-generate",
          },
          requiredCategories: {
            type: "array",
            items: { type: "string" },
            description: "Required condition categories",
          },
        },
      },
      compliance: {
        type: "object",
        properties: {
          requireQm: { type: "boolean", description: "Whether QM status is required" },
          requireAtr: { type: "boolean", description: "Whether ATR compliance is required" },
          maxPointsAndFees: { type: "number", description: "Maximum points and fees percentage" },
          stateLicenseCheck: { type: "boolean", description: "Whether state license check is required" },
          stateRestrictions: {
            type: "array",
            items: { type: "string" },
            description: "List of restricted states (2-letter codes, e.g. NY, NJ, CA)",
          },
          geoOverlays: {
            type: "object",
            description: "Geographic overlay rules by state (e.g. { 'NY': 'max 70% LTV' })",
            additionalProperties: { type: "string" },
          },
        },
      },
      tenantContext: {
        type: "object",
        properties: {
          overlayNotes: { type: "string", description: "Lender overlay notes or special instructions" },
          lenderNotes: { type: "string", description: "General lender notes or commentary" },
          riskTolerance: { type: "string", description: "Risk tolerance level: conservative, moderate, or aggressive" },
        },
      },
      property: {
        type: "object",
        description: "Allowed property and occupancy types",
        properties: {
          allowedTypes: {
            type: "array",
            items: { type: "string" },
            description: "Allowed property types (e.g. SFR, Condo, PUD, 2-4 Unit, Townhouse)",
          },
          occupancyTypes: {
            type: "array",
            items: { type: "string" },
            description: "Allowed occupancy types (e.g. Primary, Second Home, Investment)",
          },
        },
      },
      loanLimits: {
        type: "object",
        description: "Minimum and maximum loan amounts",
        properties: {
          minLoanAmount: { type: "number", description: "Minimum loan amount in dollars" },
          maxLoanAmount: { type: "number", description: "Maximum loan amount in dollars" },
        },
      },
      seasoning: {
        type: "object",
        description: "Derogatory event seasoning requirements in months",
        properties: {
          bankruptcyMonths: { type: "number", description: "Months since bankruptcy discharge" },
          foreclosureMonths: { type: "number", description: "Months since foreclosure" },
          shortSaleMonths: { type: "number", description: "Months since short sale" },
          deedInLieuMonths: { type: "number", description: "Months since deed-in-lieu" },
        },
      },
      prepayment: {
        type: "object",
        description: "Prepayment penalty terms",
        properties: {
          hasPrepayPenalty: { type: "boolean", description: "Whether a prepayment penalty applies" },
          maxPrepayYears: { type: "number", description: "Maximum prepayment penalty period in years" },
          maxPrepayPct: { type: "number", description: "Maximum prepayment penalty percentage" },
        },
      },
      fieldConfidence: {
        type: "object",
        description: "Per-field confidence scores (0-1). Keys should be dot-path field names like 'credit.minFico', 'ltv.maxLtv', 'seasoning.bankruptcyMonths'",
        additionalProperties: { type: "number" },
      },
    },
    required: ["credit", "income", "ltv", "reserves", "documents", "fieldConfidence"],
  },
};

// ── System Prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  "You are an expert mortgage underwriting guideline analyst.",
  "Your job is to extract structured guideline rules from lender product guideline documents.",
  "",
  "## Extraction Rules",
  "- Extract all numeric thresholds, requirements, and conditions you can identify",
  "- Do NOT fabricate values — only extract what is present in the document",
  "- Provide a fieldConfidence score (0.0 to 1.0) for EVERY field you extract",
  "  - Clearly stated in the document: >= 0.9",
  "  - Inferred from context: 0.5-0.8",
  "  - Guessed or uncertain: < 0.5",
  "",
  "## Field Formats",
  "- FICO scores: integer values 300-850",
  "- LTV/CLTV/HCLTV: percentages 0-100 (e.g. 80 for 80%)",
  "- DTI ratios: percentages 0-100 (e.g. 43 for 43%)",
  "- Expense factors: decimals 0-1 (e.g. 0.5 for 50%)",
  "- DSCR ratio: decimal (e.g. 1.25)",
  "- Loan amounts: whole dollar amounts (e.g. 100000 for $100,000)",
  "- Seasoning: months as integers (e.g. 48 for 4 years)",
  "- Points and fees: percentage of loan amount (e.g. 5.0 for 5%)",
  "",
  "## Section-Specific Instructions",
  "",
  "### Credit",
  "Extract min/max FICO, late payment limits (30/60/90 day), tradeline requirements,",
  "seasoning for housing events/bankruptcy/foreclosure, open collection limits, and dispute policy.",
  "",
  "### Income",
  "Use standard method identifiers: BankStatementDeposits, DSCRCoverage, AssetDepletionMonths,",
  "1099Gross, PnLCPACertified, TraditionalDocs.",
  "Extract front-end and back-end DTI limits, expense factors by category, DSCR ratio requirements,",
  "bank statement months, NSF limits, and CPA letter requirements.",
  "",
  "### LTV",
  "Extract max LTV, CLTV, HCLTV, and cash-out LTV limits.",
  "If the document contains an LTV/FICO matrix (common in rate sheets), extract each tier as an",
  "entry in the matrix array with minFico, maxFico, maxLtv, and occupancy type.",
  "",
  "### Reserves",
  "Extract minimum months of reserves overall and for investment properties.",
  "If reserves vary by LTV tier, extract each tier in the byLtvTier array.",
  "",
  "### Documents",
  "List all required documents by type. Note any conditional document requirements.",
  "",
  "### Compliance",
  "Extract QM/ATR requirements, max points and fees, state restrictions (2-letter codes),",
  "and any geographic overlays (state-specific rules).",
  "",
  "### Property & Loan Limits",
  "Extract allowed property types (SFR, Condo, PUD, 2-4 Unit, Townhouse),",
  "allowed occupancy types (Primary, Second Home, Investment),",
  "and min/max loan amounts.",
  "",
  "### Seasoning",
  "Extract months since bankruptcy discharge, foreclosure, short sale, and deed-in-lieu.",
  "These may overlap with credit section fields — extract in both places for completeness.",
  "",
  "### Prepayment",
  "Extract whether a prepayment penalty applies, max penalty period in years, and max penalty percentage.",
  "",
  "### Tenant Context",
  "Extract any lender overlay notes, special instructions, or risk tolerance indications.",
].join("\n");

// ── Processor Implementation ────────────────────────────────────────

class ClaudeVisionProcessor implements DocumentProcessor {
  name = "claude-vision";
  supportedFormats = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

  async process(input: ProcessorInput): Promise<ProcessorOutput> {
    try {
      // NPI pre-check: if we have text content in metadata, scan it
      if (input.metadata?.textContent) {
        const npiResult = detectNpi(String(input.metadata.textContent));
        if (npiResult.detected) {
          console.warn(
            `[claude-vision] NPI detected in ${input.fileName}: ${npiResult.matchCount} matches (${npiResult.types.join(", ")})`,
          );
          // Continue processing but log the warning — do not send raw text with NPI
        }
      }

      // Get base64 data from metadata (passed directly) or by fetching URL
      let base64: string;
      if (input.metadata?.base64 && typeof input.metadata.base64 === "string") {
        base64 = input.metadata.base64;
      } else if (input.fileUrl && !input.fileUrl.startsWith("data:")) {
        const fileResponse = await fetch(input.fileUrl);
        if (!fileResponse.ok) {
          return { success: false, error: `Failed to fetch document: ${fileResponse.status}` };
        }
        const buffer = await fileResponse.arrayBuffer();
        base64 = Buffer.from(buffer).toString("base64");
      } else {
        return { success: false, error: "No document data provided" };
      }

      // Use raw fetch to Anthropic API to avoid SDK encoding issues
      const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
      if (!apiKey) {
        return { success: false, error: "ANTHROPIC_API_KEY not set" };
      }

      const isPdf = input.mimeType === "application/pdf";
      const contentBlocks: unknown[] = [];

      if (isPdf) {
        contentBlocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64 },
        });
      } else {
        const mediaType = this.resolveMediaType(input.mimeType);
        if (!mediaType) {
          return { success: false, error: `Unsupported media type: ${input.mimeType}` };
        }
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: base64 },
        });
      }

      contentBlocks.push({
        type: "text",
        text: `Extract the underwriting guideline rules from this ${input.category} document for the ${input.program ?? "general"} program. File: ${input.fileName}`,
      });

      const requestBody = {
        model: VISION_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [EXTRACT_GUIDELINES_TOOL],
        tool_choice: { type: "tool", name: "extract_guideline_rules" },
        messages: [{ role: "user", content: contentBlocks }],
      };

      // Use node:https to avoid undici/fetch ByteString encoding issues
      const response = await new Promise<{
        content: Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }>;
        usage?: { input_tokens: number; output_tokens: number };
      }>((resolve, reject) => {
        const bodyStr = JSON.stringify(requestBody);
        const bodyBuf = Buffer.from(bodyStr, "utf-8");

        const req = https.request({
          hostname: "api.anthropic.com",
          path: "/v1/messages",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": bodyBuf.length,
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "pdfs-2024-09-25",
          },
        }, (res: { statusCode: number; on: Function }) => {
          let data = "";
          res.on("data", (chunk: string) => { data += chunk; });
          res.on("end", () => {
            if ((res.statusCode as number) >= 400) {
              reject(new Error(`Anthropic API ${res.statusCode}: ${data.slice(0, 300)}`));
            } else {
              try { resolve(JSON.parse(data)); }
              catch { reject(new Error(`Invalid JSON from Anthropic: ${data.slice(0, 200)}`)); }
            }
          });
        });

        req.on("error", (e: Error) => reject(e));
        req.write(bodyBuf);
        req.end();
      });

      // Extract tool use block from raw response
      const toolBlock = response.content.find((b) => b.type === "tool_use");
      if (!toolBlock || !toolBlock.input) {
        return {
          success: false,
          error: "No tool_use block in LLM response",
        };
      }

      const extracted = toolBlock.input as Record<string, unknown>;

      // Separate fieldConfidence from the rules
      const fieldConfidence = (extracted.fieldConfidence ?? {}) as Record<string, number>;
      const { fieldConfidence: _fc, ...rulesData } = extracted;

      // Compute overall confidence as average of per-field scores
      const confidenceValues = Object.values(fieldConfidence);
      const overallConfidence =
        confidenceValues.length > 0
          ? confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length
          : 0;

      // Token usage and cost
      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      const cost = estimateCost(inputTokens, outputTokens);

      return {
        success: true,
        extractedRules: rulesData as Partial<GuidelineRules>,
        perFieldConfidence: fieldConfidence,
        overallConfidence,
        tokensUsed: { input: inputTokens, output: outputTokens },
        cost,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[claude-vision] Processing error for ${input.fileName}:`, msg);
      return {
        success: false,
        error: `Claude Vision processing failed: ${msg}`,
      };
    }
  }

  private resolveMediaType(
    mimeType: string,
  ): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | undefined {
    const map: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
      "image/jpeg": "image/jpeg",
      "image/jpg": "image/jpeg",
      "image/png": "image/png",
      "image/gif": "image/gif",
      "image/webp": "image/webp",
      "application/pdf": "image/png", // PDF pages rendered as images
    };
    return map[mimeType];
  }
}

// ── Register at import time ─────────────────────────────────────────
registerProcessor(new ClaudeVisionProcessor());

export { ClaudeVisionProcessor };
