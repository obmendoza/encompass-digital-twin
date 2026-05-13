import Anthropic from "@anthropic-ai/sdk";
import { redactText } from "../../../learning/pii-redactor.js";
import type { LoanContext } from "../../doc-requirements.js";
import type { Finding } from "../pre-underwriter.js";
import type { RequirementRow } from "../resolvers/requirements-resolver.js";

const MAX_LLM_FINDINGS_PER_RUN = 10;
const MAX_BACKSTOP_BUCKET = 20;
const LLM_CONFIDENCE_FLOOR = 0.7;
const MODEL_DEFAULT = "claude-haiku-4-5";

export interface BackstopInput {
  loan: LoanContext;
  unhandledRequirements: readonly RequirementRow[];
  activeDocChecklist: readonly Finding[];
  alreadyEmitted: readonly Finding[];
}

export interface BackstopResult {
  findings: Finding[];
  /** Why the backstop produced no findings (only set when findings is empty for a non-emission reason). */
  skipReason?: "no_api_key" | "empty_bucket" | "compliance_blocker" | "llm_error";
  /** Per-step drop counters for audit metadata. */
  dropCounters: {
    schema: number;
    hallucinatedId: number;
    belowConfidence: number;
    ungrounded: number;
    outputCap: number;
  };
  /** Number of rows truncated from the bucket when it exceeded MAX_BACKSTOP_BUCKET. */
  backstopTruncated: number;
  /** Optional cost metadata. */
  cost?: { input_tokens: number; output_tokens: number; model: string };
  /** Whether PII redaction was applied to the loan payload before sending to the LLM. */
  redactionApplied: boolean;
  /** PII types detected and redacted (empty when redactionApplied is false). */
  redactionTypes: string[];
}

interface RawLlmFinding {
  description?: unknown;
  category?: unknown;
  source_rule_id?: unknown;
  rationale?: unknown;
  confidence?: unknown;
}

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "at", "by",
  "with", "from", "as", "is", "are", "was", "were", "be", "been", "being",
  "this", "that", "these", "those", "it", "its", "if", "than", "then",
]);

function contentWordsOf(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOPWORDS.has(w))
    .map(w => w.replace(/(ing|ed|s)$/, ""));
}

function isGrounded(description: string, rule: RequirementRow): boolean {
  const haystackText = `${rule.requirement_key} ${typeof rule.requirement_value === "string" ? rule.requirement_value : JSON.stringify(rule.requirement_value)}`;
  const haystackWords = new Set(contentWordsOf(haystackText));
  const descWords = contentWordsOf(description);
  if (descWords.length === 0) return false;
  const hits = descWords.filter(w => haystackWords.has(w)).length;
  return hits / descWords.length >= 0.5;
}

