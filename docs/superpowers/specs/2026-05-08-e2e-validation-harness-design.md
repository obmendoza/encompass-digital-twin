# E2E Validation Harness — Design

**Date:** 2026-05-08 (revised after technical review)
**Status:** Design (pending implementation plan)
**Driver:** Validate the recent codebase audit by running all 20 NQM loan fixtures through every developed module via named end-to-end workflows. The harness produces *two* distinct outputs: an audit-validation report (was the audit right?) and a prioritized development backlog (what's broken now?).

## 1. Problem & goal

A static read of the codebase produced an audit whose headline finding ("Push-to-Loan reads but doesn't write") was contradicted by direct code inspection. We need a **dynamic** validation pass to surface the *real* gaps before committing to a next slice of work.

**The harness has two purposes that share execution but produce different reports:**

1. **Audit validation** — for each claim in the recent audit, did dynamic execution CONFIRM, CONTRADICT, or leave INCONCLUSIVE? This is a methodology signal about how we generate audits, not an operational signal about what to fix.
2. **Backlog generation** — what's broken right now, sorted by severity? This is the operational signal that drives the next sprint.

A pass on a backlog assertion that *also* tests an audit claim simultaneously says "this is healthy" (operational) and "the audit was wrong about this" (methodology). Conflating the two reports loses the methodology signal.

**Goal:** in one execution run, score every (fixture × workflow) cell pass/fail with severity, emit machine-readable evidence per cell, a human punch list sorted by severity, *and* an audit-validation report mapping each audit claim to the cell(s) that tested it.

**Non-goal:** This is a one-shot validation harness, not a permanent CI fixture. UI smoke testing (Playwright), CI integration, and history/diff tooling are explicitly deferred to a future iteration if the data justifies further investment. **TDD-grade quality on new code is a separate effort** — see §13 for the layered quality model.

## 2. Architecture

A self-contained CLI test harness under `scripts/e2e-harness/` that runs the 20 fixtures × 8 workflows matrix against a live local stack — API on :4000, Web on :3000, Agent on :8000 (restorable via `scripts/dev-up.sh`).

The harness:
- Lives in `scripts/`, not in any `packages/` workspace, so it's clearly test infrastructure and won't ship to deployments.
- Issues HTTP requests to the running API/Agent — no in-process imports of @twin/api beyond types from @twin/core.
- Writes report artifacts to `reports/<run-id>/`.

**Three guarantees:**
1. **Idempotent for transient state.** Every workflow calls `ResetWorld` then `LoadScenario` before its assertions. Any failure leaves no in-memory residue; any cell can be re-run alone via `--workflow Wn --fixture <id>`. **Persistent audit/cost records accumulate by design** — `decision_records`, `tenant_audit_log`, `kb_cost_events`, ChromaDB collections, and Supabase Storage uploads are append-only or out-of-scope for `ResetWorld`. Every harness-generated record carries `metadata.harness_run_id`; a `--purge-test-data` flag removes records tagged with a given run id, and W6/W8 ingest into ephemeral `e2e-test-*` tenants whose deletion cascades to their persistent state.
2. **Self-describing output.** Every run writes `matrix.json` (machine-readable, Zod-validated), `punch-list.md` (severity-sorted, error-fingerprinted), `summary.md` (top-level stats including total LLM cost), `audit-validation.md` (per-claim CONFIRMED/CONTRADICTED/INCONCLUSIVE), and `cells/<workflow>/<fixture>.json` (per-cell detail).
3. **No new production dependencies.** Uses `tsx` (already a devDep), shared types from `@twin/core`, native `fetch`, and `zod` (already a workspace dep). No new package added.

## 3. Components

```
scripts/e2e-harness/
├── run.ts              # Entry point. Args, orchestration, report writing.
├── types.ts            # Types + Zod schemas: CellResult, Severity, AssertionResult, EvidenceBundle, RunReport, AuditClaim.
├── fixtures.ts         # Imports the 20 from @twin/fixtures; classifier + applicableTo() helpers.
├── http.ts             # Thin fetch() wrapper. Base URLs, JSON helpers, actor injection, HttpError.
├── audit-claims.ts     # The audit's claims as data (id, text, expectedVerdict).
├── workflows/
│   ├── W1-uw-accept.ts
│   ├── W2-uw-override.ts
│   ├── W3-send-back-va.ts
│   ├── W4-efolder-idp-push.ts
│   ├── W5-conditions-lifecycle.ts
│   ├── W6-kb-ingest-twokey.ts
│   ├── W7-pattern-detection-llm.ts
│   └── W8-multi-tenant-rls.ts
├── aggregate.ts        # CellResult[] → matrix.json + punch-list.md + summary.md + audit-validation.md (+ regression.md if previous run found).
└── README.md           # How to run, what the output means.
```

Every workflow module exports the same shape:

```typescript
export const W1: WorkflowDef = {
  id: "W1_uw_accept",
  name: "UW Decision — Accept",
  specRefs: ["learning-engine §1.2", "core/decision-records"],
  appliesTo: (fixture: FixtureMeta) => boolean,
  run: async (fixture: FixtureMeta, ctx: RunContext) => CellResult,
};
```

## 4. Data flow per cell

```
run.ts: preflight (process pings → canary cell W1×bankstmt-12mo-clean)
  │
  ▼  if preflight.ok
run.ts iterates the matrix (8 workflows × 20 fixtures = 160 conceptual cells)
  │
  ▼ for each (workflow, fixture)
Workflow.run(fixture, ctx)
  ├─► POST /world/reset + POST /world/load-scenario
  ├─► [workflow-specific calls — see §5]
  ├─► Capture evidence: GET /loans/:id, agent trace, decision record, pipeline cost
  ├─► Run assertions (some may be tagged auditClaim: "ACn")
  ├─► Compute severity (P0/P1/P2 by rubric §6); status ∈ {pass, fail, skip, partial_skip}
  └─► Return CellResult
  │
  ▼ if --repeat N>1, run the matrix N times; flake detection compares passes
  ▼ after all passes
aggregate(report, outDir)
  ├─► reports/<run-id>/matrix.json (Zod-validated)
  ├─► reports/<run-id>/audit-validation.md (per AuditClaim verdict)
  ├─► reports/<run-id>/punch-list.md (severity → fingerprint group → cells)
  ├─► reports/<run-id>/summary.md (stats, by-workflow table, spec coverage, total cost)
  ├─► reports/<run-id>/regression.md (only if a previous run is found)
  └─► reports/<run-id>/cells/<workflow>/<fixture>.json (one per executed/partial-skip cell)
```

## 5. The 8 workflows

Each workflow runs against all 20 fixtures unless `appliesTo()` returns false (a skip, not a fail). Each workflow declares `specRefs: string[]` listing the spec sections it covers; the aggregator emits a "Spec coverage" section in summary.md so missing coverage shows up as a finding, not silently.

| # | ID | Name | Spec refs | Audit claim | Key assertions |
|---|---|---|---|---|---|
| W1 | `W1_uw_accept` | UW Decision — Accept | core/decision-records, learning-engine §1.2 | — | After `accept`, `loan.decision == staged.recommendation`; `decisionRecord` exists with non-null `kbVersion` and `chatbotConsultationId`; agent trace length > 0; pipeline cost > 0. **Invariant test:** after Accept, attempting to mutate `loan.decision` is rejected. |
| W2 | `W2_uw_override` | UW Decision — Override | learning-engine §1.3, §1.4 | — | Override records original + override + `overrideReason` (one of 9 valid categories) + rationale. Decision record persists override metadata. |
| W3 | `W3_send_back_va` | Send Back to VA | core/assignment | — | After send-back, `assignment.status == "in_progress"`, `pendingRecommendation == null`, audit log captures the send-back action. |
| W4 | `W4_efolder_idp_push` | eFolder → IDP → Stare & Compare → Push | slice-5-efolder, slice-4-income | **AC1**: "Push-to-Loan reads but doesn't write." | Generate sample doc → run IDP via agent → assert `extractedData` populated → push field → assert `qualifyingWorksheet[pushField] == extractedValue`. **AC1-marker:** the `worksheet_avgDeposits_updated` assertion is tagged `auditClaim: "AC1"`. |
| W5 | `W5_conditions_lifecycle` | Conditions lifecycle | core/conditions | — | Add → link doc → clear with notes → status=Cleared. Dedup blocks duplicate AddCondition with identical category+source+description. |
| W6 | `W6_kb_ingest_twokey` | KB Ingest + Two-Key Approval | spec-f-intelligent-guidelines §3, onboarding-v2 §3.5 | — | **Sub-cells:** `W6.ingest`, `W6.operator_approve`, `W6.compliance_approve`, `W6.same_user_blocked`, `W6.version_increment`, `W6.chatbot_cites_new_version`. Ingestion uses an ephemeral `e2e-test-kb-*` tenant whose deletion cascades. Mirrors `scripts/test-guideline-pipeline.sh`. |
| W7 | `W7_pattern_detection` | Pattern detection + LLM insight | learning-engine-v2 §1.4, §2 | — | **Sub-cells:** `W7.seed`, `W7.detect`, `W7.suggestion_created`, `W7.same_user_blocked`, `W7.two_key_approved`, `W7.guideline_applied`. Asserts the suggestion lifecycle (`new → analyzing → suggestion_ready → applied`) and that same-user double approval is rejected by DB constraint. |
| W8 | `W8_multi_tenant_rls` | Multi-Tenant Isolation | tenant-isolation-v2 §1.1, §1.2 | — | Create loan in tenant A → attempt fetch as tenant B by sending a forged `x-tenant-id: <B>` header **directly to the API** (not via web tier) → assert 403 or 404, never returns A's data. Tests the API tier's own enforcement, not just web-side header trust. Cleanup ephemeral test tenants. |

**Skip and partial-skip semantics:**
- **Full skip** (`status: "skip"`) — `appliesTo` returns false; the cell records `status: "skip"`, `severity: null`, runs no assertions.
- **Partial skip** (`status: "partial_skip"`, new) — the workflow runs, all run assertions pass, but a subset of assertions was disabled because the fixture's `program` doesn't support them. `skippedAssertions: string[]` lists which were skipped. Counts toward `executed`, not `skipped`.
- **Skip rules:**
  - **DSCR / ForeignNational** fixtures partial-skip DTI-related assertions in W1/W2 (DTI not applicable to those programs); the cell still passes the workflow.
  - **ForeignNational** fixtures full-skip W4 (no document set).
  - **W6, W7** are global; runner invokes once via `GLOBAL_FIXTURE_SENTINEL`, the other 19 fixture rows are recorded as full skip.
  - **W8** runs against 3 representatives (`nqm-bankstmt-12mo-clean`, `nqm-dscr-investor-purchase`, `nqm-full-doc-recent-bk`); other 17 are full skip.
- **Skip-rate flag (lowered from 30% → 15%):** if a "broad" workflow (W1–W5) has more than 15% of its applicable rows full-skipped (≥3 of 20 for W1–W3/W5; ≥3 of ~17 for W4), the punch-list flags it as a P1 fixture-coverage gap. Single-cell (W6/W7) and limited-row (W8) workflows are exempt from this rule.

**Effective cell count (matrix is 8 × 20 = 160 conceptual cells):**
- W1, W2, W3, W5 × 20 fixtures = 80 cells, all expected to execute (DSCR/FN cells use partial-skip, not full skip)
- W4 × ~17 fixtures (full-skip ForeignNational ~3) = ~17 cells executed, ~3 full-skip
- W6 × 1 + W7 × 1 + W8 × 3 = 5 cells executed; remaining 36 rows of W6/W7/W8 are full-skip
- **Approximate executed: ~102, full-skipped: ~58, partial-skipped: ~variable depending on DSCR count.** The runner reports exact numbers per run; design-time estimates are intentionally fuzzy because they depend on `appliesTo` evaluation against actual fixture data.

The metric the operator should look at is **`total_assertions_run`**, not cell count — because a partial-skip cell still runs most of its assertions and contributes to coverage.

## 6. Evidence schema and rubric

**Evidence (per cell):**

```json
{
  "harnessRunId": "run_2026-05-08-1430_a3b1",
  "loanId": "2501000101",
  "fixture": "nqm-bankstmt-12mo-clean",
  "workflow": "W1_uw_accept",
  "subCell": null,
  "status": "pass | fail | skip | partial_skip",
  "severity": "P0 | P1 | P2 | null",
  "durationMs": 1234,
  "auditClaim": null,
  "specRefs": ["learning-engine §1.2"],
  "assertions": [
    {
      "name": "decision==approved",
      "expected": "approved",
      "actual": "approved",
      "ok": true,
      "auditClaim": null
    }
  ],
  "skippedAssertions": [],
  "evidence": {
    "decisionRecordId": "dr_abc",
    "kbVersion": "v3",
    "agentTraceLength": 12,
    "pipelineCostUsd": 0.043,
    "screenshotPath": null,
    "errorFingerprint": null
  },
  "error": null
}
```

**`harnessRunId`** uniquely tags every record this run writes to persistent stores (`decision_records.metadata.harness_run_id`, etc.) so `--purge-test-data <run_id>` can clean up.

**`auditClaim`** (cell-level or assertion-level) is set when a cell or assertion specifically tests a claim from the recent audit. The aggregator uses these to build `audit-validation.md`.

**`errorFingerprint`** — for fail cells, a normalized hash of `error.code + error.message[:80]`. Cells with the same fingerprint group together in the punch list (probably one bug, not many).

**Severity rubric:**

| Level | Definition | Examples |
|---|---|---|
| **P0** | Show-stopper: blocks the lender from doing their job. | Wrong decision recorded; RLS leak (Tenant B sees Tenant A's loan); API trusts forged `x-tenant-id` from outside the web tier; agent crashes; data corruption; missing decision record after Accept; action dispatch error; flake (non-deterministic outcome across `--repeat` passes) on a P0-class assertion. |
| **P1** | Degraded: workflow completes but with measurable defect. | Missing evidence (no kb_version, no trace); assertion partially fails (DTI off by 3% but classification correct); perf > threshold; placeholder text in UI; flake on a P1-class assertion; ≥15% fixture-coverage skip on a broad workflow. |
| **P2** | Cosmetic: result correct, presentation imperfect. | Visual glitch; typo; label mismatch; cost slightly above expected but result correct; sort order off. |

## 7. Error handling

| Failure type | Where | Handling |
|---|---|---|
| Assertion fail | inside `workflow.run` | `CellResult.status="fail"`, severity by rubric, error captured. |
| Workflow crash (uncaught throw) | inside `workflow.run` | `run.ts` catch block → `CellResult.status="fail"`, severity=P0, full `error.stack` in cell file. |
| Harness crash (e.g., API down mid-run) | `run.ts` orchestration | Abort run; write partial report with `aborted: true, reason: "..."` flag; preserve completed cells. |

**No retries within a single pass.** Quiet retries would mask real instability.

**Flake detection via `--repeat N` (default 2):** the harness runs the full matrix N times and compares CellResults across passes. A cell whose `status` differs across passes is recorded as `flake` (severity inferred from the underlying P-class of the unstable assertion — P0 flake on a P0-class assertion, etc.). The default of 2 doubles wall-clock but buys real flake signal on the first run; `--repeat 1` disables it.

**Pre-flight checks at startup, in order — abort if any fails:**
1. **Process pings** — `/system/health` (API) and `agent /health` (each < 2s).
2. **Canary cell** — one full execution of `W1_uw_accept` against `nqm-bankstmt-12mo-clean`. This verifies DB connectivity, Anthropic auth, ChromaDB, agent ↔ API round-trip, and migration version in one shot. If the canary fails, the harness aborts with the canary's error as the abort reason. Cost: ~5 seconds; payoff: catches infrastructure issues before sinking 8–15 min into a doomed run.

**Persistent-state cleanup:** All harness records carry `metadata.harness_run_id`. `--purge-test-data <run_id>` deletes records with the matching tag from `decision_records`, `pattern_suggestions`, `learning_outcomes`, and any `e2e-test-*` tenants. Workflow-specific:
- **W6** ingests into an ephemeral `e2e-test-kb-<run_id>` tenant; deleting the tenant cascades to its `tenant_guidelines`, `kb_cost_events`, and ChromaDB collection.
- **W8** creates and deletes its own `e2e-test-rls-a-*` and `e2e-test-rls-b-*` tenants; preflight purges leftover `e2e-test-*` tenants from prior crashed runs before assertions run.

## 8. Testing the harness itself

A **2-minute manual smoke test** before the full run:

```bash
pnpm tsx scripts/e2e-harness/run.ts --workflow W1 --fixture nqm-bankstmt-12mo-clean
```

Confirm:
1. `matrix.json` parses cleanly with the **Zod schema** exported from `types.ts` (TS types alone don't validate JSON at runtime — use the Zod schema as the validator). The harness itself runs this validation pass at the end of every run; failure means the harness has a bug.
2. `punch-list.md` and `audit-validation.md` both render.
3. A deliberately broken assertion (temporarily flip the expected decision) produces a fail with severity P0; the broken assertion appears in punch-list.md with a repro command.

No vitest tests for the harness itself — YAGNI for one-shot infrastructure, smoke covers the same ground faster.

## 9. Sub-agent deployment

The build is parallelizable across waves. Calibrated estimates assume one or two Wave 2 agents will need a follow-up pass (test framework quirks, fixture data shape, API contract assumptions); the explicit Wave 2.5 step accounts for this rather than papering over it.

**Wave 1 — Foundation** (1 agent, ~10 min):
Writes `types.ts` (with Zod schemas), `fixtures.ts`, `http.ts`, `run.ts` skeleton (including canary preflight), and `aggregate.ts` skeleton. All shared scaffolding. Coordinator reviews output before launching Wave 2.

**Wave 2 — Workflows** (8 agents in parallel, ~15 min wall-clock, gated by slowest):
- A1 → `W1-uw-accept.ts` (incl. decision-immutability invariant)
- A2 → `W2-uw-override.ts`
- A3 → `W3-send-back-va.ts`
- A4 → `W4-efolder-idp-push.ts` (incl. AC1 audit-claim assertion)
- A5 → `W5-conditions-lifecycle.ts`
- A6 → `W6-kb-ingest-twokey.ts` (sub-cells; ephemeral test tenant)
- A7 → `W7-pattern-detection-llm.ts` (sub-cells; suggestion-lifecycle assertions)
- A8 → `W8-multi-tenant-rls.ts` (forged `x-tenant-id` direct to API)

No merge conflicts — each agent writes one isolated file.

**Wave 2.5 — Merge & fix** (~15 min):
Coordinator reviews each Wave 2 output. For agents whose first attempt missed contract details (URL paths, payload shape, etc.), dispatches a single follow-up agent to resolve. Empirically 1–2 of 8 need this; budget the time rather than treat it as exception.

**Wave 3 — Aggregator polish + smoke** (1 agent, ~10 min):
Fills in `aggregate.ts`: severity-sorted punch list with **error-fingerprint grouping** + **regression diff** against `reports/<previous-run>/matrix.json` if present; summary.md with by-workflow table, total LLM cost, and **spec-coverage** section listing which spec sections have at least one assertion testing them; **`audit-validation.md`** mapping each audit claim to CONFIRMED/CONTRADICTED/INCONCLUSIVE based on the cells tagged with `auditClaim`. Runs the smoke test from §8.

**Wave 4 — Full run** (user-triggered, ~8–15 min × `--repeat N`):
```bash
pnpm tsx scripts/e2e-harness/run.ts                                          # default --repeat 2
pnpm tsx scripts/e2e-harness/run.ts --repeat 1                               # single pass, no flake detection
pnpm tsx scripts/e2e-harness/run.ts --out reports/$(date +%Y-%m-%d-%H%M)/    # explicit out dir
```

**Total wall-clock budget: ~50–65 min** from green-field to a reviewable punch-list (calibrated up from the original 35–50 min estimate to account for Wave 2.5 rework). Without Wave 2.5 rework, ~40–50 min — but plan for the realistic case.

## 10. First-run outputs

```
reports/2026-05-08-1430/
├── matrix.json                       # full machine-readable result (Zod-validated)
├── audit-validation.md               # CONFIRMED/CONTRADICTED/INCONCLUSIVE per audit claim
├── punch-list.md                     # P0s first, then P1s, then P2s; error-fingerprint grouped
├── summary.md                        # top-level stats, by-workflow table, spec coverage, total cost
├── regression.md                     # only if a previous run is found; lists new vs longstanding fails
└── cells/
    ├── W1_uw_accept/
    │   ├── nqm-bankstmt-12mo-clean.json
    │   └── ... (one file per executed cell)
    └── ... (8 workflow dirs)
```

**summary.md format (illustrative):**

```
# E2E Run 2026-05-08 14:30
- Started: 2026-05-08T14:30:00Z   Finished: 14:41:24Z   Duration: 11m 24s
- Total assertions run: 487   Passed: 451 (92.6%)
- Cells: 102 executed, 6 partial-skip (DSCR/FN DTI), 52 full-skip
- Failures by severity: P0: 3, P1: 14, P2: 4
- Total LLM cost (this run): $0.43
- Slowest cell: W4 / nqm-edge-large-deposit (8.2s)

## By workflow
| Workflow | Executed | Passed | Failed | P0 | Spec refs |
| W1_uw_accept | 20 | 18 | 2 | 0 | learning-engine §1.2 |
| ...

## Spec coverage
- Tenant Isolation v2 §1.1: covered by W8 (3 assertions)
- Onboarding v2 §3.5: covered by W6.same_user_blocked
- Learning Engine v2 §2 (suggestion lifecycle): NOT COVERED — gap
- ...
```

**punch-list.md format:** failures grouped first by severity (P0 → P1 → P2), then by **error fingerprint** within each severity (so 8 cells with the same root cause appear as one section listing 8 affected cells), then per cell the workflow / fixture / failed assertions / expected-vs-actual / **likely-team tag** (W6→guidelines, W7→learning, W8→tenant-isolation, etc.) / repro command. If a previous run exists in `reports/`, each fail is annotated `[NEW]` or `[REGRESSION]`.

**audit-validation.md format:** each audit claim listed with its identifier (e.g. `AC1`), the cells/assertions tagged with that claim, and a verdict. Example:

```
## AC1 — "Push-to-Loan reads but doesn't write"

**Verdict:** CONTRADICTED (3 of 3 assertions pass)

Cells testing this claim:
- W4_efolder_idp_push / nqm-bankstmt-12mo-clean → assertion `worksheet_avgDeposits_updated` PASS
- W4_efolder_idp_push / nqm-1099-only → assertion `worksheet_avgDeposits_updated` PASS
- W4_efolder_idp_push / nqm-asset-depletion → assertion `worksheet_avgDeposits_updated` PASS

The audit's headline finding is contradicted by dynamic execution. Push-to-Loan does write — the data flow goes through `actionRecalcIncome` rather than the `/extract` endpoint the audit was looking for. Methodology improvement: the audit's static read should have followed the call chain from the button handler, not just grepped for the endpoint URL.
```

## 11. Out of scope (deferred)

- UI smoke / Playwright — defer until API-level findings stabilize.
- CI integration — defer until we re-run the harness manually 2-3 times and trust the signal.
- History/diff tooling beyond the simple regression diff — defer; `git log reports/` is sufficient short-term.
- Multi-instance API parallelism — defer; sequential execution is fast enough for one-shot.
- Stress/load testing — out of scope; this is correctness, not capacity.
- **Per-change TDD discipline** — out of scope here; that's a *separate* effort that should land alongside new feature work, not on this harness. See §13.
- **Adversarial / security tests** (per Tenant Isolation v2 §9.5) and **eval-framework AI-quality tests** (per Spec F §13) — separate runners with different cadences and owners; they are not folded into this harness.

## 12. Open questions for the implementation plan

Resolved:

- **`POST /system/reset`?** — Not needed. `POST /world/reset` and `POST /world/load-scenario` already exist in `packages/api/src/routes/world.ts`. The harness uses these.
- **W6 KB ingest programmatic invocation?** — W6 inlines its HTTP calls using `http.ts`. The bash script `scripts/test-guideline-pipeline.sh` is the reference for which endpoints to hit and in what order.
- **Keep `behavioral-test` endpoint?** — Yes. Both stay. Behavioral-test is a fast reducer smoke (~5s); this harness is broad coverage. Documented in `scripts/e2e-harness/README.md`.

Remaining (genuinely open until implementation):

- Exact pattern-detection trigger endpoint shape — `POST /patterns/detect` is the assumption; A7 verifies and adjusts during Wave 2.
- Exact tenant create/delete payloads for W8 — A8 verifies during Wave 2.

## 13. Quality strategy context (the layered model)

This harness is **one layer** of a multi-layer quality strategy, not the whole strategy. It is appropriate for *post-hoc* validation against an existing codebase. It is not a substitute for per-change unit/integration tests, adversarial testing, or AI eval.

| Layer | Purpose | Frequency | What it catches |
|---|---|---|---|
| Unit tests | Each function does its job | Per-change (ms) | Logic errors, edge cases |
| Integration tests | Modules wire together correctly | Per-change (s) | Contract drift, schema mismatches |
| **E2E harness (this spec)** | System behaves correctly end-to-end | Periodic (~15 min) | Cross-module bugs, real-data shape issues |
| Adversarial tests (Tenant Isolation v2 §9.5) | Hostile inputs are handled | Pre-launch + periodic | Security gaps, RLS leaks, injection |
| Eval framework (Spec F §13) | AI quality is acceptable | Per-tenant activation | Hallucinations, retrieval gaps |

**Recommended sequencing** (informational; not part of this spec's deliverable):
1. Land this harness; first run produces the prioritized backlog.
2. In parallel, require unit + integration tests on every PR going forward.
3. Run the harness periodically (weekly during pilot, before each major release) — not as a per-change CI gate.
4. Plan for the harness to grow into the regression suite over months: every fixed P0 should leave a permanent assertion behind.
5. Adversarial tests and eval framework are separate efforts with their own runners.

**Why this matters for interpreting harness output:** a green run means "the workflows we tested pass" — not "the codebase is bug-free." The spec-coverage section in summary.md is what tells you what's *not* covered; gaps there are calls for either new harness assertions, dedicated unit tests, or another testing layer entirely.
