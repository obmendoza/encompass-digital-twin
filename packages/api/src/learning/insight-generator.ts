// ── LLM Insight Generator — Claude tool_use + prompt caching + budget tracking ──

import Anthropic from "@anthropic-ai/sdk";
import { withTenantTx } from "../db/pool.js";
import { isRedisEnabled, getRedisPub } from "../redis.js";
import { redactSamples } from "./pii-redactor.js";
import { runComplianceChecks, determineVisibility } from "./compliance-checker.js";
import type { LoanSample } from "./pii-redactor.js";
import type { SpecificChange } from "@twin/core";

// ── Budget Constants ─────────────────────────────────────────────
const TENANT_DAILY_LIMIT = 5;
const GLOBAL_DAILY_LIMIT = 40;

// ── Model Selection ──────────────────────────────────────────────

interface PatternMetrics {
  sampleCount?: number;
  confidenceVariance?: number;
}

function selectModel(metrics: PatternMetrics): string {
  const isSimple =
    (metrics.sampleCount ?? 0) > 50 &&
    (metrics.confidenceVariance ?? Infinity) < 0.1;
  return isSimple
    ? "claude-haiku-4-20250414"
    : "claude-sonnet-4-20250514";
}

// ── Budget Checking via Redis ────────────────────────────────────

async function checkAndIncrementBudget(
  tenantId: string,
): Promise<{ allowed: boolean; reason?: string }> {
  if (!isRedisEnabled()) {
    // If Redis is not available, allow but log warning
    console.warn("[insight] Redis unavailable — budget tracking disabled");
    return { allowed: true };
  }

  const redis = getRedisPub();
  const today = new Date().toISOString().slice(0, 10);
  const tenantKey = `insight:budget:${tenantId}:${today}`;
  const globalKey = `insight:budget:global:${today}`;

  // Atomically increment and check
  const tenantCount = await redis.hincrby(tenantKey, "calls", 1);
  if (tenantCount > TENANT_DAILY_LIMIT) {
    // Roll back
    await redis.hincrby(tenantKey, "calls", -1);
    return { allowed: false, reason: `Tenant daily limit reached (${TENANT_DAILY_LIMIT})` };
  }

  const globalCount = await redis.hincrby(globalKey, "calls", 1);
  if (globalCount > GLOBAL_DAILY_LIMIT) {
    // Roll back both
    await redis.hincrby(globalKey, "calls", -1);
    await redis.hincrby(tenantKey, "calls", -1);
    return { allowed: false, reason: `Global daily limit reached (${GLOBAL_DAILY_LIMIT})` };
  }

  // Set TTL on keys (25 hours to cover timezone edge cases)
  await redis.expire(tenantKey, 90_000);
  await redis.expire(globalKey, 90_000);

  return { allowed: true };
}

async function trackTokenUsage(
  tenantId: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  if (!isRedisEnabled()) return;

  const redis = getRedisPub();
  const today = new Date().toISOString().slice(0, 10);
  const tenantKey = `insight:budget:${tenantId}:${today}`;
  const globalKey = `insight:budget:global:${today}`;

  await Promise.all([
    redis.hincrby(tenantKey, "input_tokens", inputTokens),
    redis.hincrby(tenantKey, "output_tokens", outputTokens),
    redis.hincrby(globalKey, "input_tokens", inputTokens),
    redis.hincrby(globalKey, "output_tokens", outputTokens),
  ]);
}

// ── Tool Schema ──────────────────────────────────────────────────

const PROPOSE_TOOL: Anthropic.Tool = {
  name: "propose_guideline_change",
  description:
    "Propose a specific change to a mortgage underwriting guideline based on the detected override pattern.",
  input_schema: {
    type: "object" as const,
    properties: {
      suggestion_type: {
        type: "string",
        enum: ["guideline_update", "threshold_change", "new_condition", "documentation"],
        description: "The type of change being proposed",
      },
      root_cause: {
        type: "string",
        description: "Analysis of why this pattern is occurring",
      },
      specific_change: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["replace", "add", "remove"],
            description: "The RFC 6902 operation type",
          },
          path: {
            type: "string",
            description: "JSON Pointer path to the guideline field (e.g. /income/maxDtiBack)",
          },
          from: {
            description: "The expected current value at the path (for stale-view check)",
          },
          to: {
            description: "The proposed new value",
          },
          scope: {
            type: "string",
            description: "The loan program scope this change applies to",
          },
        },
        required: ["operation", "path", "to", "scope"],
      },
      confidence: {
        type: "number",
        description: "Confidence score 0.0 to 1.0",
      },
      risk_assessment: {
        type: "string",
        description: "Assessment of risks associated with this change",
      },
    },
    required: [
      "suggestion_type",
      "root_cause",
      "specific_change",
      "confidence",
      "risk_assessment",
    ],
  },
};

// ── Main Function ────────────────────────────────────────────────

