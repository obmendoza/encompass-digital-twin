// scripts/e2e-harness/workflows/W1-uw-accept.ts
// Loads fixture → runs multi-agent → stages recommendation → accepts → asserts decision + evidence.

import { ACTORS, http, type HttpOptions } from "../http.js";
import { APPLIES_TO_ALL } from "../fixtures.js";
import { getLatestDecisionRecord } from "../supabase.js";
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
    // Pass tenant_id so the agent's twin_connector can fetch + write loans
    // through the now-tenant-strict API (post Task 9 fix). Without it, the
    // agent's fetch_loan returns 400 LOAN_NOT_FOUND.
    // Wrap in try/catch: undici has a ~5min idle timeout on connections, and the agent
    // can take longer for some fixtures. A "fetch failed" here means the agent didn't
    // complete cleanly — record it as a P1 finding rather than crashing the cell.
    const tenantQ = process.env.DEMO_TENANT_ID ? `?tenant_id=${process.env.DEMO_TENANT_ID}` : "";
    try {
      await http.post(agentOpts, `/api/twin/underwrite-multi/${fixture.loanId}${tenantQ}`);
      assertions.push({ name: "agent_pipeline_completed", expected: "no-throw", actual: "ok", ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertions.push({ name: "agent_pipeline_completed", expected: "no-throw", actual: msg, ok: false });
      return finalize(fixture, start, "fail", "P1", assertions, {}, "AGENT_PIPELINE_FAILED", msg);
    }

    // Read loan after recommendation is staged.
    // Capture the trace + _pipeline_usage NOW — accept clears pendingRecommendation
    // and the trace is stripped, so we can't recover them after.
    type AgentStep = { phase: string; content: string; metadata?: Record<string, unknown>; at?: string };
    type PendingRec = { recommendation: string; trace?: AgentStep[] };
    type Loan = { id: string; decision?: string; pendingRecommendation?: PendingRec | null };
    const loanBefore = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const stagedRec = loanBefore.pendingRecommendation?.recommendation ?? null;
    const trace = loanBefore.pendingRecommendation?.trace ?? [];
    assertions.push({ name: "pendingRecommendation_present", expected: "non-null", actual: stagedRec, ok: stagedRec !== null });

    if (stagedRec === null) {
      return finalize(fixture, start, "fail", "P0", assertions, {}, "NO_RECOMMENDATION", "agent did not stage a recommendation");
    }

    // Trace length: count agent steps from the staged recommendation's trace.
    // Replaces the old AgentRunComplete-audit-entry approach (no such audit type exists).
    const traceLen = trace.length;
    assertions.push({ name: "agent_trace_length>0", expected: ">0", actual: traceLen, ok: traceLen > 0 });

    // Pipeline cost: parse _pipeline_usage from a tool_result step in the trace
    // (per packages/web/components/encompass/UWDashboard.tsx:155-173). The agent
    // emits a synthetic step with agent="_pipeline_usage" and total_cost_usd inside.
    // Field is snake_case per the agent service's emission.
    let cost = 0;
    for (const step of trace) {
      if (step.phase !== "tool_result" || !step.content) continue;
      try {
        const parsed = JSON.parse(step.content) as { agent?: string; total_cost_usd?: number };
        if (parsed.agent === "_pipeline_usage" && typeof parsed.total_cost_usd === "number") {
          cost = parsed.total_cost_usd;
          break;
        }
      } catch { /* not JSON, skip */ }
    }
    assertions.push({ name: "pipeline_cost>0", expected: ">0", actual: cost, ok: cost > 0 });

    // Accept the recommendation.
    await http.post(apiOpts, `/loans/${fixture.loanId}/recommendation/accept`, { actor: ACTORS.human });

    const loanAfter = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    assertions.push({ name: "decision_matches_staged", expected: stagedRec, actual: loanAfter.decision ?? null, ok: loanAfter.decision === stagedRec });
    assertions.push({ name: "pendingRecommendation_cleared", expected: null, actual: loanAfter.pendingRecommendation ?? null, ok: !loanAfter.pendingRecommendation });

    // Decision record: query Supabase decision_records directly via REST. The API
    // doesn't expose a GET endpoint, but the writer (packages/api/src/learning/
    // decision-writer.ts) inserts after AcceptRecommendation. Service-key auth
    // bypasses RLS so we can read across tenants for verification.
    let latest = null;
    try {
      latest = await getLatestDecisionRecord(fixture.loanId);
    } catch (e) {
      assertions.push({ name: "decision_record_query_ok", expected: "no-throw", actual: e instanceof Error ? e.message : String(e), ok: false });
    }
    assertions.push({ name: "decision_record_exists", expected: "non-null", actual: latest?.id ?? null, ok: !!latest });
    assertions.push({ name: "decision_record_has_kb_version", expected: "non-null", actual: latest?.kb_version ?? null, ok: latest?.kb_version != null });
    assertions.push({ name: "decision_record_has_chatbot_consultation_id", expected: "non-null", actual: latest?.chatbot_consultation_id ?? null, ok: !!latest?.chatbot_consultation_id });

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
