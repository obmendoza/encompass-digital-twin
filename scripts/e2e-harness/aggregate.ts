// scripts/e2e-harness/aggregate.ts
// Writes matrix.json + per-cell JSON files. Skeleton — full Markdown rendering lands in Task 14.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CellResult, RunReport } from "./types.js";

export async function aggregate(report: RunReport, outDir: string): Promise<void> {
  // 1. matrix.json
  writeFileSync(join(outDir, "matrix.json"), JSON.stringify(report, null, 2));

  // 2. per-cell JSON files at cells/<workflow>/<fixture>.json
  for (const cell of report.cells) {
    if (cell.status === "skip") continue;
    const cellPath = join(outDir, "cells", cell.workflow, `${cell.fixture}.json`);
    mkdirSync(dirname(cellPath), { recursive: true });
    writeFileSync(cellPath, JSON.stringify(cell, null, 2));
  }

  // 3. summary.md (minimal — Task 14 will enrich)
  const summary = renderSummary(report);
  writeFileSync(join(outDir, "summary.md"), summary);

  // 4. punch-list.md (minimal — Task 14 will enrich)
  const punch = renderPunchList(report.cells);
  writeFileSync(join(outDir, "punch-list.md"), punch);
}

function renderSummary(r: RunReport): string {
  return [
    `# E2E Run ${r.startedAt}`,
    ``,
    `- runId: ${r.harnessRunId}`,
    `- Started: ${r.startedAt}`,
    `- Finished: ${r.finishedAt}`,
    `- Duration: ${(r.durationMs / 1000).toFixed(1)}s`,
    `- Passes: ${r.passes}`,
    `- Total matrix cells: ${r.totalCells} (executed: ${r.executed}, partial-skip: ${r.partialSkipped}, full-skip: ${r.fullSkipped})`,
    `- Total assertions run: ${r.totalAssertionsRun}`,
    `- Passed: ${r.passed}`,
    `- Failed: ${r.failed} (P0: ${r.bySeverity.P0}, P1: ${r.bySeverity.P1}, P2: ${r.bySeverity.P2})`,
    `- Flake cells: ${r.flakeCells.length}`,
    `- Total LLM cost: $${r.totalLlmCostUsd.toFixed(2)}`,
    r.aborted ? `- **ABORTED**: ${r.abortReason ?? "unknown"}` : ``,
    ``,
  ].filter(Boolean).join("\n");
}

function renderPunchList(cells: CellResult[]): string {
  const fails = cells.filter((c) => c.status === "fail");
  const order: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
  fails.sort((a, b) => (order[a.severity ?? "P2"] - order[b.severity ?? "P2"]));
  if (fails.length === 0) return "# Punch List\n\nNo failures.\n";
  const lines: string[] = ["# Punch List", ""];
  for (const c of fails) {
    lines.push(`## [${c.severity}] ${c.workflow} / ${c.fixture}`);
    lines.push("");
    if (c.error) lines.push(`Error: \`${c.error.code}\` — ${c.error.message}`);
    for (const a of c.assertions.filter((x) => !x.ok)) {
      lines.push(`- ${a.name}: expected \`${JSON.stringify(a.expected)}\`, got \`${JSON.stringify(a.actual)}\``);
    }
    lines.push("");
    lines.push(`Repro: \`pnpm tsx scripts/e2e-harness/run.ts --workflow ${c.workflow} --fixture ${c.fixture}\``);
    lines.push("");
  }
  return lines.join("\n");
}
