// scripts/e2e-harness/fixtures.ts
// Loads the 20 NQM fixtures and classifies them for skip rules.

import { scenarios } from "@twin/fixtures";
import type { FixtureMeta } from "./types.js";

export function listFixtures(): FixtureMeta[] {
  const result: FixtureMeta[] = [];
  for (const [id, scenario] of Object.entries(scenarios)) {
    const loan = scenario.loan;
    result.push({
      id,
      loanId: loan.id,
      program: loan.nqmProgram ?? "Unknown",
      isEdge: id.startsWith("nqm-edge-"),
    });
  }
  return result.sort((a, b) => a.id.localeCompare(b.id));
}

// Default: every workflow runs against every fixture unless overridden.
export const APPLIES_TO_ALL = (_fixture: FixtureMeta) => true;

// W8 runs against 3 representative fixtures.
export const RLS_REPRESENTATIVES = new Set([
  "nqm-bankstmt-12mo-clean",
  "nqm-dscr-investor-purchase",
  "nqm-full-doc-recent-bk",
]);
export const APPLIES_TO_RLS = (fixture: FixtureMeta) => RLS_REPRESENTATIVES.has(fixture.id);

// W6 and W7 are global (one cell per matrix run).
// They use a sentinel fixture record; the main runner emits skip cells for the other 19.
export const GLOBAL_FIXTURE_SENTINEL: FixtureMeta = {
  id: "_global",
  loanId: "_global",
  program: "_global",
  isEdge: false,
};
