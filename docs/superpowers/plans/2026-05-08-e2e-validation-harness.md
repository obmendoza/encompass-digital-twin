# E2E Validation Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-shot CLI harness that runs all 20 NQM fixtures × 8 named workflows, captures pass/fail evidence per cell with P0/P1/P2 severity, and emits both `matrix.json` and a severity-sorted `punch-list.md` to drive the next development backlog.

**Architecture:** Self-contained scripts under `scripts/e2e-harness/`. Sequential execution against a live local stack (API :4000, Agent :8000). Per-workflow modules implement isolated `appliesTo()` + `run(fixture)` shapes. Foundation files (types, fixtures, http, run skeleton, aggregate skeleton) are written first as Wave 1; the 8 workflow modules can then be implemented in parallel as Wave 2; aggregator polish + smoke validation is Wave 3.

**Tech Stack:** TypeScript, `tsx` (already a devDep), native `fetch`, existing `@twin/core` and `@twin/fixtures` types. No new package deps.

**Spec reference:** `docs/superpowers/specs/2026-05-08-e2e-validation-harness-design.md` (commit `739a33a`).

---

## Resolutions for spec §12 open questions

1. **`POST /system/reset`?** — Not needed. `POST /world/reset` and `POST /world/load-scenario` already exist in `packages/api/src/routes/world.ts`. The harness uses these.
2. **Programmatic KB ingest for W6?** — W6 inlines its HTTP calls using `http.ts`. No shared kb-ingest module. The bash script `scripts/test-guideline-pipeline.sh` is the reference for which calls to make in which order.
3. **Keep `POST /system/behavioral-test`?** — Yes, both stay. Behavioral-test is a fast reducer smoke (~5s); the harness is broad coverage. Documented in `scripts/e2e-harness/README.md`.

## File structure

| File | Responsibility | Wave |
|---|---|---|
| `scripts/e2e-harness/types.ts` | Shared types: `Severity`, `AssertionResult`, `EvidenceBundle`, `CellResult`, `RunReport`, `FixtureMeta`, `RunContext`, `WorkflowDef` | 1 |
| `scripts/e2e-harness/http.ts` | Thin `fetch()` wrapper for API + Agent calls; JSON helpers; default actor injection | 1 |
| `scripts/e2e-harness/fixtures.ts` | Imports 20 fixtures from `@twin/fixtures`; classifies them; exposes `listFixtures()` and a default `appliesTo()` helper | 1 |
| `scripts/e2e-harness/run.ts` | CLI entry: parses argv, runs preflight, iterates matrix, calls aggregate, exits with non-zero if any P0 | 1 |
| `scripts/e2e-harness/aggregate.ts` | Skeleton in Wave 1; full Markdown formatter in Wave 3 | 1 + 3 |
| `scripts/e2e-harness/workflows/W1-uw-accept.ts` | UW accept happy path | 2 |
| `scripts/e2e-harness/workflows/W2-uw-override.ts` | UW override with reason | 2 |
| `scripts/e2e-harness/workflows/W3-send-back-va.ts` | UW sends back to VA | 2 |
| `scripts/e2e-harness/workflows/W4-efolder-idp-push.ts` | eFolder → IDP → Stare & Compare → Push | 2 |
| `scripts/e2e-harness/workflows/W5-conditions-lifecycle.ts` | Add → link → clear; dedup blocks duplicate | 2 |
| `scripts/e2e-harness/workflows/W6-kb-ingest-twokey.ts` | KB ingest + two-key approval (one cell) | 2 |
| `scripts/e2e-harness/workflows/W7-pattern-detection-llm.ts` | Pattern detection from N seeded decisions (one cell) | 2 |
| `scripts/e2e-harness/workflows/W8-multi-tenant-rls.ts` | RLS isolation across 3 representative fixtures | 2 |
| `scripts/e2e-harness/README.md` | How to run, output format, troubleshooting | 3 |

**Wave dispatch model:** Wave 1 is one agent (Tasks 1–5 sequential). Wave 2 dispatches 8 parallel agents (Tasks 6–13, one each). Wave 3 is one agent (Tasks 14–15).

---

## Task 1: Create `types.ts` — shared type definitions

**Files:**
- Create: `scripts/e2e-harness/types.ts`

- [ ] **Step 1: Write the file**

```typescript
// scripts/e2e-harness/types.ts
// Shared types for the E2E validation harness. No runtime code.

export type Severity = "P0" | "P1" | "P2" | null;

export type CellStatus = "pass" | "fail" | "skip";

export interface AssertionResult {
  name: string;
  expected: unknown;
  actual: unknown;
  ok: boolean;
}

export interface EvidenceBundle {
  decisionRecordId?: string;
  kbVersion?: string | null;
  agentTraceLength?: number;
  pipelineCostUsd?: number;
  screenshotPath?: string | null;
  // Workflow-specific extras allowed:
  [key: string]: unknown;
}

export interface CellResult {
  loanId: string | null;          // null for global workflows (W6, W7)
  fixture: string;                // fixture id; "_global" for W6/W7
  workflow: string;               // e.g. "W1_uw_accept"
  status: CellStatus;
  severity: Severity;
  durationMs: number;
  assertions: AssertionResult[];
  evidence: EvidenceBundle;
  error: { code: string; message: string; stack?: string } | null;
}

export interface FixtureMeta {
  id: string;                     // e.g. "nqm-bankstmt-12mo-clean"
  loanId: string;                 // e.g. "2501000101"
  program: string;                // "BankStatement" | "DSCR" | "FullDoc" | "ForeignNational" | ...
  isEdge: boolean;                // true for nqm-edge-*
}

export interface RunContext {
  apiUrl: string;                 // default http://localhost:4000
  agentUrl: string;               // default http://localhost:8000
  outDir: string;                 // reports/<run-id>/
  startedAt: string;              // ISO timestamp
}

export interface WorkflowDef {
  id: string;                     // "W1_uw_accept"
  name: string;                   // "UW Decision — Accept"
  appliesTo: (fixture: FixtureMeta) => boolean;
  run: (fixture: FixtureMeta, ctx: RunContext) => Promise<CellResult>;
}

export interface RunReport {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalCells: number;             // 160 (full matrix)
  executed: number;               // 105
  skipped: number;                // 55
  passed: number;
  failed: number;
  bySeverity: { P0: number; P1: number; P2: number };
  aborted: boolean;
  abortReason: string | null;
  cells: CellResult[];
}
```

- [ ] **Step 2: Verify the file type-checks**

Run: `pnpm tsc --noEmit --target es2022 --module esnext --moduleResolution bundler scripts/e2e-harness/types.ts`
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-harness/types.ts
git commit -m "feat(e2e): types module for validation harness"
```

---

## Task 2: Create `http.ts` — fetch wrapper

**Files:**
- Create: `scripts/e2e-harness/http.ts`

- [ ] **Step 1: Write the file**

```typescript
// scripts/e2e-harness/http.ts
// Thin fetch() wrapper for API + Agent calls.

const DEFAULT_ACTOR = { kind: "human" as const, id: "e2e-harness" };
const DEFAULT_AGENT_ACTOR = { kind: "agent" as const, id: "e2e-harness-agent" };

export interface HttpOptions {
  baseUrl: string;
  tenantId?: string;
  timeoutMs?: number;
}

export class HttpError extends Error {
  constructor(public status: number, public url: string, public bodyText: string) {
    super(`HTTP ${status} ${url}: ${bodyText.slice(0, 200)}`);
  }
}

