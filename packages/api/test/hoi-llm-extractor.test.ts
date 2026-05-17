import { describe, test, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { LlmHoiExtractor } from "../src/services/validators/hoi/llm-extractor.js";

// ---------------------------------------------------------------------------
// Mock Anthropic client — no real HTTP calls
// ---------------------------------------------------------------------------
class MockAnthropic {
  responses: Anthropic.Messages.Message[] = [];
  messages = {
    create: async (..._args: unknown[]) =>
      this.responses.shift() ?? ({ content: [] } as never),
  };
}

// ---------------------------------------------------------------------------
// Helpers to build stub Message objects
// ---------------------------------------------------------------------------
function makeToolUseMessage(name: string, input: unknown): Anthropic.Messages.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "tu_test", name, input } as never],
    model: "claude-sonnet-4-6",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Messages.Message;
}

function makeTextOnlyMessage(): Anthropic.Messages.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "I cannot extract fields from this document." }],
    model: "claude-sonnet-4-6",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 50, output_tokens: 20 },
  } as unknown as Anthropic.Messages.Message;
}

// ---------------------------------------------------------------------------
// Minimal valid HOI policy fields payload
// ---------------------------------------------------------------------------
const VALID_HOI_FIELDS = {
  carrier: "State Farm",
  policyNumber: "HO-12345",
  namedInsured: "John Doe",
  propertyAddress: { line1: "123 Main St", line2: null, city: "Austin", state: "TX", zip: "78701" },
  effectiveDate: "2025-01-01",
  expirationDate: "2026-01-01",
  termMonths: 12,
  lossPayeeClause: "Lender Name ISAOA",
  loanNumberOnPolicy: "LN-99999",
  coverageAmount: 400000,
  replacementCost: 420000,
  deductiblePct: null,
  deductibleAmount: 5000,
  windHailHurricane: { included: true, wording: "Wind and Hail included", separatePolicy: false, confidence: 0.9 },
  rentLossCoverageMonths: null,
  rentLossWording: null,
  rentLossActualCostSustained: null,
  occupancyOnPolicy: "Primary",
  premiumPaidInFull: { paid: true, confidence: 0.85 },
  premiumDueDays: null,
  wallsInCoverage: { included: true, confidence: 0.8 },
  ho6Policy: null,
  evidence: [{ fieldPath: "carrier", documentPage: 1, bbox: null }],
};

// ---------------------------------------------------------------------------
// Minimal valid Flood cert fields payload
// ---------------------------------------------------------------------------
const VALID_FLOOD_FIELDS = {
  carrier: "NFIP",
  policyNumber: "FLD-00001",
  namedInsured: "Jane Smith",
  propertyAddress: { line1: "456 River Rd", line2: null, city: "Houston", state: "TX", zip: "77001" },
  effectiveDate: "2025-03-01",
  expirationDate: "2026-03-01",
  termMonths: 12,
  floodZone: "AE",
  floodCoverage: 250000,
  floodDeductible: 1000,
  isNfip: true,
  nfipMaxApplied: false,
  evidence: [{ fieldPath: "floodZone", documentPage: 1, bbox: null }],
};

const HOI_DOC = {
  tenantId: "00000000-0000-0000-0000-000000000000",
  loanId: "loan-1",
  documentId: "doc-hoi",
  category: "hoi-policy" as const,
  storageUrl: "https://example.com/hoi.pdf",
};

const FLOOD_DOC = {
  tenantId: "00000000-0000-0000-0000-000000000000",
  loanId: "loan-1",
  documentId: "doc-flood",
  category: "flood-cert" as const,
  storageUrl: "https://example.com/flood.pdf",
};

// ===========================================================================
// Tests
// ===========================================================================

