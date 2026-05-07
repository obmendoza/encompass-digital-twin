// scripts/e2e-harness/aggregate.ts
// Writes matrix.json + per-cell + summary.md + punch-list.md + audit-validation.md (+ regression.md if previous run found).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { AUDIT_CLAIMS } from "./audit-claims.js";
import { CellResultSchema, RunReportSchema, type AssertionResult, type CellResult, type RunReport } from "./types.js";

export async function aggregate(report: RunReport, outDir: string): Promise<void> {
  // 1. matrix.json — Zod-validated round-trip
  const validated = RunReportSchema.parse(report);
  writeFileSync(join(outDir, "matrix.json"), JSON.stringify(validated, null, 2));

  // 2. per-cell JSON files for executed and partial-skip cells
  for (const cell of report.cells) {
    if (cell.status === "skip") continue;
    const cellPath = join(outDir, "cells", cell.workflow, `${cell.fixture}.json`);
    mkdirSync(dirname(cellPath), { recursive: true });
    writeFileSync(cellPath, JSON.stringify(CellResultSchema.parse(cell), null, 2));
  }

  // 3. Identify a prior run, if any (for regression diff).
  const prior = findPriorRun(outDir);

  // 4. Annotate cells with errorFingerprint + new/regression flags.
  const annotated = report.cells.map((c) => annotateCell(c, prior?.cells.find((p) => p.workflow === c.workflow && p.fixture === c.fixture)));

  // 5. summary.md
  writeFileSync(join(outDir, "summary.md"), renderSummary(report, annotated));

  // 6. punch-list.md
  writeFileSync(join(outDir, "punch-list.md"), renderPunchList(annotated));

  // 7. audit-validation.md
  writeFileSync(join(outDir, "audit-validation.md"), renderAuditValidation(report.cells));

  // 8. regression.md (only if prior found)
  if (prior) writeFileSync(join(outDir, "regression.md"), renderRegression(annotated, prior));
}

interface AnnotatedCell extends CellResult {
  fingerprint: string | null;
  isRegression: boolean;
  isNew: boolean;
}

function annotateCell(c: CellResult, prior: CellResult | undefined): AnnotatedCell {
  const fingerprint = c.status === "fail" ? fingerprintFor(c) : null;
  const isRegression = c.status === "fail" && prior !== undefined && prior.status !== "fail";
  const isNew = c.status === "fail" && prior === undefined;
  return { ...c, fingerprint, isRegression, isNew };
}

function fingerprintFor(c: CellResult): string {
  const code = c.error?.code ?? "ASSERTION_FAIL";
  const msg = (c.error?.message ?? c.assertions.filter((a) => !a.ok).map((a) => a.name).join(",")).slice(0, 80);
  return createHash("sha1").update(`${code}|${msg}`).digest("hex").slice(0, 10);
}

function findPriorRun(currentOutDir: string): RunReport | null {
  const reportsRoot = dirname(currentOutDir);
  if (!existsSync(reportsRoot)) return null;
  const dirs = readdirSync(reportsRoot)
    .filter((d) => join(reportsRoot, d) !== currentOutDir)
    .map((d) => ({ d, mtime: safeMtime(join(reportsRoot, d, "matrix.json")) }))
    .filter((x) => x.mtime !== null)
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  for (const { d } of dirs) {
    try {
      const raw = JSON.parse(readFileSync(join(reportsRoot, d, "matrix.json"), "utf8"));
      return RunReportSchema.parse(raw);
    } catch {
      continue;
    }
  }
  return null;
}

function safeMtime(p: string): number | null {
  try { return statSync(p).mtimeMs; } catch { return null; }
}