const TOOL_SCHEMA = {
  name: "emit_predictions",
  description: "Emit predicted conditions for the loan based on the program rules provided.",
  input_schema: {
    type: "object",
    required: ["findings"],
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          required: ["description", "category", "source_rule_id", "rationale", "confidence"],
          properties: {
            description: { type: "string", minLength: 8, maxLength: 240 },
            category: { type: "string", enum: ["PTA", "PTD", "PTF", "PTP"] },
            source_rule_id: { type: "string", pattern: "^[0-9a-f-]{36}$" },
            rationale: { type: "string", maxLength: 480 },
            confidence: {
              type: "number", minimum: 0, maximum: 1,
              description: "Probability that this finding is correct and actionable. Prefer emitting fewer high-confidence findings than many low-confidence ones.",
            },
          },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are a pre-underwriter for a non-QM lender. Given the loan profile and the
program requirement rules below, list any additional documents an underwriter
would require beyond what is already known. Be conservative — emit a prediction
ONLY when the requirement clearly implies a document the loan does not yet
satisfy. Prefer emitting fewer high-confidence findings than many low-confidence
ones. Respond via the emit_predictions tool.`;

function validateRawFinding(raw: RawLlmFinding): { ok: true; finding: Required<RawLlmFinding> } | { ok: false } {
  if (typeof raw.description !== "string" || raw.description.length < 8 || raw.description.length > 240) return { ok: false };
  if (raw.category !== "PTA" && raw.category !== "PTD" && raw.category !== "PTF" && raw.category !== "PTP") return { ok: false };
  if (typeof raw.source_rule_id !== "string" || !/^[0-9a-f-]{36}$/.test(raw.source_rule_id)) return { ok: false };
  if (typeof raw.rationale !== "string" || raw.rationale.length > 480) return { ok: false };
  if (typeof raw.confidence !== "number" || raw.confidence < 0 || raw.confidence > 1) return { ok: false };
  return { ok: true, finding: raw as Required<RawLlmFinding> };
}

export async function requirementsLlmBackstop(input: BackstopInput): Promise<BackstopResult> {
  const dropCounters = { schema: 0, hallucinatedId: 0, belowConfidence: 0, ungrounded: 0, outputCap: 0 };

  if (!process.env.ANTHROPIC_API_KEY) {
    return { findings: [], skipReason: "no_api_key", dropCounters, backstopTruncated: 0, redactionApplied: false, redactionTypes: [] };
  }
  if (input.unhandledRequirements.length === 0) {
    return { findings: [], skipReason: "empty_bucket", dropCounters, backstopTruncated: 0, redactionApplied: false, redactionTypes: [] };
  }

  // Bucket truncation (spec §5.3 MAX_BACKSTOP_BUCKET).
  const sortedBucket = [...input.unhandledRequirements].sort((a, b) =>
    a.requirement_key.localeCompare(b.requirement_key) || a.id.localeCompare(b.id),
  );
  const bucket = sortedBucket.slice(0, MAX_BACKSTOP_BUCKET);
  const backstopTruncated = sortedBucket.length - bucket.length;
  if (backstopTruncated > 0) {
    for (const dropped of sortedBucket.slice(MAX_BACKSTOP_BUCKET)) {
      console.warn("[requirements-backstop] bucket-truncated row", { ruleId: dropped.id, ruleKey: dropped.requirement_key });
    }
  }

  // Redact the loan payload before sending to the LLM (spec §310, §328).
  const loanJson = JSON.stringify(input.loan);
  const { redacted: redactedLoan, types: redactionTypes } = redactText(loanJson);

  // Construct the dynamic prompt suffix.
  const userMessage = [
    `LOAN (redacted): ${redactedLoan}`,
    "",
    "PROGRAM RULES (unhandled by deterministic resolver):",
    ...bucket.map(r => `- rule_id: ${r.id}; key: "${r.requirement_key}"; value: ${typeof r.requirement_value === "string" ? JSON.stringify(r.requirement_value) : JSON.stringify(r.requirement_value)}`),
    "",
    "DOCS ALREADY KNOWN TO BE REQUIRED:",
    ...input.activeDocChecklist.map(f => `- "${f.description}" (from doc-checklist)`),
    ...input.alreadyEmitted.map(f => `- "${f.description}" (from ${f.sourceList})`),
  ].join("\n");

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { "anthropic-ddr": "true" },
  });
  let resp;
  try {
    resp = await client.messages.create({
      model: MODEL_DEFAULT,
      max_tokens: 2048,
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools: [TOOL_SCHEMA as never],
      tool_choice: { type: "tool", name: "emit_predictions" },
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    console.warn("[requirements-backstop] llm call failed", { err: err instanceof Error ? err.message : String(err) });
    return { findings: [], skipReason: "llm_error", dropCounters, backstopTruncated, redactionApplied: redactionTypes.length > 0, redactionTypes };
  }

  // Extract tool_use block.
  type AnthropicContentBlock = { type: string; name?: string; input?: { findings?: RawLlmFinding[] } };
  const toolUse = (resp.content as AnthropicContentBlock[]).find((b) => b.type === "tool_use" && b.name === "emit_predictions");
  if (!toolUse) {
    return { findings: [], skipReason: "llm_error", dropCounters, backstopTruncated, redactionApplied: redactionTypes.length > 0, redactionTypes };
  }
  const rawFindings: RawLlmFinding[] = Array.isArray(toolUse.input?.findings) ? toolUse.input!.findings! : [];

  // Step 1 — schema validation.
  const schemaPass: Required<RawLlmFinding>[] = [];
  for (const r of rawFindings) {
    const v = validateRawFinding(r);
    if (!v.ok) { dropCounters.schema++; console.warn("[requirements-backstop] schema drop", { raw: r }); continue; }
    schemaPass.push(v.finding);
  }

  // Step 2 — source-rule existence.
  const bucketIds = new Set(bucket.map(r => r.id));
  const existencePass = schemaPass.filter(f => {
    if (!bucketIds.has(f.source_rule_id as string)) {
      dropCounters.hallucinatedId++;
      console.warn("[requirements-backstop] hallucinated source_rule_id drop", { id: f.source_rule_id });
      return false;
    }
    return true;
  });

  // Step 3 — confidence floor.
  const confidencePass = existencePass.filter(f => {
    if ((f.confidence as number) < LLM_CONFIDENCE_FLOOR) {
      dropCounters.belowConfidence++;
      console.warn("[requirements-backstop] below-confidence drop", { id: f.source_rule_id, confidence: f.confidence });
      return false;
    }
    return true;
  });

  // Step 4 — source-text grounding.
  const bucketById = new Map(bucket.map(r => [r.id, r]));
  const groundedPass = confidencePass.filter(f => {
    const rule = bucketById.get(f.source_rule_id as string)!;
    if (!isGrounded(f.description as string, rule)) {
      dropCounters.ungrounded++;
      console.warn("[requirements-backstop] ungrounded drop", { id: f.source_rule_id, description: f.description });
      return false;
    }
    return true;
  });

  // Step 5 — output cap. Stable sort then truncate.
  groundedPass.sort((a, b) => (a.source_rule_id as string).localeCompare(b.source_rule_id as string) || (a.description as string).localeCompare(b.description as string));
  const dropped = Math.max(0, groundedPass.length - MAX_LLM_FINDINGS_PER_RUN);
  if (dropped > 0) {
    dropCounters.outputCap = dropped;
    for (const f of groundedPass.slice(MAX_LLM_FINDINGS_PER_RUN)) {
      console.warn("[requirements-backstop] output-cap drop", { id: f.source_rule_id });
    }
  }
  const capped = groundedPass.slice(0, MAX_LLM_FINDINGS_PER_RUN);

  const findings: Finding[] = capped.map(f => ({
    description: f.description as string,
    note: `AI-suggested: ${f.rationale}`,
    category: f.category as Finding["category"],
    sourceList: "requirements",
    sourceRuleTable: "program_requirements",
    sourceRuleId: f.source_rule_id as string,
    emissionKind: "llm",
  }));

  return {
    findings,
    dropCounters,
    backstopTruncated,
    cost: {
      input_tokens: resp.usage?.input_tokens ?? 0,
      output_tokens: resp.usage?.output_tokens ?? 0,
      model: resp.model ?? MODEL_DEFAULT,
    },
    redactionApplied: redactionTypes.length > 0,
    redactionTypes,
  };
}
