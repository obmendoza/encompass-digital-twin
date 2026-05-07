// scripts/e2e-harness/workflows/W3-send-back-va.ts
import { ACTORS, http, type HttpOptions } from "../http.js";
import { APPLIES_TO_ALL } from "../fixtures.js";
import type { AssertionResult, CellResult, FixtureMeta, WorkflowDef } from "../types.js";

export const W3: WorkflowDef = {
  id: "W3_send_back_va",
  name: "Send Back to VA",
  specRefs: ["core/assignment"],
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
    const auditRaw = await http.get<Audit | Array<{ type: string }>>(apiOpts, `/loans/${fixture.loanId}/audit`).catch(() => ({} as Audit));
    // Audit endpoint returns top-level array, not { entries: [] }; handle both shapes defensively (per W1 finding).
    const auditEntries: Array<{ type: string }> = Array.isArray(auditRaw)
      ? auditRaw
      : Array.isArray((auditRaw as Audit).entries) ? (auditRaw as Audit).entries! : [];
    const sentBackEntry = auditEntries.find((e) => e.type === "SendBackToVA");
    assertions.push({ name: "audit_log_has_sendback", expected: "SendBackToVA entry", actual: sentBackEntry ?? null, ok: !!sentBackEntry });

    const allOk = assertions.every((a) => a.ok);
    const severity = allOk ? null : (assertions.find((a) => !a.ok && (a.name === "assignment_back_to_in_progress" || a.name === "rec_cleared")) ? "P0" : "P1");
    return { loanId: fixture.loanId, fixture: fixture.id, workflow: "W3_send_back_va", status: allOk ? "pass" : "fail", severity, durationMs: Date.now() - start, assertions, evidence: {}, error: null };
  },
};