function renderSummary(r: RunReport, cells: AnnotatedCell[]): string {
  const slowest = [...cells].filter((c) => c.status !== "skip").sort((a, b) => b.durationMs - a.durationMs)[0];
  const passPct = r.executed ? Math.round((r.passed / (r.executed + r.partialSkipped)) * 100) : 0;

  // Per-workflow breakdown
  const byWorkflow = new Map<string, { exec: number; partial: number; pass: number; fail: number; p0: number; specRefs: string[] }>();
  for (const c of cells) {
    const w = byWorkflow.get(c.workflow) ?? { exec: 0, partial: 0, pass: 0, fail: 0, p0: 0, specRefs: c.specRefs ?? [] };
    if (c.status === "pass" || c.status === "fail") w.exec++;
    if (c.status === "partial_skip") w.partial++;
    if (c.status === "pass" || c.status === "partial_skip") w.pass++;
    if (c.status === "fail") w.fail++;
    if (c.severity === "P0") w.p0++;
    byWorkflow.set(c.workflow, w);
  }

  const lines = [
    `# E2E Validation Run`,
    ``,
    `- **runId:** ${r.harnessRunId}`,
    `- **Started:** ${r.startedAt}`,
    `- **Finished:** ${r.finishedAt}`,
    `- **Duration:** ${(r.durationMs / 1000).toFixed(1)}s`,
    `- **Passes:** ${r.passes} (flake cells: ${r.flakeCells.length})`,
    ``,
    `## Results`,
    ``,
    `- Total matrix cells: **${r.totalCells}** (executed: ${r.executed}, partial-skip: ${r.partialSkipped}, full-skip: ${r.fullSkipped})`,
    `- Total assertions run: **${r.totalAssertionsRun}**`,
    `- Passed: **${r.passed}** (${passPct}%)`,
    `- Failed: **${r.failed}** — P0: ${r.bySeverity.P0}, P1: ${r.bySeverity.P1}, P2: ${r.bySeverity.P2}`,
    `- **Total LLM cost (this run): $${r.totalLlmCostUsd.toFixed(2)}**`,
    ``,
  ];
  if (slowest) lines.push(`Slowest cell: ${slowest.workflow} / ${slowest.fixture} (${(slowest.durationMs / 1000).toFixed(1)}s)`, ``);
  if (r.aborted) lines.push(`> **ABORTED**: ${r.abortReason ?? "unknown"}`, ``);

  lines.push(`## By workflow`, ``, `| Workflow | Executed | Partial | Passed | Failed | P0 | Spec refs |`, `|---|---:|---:|---:|---:|---:|---|`);
  for (const [name, s] of byWorkflow) {
    lines.push(`| ${name} | ${s.exec} | ${s.partial} | ${s.pass} | ${s.fail} | ${s.p0} | ${s.specRefs.join(", ") || "—"} |`);
  }
  lines.push(``);

  // Spec coverage section
  const allSpecRefs = new Set<string>();
  for (const c of cells) for (const ref of c.specRefs ?? []) allSpecRefs.add(ref);
  lines.push(`## Spec coverage`, ``, `Spec sections covered by at least one assertion in this run:`, ``);
  for (const ref of [...allSpecRefs].sort()) lines.push(`- ${ref}`);
  lines.push(``, `> Gaps (sections expected but not covered) should be added here as the spec library grows.`, ``);

  return lines.join("\n");
}

