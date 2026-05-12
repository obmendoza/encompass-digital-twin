// Maps a DocItem to a ConditionCategory using a deterministic regex.
// Per spec §7.7: PTF for items finalized before disbursement (HOI,
// insurance, "Final" prefixes, recording instructions, wire instructions);
// PTD for everything else (the intake-docs default).
//
// The mapping table is plan-time-mutable: change the regex here when NPNQM
// adds a doc-category signal we don't already recognize. PTA/PTP are
// reserved for future engine rules that explicitly mark "prior to approval"
// or "prior to processing" — not used by the current doc-checklist.

import type { PredictedConditionCategory } from "./types.js";

const PTF_PATTERN = /insurance|hoi|recording|final|wire instructions/i;

export function categoryInference(docItem: { name: string }): PredictedConditionCategory {
  if (PTF_PATTERN.test(docItem.name)) return "PTF";
  return "PTD";
}
