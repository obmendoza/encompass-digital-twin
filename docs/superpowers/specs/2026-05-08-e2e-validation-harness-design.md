# E2E Validation Harness — Design

**Date:** 2026-05-08
**Status:** Design (pending implementation plan)
**Driver:** Validate the recent codebase audit by running all 20 NQM loan fixtures through every developed module via named end-to-end workflows. The harness output becomes the prioritized development backlog.

## 1. Problem & goal

A static read of the codebase produced an audit whose headline finding ("Push-to-Loan reads but doesn't write") was contradicted by direct code inspection. We need a **dynamic** validation pass to surface the *real* gaps before committing to a next slice of work.

**Goal:** in one execution run, score every (fixture × workflow) cell pass/fail with severity, capture machine-readable evidence per cell, and emit a human punch list sorted by severity.

**Non-goal:** This is a one-shot validation harness, not a permanent CI fixture. UI smoke testing (Playwright), CI integration, and history/diff tooling are explicitly deferred to a future iteration if the data justifies further investment.

## 2. Architecture

A self-contained CLI test harness under `scripts/e2e-harness/` that runs the 20 fixtures × 8 workflows matrix against a live local stack — API on :4000, Web on :3000, Agent on :8000 (restorable via `scripts/dev-up.sh`).

The harness:
- Lives in `scripts/`, not in any `packages/` workspace, so it's clearly test infrastructure and won't ship to deployments.
- Issues HTTP requests to the running API/Agent — no in-process imports of @twin/api beyond types from @twin/core.
- Writes report artifacts to `reports/<run-id>/`.

**Three guarantees:**
1. **Idempotent.** Every workflow calls `ResetWorld` then `LoadScenario` before its assertions. Any failure leaves no residue; any cell can be re-run alone via `--workflow Wn --fixture <id>`.
2. **Self-describing output.** Every run writes `matrix.json` (machine-readable), `punch-list.md` (severity-sorted), `summary.md` (top-level stats), and `cells/<workflow>/<fixture>.json` (per-cell detail).
3. **No new production dependencies.** Uses `tsx` (already a devDep), shared types from `@twin/core`, and `fetch`. No new package added.

## 3. Components

```
scripts/e2e-harness/
├── run.ts              # Entry point. Args, orchestration, report writing.
├── types.ts            # CellResult, Severity, AssertionResult, EvidenceBundle, RunReport.
├── fixtures.ts         # Imports the 20 from @twin/fixtures; classifier + applicableTo() helpers.
├── http.ts             # Thin fetch() wrapper. Base URLs, JSON helpers, actor injection.
├── workflows/
│   ├── W1-uw-accept.ts
│   ├── W2-uw-override.ts
│   ├── W3-send-back-va.ts
│   ├── W4-efolder-idp-push.ts
│   ├── W5-conditions-lifecycle.ts
│   ├── W6-kb-ingest-twokey.ts
│   ├── W7-pattern-detection-llm.ts
│   └── W8-multi-tenant-rls.ts
├── aggregate.ts        # CellResult[] → matrix.json + punch-list.md + summary.md
└── README.md           # How to run, what the output means.
```

Every workflow module exports the same shape:

```typescript
export const W1: WorkflowDef = {
  id: "W1_uw_accept",
  name: "UW Decision — Accept",
  appliesTo: (fixture: FixtureMeta) => boolean,
  run: async (fixture: FixtureMeta, ctx: RunContext) => CellResult,
};
```

## 4. Data flow per cell

```
run.ts iterates (fixture, workflow)
  │
  ▼
Workflow.run(fixture, ctx)
  ├─► POST /system/reset (ResetWorld) + load fixture
  ├─► [workflow-specific calls — see §5]
  ├─► Capture evidence: GET /loans/:id, agent trace, decision record
  ├─► Run assertions
  ├─► Compute severity (P0/P1/P2 by rubric §6)
  └─► Return CellResult
  │
  ▼ after all 160 cells
aggregate(results, outDir)
  ├─► reports/<run-id>/matrix.json
  ├─► reports/<run-id>/punch-list.md (severity-sorted)
  ├─► reports/<run-id>/summary.md
  └─► reports/<run-id>/cells/<workflow>/<fixture>.json
```

## 5. The 8 workflows

Each workflow runs against all 20 fixtures unless `appliesTo()` returns false (a skip, not a fail).