function renderPunchList(cells: AnnotatedCell[]): string {
  const fails = cells.filter((c) => c.status === "fail");
  if (fails.length === 0) return "# Punch List\n\nNo failures.\n";

  const order: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
  fails.sort((a, b) => (order[a.severity ?? "P2"] ?? 99) - (order[b.severity ?? "P2"] ?? 99));

  const sections: string[] = ["# Punch List", "", `${fails.length} failure(s) — sorted by severity, grouped by error fingerprint.`, ""];
  for (const sev of ["P0", "P1", "P2"] as const) {
    const slice = fails.filter((c) => c.severity === sev);
    if (slice.length === 0) continue;
    sections.push(`## ${sev} — ${slice.length} failure(s)`, "");

    // Group by fingerprint within severity.
    const groups = new Map<string, AnnotatedCell[]>();
    for (const c of slice) {
      const key = c.fingerprint ?? "unknown";
      const arr = groups.get(key) ?? [];
      arr.push(c);
      groups.set(key, arr);
    }
    for (const [fp, group] of groups) {
      const head = group[0]!;
      const team = teamFor(head.workflow);
      sections.push(`### Group \`${fp}\` — ${group.length} cell(s) — likely team: **${team}**`, "");
      if (head.error) sections.push(`**Error:** \`${head.error.code}\` — ${head.error.message}`, "");
      const failed = head.assertions.filter((a) => !a.ok);
      if (failed.length) {
        sections.push("**Representative failed assertions:**");
        for (const a of failed) sections.push(`- \`${a.name}\` — expected \`${JSON.stringify(a.expected)}\`, got \`${JSON.stringify(a.actual)}\``);
        sections.push("");
      }
      sections.push("**Affected cells:**");
      for (const c of group) {
        const tag = c.isRegression ? " [REGRESSION]" : c.isNew ? " [NEW]" : "";
        sections.push(`- ${c.workflow} / ${c.fixture}${tag} — repro: \`pnpm tsx scripts/e2e-harness/run.ts --workflow ${c.workflow} --fixture ${c.fixture}\``);
      }
      sections.push("");
    }
  }
  return sections.join("\n");
}

function teamFor(workflow: string): string {
  if (workflow.startsWith("W6")) return "guidelines";
  if (workflow.startsWith("W7")) return "learning-engine";
  if (workflow.startsWith("W8")) return "tenant-isolation";
  if (workflow.startsWith("W4")) return "efolder/idp";
  if (workflow.startsWith("W5")) return "conditions";
  return "uw-flow";
}

function renderAuditValidation(cells: CellResult[]): string {
  const lines: string[] = ["# Audit Validation", "", "Each audit claim is mapped to the cells/assertions that test it. Verdict is determined by the run."];
  for (const claim of AUDIT_CLAIMS) {
    const tagged: { cell: CellResult; assertion: AssertionResult }[] = [];
    for (const c of cells) for (const a of c.assertions) if (a.auditClaim === claim.id) tagged.push({ cell: c, assertion: a });

    let verdict: "CONFIRMED" | "CONTRADICTED" | "INCONCLUSIVE";
    if (tagged.length === 0) verdict = "INCONCLUSIVE";
    else if (tagged.every((t) => t.assertion.ok)) verdict = "CONTRADICTED";
    else if (tagged.every((t) => !t.assertion.ok)) verdict = "CONFIRMED";
    else verdict = "INCONCLUSIVE";

    lines.push(``, `## ${claim.id} — "${claim.text}"`, ``, `**Verdict:** ${verdict}`, ``);
    if (tagged.length === 0) {
      lines.push(`No assertions are tagged with ${claim.id}. Add coverage in the relevant workflow before the next run.`);
    } else {
      lines.push(`Cells testing this claim:`);
      for (const { cell, assertion } of tagged) {
        lines.push(`- ${cell.workflow} / ${cell.fixture} → \`${assertion.name}\` — ${assertion.ok ? "PASS" : "FAIL"}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

function renderRegression(current: AnnotatedCell[], prior: RunReport): string {
  const newFails = current.filter((c) => c.isNew);
  const regressions = current.filter((c) => c.isRegression);
  const fixed = prior.cells.filter((p) => p.status === "fail" && !current.some((c) => c.workflow === p.workflow && c.fixture === p.fixture && c.status === "fail"));

  const lines = [
    `# Regression Diff`,
    ``,
    `Compared to prior run \`${prior.harnessRunId}\` (${prior.startedAt}).`,
    ``,
    `## New failures (${newFails.length})`, ``,
  ];
  for (const c of newFails) lines.push(`- ${c.workflow} / ${c.fixture} (${c.severity})`);
  lines.push(``, `## Regressions — passed before, fail now (${regressions.length})`, ``);
  for (const c of regressions) lines.push(`- ${c.workflow} / ${c.fixture} (${c.severity})`);
  lines.push(``, `## Fixed since last run (${fixed.length})`, ``);
  for (const c of fixed) lines.push(`- ${c.workflow} / ${c.fixture}`);
  return lines.join("\n") + "\n";
}
