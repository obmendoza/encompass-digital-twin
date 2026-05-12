// scripts/e2e-harness/workflows/W10-predicted-conditions.ts
//
// Exercises the full Predictive Conditions round-trip against a single
// canonical fixture (nqm-bankstmt-12mo-clean): manual /predictions/run,
// accept some, dismiss one, assert resulting state.
//
// IMPORTANT: This workflow's predicted-count assertion (=== EXPECTED_PENDING)
// is coupled to the active doc-checklist KB version. If NPNQM regenerates
// Document_Requirements_All_Income_Types.md and the canonical fixture's
// predicted-doc count shifts, this assertion will break alongside the
// doc-checklist integration test. Update EXPECTED_PENDING here when
// re-ingesting. Last verified against demo tenant KB version 105 (id 70)
// on 2026-05-13: 15 predictions for the canonical fixture.

import { http, type HttpOptions } from "../http.js";
import type { CellResult, WorkflowDef } from "../types.js";

const CANONICAL_FIXTURE = "nqm-bankstmt-12mo-clean";
const EXPECTED_PENDING = 15;

export const W10: WorkflowDef = {
  id: "W10_predicted_conditions",
  name: "Predicted Conditions — round-trip",
  specRefs: ["2026-05-12-predictive-conditions-design §5", "§8.6"],
  appliesTo: (f) => f.id === CANONICAL_FIXTURE,
  run: async (fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const assertions: Array<{ name: string; expected: string; actual: string; ok: boolean }> = [];

    // 0. Load fixture into world_state.
    await http.post(apiOpts, "/world/reset");
    await http.post(apiOpts, "/world/load-scenario", { scenarioId: fixture.id });

    // 1. Manually invoke /predictions/run.
    type RunResp = { runId: string; predictionCount: number; alertCount: number; reused: boolean };
    let run: RunResp;
    try {
      run = await http.post<RunResp>(apiOpts, `/loans/${fixture.loanId}/predictions/run`, {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertions.push({ name: "run_succeeded", expected: "200", actual: msg, ok: false });
      return finalize(fixture, start, "fail", "P0", assertions, {}, "PREDICTIONS_RUN_FAILED", msg);
    }
    assertions.push({
      name: "run_succeeded",
      expected: "alertCount=0",
      actual: `alertCount=${run.alertCount}`,
      ok: run.alertCount === 0,
    });

    if (run.alertCount !== 0) {
      // Most likely cause: demo tenant has no active KB version. Treat as a
      // hard failure so the operator notices and runs approve-kb.ts before
      // re-running the harness.
      return finalize(
        fixture, start, "fail", "P1", assertions,
        { runId: run.runId, alertCount: run.alertCount },
        "PREDICTIONS_ALERTED",
        `predictions run produced ${run.alertCount} alert(s) — likely no active KB version. Run scripts/approve-kb.ts --activate against the demo tenant.`,
      );
    }

    // 2. List predictions. Expect EXPECTED_PENDING pending.
    type ListResp = { predictions: Array<{ id: string; status: string }>; alerts: unknown[] };
    const list = await http.get<ListResp>(apiOpts, `/loans/${fixture.loanId}/predictions`);
    const pending = list.predictions.filter((p) => p.status === "pending");
    assertions.push({
      name: "pending_count",
      expected: String(EXPECTED_PENDING),
      actual: String(pending.length),
      ok: pending.length === EXPECTED_PENDING,
    });

    if (pending.length < 9) {
      // Not enough predictions to perform the planned 8-accept + 1-dismiss flow.
      return finalize(
        fixture, start, "fail", "P0", assertions,
        { runId: run.runId, pendingCount: pending.length },
        "PREDICTIONS_INSUFFICIENT",
        `expected at least 9 pending predictions to exercise accept/dismiss; got ${pending.length}`,
      );
    }

    // 3. Accept 8, dismiss 1, leave 2 pending.
    for (let i = 0; i < 8; i++) {
      const p = pending[i]!;
      try {
        await http.post(apiOpts, `/loans/${fixture.loanId}/predictions/${p.id}/accept`, {});
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        assertions.push({ name: `accept_${i}`, expected: "200", actual: msg, ok: false });
      }
    }
    try {
      await http.post(apiOpts, `/loans/${fixture.loanId}/predictions/${pending[8]!.id}/dismiss`, {
        reason: "Smoke-test dismissal with sufficient length",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertions.push({ name: "dismiss", expected: "200", actual: msg, ok: false });
    }

    // 4. Assert 8 Predicted conditions on the loan, 2 pending, 1 dismissed.
    type Loan = { conditions: Array<{ source: string; status: string }> };
    const loanAfter = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const predictedCount = loanAfter.conditions.filter((c) => c.source === "Predicted" && c.status === "Open").length;
    assertions.push({
      name: "predicted_conditions_on_loan",
      expected: "8",
      actual: String(predictedCount),
      ok: predictedCount === 8,
    });

    const after = await http.get<ListResp>(apiOpts, `/loans/${fixture.loanId}/predictions`);
    const pendingAfter = after.predictions.filter((p) => p.status === "pending").length;
    const dismissedAfter = after.predictions.filter((p) => p.status === "dismissed").length;
    const remainingExpected = pending.length - 9; // 8 accepted + 1 dismissed from EXPECTED_PENDING total
    assertions.push({
      name: "remaining_pending",
      expected: String(remainingExpected),
      actual: String(pendingAfter),
      ok: pendingAfter === remainingExpected,
    });
    assertions.push({
      name: "dismissed_count",
      expected: "1",
      actual: String(dismissedAfter),
      ok: dismissedAfter === 1,
    });

    const allOk = assertions.every((a) => a.ok);
    return finalize(
      fixture, start, allOk ? "pass" : "fail", allOk ? null : "P0",
      assertions, { runId: run.runId }, null, null,
    );
  },
};

function finalize(
  fixture: { id: string; loanId: string },
  start: number,
  status: "pass" | "fail" | "skip",
  severity: "P0" | "P1" | "P2" | null,
  assertions: Array<{ name: string; expected: string; actual: string; ok: boolean }>,
  evidence: Record<string, unknown>,
  errorCode: string | null,
  errorMessage: string | null,
): CellResult {
  return {
    loanId: fixture.loanId,
    fixture: fixture.id,
    workflow: "W10_predicted_conditions",
    status,
    severity,
    durationMs: Date.now() - start,
    assertions,
    evidence,
    error: errorCode ? { code: errorCode, message: errorMessage ?? "" } : null,
  };
}
