// ── Manual Entry Processor — Pass-through for human-entered rules ────────

import type { ProcessorInput, ProcessorOutput } from "@twin/core";
import type { GuidelineRules } from "@twin/core";
import { registerProcessor } from "./document-processor.js";
import type { DocumentProcessor } from "./document-processor.js";

class ManualEntryProcessor implements DocumentProcessor {
  name = "manual-entry";
  supportedFormats = ["application/json"];

  async process(input: ProcessorInput): Promise<ProcessorOutput> {
    try {
      const rules = input.metadata?.rules as Partial<GuidelineRules> | undefined;

      if (!rules) {
        return {
          success: false,
          error: "No rules provided in input.metadata.rules",
        };
      }

      // Build per-field confidence (all 1.0 since manually entered)
      const perFieldConfidence: Record<string, number> = {};
      if (rules.credit) {
        for (const key of Object.keys(rules.credit)) {
          perFieldConfidence[`credit.${key}`] = 1.0;
        }
      }
      if (rules.income) {
        for (const key of Object.keys(rules.income)) {
          perFieldConfidence[`income.${key}`] = 1.0;
        }
      }
      if (rules.ltv) {
        for (const key of Object.keys(rules.ltv)) {
          perFieldConfidence[`ltv.${key}`] = 1.0;
        }
      }
      if (rules.reserves) {
        for (const key of Object.keys(rules.reserves)) {
          perFieldConfidence[`reserves.${key}`] = 1.0;
        }
      }
      if (rules.documents) {
        perFieldConfidence["documents.required"] = 1.0;
      }
      if (rules.conditions) {
        perFieldConfidence["conditions"] = 1.0;
      }
      if (rules.compliance) {
        for (const key of Object.keys(rules.compliance)) {
          perFieldConfidence[`compliance.${key}`] = 1.0;
        }
      }

      return {
        success: true,
        extractedRules: rules,
        perFieldConfidence,
        overallConfidence: 1.0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `Manual entry processing failed: ${msg}`,
      };
    }
  }
}

// ── Register at import time ─────────────────────────────────────────
registerProcessor(new ManualEntryProcessor());

export { ManualEntryProcessor };