export async function generateInsight(
  tenantId: string,
  patternId: string,
  patternSummary: string,
  guidelineJson: string,
  samples: LoanSample[],
): Promise<{ success: boolean; suggestionId?: string; error?: string }> {
  // 1. Budget check
  const budget = await checkAndIncrementBudget(tenantId);
  if (!budget.allowed) {
    return { success: false, error: budget.reason };
  }

  // 2. Redact samples
  const { redacted, manifests } = redactSamples(samples);

  // 3. Parse metrics from pattern summary for model selection
  let metrics: PatternMetrics = {};
  try {
    const parsed = JSON.parse(patternSummary);
    metrics = {
      sampleCount: parsed.metricsSnapshot?.sampleCount ?? parsed.sampleCount,
      confidenceVariance: parsed.metricsSnapshot?.confidenceVariance ?? parsed.confidenceVariance,
    };
  } catch {
    // patternSummary may be plain text — use defaults
  }

  const model = selectModel(metrics);

  // 4. Call Claude
  const client = new Anthropic();

  const systemBlocks: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: [
        "You are an expert mortgage underwriting analyst reviewing override patterns.",
        "Your job is to propose specific, safe guideline changes based on detected patterns.",
        "Rules:",
        "- Never propose changes that would violate fair lending laws",
        "- Never disable ATR (Ability to Repay) verification",
        "- Keep all thresholds within regulatory bounds",
        "- Prefer conservative adjustments (small increments)",
        "- Always include a risk assessment",
        "- The scope should match the loan program where the pattern was detected",
      ].join("\n"),
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: `Current guideline JSON:\n${guidelineJson}`,
      cache_control: { type: "ephemeral" },
    },
  ];

  const userMessage = [
    `Pattern detected: ${patternSummary}`,
    "",
    `Sample override decisions (redacted, ${redacted.length} of ${samples.length} after k-anonymity):`,
    JSON.stringify(redacted, null, 2),
    "",
    "Propose a specific guideline change to address this pattern.",
  ].join("\n");

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemBlocks,
      tools: [PROPOSE_TOOL],
      tool_choice: { type: "tool", name: "propose_guideline_change" },
      messages: [{ role: "user", content: userMessage }],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[insight] Claude API error for pattern ${patternId}:`, msg);
    return { success: false, error: `LLM call failed: ${msg}` };
  }

  // 5. Extract tool input
  const toolBlock = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolBlock) {
    return { success: false, error: "No tool_use block in LLM response" };
  }

  const input = toolBlock.input as {
    suggestion_type: string;
    root_cause: string;
    specific_change: SpecificChange;
    confidence: number;
    risk_assessment: string;
  };

  // 6. Track token usage
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  await trackTokenUsage(tenantId, inputTokens, outputTokens);

  // 7. Compliance validation
  const checks = runComplianceChecks(input.specific_change);
  const visibility = determineVisibility(checks);

  const hasBlock = checks.some((c) => c.result === "block");
  if (hasBlock) {
    console.warn(
      `[insight] Compliance block for pattern ${patternId}:`,
      checks.filter((c) => c.result === "block"),
    );
  }

  // 8. Write to DB
  const suggestionId = await withTenantTx(tenantId, async (client) => {
    // Insert suggestion
    const { rows } = await client.query(
      `INSERT INTO pattern_suggestions (
        tenant_id, pattern_id, suggestion_type, root_cause,
        specific_change, confidence, risk_assessment,
        generated_by, redaction_applied, redaction_version,
        redaction_manifest, model_used, input_tokens, output_tokens,
        visibility, status, expires_at, created_at
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7,
        $8, $9, $10,
        $11, $12, $13, $14,
        $15, 'pending', NOW() + INTERVAL '30 days', NOW()
      ) RETURNING id`,
      [
        tenantId,
        patternId,
        input.suggestion_type,
        input.root_cause,
        JSON.stringify(input.specific_change),
        input.confidence,
        input.risk_assessment,
        "system:insight-generator",
        manifests.length > 0,
        "1.0",
        JSON.stringify(manifests),
        model,
        inputTokens,
        outputTokens,
        visibility,
      ],
    );

    const newId = rows[0].id as string;

    // Insert compliance checks
    for (const check of checks) {
      await client.query(
        `INSERT INTO compliance_checks (
          suggestion_id, check_type, result, details, checked_at
        ) VALUES ($1, $2, $3, $4, NOW())`,
        [newId, check.checkType, check.result, JSON.stringify(check.details)],
      );
    }

    // Update pattern status
    const { rows: patternRows } = await client.query(
      `SELECT status_history FROM detected_patterns WHERE id = $1`,
      [patternId],
    );

    const statusHistory =
      (patternRows[0]?.status_history as Array<Record<string, unknown>>) ?? [];
    statusHistory.push({
      status: "suggestion_ready",
      at: new Date().toISOString(),
      by: "system:insight-generator",
      reason: `suggestion ${newId} generated via ${model}`,
    });

    await client.query(
      `UPDATE detected_patterns
       SET status = 'suggestion_ready',
           status_history = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(statusHistory), patternId],
    );

    return newId;
  });

  console.log(
    `[insight] Pattern ${patternId} → suggestion ${suggestionId} (${model}, ${inputTokens}+${outputTokens} tokens, visibility=${visibility})`,
  );

  return { success: true, suggestionId };
}