async function request<T>(
  opts: HttpOptions,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${opts.baseUrl}${path}`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.tenantId) headers["x-tenant-id"] = opts.tenantId;
  const init: RequestInit = {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  };
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, url, text);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export const http = {
  get: <T>(opts: HttpOptions, path: string) => request<T>(opts, "GET", path),
  post: <T>(opts: HttpOptions, path: string, body?: unknown) => request<T>(opts, "POST", path, body),
  put: <T>(opts: HttpOptions, path: string, body?: unknown) => request<T>(opts, "PUT", path, body),
  delete: <T>(opts: HttpOptions, path: string) => request<T>(opts, "DELETE", path),
};

export const ACTORS = {
  human: DEFAULT_ACTOR,
  agent: DEFAULT_AGENT_ACTOR,
};

export async function pingHealth(apiUrl: string, agentUrl: string): Promise<{ apiOk: boolean; agentOk: boolean; details: string[] }> {
  const details: string[] = [];
  let apiOk = false;
  let agentOk = false;
  try {
    await request<unknown>({ baseUrl: apiUrl, timeoutMs: 2000 }, "GET", "/system/health");
    apiOk = true;
  } catch (e) {
    details.push(`API unhealthy: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await request<unknown>({ baseUrl: agentUrl, timeoutMs: 2000 }, "GET", "/health");
    agentOk = true;
  } catch (e) {
    details.push(`Agent unhealthy: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { apiOk, agentOk, details };
}
```

- [ ] **Step 2: Smoke-check against running stack**

Prerequisite: API and Agent must be running (`./scripts/dev-up.sh`).

Run: `pnpm tsx -e 'import { pingHealth } from "./scripts/e2e-harness/http.ts"; pingHealth("http://localhost:4000", "http://localhost:8000").then(r => { console.log(r); process.exit(r.apiOk && r.agentOk ? 0 : 1); });'`
Expected: `{ apiOk: true, agentOk: true, details: [] }` and exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-harness/http.ts
git commit -m "feat(e2e): http wrapper + preflight ping"
```

---

## Task 3: Create `fixtures.ts` — fixture loader and classifier

**Files:**
- Create: `scripts/e2e-harness/fixtures.ts`

- [ ] **Step 1: Write the file**

```typescript
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
```

- [ ] **Step 2: Smoke-check fixture loading**

Run: `pnpm tsx -e 'import { listFixtures } from "./scripts/e2e-harness/fixtures.ts"; const f = listFixtures(); console.log(f.length, f[0].id, f.filter(x => x.isEdge).length);'`
Expected: `20 nqm-1099-only 8` (or similar — 20 total, 8 edge).

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-harness/fixtures.ts
git commit -m "feat(e2e): fixtures loader + classifier"
```

---

## Task 4: Create `run.ts` — main entry point

**Files:**
- Create: `scripts/e2e-harness/run.ts`

- [ ] **Step 1: Write the file**

```typescript
// scripts/e2e-harness/run.ts
// CLI entry point for the E2E validation harness.
// Usage: pnpm tsx scripts/e2e-harness/run.ts [--out reports/<id>/] [--workflow Wn] [--fixture <id>]

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

const ALL_WORKFLOWS: WorkflowDef[] = [W1, W2, W3, W4, W5, W6, W7, W8];
const GLOBAL_WORKFLOWS = new Set(["W6_kb_ingest_twokey", "W7_pattern_detection"]);

interface Args {
  outDir: string;
  workflow: string | null;
  fixture: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { outDir: defaultOutDir(), workflow: null, fixture: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" && argv[i + 1]) { out.outDir = argv[++i]!; continue; }
    if (a === "--workflow" && argv[i + 1]) { out.workflow = argv[++i]!; continue; }
    if (a === "--fixture" && argv[i + 1]) { out.fixture = argv[++i]!; continue; }
  }
  return out;
}

function defaultOutDir(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `reports/${stamp}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

async function runCell(workflow: WorkflowDef, fixture: FixtureMeta, ctx: RunContext): Promise<CellResult> {
  const start = Date.now();
  try {
    return await workflow.run(fixture, ctx);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    return {
      loanId: fixture.loanId === "_global" ? null : fixture.loanId,
      fixture: fixture.id,
      workflow: workflow.id,
      status: "fail",
      severity: "P0",
      durationMs: Date.now() - start,
      assertions: [],
      evidence: {},
      error: { code: "WORKFLOW_CRASH", message: err.message, stack: err.stack },
    };
  }
}

function skipCell(workflow: WorkflowDef, fixture: FixtureMeta): CellResult {
  return {
    loanId: fixture.loanId === "_global" ? null : fixture.loanId,
    fixture: fixture.id,
    workflow: workflow.id,
    status: "skip",
    severity: null,
    durationMs: 0,
    assertions: [],
    evidence: {},
    error: null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ctx: RunContext = {
    apiUrl: process.env.API_URL ?? "http://localhost:4000",
    agentUrl: process.env.AGENT_SERVICE_URL ?? "http://localhost:8000",
    outDir: args.outDir,
    startedAt: new Date().toISOString(),
  };
  if (!existsSync(ctx.outDir)) mkdirSync(ctx.outDir, { recursive: true });

  const preflight = await pingHealth(ctx.apiUrl, ctx.agentUrl);
  if (!preflight.apiOk || !preflight.agentOk) {
    console.error("Preflight failed:");
    for (const d of preflight.details) console.error("  " + d);
    process.exit(2);
  }

  const fixtures = listFixtures();
  let workflows = ALL_WORKFLOWS;
  if (args.workflow) workflows = workflows.filter((w) => w.id === args.workflow || w.id.startsWith(args.workflow!));
  if (workflows.length === 0) {
    console.error(`No workflow matched --workflow ${args.workflow}`);
    process.exit(2);
  }

  const cells: CellResult[] = [];
  const startMs = Date.now();
  let aborted = false;
  let abortReason: string | null = null;

  outer: for (const w of workflows) {
    if (GLOBAL_WORKFLOWS.has(w.id)) {
      // One cell against the sentinel; skip cells for the other 19.
      cells.push(await runCell(w, GLOBAL_FIXTURE_SENTINEL, ctx));
      for (const f of fixtures) cells.push(skipCell(w, f));
      continue;
    }
    for (const f of fixtures) {
      if (args.fixture && f.id !== args.fixture) continue;
      if (!w.appliesTo(f)) { cells.push(skipCell(w, f)); continue; }
      try {
        cells.push(await runCell(w, f, ctx));
      } catch (e) {
        aborted = true;
        abortReason = e instanceof Error ? e.message : String(e);
        break outer;
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const totalCells = cells.length;
  const executed = cells.filter((c) => c.status !== "skip").length;
  const passed = cells.filter((c) => c.status === "pass").length;
  const failed = cells.filter((c) => c.status === "fail").length;
  const skipped = totalCells - executed;
  const bySeverity = {
    P0: cells.filter((c) => c.severity === "P0").length,
    P1: cells.filter((c) => c.severity === "P1").length,
    P2: cells.filter((c) => c.severity === "P2").length,
  };

  const report: RunReport = {
    startedAt: ctx.startedAt,
    finishedAt,
    durationMs: Date.now() - startMs,
    totalCells,
    executed,
    skipped,
    passed,
    failed,
    bySeverity,
    aborted,
    abortReason,
    cells,
  };

  await aggregate(report, ctx.outDir);
  console.log(`\nRun ${aborted ? "ABORTED" : "complete"}: ${passed}/${executed} passed, ${failed} failed (P0=${bySeverity.P0} P1=${bySeverity.P1} P2=${bySeverity.P2}). Report at ${ctx.outDir}/`);
  process.exit(bySeverity.P0 > 0 || aborted ? 1 : 0);
}

void writeFileSyncMaybe(); // tree-shake guard for unused import
async function writeFileSyncMaybe() { writeFileSync; dirname; join; } // referenced for tsc

main().catch((e) => { console.error(e); process.exit(2); });
```

- [ ] **Step 2: Verify it type-checks (workflow imports will fail until Wave 2; that's expected)**

Run: `pnpm tsx --no-warnings scripts/e2e-harness/run.ts --help 2>&1 | head -5 || true`
Expected: error mentioning `Cannot find module './workflows/W1-uw-accept.js'` — this is correct; Wave 2 fills these in.

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-harness/run.ts
git commit -m "feat(e2e): runner skeleton with preflight, args, abort handling"
```

---

## Task 5: Create `aggregate.ts` skeleton

**Files:**
- Create: `scripts/e2e-harness/aggregate.ts`

- [ ] **Step 1: Write the skeleton file**

```typescript
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
    if (cell.status === "skip") continue; // don't write per-cell for skips
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
    `- Started: ${r.startedAt}`,
    `- Finished: ${r.finishedAt}`,
    `- Duration: ${(r.durationMs / 1000).toFixed(1)}s`,
    `- Total matrix cells: ${r.totalCells}`,
    `- Executed: ${r.executed} (skipped: ${r.skipped})`,
    `- Passed: ${r.passed} / ${r.executed} (${r.executed ? Math.round((r.passed / r.executed) * 100) : 0}%)`,
    `- Failed: ${r.failed} (P0: ${r.bySeverity.P0}, P1: ${r.bySeverity.P1}, P2: ${r.bySeverity.P2})`,
    r.aborted ? `- **ABORTED**: ${r.abortReason ?? "unknown"}` : ``,
    ``,
  ].join("\n");
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
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit --target es2022 --module esnext --moduleResolution bundler scripts/e2e-harness/aggregate.ts 2>&1 | head -20 || true`
Expected: errors only for the unresolved `./workflows/*` imports in run.ts; aggregate.ts itself should be clean.

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-harness/aggregate.ts
git commit -m "feat(e2e): aggregate skeleton (json + minimal markdown)"
```

---

## Task 6: Create `W1-uw-accept.ts` — UW Accept workflow

**Files:**
- Create: `scripts/e2e-harness/workflows/W1-uw-accept.ts`

**Spec assertions (§5):** After `accept`, `loan.decision == staged.recommendation`; `decisionRecord` exists with non-null `kbVersion` and `chatbotConsultationId`; agent trace length > 0; pipeline cost > 0.

- [ ] **Step 1: Write the workflow module**

```typescript
// scripts/e2e-harness/workflows/W1-uw-accept.ts
// Loads fixture → runs multi-agent → stages recommendation → accepts → asserts decision + evidence.

import { ACTORS, http, type HttpOptions } from "../http.js";
import { APPLIES_TO_ALL } from "../fixtures.js";
import type { AssertionResult, CellResult, FixtureMeta, RunContext, WorkflowDef } from "../types.js";

export const W1: WorkflowDef = {
  id: "W1_uw_accept",
  name: "UW Decision — Accept",
  appliesTo: APPLIES_TO_ALL,
  run: async (fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const agentOpts: HttpOptions = { baseUrl: ctx.agentUrl, timeoutMs: 600_000 };
    const assertions: AssertionResult[] = [];

    await http.post(apiOpts, "/world/reset");
    await http.post(apiOpts, "/world/load-scenario", { scenarioId: fixture.id });

    // Run multi-agent pipeline (writes pendingRecommendation on the loan).
    await http.post(agentOpts, `/api/twin/underwrite-multi/${fixture.loanId}`);

    // Read loan after recommendation is staged.
    type Loan = { id: string; decision?: string; pendingRecommendation?: { recommendation: string } | null };
    const loanBefore = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const stagedRec = loanBefore.pendingRecommendation?.recommendation ?? null;
    assertions.push({ name: "pendingRecommendation_present", expected: "non-null", actual: stagedRec, ok: stagedRec !== null });

    if (stagedRec === null) {
      return finalize(fixture, start, "fail", "P0", assertions, {}, "NO_RECOMMENDATION", "agent did not stage a recommendation");
    }

    // Accept the recommendation.
    await http.post(apiOpts, `/loans/${fixture.loanId}/recommendation/accept`, { actor: ACTORS.human });

    const loanAfter = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    assertions.push({ name: "decision_matches_staged", expected: stagedRec, actual: loanAfter.decision ?? null, ok: loanAfter.decision === stagedRec });
    assertions.push({ name: "pendingRecommendation_cleared", expected: null, actual: loanAfter.pendingRecommendation ?? null, ok: !loanAfter.pendingRecommendation });

    // Read decision record(s).
    type DecisionsResp = { decisions?: Array<{ id: string; kb_version: string | null; chatbot_consultation_id: string | null }> };
    const decisionsResp = await http.get<DecisionsResp>(apiOpts, `/loans/${fixture.loanId}/decision`).catch(() => ({} as DecisionsResp));
    const latest = decisionsResp.decisions?.[decisionsResp.decisions.length - 1];
    assertions.push({ name: "decision_record_exists", expected: "non-null", actual: latest ?? null, ok: !!latest });
    assertions.push({ name: "decision_record_has_kb_version", expected: "non-null", actual: latest?.kb_version ?? null, ok: !!latest?.kb_version });
    assertions.push({ name: "decision_record_has_chatbot_consultation_id", expected: "non-null", actual: latest?.chatbot_consultation_id ?? null, ok: !!latest?.chatbot_consultation_id });

    // Trace + cost from the loan's _pipeline_usage and audit log.
    type Audit = { entries?: Array<{ type: string; trace?: unknown[] }> };
    const audit = await http.get<Audit>(apiOpts, `/loans/${fixture.loanId}/audit`).catch(() => ({} as Audit));
    const traceEntry = (audit.entries ?? []).find((e) => e.type === "AgentRunComplete");
    const traceLen = Array.isArray(traceEntry?.trace) ? traceEntry!.trace!.length : 0;
    assertions.push({ name: "agent_trace_length>0", expected: ">0", actual: traceLen, ok: traceLen > 0 });

    type LoanWithUsage = Loan & { _pipeline_usage?: { totalCostUsd?: number } };
    const loanFull = await http.get<LoanWithUsage>(apiOpts, `/loans/${fixture.loanId}`);
    const cost = loanFull._pipeline_usage?.totalCostUsd ?? 0;
    assertions.push({ name: "pipeline_cost>0", expected: ">0", actual: cost, ok: cost > 0 });

    const allOk = assertions.every((a) => a.ok);
    const severity = allOk ? null : (assertions.find((a) => !a.ok && (a.name === "decision_matches_staged" || a.name === "decision_record_exists")) ? "P0" : "P1");
    return finalize(fixture, start, allOk ? "pass" : "fail", severity, assertions, {
      decisionRecordId: latest?.id,
      kbVersion: latest?.kb_version ?? null,
      agentTraceLength: traceLen,
      pipelineCostUsd: cost,
    }, null, null);
  },
};

function finalize(
  fixture: FixtureMeta,
  start: number,
  status: "pass" | "fail",
  severity: "P0" | "P1" | "P2" | null,
  assertions: AssertionResult[],
  evidence: Record<string, unknown>,
  errCode: string | null,
  errMsg: string | null,
): CellResult {
  return {
    loanId: fixture.loanId,
    fixture: fixture.id,
    workflow: "W1_uw_accept",
    status,
    severity,
    durationMs: Date.now() - start,
    assertions,
    evidence,
    error: errCode ? { code: errCode, message: errMsg ?? "" } : null,
  };
}
```

- [ ] **Step 2: Smoke-test against one fixture**

Prerequisite: API + Agent running.

Run: `pnpm tsx scripts/e2e-harness/run.ts --workflow W1_uw_accept --fixture nqm-bankstmt-12mo-clean --out tmp/e2e-smoke-w1`
Expected: command exits; `tmp/e2e-smoke-w1/cells/W1_uw_accept/nqm-bankstmt-12mo-clean.json` exists; `status` is `pass` or `fail` (not `skip`); `assertions` array has ≥6 entries.

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-harness/workflows/W1-uw-accept.ts
git commit -m "feat(e2e): W1 UW accept workflow"
```

---

## Task 7: Create `W2-uw-override.ts` — UW Override workflow

**Files:**
- Create: `scripts/e2e-harness/workflows/W2-uw-override.ts`

**Spec assertions (§5):** Override records original + override + `overrideReason` (one of 9 valid categories) + rationale. Decision record persists override metadata.

- [ ] **Step 1: Write the workflow module**

```typescript
// scripts/e2e-harness/workflows/W2-uw-override.ts
import { ACTORS, http, type HttpOptions } from "../http.js";
import { APPLIES_TO_ALL } from "../fixtures.js";
import type { AssertionResult, CellResult, FixtureMeta, WorkflowDef } from "../types.js";

const VALID_REASONS = new Set([
  "DTI_RATIO_EXCEPTION", "RESERVES_EXCEPTION", "CREDIT_EVENT_EXCEPTION", "INCOME_DOCUMENTATION",
  "PROPERTY_CONDITION", "COMPENSATING_FACTORS", "INVESTOR_OVERLAY_DEVIATION", "MISSING_DOCUMENTATION",
  "OTHER",
]);

export const W2: WorkflowDef = {
  id: "W2_uw_override",
  name: "UW Decision — Override",
  appliesTo: APPLIES_TO_ALL,
  run: async (fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const agentOpts: HttpOptions = { baseUrl: ctx.agentUrl, timeoutMs: 600_000 };
    const assertions: AssertionResult[] = [];

    await http.post(apiOpts, "/world/reset");
    await http.post(apiOpts, "/world/load-scenario", { scenarioId: fixture.id });
    await http.post(agentOpts, `/api/twin/underwrite-multi/${fixture.loanId}`);

    type Loan = { decision?: string; pendingRecommendation?: { recommendation: string } | null };
    const before = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const original = before.pendingRecommendation?.recommendation ?? null;
    assertions.push({ name: "staged_recommendation_present", expected: "non-null", actual: original, ok: original !== null });
    if (!original) return cell(fixture, start, "fail", "P0", assertions, {}, "NO_RECOMMENDATION", "no rec to override");

    const overrideTo = original === "approved" ? "suspended" : "approved";
    const reason = "DTI_RATIO_EXCEPTION";
    const rationale = `e2e-test override: ${original}→${overrideTo}`;

    await http.post(apiOpts, `/loans/${fixture.loanId}/override`, {
      originalRecommendation: original,
      overrideDecision: overrideTo,
      overrideReason: reason,
      rationale,
      actor: ACTORS.human,
    });

    const after = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    assertions.push({ name: "decision_is_override", expected: overrideTo, actual: after.decision ?? null, ok: after.decision === overrideTo });

    type DecisionsResp = { decisions?: Array<{ id: string; original_recommendation?: string; final_decision?: string; override_reason?: string; rationale?: string }> };
    const dec = await http.get<DecisionsResp>(apiOpts, `/loans/${fixture.loanId}/decision`).catch(() => ({} as DecisionsResp));
    const latest = dec.decisions?.[dec.decisions.length - 1];
    assertions.push({ name: "decision_record_original", expected: original, actual: latest?.original_recommendation ?? null, ok: latest?.original_recommendation === original });
    assertions.push({ name: "decision_record_final", expected: overrideTo, actual: latest?.final_decision ?? null, ok: latest?.final_decision === overrideTo });
    assertions.push({ name: "override_reason_valid", expected: "in 9-category set", actual: latest?.override_reason ?? null, ok: !!latest?.override_reason && VALID_REASONS.has(latest.override_reason) });
    assertions.push({ name: "rationale_persisted", expected: rationale, actual: latest?.rationale ?? null, ok: latest?.rationale === rationale });

    const allOk = assertions.every((a) => a.ok);
    const severity = allOk ? null : (assertions.find((a) => !a.ok && a.name.startsWith("decision_")) ? "P0" : "P1");
    return cell(fixture, start, allOk ? "pass" : "fail", severity, assertions, { decisionRecordId: latest?.id }, null, null);
  },
};

function cell(fixture: FixtureMeta, start: number, status: "pass" | "fail", severity: "P0" | "P1" | "P2" | null, assertions: AssertionResult[], evidence: Record<string, unknown>, errCode: string | null, errMsg: string | null): CellResult {
  return { loanId: fixture.loanId, fixture: fixture.id, workflow: "W2_uw_override", status, severity, durationMs: Date.now() - start, assertions, evidence, error: errCode ? { code: errCode, message: errMsg ?? "" } : null };
}
```

- [ ] **Step 2: Smoke-test**

Run: `pnpm tsx scripts/e2e-harness/run.ts --workflow W2_uw_override --fixture nqm-bankstmt-12mo-clean --out tmp/e2e-smoke-w2`
Expected: cell file written; assertions array has ≥6 entries; if it passes, decision is the override target, not the original.

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-harness/workflows/W2-uw-override.ts
git commit -m "feat(e2e): W2 UW override workflow"
```

---

## Task 8: Create `W3-send-back-va.ts` — Send Back to VA workflow

**Files:**
- Create: `scripts/e2e-harness/workflows/W3-send-back-va.ts`

**Spec assertions (§5):** After send-back, `assignment.status == "in_progress"`, `pendingRecommendation == null`, audit log captures the send-back action.

- [ ] **Step 1: Write the workflow module**

```typescript
// scripts/e2e-harness/workflows/W3-send-back-va.ts
import { ACTORS, http, type HttpOptions } from "../http.js";
import { APPLIES_TO_ALL } from "../fixtures.js";
import type { AssertionResult, CellResult, FixtureMeta, WorkflowDef } from "../types.js";

export const W3: WorkflowDef = {
  id: "W3_send_back_va",
  name: "Send Back to VA",
  appliesTo: APPLIES_TO_ALL,
  run: async (fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const agentOpts: HttpOptions = { baseUrl: ctx.agentUrl, timeoutMs: 600_000 };
    const assertions: AssertionResult[] = [];

    await http.post(apiOpts, "/world/reset");
    await http.post(apiOpts, "/world/load-scenario", { scenarioId: fixture.id });

    // Assign to a VA, mark report ready, stage recommendation.
    await http.post(apiOpts, `/loans/${fixture.loanId}/assign`, { assignedTo: "va@e2e.test", priority: "normal", actor: ACTORS.human });
    await http.post(apiOpts, `/loans/${fixture.loanId}/assignment-status`, { status: "report_ready", actor: ACTORS.human });
    await http.post(agentOpts, `/api/twin/underwrite-multi/${fixture.loanId}`);

    type Loan = { assignment?: { status?: string }; pendingRecommendation?: unknown };
    const before = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    assertions.push({ name: "rec_present_before_sendback", expected: "non-null", actual: before.pendingRecommendation ?? null, ok: !!before.pendingRecommendation });

    // Send back to VA.
    await http.post(apiOpts, `/loans/${fixture.loanId}/send-back`, { notes: "e2e: re-check income docs", actor: ACTORS.human });

    const after = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    assertions.push({ name: "assignment_back_to_in_progress", expected: "in_progress", actual: after.assignment?.status ?? null, ok: after.assignment?.status === "in_progress" });
    assertions.push({ name: "rec_cleared", expected: null, actual: after.pendingRecommendation ?? null, ok: !after.pendingRecommendation });

    type Audit = { entries?: Array<{ type: string }> };
    const audit = await http.get<Audit>(apiOpts, `/loans/${fixture.loanId}/audit`).catch(() => ({} as Audit));
    const sentBackEntry = (audit.entries ?? []).find((e) => e.type === "SendBackToVA");
    assertions.push({ name: "audit_log_has_sendback", expected: "SendBackToVA entry", actual: sentBackEntry ?? null, ok: !!sentBackEntry });

    const allOk = assertions.every((a) => a.ok);
    const severity = allOk ? null : (assertions.find((a) => !a.ok && (a.name === "assignment_back_to_in_progress" || a.name === "rec_cleared")) ? "P0" : "P1");
    return { loanId: fixture.loanId, fixture: fixture.id, workflow: "W3_send_back_va", status: allOk ? "pass" : "fail", severity, durationMs: Date.now() - start, assertions, evidence: {}, error: null };
  },
};
```

- [ ] **Step 2: Smoke-test**

Run: `pnpm tsx scripts/e2e-harness/run.ts --workflow W3_send_back_va --fixture nqm-bankstmt-12mo-clean --out tmp/e2e-smoke-w3`
Expected: cell file written; if pass, assignment back to in_progress.

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-harness/workflows/W3-send-back-va.ts
git commit -m "feat(e2e): W3 send-back-to-VA workflow"
```

---

## Task 9: Create `W4-efolder-idp-push.ts` — eFolder/IDP/Push workflow

**Files:**
- Create: `scripts/e2e-harness/workflows/W4-efolder-idp-push.ts`

**Spec assertions (§5):** Generate sample doc → run IDP → assert `extractedData` populated → push field → assert `qualifyingWorksheet[pushField] == extractedValue`.

**Skip rule (§5):** Skip ForeignNational fixtures.

- [ ] **Step 1: Write the workflow module**

```typescript
// scripts/e2e-harness/workflows/W4-efolder-idp-push.ts
import { ACTORS, http, type HttpOptions } from "../http.js";
import type { AssertionResult, CellResult, FixtureMeta, WorkflowDef } from "../types.js";

export const W4: WorkflowDef = {
  id: "W4_efolder_idp_push",
  name: "eFolder → IDP → Stare & Compare → Push",
  appliesTo: (f) => f.program !== "ForeignNational",
  run: async (fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const agentOpts: HttpOptions = { baseUrl: ctx.agentUrl, timeoutMs: 600_000 };
    const assertions: AssertionResult[] = [];

    await http.post(apiOpts, "/world/reset");
    await http.post(apiOpts, "/world/load-scenario", { scenarioId: fixture.id });

    // Generate sample docs (writes uploaded files into the loan's eFolder).
    type GenResp = { documentsGenerated?: number };
    const gen = await http.post<GenResp>(agentOpts, `/api/workshop/generate-docs/${fixture.loanId}`);
    assertions.push({ name: "docs_generated", expected: ">0", actual: gen.documentsGenerated ?? 0, ok: (gen.documentsGenerated ?? 0) > 0 });

    type Doc = { id: string; docType: string; fileKey?: string; extractedData?: Record<string, unknown> };
    type Loan = { qualifyingWorksheet?: Record<string, unknown>; documents?: Doc[] };
    const loan = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const bankDoc = (loan.documents ?? []).find((d) => d.docType === "BankStatement" && d.fileKey);
    assertions.push({ name: "bank_doc_present", expected: "BankStatement w/ fileKey", actual: bankDoc?.id ?? null, ok: !!bankDoc });
    if (!bankDoc) return cell(fixture, start, "fail", "P1", assertions, {}, null, null);

    // Run IDP.
    type IdpResp = { extracted?: Record<string, unknown> };
    const idp = await http.post<IdpResp>(agentOpts, `/api/idp/extract-from-twin/${fixture.loanId}/${bankDoc.id}`);
    assertions.push({ name: "idp_returned_extracted", expected: "object", actual: idp.extracted ? "object" : null, ok: !!idp.extracted });

    // Re-fetch to confirm extractedData persisted on the doc.
    const loanAfter = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const docAfter = (loanAfter.documents ?? []).find((d) => d.id === bankDoc.id);
    const extracted = docAfter?.extractedData ?? {};
    assertions.push({ name: "extractedData_persisted", expected: "non-empty", actual: Object.keys(extracted).length, ok: Object.keys(extracted).length > 0 });

    // Push the total_deposits field into avgDeposits via /qualifying-income.
    const totalDeposits = Number((extracted as Record<string, unknown>).total_deposits ?? 0);
    if (!isFinite(totalDeposits) || totalDeposits <= 0) {
      assertions.push({ name: "extracted_total_deposits_numeric", expected: ">0", actual: totalDeposits, ok: false });
      return cell(fixture, start, "fail", "P1", assertions, { extractedKeys: Object.keys(extracted) }, null, null);
    }

    type WorksheetEnvelope = { worksheet?: Record<string, unknown> };
    const ws = (loanAfter.qualifyingWorksheet ?? {}) as Record<string, unknown>;
    const ef = typeof ws.expenseFactor === "number" ? ws.expenseFactor : 0.5;
    const newWorksheet = { ...ws, avgDeposits: totalDeposits, derivedMonthlyIncome: totalDeposits * (1 - ef) };
    await http.post<WorksheetEnvelope>(apiOpts, `/loans/${fixture.loanId}/qualifying-income`, { worksheet: newWorksheet, actor: ACTORS.human });

    const finalLoan = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const wsFinal = (finalLoan.qualifyingWorksheet ?? {}) as Record<string, unknown>;
    assertions.push({ name: "worksheet_avgDeposits_updated", expected: totalDeposits, actual: wsFinal.avgDeposits, ok: wsFinal.avgDeposits === totalDeposits });

    const allOk = assertions.every((a) => a.ok);
    const severity = allOk ? null : (assertions.find((a) => !a.ok && (a.name === "extractedData_persisted" || a.name === "worksheet_avgDeposits_updated")) ? "P0" : "P1");
    return cell(fixture, start, allOk ? "pass" : "fail", severity, assertions, { extractedKeys: Object.keys(extracted) }, null, null);
  },
};

function cell(fixture: FixtureMeta, start: number, status: "pass" | "fail", severity: "P0" | "P1" | "P2" | null, assertions: AssertionResult[], evidence: Record<string, unknown>, errCode: string | null, errMsg: string | null): CellResult {
  return { loanId: fixture.loanId, fixture: fixture.id, workflow: "W4_efolder_idp_push", status, severity, durationMs: Date.now() - start, assertions, evidence, error: errCode ? { code: errCode, message: errMsg ?? "" } : null };
}
```

- [ ] **Step 2: Smoke-test**

Run: `pnpm tsx scripts/e2e-harness/run.ts --workflow W4_efolder_idp_push --fixture nqm-bankstmt-12mo-clean --out tmp/e2e-smoke-w4`
Expected: cell file; assertions include doc generation, IDP returning extracted data, worksheet update.

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-harness/workflows/W4-efolder-idp-push.ts
git commit -m "feat(e2e): W4 eFolder→IDP→push workflow"
```

---

## Task 10: Create `W5-conditions-lifecycle.ts` — Conditions workflow

**Files:**
- Create: `scripts/e2e-harness/workflows/W5-conditions-lifecycle.ts`

**Spec assertions (§5):** Add → link doc → clear with notes → status=Cleared. Dedup blocks duplicate AddCondition with identical category+source+description.

- [ ] **Step 1: Write the workflow module**

```typescript
// scripts/e2e-harness/workflows/W5-conditions-lifecycle.ts
import { ACTORS, http, type HttpOptions } from "../http.js";
import { APPLIES_TO_ALL } from "../fixtures.js";
import type { AssertionResult, CellResult, FixtureMeta, WorkflowDef } from "../types.js";

export const W5: WorkflowDef = {
  id: "W5_conditions_lifecycle",
  name: "Conditions lifecycle",
  appliesTo: APPLIES_TO_ALL,
  run: async (fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const assertions: AssertionResult[] = [];

    await http.post(apiOpts, "/world/reset");
    await http.post(apiOpts, "/world/load-scenario", { scenarioId: fixture.id });

    type Loan = { conditions?: Array<{ id: string; status?: string; description: string }>; documents?: Array<{ id: string; linkedConditionId?: string }> };
    const before = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const baselineCount = before.conditions?.length ?? 0;

    const condition = { category: "PTD" as const, source: "UW" as const, description: "e2e-test condition unique-marker-W5" };

    // Add.
    type AddResp = { condition?: { id: string } };
    const addResp = await http.post<AddResp>(apiOpts, `/loans/${fixture.loanId}/conditions`, { ...condition, actor: ACTORS.human });
    const addedId = addResp.condition?.id ?? null;
    assertions.push({ name: "condition_added", expected: "non-null id", actual: addedId, ok: !!addedId });
    if (!addedId) return cell(fixture, start, "fail", "P0", assertions);

    // Dedup: try adding the same condition again.
    const afterDup = await http.post<{ condition?: { id: string } } | { error?: string }>(apiOpts, `/loans/${fixture.loanId}/conditions`, { ...condition, actor: ACTORS.human }).catch(() => ({} as { error?: string }));
    const loanAfterDup = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const matchingCount = (loanAfterDup.conditions ?? []).filter((c) => c.description === condition.description).length;
    assertions.push({ name: "dedup_blocks_duplicate", expected: 1, actual: matchingCount, ok: matchingCount === 1 });

    // Clear.
    await http.put(apiOpts, `/loans/${fixture.loanId}/conditions/${addedId}/clear`, { notes: "e2e: cleared", actor: ACTORS.human });

    const final = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const cleared = (final.conditions ?? []).find((c) => c.id === addedId);
    assertions.push({ name: "condition_cleared", expected: "Cleared", actual: cleared?.status ?? null, ok: cleared?.status === "Cleared" });
    assertions.push({ name: "condition_count_increased_by_one", expected: baselineCount + 1, actual: final.conditions?.length ?? 0, ok: (final.conditions?.length ?? 0) === baselineCount + 1 });

    const allOk = assertions.every((a) => a.ok);
    const severity = allOk ? null : (assertions.find((a) => !a.ok && (a.name === "condition_cleared" || a.name === "dedup_blocks_duplicate")) ? "P0" : "P1");
    return cell(fixture, start, allOk ? "pass" : "fail", severity, assertions);
  },
};

function cell(fixture: FixtureMeta, start: number, status: "pass" | "fail", severity: "P0" | "P1" | "P2" | null, assertions: AssertionResult[], evidence: Record<string, unknown> = {}): CellResult {
  return { loanId: fixture.loanId, fixture: fixture.id, workflow: "W5_conditions_lifecycle", status, severity, durationMs: Date.now() - start, assertions, evidence, error: null };
}
```

- [ ] **Step 2: Verify the clear endpoint URL is correct**

The clear endpoint may be `PUT /loans/:loanId/conditions/:condId/clear` or `POST` — confirm by:
Run: `grep -n "conditions.*/:condId.*clear\|conditions.*clear" packages/api/src/routes/conditions.ts`
If route is POST, change `http.put` to `http.post` in the file above.

- [ ] **Step 3: Smoke-test**

Run: `pnpm tsx scripts/e2e-harness/run.ts --workflow W5_conditions_lifecycle --fixture nqm-bankstmt-12mo-clean --out tmp/e2e-smoke-w5`
Expected: cell file; condition_cleared and dedup_blocks_duplicate both pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-harness/workflows/W5-conditions-lifecycle.ts
git commit -m "feat(e2e): W5 conditions lifecycle workflow"
```

---

## Task 11: Create `W6-kb-ingest-twokey.ts` — KB Ingest workflow

**Files:**
- Create: `scripts/e2e-harness/workflows/W6-kb-ingest-twokey.ts`

**Spec assertions (§5):** Ingest NPNQM PDFs → operator approval → compliance approval → `kb_version` increments; chatbot answer cites the new version.

**Reference:** Replicate the HTTP calls from `scripts/test-guideline-pipeline.sh` (steps 3-6). One cell per matrix run.

- [ ] **Step 1: Read the existing bash script for the call sequence**

Run: `sed -n '1,200p' scripts/test-guideline-pipeline.sh`
Note: the script is the source of truth for endpoint paths, payloads, and tenant resolution. Replicate its calls in TypeScript via `http.ts`.

- [ ] **Step 2: Write the workflow module**

```typescript
// scripts/e2e-harness/workflows/W6-kb-ingest-twokey.ts
// Mirrors scripts/test-guideline-pipeline.sh in TypeScript. One cell per run.

import { http, type HttpOptions } from "../http.js";
import type { AssertionResult, CellResult, FixtureMeta, WorkflowDef } from "../types.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GUIDELINES_PDF = process.env.GUIDELINES_PDF ?? join(homedir(), "Downloads", "Flex NonQM and DSCR Underwriting Guidelines_02 13 2026 Rev 1.pdf");
const MATRICES_PDF = process.env.MATRICES_PDF ?? join(homedir(), "Downloads", "NonQM and DSCR Matrices_02 13 2026 Rev1.pdf");

export const W6: WorkflowDef = {
  id: "W6_kb_ingest_twokey",
  name: "KB Ingest + Two-Key Approval",
  appliesTo: () => true, // global; runner only invokes it once via GLOBAL_FIXTURE_SENTINEL
  run: async (_fixture: FixtureMeta, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const agentOpts: HttpOptions = { baseUrl: ctx.agentUrl, timeoutMs: 600_000 };
    const assertions: AssertionResult[] = [];

    // Pre-check: PDFs present.
    assertions.push({ name: "guidelines_pdf_present", expected: "exists", actual: existsSync(GUIDELINES_PDF), ok: existsSync(GUIDELINES_PDF) });
    assertions.push({ name: "matrices_pdf_present", expected: "exists", actual: existsSync(MATRICES_PDF), ok: existsSync(MATRICES_PDF) });
    if (!existsSync(GUIDELINES_PDF) || !existsSync(MATRICES_PDF)) {
      return cell(start, "fail", "P1", assertions, "MISSING_PDFS", "set GUIDELINES_PDF and MATRICES_PDF env vars");
    }

    // Resolve NPNQM tenant.
    type TenantsResp = { tenants?: Array<{ id: string; slug: string }> };
    const tenants = await http.get<TenantsResp>(apiOpts, "/tenants");
    const npnqm = (tenants.tenants ?? []).find((t) => t.slug.toLowerCase().includes("npnqm")) ?? (tenants.tenants ?? [])[0];
    assertions.push({ name: "tenant_resolved", expected: "non-null", actual: npnqm?.id ?? null, ok: !!npnqm });
    if (!npnqm) return cell(start, "fail", "P0", assertions, "NO_TENANT", "no tenant available for KB ingest");

    const tenantOpts: HttpOptions = { baseUrl: ctx.apiUrl, tenantId: npnqm.id };
    const tenantAgentOpts: HttpOptions = { baseUrl: ctx.agentUrl, tenantId: npnqm.id, timeoutMs: 600_000 };

    // Read kb_version before.
    type GuidelinesResp = { kb_version?: string | null };
    const before = await http.get<GuidelinesResp>(tenantOpts, "/guidelines").catch(() => ({} as GuidelinesResp));
    const versionBefore = before.kb_version ?? null;

    // Ingest. Endpoint shape inferred from test-guideline-pipeline.sh; adjust if file paths differ.
    type IngestResp = { ingestion_id?: string; status?: string };
    const ingest = await http.post<IngestResp>(tenantAgentOpts, "/api/kb/ingest", {
      tenant_id: npnqm.id,
      guidelines_path: GUIDELINES_PDF,
      matrices_path: MATRICES_PDF,
    }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) } as IngestResp & { error: string }));
    assertions.push({ name: "ingestion_started", expected: "ingestion_id non-null", actual: ingest.ingestion_id ?? null, ok: !!ingest.ingestion_id });
    if (!ingest.ingestion_id) return cell(start, "fail", "P0", assertions, "INGEST_FAILED", "ingestion did not start");

    // Two-key approval (operator + compliance).
    type ApprovalResp = { ok?: boolean };
    const opApproval = await http.post<ApprovalResp>(tenantOpts, `/guidelines/approvals/${ingest.ingestion_id}`, { role: "admin", actor: { kind: "human", id: "e2e-operator" } }).catch(() => ({} as ApprovalResp));
    const cpApproval = await http.post<ApprovalResp>(tenantOpts, `/guidelines/approvals/${ingest.ingestion_id}`, { role: "compliance_officer", actor: { kind: "human", id: "e2e-compliance" } }).catch(() => ({} as ApprovalResp));
    assertions.push({ name: "operator_approval_ok", expected: true, actual: opApproval.ok ?? false, ok: !!opApproval.ok });
    assertions.push({ name: "compliance_approval_ok", expected: true, actual: cpApproval.ok ?? false, ok: !!cpApproval.ok });

    const after = await http.get<GuidelinesResp>(tenantOpts, "/guidelines");
    assertions.push({ name: "kb_version_changed", expected: `!= ${versionBefore}`, actual: after.kb_version ?? null, ok: (after.kb_version ?? null) !== versionBefore && !!after.kb_version });

    // Chatbot smoke.
    type ChatResp = { answer?: string; kb_version?: string };
    const chat = await http.post<ChatResp>(tenantAgentOpts, "/api/chatbot/query", { question: "What is the maximum LTV for a DSCR purchase?", tenant_id: npnqm.id }).catch(() => ({} as ChatResp));
    assertions.push({ name: "chatbot_answered", expected: "non-empty", actual: chat.answer?.length ?? 0, ok: (chat.answer?.length ?? 0) > 0 });
    assertions.push({ name: "chatbot_cites_kb_version", expected: after.kb_version, actual: chat.kb_version ?? null, ok: chat.kb_version === after.kb_version });

    const allOk = assertions.every((a) => a.ok);
    const severity = allOk ? null : (assertions.find((a) => !a.ok && (a.name === "kb_version_changed" || a.name === "ingestion_started")) ? "P0" : "P1");
    return cell(start, allOk ? "pass" : "fail", severity, assertions, null, null, { kbVersionBefore: versionBefore, kbVersionAfter: after.kb_version ?? null });
  },
};

function cell(start: number, status: "pass" | "fail", severity: "P0" | "P1" | "P2" | null, assertions: AssertionResult[], errCode: string | null, errMsg: string | null, evidence: Record<string, unknown> = {}): CellResult {
  return { loanId: null, fixture: "_global", workflow: "W6_kb_ingest_twokey", status, severity, durationMs: Date.now() - start, assertions, evidence, error: errCode ? { code: errCode, message: errMsg ?? "" } : null };
}
```

- [ ] **Step 3: Smoke-test (skips gracefully if PDFs absent)**

Run: `pnpm tsx scripts/e2e-harness/run.ts --workflow W6_kb_ingest_twokey --out tmp/e2e-smoke-w6`
Expected: cell written; if PDFs absent, fails with `MISSING_PDFS` (P1); if present, runs the ingest flow.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-harness/workflows/W6-kb-ingest-twokey.ts
git commit -m "feat(e2e): W6 KB ingest + two-key workflow"
```

---

## Task 12: Create `W7-pattern-detection-llm.ts` — Pattern Detection workflow

**Files:**
- Create: `scripts/e2e-harness/workflows/W7-pattern-detection-llm.ts`

**Spec assertions (§5):** Seed N override decisions for one rule → run pattern detector → assert a `PatternSuggestion` is created → two-key approval → guideline change applied; assert separation-of-duties prevents same-user double approval.

**Reference:** `packages/api/src/routes/patterns.ts` for the detection trigger endpoint.

- [ ] **Step 1: Discover the relevant endpoints**

Run: `grep -n 'app\.\(get\|post\|put\)' packages/api/src/routes/patterns.ts | head -20`
Capture the actual paths. The plan below assumes `POST /patterns/detect` triggers detection and `POST /patterns/:id/approve` records an approval — adjust the file's URLs to match what you find.

- [ ] **Step 2: Write the workflow module**

```typescript
// scripts/e2e-harness/workflows/W7-pattern-detection-llm.ts
import { ACTORS, http, type HttpOptions } from "../http.js";
import type { AssertionResult, CellResult, WorkflowDef } from "../types.js";

const SEED_FIXTURE = "nqm-bankstmt-12mo-clean";
const SEED_COUNT = 4;

export const W7: WorkflowDef = {
  id: "W7_pattern_detection",
  name: "Pattern Detection + LLM Insight",
  appliesTo: () => true, // global; runner invokes once via GLOBAL_FIXTURE_SENTINEL
  run: async (_fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const agentOpts: HttpOptions = { baseUrl: ctx.agentUrl, timeoutMs: 600_000 };
    const assertions: AssertionResult[] = [];

    // Seed N overrides for the same reason against the same fixture.
    for (let i = 0; i < SEED_COUNT; i++) {
      await http.post(apiOpts, "/world/reset");
      await http.post(apiOpts, "/world/load-scenario", { scenarioId: SEED_FIXTURE });
      await http.post(agentOpts, `/api/twin/underwrite-multi/2501000101`);
      type Loan = { pendingRecommendation?: { recommendation: string } | null };
      const l = await http.get<Loan>(apiOpts, `/loans/2501000101`);
      const original = l.pendingRecommendation?.recommendation ?? "approved";
      const overrideTo = original === "approved" ? "suspended" : "approved";
      await http.post(apiOpts, `/loans/2501000101/override`, {
        originalRecommendation: original,
        overrideDecision: overrideTo,
        overrideReason: "DTI_RATIO_EXCEPTION",
        rationale: `e2e-pattern-seed-${i}`,
        actor: ACTORS.human,
      });
    }
    assertions.push({ name: "seeded_overrides", expected: SEED_COUNT, actual: SEED_COUNT, ok: true });

    // Trigger pattern detection. (Endpoint per Step 1.)
    type DetectResp = { patterns?: Array<{ id: string; rule: string; suggestion_id?: string }>; suggestions?: Array<{ id: string }> };
    const detect = await http.post<DetectResp>(apiOpts, "/patterns/detect").catch((e) => ({ error: e instanceof Error ? e.message : String(e) } as DetectResp & { error: string }));
    const patternsFound = (detect.patterns ?? []).length + (detect.suggestions ?? []).length;
    assertions.push({ name: "patterns_detected", expected: ">0", actual: patternsFound, ok: patternsFound > 0 });

    const suggestion = detect.suggestions?.[0] ?? (detect.patterns ?? []).find((p) => p.suggestion_id);
    const suggestionId = (suggestion as { id?: string; suggestion_id?: string })?.id ?? (suggestion as { suggestion_id?: string })?.suggestion_id ?? null;
    assertions.push({ name: "suggestion_id_present", expected: "non-null", actual: suggestionId, ok: !!suggestionId });
    if (!suggestionId) return cell(start, "fail", "P0", assertions);

    // Two-key approval — same user denied (separation-of-duties), then second user approved.
    const op1 = await http.post<{ ok?: boolean }>(apiOpts, `/patterns/${suggestionId}/approve`, { role: "admin", actor: { kind: "human", id: "e2e-user-A" } }).catch(() => ({} as { ok?: boolean }));
    const opSelf = await http.post<{ ok?: boolean; error?: string }>(apiOpts, `/patterns/${suggestionId}/approve`, { role: "compliance_officer", actor: { kind: "human", id: "e2e-user-A" } }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) } as { ok?: boolean; error?: string }));
    const op2 = await http.post<{ ok?: boolean }>(apiOpts, `/patterns/${suggestionId}/approve`, { role: "compliance_officer", actor: { kind: "human", id: "e2e-user-B" } }).catch(() => ({} as { ok?: boolean }));

    assertions.push({ name: "first_approval_ok", expected: true, actual: op1.ok ?? false, ok: !!op1.ok });
    assertions.push({ name: "self_approval_blocked", expected: "blocked", actual: opSelf.ok ? "allowed" : "blocked", ok: !opSelf.ok });
    assertions.push({ name: "second_approval_ok", expected: true, actual: op2.ok ?? false, ok: !!op2.ok });

    const allOk = assertions.every((a) => a.ok);
    const severity = allOk ? null : (assertions.find((a) => !a.ok && (a.name === "self_approval_blocked" || a.name === "patterns_detected")) ? "P0" : "P1");
    return cell(start, allOk ? "pass" : "fail", severity, assertions);
  },
};

function cell(start: number, status: "pass" | "fail", severity: "P0" | "P1" | "P2" | null, assertions: AssertionResult[], evidence: Record<string, unknown> = {}): CellResult {
  return { loanId: null, fixture: "_global", workflow: "W7_pattern_detection", status, severity, durationMs: Date.now() - start, assertions, evidence, error: null };
}
```

- [ ] **Step 3: Smoke-test**

Run: `pnpm tsx scripts/e2e-harness/run.ts --workflow W7_pattern_detection --out tmp/e2e-smoke-w7`
Expected: cell file; pattern detected after 4 seeded overrides.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-harness/workflows/W7-pattern-detection-llm.ts
git commit -m "feat(e2e): W7 pattern detection + two-key workflow"
```

---

## Task 13: Create `W8-multi-tenant-rls.ts` — RLS Isolation workflow

**Files:**
- Create: `scripts/e2e-harness/workflows/W8-multi-tenant-rls.ts`

**Spec assertions (§5):** Create loan in tenant A → attempt fetch as tenant B with explicit `x-tenant-id` → assert 403 or 404, never returns A's data. Cleanup ephemeral test tenants.

**Skip rule (§5):** Runs only against the 3 representatives in `RLS_REPRESENTATIVES`.

- [ ] **Step 1: Write the workflow module**

```typescript
// scripts/e2e-harness/workflows/W8-multi-tenant-rls.ts
import { http, HttpError, type HttpOptions } from "../http.js";
import { APPLIES_TO_RLS } from "../fixtures.js";
import type { AssertionResult, CellResult, FixtureMeta, WorkflowDef } from "../types.js";

const TENANT_PREFIX = "e2e-test-";

export const W8: WorkflowDef = {
  id: "W8_multi_tenant_rls",
  name: "Multi-Tenant Isolation",
  appliesTo: APPLIES_TO_RLS,
  run: async (fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const assertions: AssertionResult[] = [];

    // Cleanup any leftover e2e-test-* tenants from prior runs.
    type TenantsResp = { tenants?: Array<{ id: string; slug: string }> };
    const all = await http.get<TenantsResp>(apiOpts, "/tenants");
    for (const t of all.tenants ?? []) {
      if (t.slug.startsWith(TENANT_PREFIX)) {
        await http.delete(apiOpts, `/tenants/${t.slug}`).catch(() => {});
      }
    }

    // Create tenant A and tenant B.
    type CreateResp = { tenant?: { id: string; slug: string } };
    const aSlug = `${TENANT_PREFIX}a-${Date.now()}`;
    const bSlug = `${TENANT_PREFIX}b-${Date.now()}`;
    const a = await http.post<CreateResp>(apiOpts, "/tenants", { name: "E2E Tenant A", slug: aSlug });
    const b = await http.post<CreateResp>(apiOpts, "/tenants", { name: "E2E Tenant B", slug: bSlug });
    assertions.push({ name: "tenant_a_created", expected: "non-null", actual: a.tenant?.id ?? null, ok: !!a.tenant });
    assertions.push({ name: "tenant_b_created", expected: "non-null", actual: b.tenant?.id ?? null, ok: !!b.tenant });
    if (!a.tenant || !b.tenant) return cell(fixture, start, "fail", "P0", assertions);

    // Load fixture under tenant A's context.
    const aOpts: HttpOptions = { baseUrl: ctx.apiUrl, tenantId: a.tenant.id };
    await http.post(aOpts, "/world/reset");
    await http.post(aOpts, "/world/load-scenario", { scenarioId: fixture.id });

    // Tenant A can read its own loan.
    type Loan = { id: string };
    const aRead = await http.get<Loan>(aOpts, `/loans/${fixture.loanId}`).catch((e) => ({ error: e instanceof HttpError ? e.status : String(e) } as Loan & { error: unknown }));
    assertions.push({ name: "tenant_a_can_read_own_loan", expected: fixture.loanId, actual: (aRead as Loan).id ?? null, ok: (aRead as Loan).id === fixture.loanId });

    // Tenant B should NOT see the loan.
    const bOpts: HttpOptions = { baseUrl: ctx.apiUrl, tenantId: b.tenant.id };
    let bStatus: number | null = null;
    let bData: unknown = null;
    try {
      bData = await http.get<Loan>(bOpts, `/loans/${fixture.loanId}`);
    } catch (e) {
      if (e instanceof HttpError) bStatus = e.status;
      else throw e;
    }
    assertions.push({ name: "tenant_b_blocked_or_not_found", expected: "403 or 404", actual: bStatus, ok: bStatus === 403 || bStatus === 404 });
    assertions.push({ name: "tenant_b_did_not_receive_data", expected: null, actual: bData ?? null, ok: bData === null });

    // Cleanup.
    await http.delete(apiOpts, `/tenants/${aSlug}`).catch(() => {});
    await http.delete(apiOpts, `/tenants/${bSlug}`).catch(() => {});

    const allOk = assertions.every((a) => a.ok);
    const severity = allOk ? null : (assertions.find((a) => !a.ok && (a.name === "tenant_b_blocked_or_not_found" || a.name === "tenant_b_did_not_receive_data")) ? "P0" : "P1");
    return cell(fixture, start, allOk ? "pass" : "fail", severity, assertions);
  },
};

function cell(fixture: FixtureMeta, start: number, status: "pass" | "fail", severity: "P0" | "P1" | "P2" | null, assertions: AssertionResult[], evidence: Record<string, unknown> = {}): CellResult {
  return { loanId: fixture.loanId, fixture: fixture.id, workflow: "W8_multi_tenant_rls", status, severity, durationMs: Date.now() - start, assertions, evidence, error: null };
}
```

- [ ] **Step 2: Verify tenant create/delete endpoint shapes**

Run: `grep -n 'app\.\(post\|delete\)' packages/api/src/routes/tenants.ts | head -10`
If `POST /tenants` requires different fields, or delete is `DELETE /tenants/:slug` vs `:id`, adjust the file accordingly.

- [ ] **Step 3: Smoke-test**

Run: `pnpm tsx scripts/e2e-harness/run.ts --workflow W8_multi_tenant_rls --fixture nqm-bankstmt-12mo-clean --out tmp/e2e-smoke-w8`
Expected: cell file; tenant B blocked with 403/404, no data leaked.

- [ ] **Step 4: Commit**

```bash
git add scripts/e2e-harness/workflows/W8-multi-tenant-rls.ts
git commit -m "feat(e2e): W8 multi-tenant RLS isolation workflow"
```

---

## Task 14: Polish `aggregate.ts` and add `README.md`

**Files:**
- Modify: `scripts/e2e-harness/aggregate.ts`
- Create: `scripts/e2e-harness/README.md`

- [ ] **Step 1: Replace `renderSummary` and `renderPunchList` with richer formatters**

Replace those two functions in `aggregate.ts` with the following:

```typescript
function renderSummary(r: RunReport): string {
  const slowest = [...r.cells].filter((c) => c.status !== "skip").sort((a, b) => b.durationMs - a.durationMs)[0];
  const passPct = r.executed ? Math.round((r.passed / r.executed) * 100) : 0;
  const lines = [
    `# E2E Validation Run`,
    ``,
    `- **Started:** ${r.startedAt}`,
    `- **Finished:** ${r.finishedAt}`,
    `- **Duration:** ${(r.durationMs / 1000).toFixed(1)}s`,
    ``,
    `## Results`,
    ``,
    `- Total matrix cells: **${r.totalCells}**`,
    `- Executed: **${r.executed}** (skipped: ${r.skipped})`,
    `- Passed: **${r.passed} / ${r.executed}** (${passPct}%)`,
    `- Failed: **${r.failed}** — P0: ${r.bySeverity.P0}, P1: ${r.bySeverity.P1}, P2: ${r.bySeverity.P2}`,
    ``,
  ];
  if (slowest) lines.push(`Slowest cell: ${slowest.workflow} / ${slowest.fixture} (${(slowest.durationMs / 1000).toFixed(1)}s)`, ``);
  if (r.aborted) lines.push(`> **ABORTED**: ${r.abortReason ?? "unknown"}`, ``);
  // Per-workflow breakdown
  lines.push(`## By workflow`, ``, `| Workflow | Executed | Passed | Failed | P0 |`, `|---|---:|---:|---:|---:|`);
  const byWorkflow = new Map<string, { exec: number; pass: number; fail: number; p0: number }>();
  for (const c of r.cells) {
    const w = byWorkflow.get(c.workflow) ?? { exec: 0, pass: 0, fail: 0, p0: 0 };
    if (c.status !== "skip") w.exec++;
    if (c.status === "pass") w.pass++;
    if (c.status === "fail") w.fail++;
    if (c.severity === "P0") w.p0++;
    byWorkflow.set(c.workflow, w);
  }
  for (const [name, s] of byWorkflow) lines.push(`| ${name} | ${s.exec} | ${s.pass} | ${s.fail} | ${s.p0} |`);
  return lines.join("\n") + "\n";
}

function renderPunchList(cells: CellResult[]): string {
  const fails = cells.filter((c) => c.status === "fail");
  const order: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
  fails.sort((a, b) => (order[a.severity ?? "P2"] ?? 99) - (order[b.severity ?? "P2"] ?? 99));
  if (fails.length === 0) return "# Punch List\n\nNo failures.\n";
  const sections: string[] = ["# Punch List", "", `${fails.length} failure(s) — sorted by severity.`, ""];
  for (const sev of ["P0", "P1", "P2"] as const) {
    const slice = fails.filter((c) => c.severity === sev);
    if (slice.length === 0) continue;
    sections.push(`## ${sev} — ${slice.length}`, "");
    for (const c of slice) {
      sections.push(`### ${c.workflow} / ${c.fixture}`, "");
      if (c.error) sections.push(`**Error:** \`${c.error.code}\` — ${c.error.message}`, "");
      const failed = c.assertions.filter((a) => !a.ok);
      if (failed.length) {
        sections.push("**Failed assertions:**");
        for (const a of failed) sections.push(`- \`${a.name}\` — expected \`${JSON.stringify(a.expected)}\`, got \`${JSON.stringify(a.actual)}\``);
        sections.push("");
      }
      sections.push(`**Repro:** \`pnpm tsx scripts/e2e-harness/run.ts --workflow ${c.workflow} --fixture ${c.fixture}\``, "");
    }
  }
  return sections.join("\n");
}
```

- [ ] **Step 2: Write `README.md`**

```markdown
# E2E Validation Harness

One-shot CLI harness that runs 20 NQM fixtures × 8 named workflows against a live local stack and emits a severity-graded punch list.

## Quickstart

1. Start the stack: `./scripts/dev-up.sh` (API :4000, Web :3000, Agent :8000)
2. Full run: `pnpm tsx scripts/e2e-harness/run.ts`
3. Read results: `reports/<run-id>/punch-list.md`

## Single-cell run

```
pnpm tsx scripts/e2e-harness/run.ts --workflow W1_uw_accept --fixture nqm-bankstmt-12mo-clean
```

## Output

```
reports/<run-id>/
├── matrix.json            # full machine-readable result
├── summary.md             # top-level stats + by-workflow table
├── punch-list.md          # P0s first, then P1s, then P2s, with repro commands
└── cells/<workflow>/<fixture>.json
```

Severity rubric: see spec `docs/superpowers/specs/2026-05-08-e2e-validation-harness-design.md` §6.

## Relationship to other test surfaces

- `pnpm --filter @twin/core test` — 84 reducer/store unit tests.
- `pnpm --filter @twin/api test` — 98 API integration tests.
- `GET /system/integrity` — 220 invariant checks across all 20 loans.
- `POST /system/behavioral-test` — 10 reducer-level workflow tests against one fixture (~5s).
- This harness — broad fixture × workflow matrix, ~8-15 min per run.

All four are kept; they catch different things.

## Environment

- `API_URL` (default `http://localhost:4000`)
- `AGENT_SERVICE_URL` (default `http://localhost:8000`)
- `GUIDELINES_PDF`, `MATRICES_PDF` — for W6, default to `~/Downloads/...`
```

- [ ] **Step 3: Commit**

```bash
git add scripts/e2e-harness/aggregate.ts scripts/e2e-harness/README.md
git commit -m "feat(e2e): polished aggregator + harness README"
```

---

## Task 15: End-to-end smoke test

**Files:**
- None (verification only)

- [ ] **Step 1: Run a single-workflow single-fixture cell**

Run: `pnpm tsx scripts/e2e-harness/run.ts --workflow W1_uw_accept --fixture nqm-bankstmt-12mo-clean --out tmp/e2e-final-smoke`

Expected: command exits with code 0 (or 1 if real failures); the following files exist:
- `tmp/e2e-final-smoke/matrix.json`
- `tmp/e2e-final-smoke/summary.md`
- `tmp/e2e-final-smoke/punch-list.md`
- `tmp/e2e-final-smoke/cells/W1_uw_accept/nqm-bankstmt-12mo-clean.json`

- [ ] **Step 2: Verify the JSON schema is well-formed**

Run: `node -e 'const r = require("./tmp/e2e-final-smoke/matrix.json"); if (!r.cells || !Array.isArray(r.cells) || r.cells.length === 0) { console.error("bad matrix"); process.exit(1); } const c = r.cells[0]; if (!c.workflow || !c.fixture || !["pass","fail","skip"].includes(c.status)) { console.error("bad cell"); process.exit(1); } console.log("schema ok"); '`
Expected: `schema ok`.

- [ ] **Step 3: Verify a deliberately broken assertion produces a P0 fail**

Manually edit `scripts/e2e-harness/workflows/W1-uw-accept.ts` and change the `decision_matches_staged` assertion's expected value to `"NEVER_THIS_VALUE"`. Re-run Step 1.
Expected: `summary.md` shows 1 failure with P0; `punch-list.md` lists the cell with the broken assertion.

Revert the edit before continuing: `git checkout scripts/e2e-harness/workflows/W1-uw-accept.ts`.

- [ ] **Step 4: Commit a marker that the harness is verified**

```bash
git add -A
git commit --allow-empty -m "chore(e2e): harness smoke-verified end-to-end"
```

- [ ] **Step 5: Trigger the full matrix run (user-driven, not a sub-agent task)**

The harness is now ready for the full run:

```bash
pnpm tsx scripts/e2e-harness/run.ts
```

Read `reports/<run-id>/punch-list.md` to drive the next development backlog.

---

## Self-review

**1. Spec coverage:**
- §2 (architecture) → covered by file structure table + Tasks 1–5.
- §3 (components) → each file mapped to a task.
- §4 (data flow) → Task 4 (`run.ts`) implements the loop, Task 5 + 14 (`aggregate.ts`) implements the writers.
- §5 (8 workflows + skip rules) → Tasks 6–13.
- §6 (evidence schema + rubric) → Task 1 defines types; Tasks 6–13 each compute severity inline per the rubric.
- §7 (error handling) → Task 4 handles workflow crashes and abort; pre-flight is in Task 2 + Task 4.
- §8 (testing the harness) → Task 15.
- §9 (sub-agent waves) → mapped explicitly in the file structure table and the Wave Dispatch Model paragraph.
- §10 (first-run outputs) → Tasks 5 + 14 produce all four artifact types.
- §11 (out-of-scope) → respected; nothing in the plan touches Playwright, CI, or history tooling.
- §12 (open questions) → resolved in the Resolutions section above.

**2. Placeholder scan:** No "TBD", no "implement later", no "similar to". Code blocks contain real, runnable code. The two cases where the engineer has to verify a URL (Task 10 Step 2 for conditions clear, Task 12 Step 1 for patterns) are explicit verification steps with the exact grep command, not placeholders.

**3. Type consistency:** `CellResult.severity: Severity` is used uniformly. Workflow ids are exact strings (e.g. `"W1_uw_accept"`) used consistently in modules and run.ts. `FixtureMeta` shape matches between `fixtures.ts` and the workflow signatures. `HttpOptions` and `ACTORS` from `http.ts` are imported the same way everywhere.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-08-e2e-validation-harness.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — coordinator dispatches a fresh subagent per task; review between tasks; aligns directly with the spec's three-wave deployment model (Wave 1 = Tasks 1–5 sequentially, Wave 2 = Tasks 6–13 in parallel, Wave 3 = Tasks 14–15).

2. **Inline Execution** — run tasks in this session with batch checkpoints; simpler but loses the parallel speedup.

Which approach?
