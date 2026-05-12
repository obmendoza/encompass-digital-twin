// scripts/e2e-harness/run.ts
// CLI entry point for the E2E validation harness.

import { existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { listFixtures, GLOBAL_FIXTURE_SENTINEL } from "./fixtures.js";
import { pingHealth } from "./http.js";
import type { CellResult, FixtureMeta, RunContext, RunReport, WorkflowDef } from "./types.js";
import { aggregate } from "./aggregate.js";
import { W1 } from "./workflows/W1-uw-accept.js";
import { W2 } from "./workflows/W2-uw-override.js";
import { W3 } from "./workflows/W3-send-back-va.js";
import { W4 } from "./workflows/W4-efolder-idp-push.js";
import { W5 } from "./workflows/W5-conditions-lifecycle.js";
import { W6 } from "./workflows/W6-kb-ingest-twokey.js";
import { W7 } from "./workflows/W7-pattern-detection-llm.js";
import { W8 } from "./workflows/W8-multi-tenant-rls.js";
import { W9 } from "./workflows/W9-va-review.js";
import { W10 } from "./workflows/W10-predicted-conditions.js";

const ALL_WORKFLOWS: WorkflowDef[] = [W1, W2, W3, W4, W5, W6, W7, W8, W9, W10];
const GLOBAL_WORKFLOWS = new Set(["W6_kb_ingest_twokey", "W7_pattern_detection"]);
const CANARY_FIXTURE_ID = "nqm-bankstmt-12mo-clean";

interface Args {
  outDir: string;
  workflow: string | null;
  fixture: string | null;
  repeat: number;
  skipCanary: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { outDir: defaultOutDir(), workflow: null, fixture: null, repeat: 2, skipCanary: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" && argv[i + 1]) { out.outDir = argv[++i]!; continue; }
    if (a === "--workflow" && argv[i + 1]) { out.workflow = argv[++i]!; continue; }
    if (a === "--fixture" && argv[i + 1]) { out.fixture = argv[++i]!; continue; }
    if (a === "--repeat" && argv[i + 1]) { out.repeat = Math.max(1, parseInt(argv[++i]!, 10) || 1); continue; }
    if (a === "--skip-canary") { out.skipCanary = true; continue; }
  }
  return out;
}

function defaultOutDir(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `reports/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function newRunId(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `run_${stamp}_${randomBytes(2).toString("hex")}`;
}

async function runCell(workflow: WorkflowDef, fixture: FixtureMeta, ctx: RunContext): Promise<CellResult> {
  const start = Date.now();
  try {
    const result = await workflow.run(fixture, ctx);
    result.harnessRunId ??= ctx.harnessRunId;
    result.specRefs ??= workflow.specRefs;
    return result;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return {
      harnessRunId: ctx.harnessRunId,
      loanId: fixture.loanId === "_global" ? null : fixture.loanId,
      fixture: fixture.id,
      workflow: workflow.id,
      status: "fail",
      severity: "P0",
      durationMs: Date.now() - start,
      auditClaim: null,
      specRefs: workflow.specRefs,
      assertions: [],
      skippedAssertions: [],
      subCells: [],
      evidence: {},
      error: { code: "WORKFLOW_CRASH", message: err.message, stack: err.stack },
    };
  }
}

function skipCell(workflow: WorkflowDef, fixture: FixtureMeta, ctx: RunContext): CellResult {
  return {
    harnessRunId: ctx.harnessRunId,
    loanId: fixture.loanId === "_global" ? null : fixture.loanId,
    fixture: fixture.id,
    workflow: workflow.id,
    status: "skip",
    severity: null,
    durationMs: 0,
    auditClaim: null,
    specRefs: workflow.specRefs,
    assertions: [],
    skippedAssertions: [],
    subCells: [],
    evidence: {},
    error: null,
  };
}

async function runMatrix(
  workflows: WorkflowDef[],
  fixtures: FixtureMeta[],
  args: Args,
  ctx: RunContext,
): Promise<{ cells: CellResult[]; aborted: boolean; abortReason: string | null }> {
  const cells: CellResult[] = [];
  let aborted = false;
  let abortReason: string | null = null;

  outer: for (const w of workflows) {
    if (GLOBAL_WORKFLOWS.has(w.id)) {
      cells.push(await runCell(w, GLOBAL_FIXTURE_SENTINEL, ctx));
      for (const f of fixtures) cells.push(skipCell(w, f, ctx));
      continue;
    }
    for (const f of fixtures) {
      if (args.fixture && f.id !== args.fixture) continue;
      if (!w.appliesTo(f)) { cells.push(skipCell(w, f, ctx)); continue; }
      try {
        cells.push(await runCell(w, f, ctx));
      } catch (e) {
        aborted = true;
        abortReason = e instanceof Error ? e.message : String(e);
        break outer;
      }
    }
  }
  return { cells, aborted, abortReason };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const harnessRunId = newRunId();
  const apiUrl = process.env.API_URL ?? "http://localhost:4000";
  const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:8000";
  if (!existsSync(args.outDir)) mkdirSync(args.outDir, { recursive: true });

  // --- Preflight: process pings ---
  const preflight = await pingHealth(apiUrl, agentUrl);
  if (!preflight.apiOk || !preflight.agentOk) {
    console.error("Preflight failed:");
    for (const d of preflight.details) console.error("  " + d);
    process.exit(2);
  }

  // --- Preflight: canary cell ---
  const isExplicitSingleCell = args.workflow !== null && args.fixture !== null;
  if (args.skipCanary) {
    console.log("Canary skipped (--skip-canary). Operator-acknowledged risk: infrastructure issues won't surface until first real cell.");
  } else if (!isExplicitSingleCell) {
    const canaryFixture = listFixtures().find((f) => f.id === CANARY_FIXTURE_ID);
    if (!canaryFixture) {
      console.error(`Canary fixture ${CANARY_FIXTURE_ID} not found.`);
      process.exit(2);
    }
    const canaryCtx: RunContext = { harnessRunId, apiUrl, agentUrl, outDir: args.outDir, startedAt: new Date().toISOString(), pass: 0 };
    const canary = await runCell(W1, canaryFixture, canaryCtx);
    if (canary.status === "fail") {
      console.error("Canary cell failed — aborting before full matrix.");
      console.error(`  ${canary.error?.code}: ${canary.error?.message}`);
      console.error(`  Failed assertions: ${canary.assertions.filter((a) => !a.ok).map((a) => a.name).join(", ")}`);
      process.exit(2);
    }
    console.log(`Canary OK (${(canary.durationMs / 1000).toFixed(1)}s).`);
  }

  // --- Run the matrix N times for flake detection ---
  const fixtures = listFixtures();
  let workflows = ALL_WORKFLOWS;
  if (args.workflow) workflows = workflows.filter((w) => w.id === args.workflow || w.id.startsWith(args.workflow!));
  if (workflows.length === 0) {
    console.error(`No workflow matched --workflow ${args.workflow}`);
    process.exit(2);
  }

  const startMs = Date.now();
  const startedAt = new Date().toISOString();
  const allPasses: CellResult[][] = [];
  let aborted = false;
  let abortReason: string | null = null;

  for (let pass = 1; pass <= args.repeat; pass++) {
    if (args.repeat > 1) console.log(`\n--- Pass ${pass} of ${args.repeat} ---`);
    const ctx: RunContext = { harnessRunId, apiUrl, agentUrl, outDir: args.outDir, startedAt, pass };
    const result = await runMatrix(workflows, fixtures, args, ctx);
    allPasses.push(result.cells);
    if (result.aborted) { aborted = true; abortReason = result.abortReason; break; }
  }

  // --- Flake detection ---
  const flakeCells: string[] = [];
  if (allPasses.length > 1) {
    const baseline = allPasses[0]!;
    for (let i = 0; i < baseline.length; i++) {
      const id = `${baseline[i]!.workflow}:${baseline[i]!.fixture}`;
      const statuses = new Set(allPasses.map((p) => p[i]?.status));
      if (statuses.size > 1) flakeCells.push(id);
    }
  }

  const cells = allPasses[allPasses.length - 1] ?? [];

  // --- Aggregate ---
  const finishedAt = new Date().toISOString();
  const totalCells = cells.length;
  const executed = cells.filter((c) => c.status === "pass" || c.status === "fail").length;
  const partialSkipped = cells.filter((c) => c.status === "partial_skip").length;
  const fullSkipped = cells.filter((c) => c.status === "skip").length;
  const passed = cells.filter((c) => c.status === "pass" || c.status === "partial_skip").length;
  const failed = cells.filter((c) => c.status === "fail").length;
  const bySeverity = {
    P0: cells.filter((c) => c.severity === "P0").length,
    P1: cells.filter((c) => c.severity === "P1").length,
    P2: cells.filter((c) => c.severity === "P2").length,
  };
  const totalLlmCostUsd = cells.reduce((s, c) => s + (typeof c.evidence.pipelineCostUsd === "number" ? c.evidence.pipelineCostUsd : 0), 0);
  const totalAssertionsRun = cells.reduce((s, c) => s + c.assertions.length, 0);

  const report: RunReport = {
    harnessRunId,
    startedAt,
    finishedAt,
    durationMs: Date.now() - startMs,
    totalCells,
    executed,
    partialSkipped,
    fullSkipped,
    passed,
    failed,
    bySeverity,
    totalLlmCostUsd,
    totalAssertionsRun,
    passes: allPasses.length,
    flakeCells,
    aborted,
    abortReason,
    cells,
  };

  await aggregate(report, args.outDir);
  console.log(`\nRun ${aborted ? "ABORTED" : "complete"}: ${passed}/${executed + partialSkipped} passed, ${failed} failed (P0=${bySeverity.P0} P1=${bySeverity.P1} P2=${bySeverity.P2}); cost $${totalLlmCostUsd.toFixed(2)}; flakes: ${flakeCells.length}. Report at ${args.outDir}/`);
  process.exit(bySeverity.P0 > 0 || aborted ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
