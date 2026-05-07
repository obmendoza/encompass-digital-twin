// scripts/e2e-harness/workflows/W1-uw-accept.ts
// Loads fixture → runs multi-agent → stages recommendation → accepts → asserts decision + evidence.

import { ACTORS, http, type HttpOptions } from "../http.js";
import { APPLIES_TO_ALL } from "../fixtures.js";
import type { AssertionResult, CellResult, FixtureMeta, RunContext, WorkflowDef } from "../types.js";

export const W1: WorkflowDef = {
  id: "W1_uw_accept",
  name: "UW Decision — Accept",
  specRefs: ["learning-engine §1.2", "core/decision-records"],
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
    // The audit endpoint may return either a top-level array of entries or { entries: [...] }.
    type AuditEntry = { type?: string; action?: { type?: string }; trace?: unknown[] };
    const auditRaw = await http.get<unknown>(apiOpts, `/loans/${fixture.loanId}/audit`).catch(() => [] as unknown);
    const auditEntries: AuditEntry[] = Array.isArray(auditRaw)
      ? (auditRaw as AuditEntry[])
      : (((auditRaw as { entries?: AuditEntry[] }).entries) ?? []);
    const traceEntry = auditEntries.find((e) => e.type === "AgentRunComplete" || e.action?.type === "AgentRunComplete");
    const traceLen = Array.isArray(traceEntry?.trace) ? traceEntry!.trace!.length : 0;
    assertions.push({ name: "agent_trace_length>0", expected: ">0", actual: traceLen, ok: traceLen > 0 });

    type LoanWithUsage = Loan & { _pipeline_usage?: { totalCostUsd?: number } };
    const loanFull = await http.get<LoanWithUsage>(apiOpts, `/loans/${fixture.loanId}`);
    const cost = loanFull._pipeline_usage?.totalCostUsd ?? 0;
    assertions.push({ name: "pipeline_cost>0", expected: ">0", actual: cost, ok: cost > 0 });

    // Decision-immutability invariant test (per spec §5 revision).
    // After Accept, attempting to mutate loan.decision must be rejected.
    let immutableOk = false;
    try {
      await http.post(apiOpts, `/loans/${fixture.loanId}/recommendation/accept`, { actor: ACTORS.human });
      // If the second accept succeeded, check that decision didn't change.
      const reread = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
      immutableOk = reread.decision === stagedRec;
    } catch {
      // Rejection (HTTP error) is the desired behavior — decision is immutable.
      immutableOk = true;
    }
    assertions.push({ name: "decision_immutable_after_accept", expected: "rejected or unchanged", actual: immutableOk ? "immutable" : "mutated", ok: immutableOk });

    const allOk = assertions.every((a) => a.ok);
    const severity = allOk ? null : (assertions.find((a) => !a.ok && (a.name === "decision_matches_staged" || a.name === "decision_record_exists" || a.name === "decision_immutable_after_accept")) ? "P0" : "P1");
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
