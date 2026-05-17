// Prometheus metric helpers — emits structured JSON log lines that the existing
// log-shipper / Grafana pipeline can parse into metrics (same pattern used by
// PC v2 §4.4 dropped_* counters which also log-shipper-derive). When a real
// prom-client integration lands suite-wide, swap the console.log calls for
// gauge.set() / counter.inc() without changing the call sites.

import type Anthropic from "@anthropic-ai/sdk";

// Cost constants — Sonnet 3.5/3.7 pricing as of 2025 ($3 input, $15 output per 1M tokens).
const INPUT_RATE = 3.0 / 1_000_000;   // $/token
const OUTPUT_RATE = 15.0 / 1_000_000; // $/token

export function trackExtractionCost(
  tenantId: string,
  extractorKind: string,
  docType: string,
  usage: Anthropic.Messages.Usage,
): void {
  const dollars =
    (usage.input_tokens ?? 0) * INPUT_RATE +
    (usage.output_tokens ?? 0) * OUTPUT_RATE;
  console.log(
    JSON.stringify({
      metric: "hoi_extraction_cost_dollars",
      tenant_id: tenantId,
      extractor_kind: extractorKind,
      doc_type: docType,
      value: dollars,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
    }),
  );
}

export function trackExtractionOutcome(
  tenantId: string,
  extractorKind: string,
  outcome: "success" | "malformed" | "rate_limited" | "dead_lettered",
): void {
  console.log(
    JSON.stringify({
      metric: "hoi_extraction_calls_total",
      tenant_id: tenantId,
      extractor_kind: extractorKind,
      outcome,
    }),
  );
}