| # | ID | Name | Key assertions |
|---|---|---|---|
| W1 | `W1_uw_accept` | UW Decision — Accept | After `accept`, `loan.decision == staged.recommendation`; `decisionRecord` exists with non-null `kbVersion` and `chatbotConsultationId`; agent trace length > 0; pipeline cost > 0. |
| W2 | `W2_uw_override` | UW Decision — Override | Override records original + override + `overrideReason` (one of 9 valid categories) + rationale. Decision record persists override metadata. |
| W3 | `W3_send_back_va` | Send Back to VA | After send-back, `assignment.status == "in_progress"`, `pendingRecommendation == null`, audit log captures the send-back action. |
| W4 | `W4_efolder_idp_push` | eFolder → IDP → Stare & Compare → Push | Generate sample doc → run IDP via agent → assert `extractedData` populated → push field → assert `qualifyingWorksheet[pushField] == extractedValue`. |
| W5 | `W5_conditions_lifecycle` | Conditions lifecycle | Add → link doc → clear with notes → status=Cleared. Dedup blocks duplicate AddCondition with identical category+source+description. |
| W6 | `W6_kb_ingest_twokey` | KB Ingest + Two-Key Approval | Ingest NPNQM PDFs → operator approval → compliance approval → `kb_version` increments; chatbot answer cites the new version. (Mirrors `scripts/test-guideline-pipeline.sh`.) |
| W7 | `W7_pattern_detection` | Pattern detection + LLM insight | Seed N override decisions for one rule → run pattern detector → assert a `PatternSuggestion` is created → two-key approval → guideline change applied; assert separation-of-duties prevents same-user double approval. |
| W8 | `W8_multi_tenant_rls` | Multi-Tenant Isolation | Create loan in tenant A → attempt fetch as tenant B with explicit `x-tenant-id` → assert 403 or 404, never returns A's data. Cleanup ephemeral test tenants. |

**Skip rules** (encoded in `appliesTo`):
- DSCR fixtures skip DTI-related assertions in W1/W2 but still execute the workflow.
- Edge fixtures whose program is ForeignNational skip W4 if no docs exist.
- W6 runs once per matrix run (KB ingest is global, not per-fixture). It still occupies a row in the matrix as a single cell.
- W7 runs once per matrix run (pattern detector is global). Single cell.
- W8 runs against 3 fixtures (one each: bank-stmt, DSCR, full-doc) — not all 20, since RLS behavior is uniform across fixture types.

**Effective cell count:** 5 workflows (W1–W5) × 20 fixtures + W6 × 1 + W7 × 1 + W8 × 3 = **105 executed cells**. The full matrix is still 8 × 20 = 160; the remaining 55 cells are recorded as `status: "skip"` in `matrix.json`.

## 6. Evidence schema and rubric

**Evidence (per cell):**

```json
{
  "loanId": "2501000101",
  "fixture": "nqm-bankstmt-12mo-clean",
  "workflow": "W1_uw_accept",
  "status": "pass | fail | skip",
  "severity": "P0 | P1 | P2 | null",
  "durationMs": 1234,
  "assertions": [
    { "name": "decision==approved", "expected": "approved", "actual": "approved", "ok": true }
  ],
  "evidence": {
    "decisionRecordId": "dr_abc",
    "kbVersion": "v3",
    "agentTraceLength": 12,
    "pipelineCostUsd": 0.043,
    "screenshotPath": null
  },
  "error": null
}
```

**Severity rubric:**

