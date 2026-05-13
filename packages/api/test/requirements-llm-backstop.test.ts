import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Anthropic SDK before importing the backstop module.
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class Anthropic {
    messages = { create: mockCreate };
    constructor() {}
  },
}));

// Mock the redactor + compliance-checker.
vi.mock("../src/learning/pii-redactor.js", () => ({
  redactSamples: (s: unknown[]) => ({ redacted: s, manifests: [] }),
}));
vi.mock("../src/learning/compliance-checker.js", () => ({
  runComplianceChecks: () => ({ ok: true, blockers: [] }),
  determineVisibility: () => "tenant",
}));

import { requirementsLlmBackstop } from "../src/services/predict-conditions/llm/requirements-backstop.js";
import type { RequirementRow } from "../src/services/predict-conditions/resolvers/requirements-resolver.js";
import type { LoanContext } from "../src/services/doc-requirements.js";

function toolUseResponse(findings: unknown[]) {
  return {
    content: [{ type: "tool_use", name: "emit_predictions", input: { findings } }],
    usage: { input_tokens: 100, output_tokens: 50 },
    model: "claude-haiku-4-5",
  };
}

const baseLoan: LoanContext = {
  incomeDocType: "Full Doc", borrowerType: "W2", citizenship: "US Citizen",
  isItin: false, llcOrLegalEntity: false, occupancy: "primary",
  state: "CA", county: "", usCredit: true, program: "Flex Select",
  repFico: 720, ltv: 75, loanAmount: 500000, loanPurpose: "Purchase",
};

const bucketRow: RequirementRow = {
  id: "00000000-0000-0000-0000-0000000000aa",
  requirement_key: "Future Rule",
  requirement_value: "Borrower must provide CPA-signed P&L statement when self-employed",
};

describe("requirementsLlmBackstop — post-call validation pipeline (spec §5.3 Stage B)", () => {
  beforeEach(() => mockCreate.mockReset());

  it("returns empty findings when ANTHROPIC_API_KEY is absent", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toEqual([]);
    expect(out.skipReason).toBe("no_api_key");
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
  });

  it("returns empty findings when the unhandled bucket is empty", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toEqual([]);
    expect(out.skipReason).toBe("empty_bucket");
  });

  it("step 1 — schema: drops findings missing required fields", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(toolUseResponse([
      { description: "x", source_rule_id: bucketRow.id, category: "PTA", rationale: "y" },  // missing confidence
    ]));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toEqual([]);
    expect(out.dropCounters.schema).toBe(1);
  });

  it("step 2 — source-rule existence: drops findings with hallucinated UUIDs", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(toolUseResponse([
      { description: "CPA-signed P&L statement required", source_rule_id: "00000000-0000-0000-0000-deadbeefdead", category: "PTA", rationale: "borrower self-employed; rule requires CPA-signed P&L", confidence: 0.9 },
    ]));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toEqual([]);
    expect(out.dropCounters.hallucinatedId).toBe(1);
  });

  it("step 3 — confidence floor: drops findings below 0.7", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(toolUseResponse([
      { description: "CPA-signed P&L statement required", source_rule_id: bucketRow.id, category: "PTA", rationale: "y", confidence: 0.5 },
    ]));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toEqual([]);
    expect(out.dropCounters.belowConfidence).toBe(1);
  });

  it("step 4 — source-text grounding: drops findings whose content words don't appear in source rule's key+value", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(toolUseResponse([
      // Description has no overlap with the rule's "CPA-signed P&L statement" content.
      { description: "Need flood insurance certificate", source_rule_id: bucketRow.id, category: "PTA", rationale: "y", confidence: 0.9 },
    ]));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toEqual([]);
    expect(out.dropCounters.ungrounded).toBe(1);
  });

  it("step 5 — output cap: truncates to MAX_LLM_FINDINGS_PER_RUN with deterministic ordering", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    // 15 valid findings — all pass steps 1-4. Cap should be 10.
    const findings = Array.from({ length: 15 }, (_, i) => ({
      description: `CPA-signed P&L statement variant ${i}`,
      source_rule_id: bucketRow.id, category: "PTA" as const, rationale: "y", confidence: 0.9,
    }));
    mockCreate.mockResolvedValue(toolUseResponse(findings));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toHaveLength(10);
    expect(out.dropCounters.outputCap).toBe(5);
  });

  it("full chain: a single valid finding survives all 5 steps", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(toolUseResponse([
      { description: "CPA-signed P&L statement required for self-employed borrower",
        source_rule_id: bucketRow.id, category: "PTA",
        rationale: "rule requires CPA-signed P&L for self-employed borrowers", confidence: 0.9 },
    ]));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: [bucketRow],
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.emissionKind).toBe("llm");
    expect(out.findings[0]!.note).toContain("AI-suggested:");
    expect(out.findings[0]!.note).toContain("CPA-signed P&L");
    expect(out.dropCounters.schema).toBe(0);
  });

  it("truncates bucket to MAX_BACKSTOP_BUCKET when over the cap", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    mockCreate.mockResolvedValue(toolUseResponse([]));
    const bigBucket = Array.from({ length: 30 }, (_, i): RequirementRow => ({
      id: `00000000-0000-0000-0000-${(i + 1).toString().padStart(12, "0")}`,
      requirement_key: `Rule ${i.toString().padStart(2, "0")}`,
      requirement_value: `content for rule ${i}`,
    }));
    const out = await requirementsLlmBackstop({
      loan: baseLoan, unhandledRequirements: bigBucket,
      activeDocChecklist: [], alreadyEmitted: [],
    });
    expect(out.backstopTruncated).toBe(10);  // 30 - 20 cap
  });
});