describe("LlmHoiExtractor", () => {
  // -------------------------------------------------------------------------
  // 1. Valid HOI tool_use response
  // -------------------------------------------------------------------------
  test("valid HOI tool_use response returns populated HoiExtractionResult", async () => {
    const mock = new MockAnthropic();
    mock.responses.push(
      makeToolUseMessage("emit_hoi_policy_fields", VALID_HOI_FIELDS),
    );

    const extractor = new LlmHoiExtractor(mock as never);
    const result = await extractor.extract(HOI_DOC);

    expect(result.source).toBe("llm-extractor");
    expect(result.schemaVersion).toBe(1);
    expect(result.extractedBy).toContain("worker:hoi-extractor:v1");
    expect((result.fields as typeof VALID_HOI_FIELDS).carrier).toBe("State Farm");
    expect((result.fields as typeof VALID_HOI_FIELDS).policyNumber).toBe("HO-12345");
    // confidence should be a number (computed from prose-derived booleans)
    expect(typeof result.confidence).toBe("number");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.extractionError).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 2. Valid Flood tool_use response
  // -------------------------------------------------------------------------
  test("valid Flood tool_use response returns FloodCertFields-shaped result", async () => {
    const mock = new MockAnthropic();
    mock.responses.push(
      makeToolUseMessage("emit_flood_cert_fields", VALID_FLOOD_FIELDS),
    );

    const extractor = new LlmHoiExtractor(mock as never);
    const result = await extractor.extract(FLOOD_DOC);

    expect(result.source).toBe("llm-extractor");
    expect((result.fields as typeof VALID_FLOOD_FIELDS).floodZone).toBe("AE");
    expect((result.fields as typeof VALID_FLOOD_FIELDS).isNfip).toBe(true);
    expect(result.extractionError).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 3. No tool_use block → failed extraction
  // -------------------------------------------------------------------------
  test("no tool_use block returns failed extraction with extraction_error=no_tool_use_block", async () => {
    const mock = new MockAnthropic();
    mock.responses.push(makeTextOnlyMessage());

    const extractor = new LlmHoiExtractor(mock as never);
    const result = await extractor.extract(HOI_DOC);

    expect(result.source).toBe("llm-extractor");
    expect(result.confidence).toBe(0);
    expect(result.extractionError).toBe("no_tool_use_block");
  });

  // -------------------------------------------------------------------------
  // 4. Malformed tool_use (fails Zod) → failed extraction
  // -------------------------------------------------------------------------
  test("malformed tool_use input (Zod failure) returns zod_validation_failed error", async () => {
    const mock = new MockAnthropic();
    // Send a payload missing the required `evidence` field
    mock.responses.push(
      makeToolUseMessage("emit_hoi_policy_fields", {
        carrier: "Bad Corp",
        // evidence is missing — required by Zod schema
      }),
    );

    const extractor = new LlmHoiExtractor(mock as never);
    const result = await extractor.extract(HOI_DOC);

    expect(result.confidence).toBe(0);
    expect(result.extractionError).toMatch(/^zod_validation_failed/);
  });

  // -------------------------------------------------------------------------
  // 5. Aggregate confidence calculation
  // -------------------------------------------------------------------------
  test("aggregate confidence is average of prose-derived boolean confidences", async () => {
    const mock = new MockAnthropic();
    // windHailHurricane.confidence=0.8, rentLossActualCostSustained.confidence=0.9,
    // premiumPaidInFull.confidence=0.7, wallsInCoverage.confidence=0.6
    // Expected average = (0.8 + 0.9 + 0.7 + 0.6) / 4 = 0.75
    const fields = {
      ...VALID_HOI_FIELDS,
      windHailHurricane: { included: true, wording: null, separatePolicy: false, confidence: 0.8 },
      rentLossActualCostSustained: { detected: false, confidence: 0.9 },
      premiumPaidInFull: { paid: true, confidence: 0.7 },
      wallsInCoverage: { included: true, confidence: 0.6 },
    };
    mock.responses.push(makeToolUseMessage("emit_hoi_policy_fields", fields));

    const extractor = new LlmHoiExtractor(mock as never);
    const result = await extractor.extract(HOI_DOC);

    expect(result.confidence).toBeCloseTo(0.75, 5);
    expect(result.extractionError).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // canExtract
  // -------------------------------------------------------------------------
  test("canExtract returns true for hoi-policy", async () => {
    const extractor = new LlmHoiExtractor(new MockAnthropic() as never);
    expect(await extractor.canExtract(HOI_DOC)).toBe(true);
  });

  test("canExtract returns true for flood-cert", async () => {
    const extractor = new LlmHoiExtractor(new MockAnthropic() as never);
    expect(await extractor.canExtract(FLOOD_DOC)).toBe(true);
  });
});