| Level | Definition | Examples |
|---|---|---|
| **P0** | Show-stopper: blocks the lender from doing their job. | Wrong decision recorded; RLS leak (Tenant B sees Tenant A's loan); agent crashes; data corruption; missing decision record after Accept; action dispatch error. |
| **P1** | Degraded: workflow completes but with measurable defect. | Missing evidence (no kb_version, no trace); assertion partially fails (DTI off by 3% but classification correct); perf > threshold; placeholder text in UI. |
| **P2** | Cosmetic: result correct, presentation imperfect. | Visual glitch; typo; label mismatch; cost slightly above expected but result correct; sort order off. |

**Skip ≠ fail.** Skipped cells appear in `matrix.json` with `status: "skip"` and `severity: null` and are excluded from fail counts in summary.md. Skips are noted in punch-list.md only when a workflow that's *expected* to run broadly (W1–W5) has more than 30% of its row skipped — that's a signal the fixture set may need to grow. W6/W7 (one-cell-by-design) and W8 (three-cell-by-design) are exempt from this rule; their skip rates are expected.

## 7. Error handling

| Failure type | Where | Handling |
|---|---|---|
| Assertion fail | inside `workflow.run` | `CellResult.status="fail"`, severity by rubric, error captured. |
| Workflow crash (uncaught throw) | inside `workflow.run` | `run.ts` catch block → `CellResult.status="fail"`, severity=P0, full `error.stack` in cell file. |
| Harness crash (e.g., API down mid-run) | `run.ts` orchestration | Abort run; write partial report with `aborted: true, reason: "..."` flag; preserve completed cells. |

**No retries.** Flaky behavior is itself a P1 finding; quiet retries would mask real instability.

**Pre-flight check at startup:** runner pings `/system/health` (API) and `agent /health` (each must respond < 2s with non-error status). The web tier is not required — the harness only talks to API and Agent. If either is down, fail fast with a clear message and run zero cells.

**Tenant cleanup:** W8 creates and deletes ephemeral test tenants matching `e2e-test-*`. If a previous run crashed leaving them behind, W8 starts by purging matching tenants before its assertions.

## 8. Testing the harness itself

A **2-minute manual smoke test** before the full run:

```bash
pnpm tsx scripts/e2e-harness/run.ts --workflow W1 --fixture nqm-bankstmt-12mo-clean
```

Confirm:
1. `matrix.json` schema validates against `types.ts`.
2. `punch-list.md` renders.
3. A deliberately broken assertion (temporarily flip the expected decision) produces a fail with severity P0.

No vitest tests for the harness itself — YAGNI for one-shot infrastructure, smoke covers the same ground faster.

## 9. Sub-agent deployment

The build is parallelizable in three waves:

**Wave 1 — Foundation** (1 agent, ~10 min):
Writes `types.ts`, `fixtures.ts`, `http.ts`, `run.ts` skeleton, and `aggregate.ts` skeleton. All shared scaffolding. Coordinator reviews output before launching Wave 2.

**Wave 2 — Workflows** (8 agents in parallel, ~15 min wall-clock, gated by slowest):
- A1 → `W1-uw-accept.ts`
- A2 → `W2-uw-override.ts`
- A3 → `W3-send-back-va.ts`
- A4 → `W4-efolder-idp-push.ts`
- A5 → `W5-conditions-lifecycle.ts`
- A6 → `W6-kb-ingest-twokey.ts`
- A7 → `W7-pattern-detection-llm.ts`
- A8 → `W8-multi-tenant-rls.ts`

No merge conflicts — each agent writes one isolated file.

**Wave 3 — Aggregator polish + smoke** (1 agent, ~10 min):
Fills in `aggregate.ts` (Markdown formatter, severity-sorted punch list, summary stats); runs the smoke test from §8.

**Wave 4 — Full run** (user-triggered, ~8-15 min execution):
```bash
pnpm tsx scripts/e2e-harness/run.ts --out reports/$(date +%Y-%m-%d-%H%M)/
```

**Total wall-clock budget: ~35-50 min** from green-field to a reviewable punch-list.

## 10. First-run outputs

```
reports/2026-05-08-1430/
├── matrix.json                       # full machine-readable result
├── punch-list.md                     # P0s first, then P1s, then P2s
├── summary.md                        # top-level stats
└── cells/
    ├── W1_uw_accept/
    │   ├── nqm-bankstmt-12mo-clean.json
    │   ├── ... (20 cells)
    ├── W2_uw_override/
    │   └── ...
    └── ... (8 workflow dirs)
```

**summary.md format:**

```
# E2E Run 2026-05-08 14:30
- Cells executed: 105 (55 skipped)
- Passed: 84 (80%)
- Failed: 21 (P0: 3, P1: 14, P2: 4)
- Total duration: 11m 24s
- Slowest cell: W4 / nqm-edge-large-deposit (8.2s)
```

**punch-list.md format:** for each fail, the file path, fixture, workflow, assertion that failed, expected vs. actual, and a "Repro" line with the exact `pnpm tsx ... --workflow Wn --fixture ...` command.

## 11. Out of scope (deferred)

- UI smoke / Playwright — defer until API-level findings stabilize.
- CI integration — defer until we re-run the harness manually 2-3 times and trust the signal.
- History/diff tooling — defer; `git log reports/` is sufficient short-term.
- Multi-instance API parallelism — defer; sequential execution is fast enough for one-shot.
- Stress/load testing — out of scope; this is correctness, not capacity.

## 12. Open questions for the implementation plan

These belong in the writing-plans phase, not here:

- Which `/system` admin endpoints (if any) need to be added to support `ResetWorld` over HTTP? (Possibly a new `POST /system/reset` route.)
- How does W6 invoke KB ingestion programmatically when the existing flow is a bash script? (Likely: extract its HTTP calls into a TS module the workflow can call.)
- Does the existing `behavioral-test` endpoint stay or get folded into the harness? (Recommendation: keep both — `behavioral-test` is a fast smoke for the reducer; this harness is the broad matrix.)
