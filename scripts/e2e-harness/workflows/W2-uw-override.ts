// scripts/e2e-harness/workflows/W2-uw-override.ts
import { ACTORS, http, type HttpOptions } from "../http.js";
import { APPLIES_TO_ALL } from "../fixtures.js";
import { getLatestDecisionRecord } from "../supabase.js";
import type { AssertionResult, CellResult, FixtureMeta, WorkflowDef } from "../types.js";

// Note: spec's plan listed SCREAMING_SNAKE category names, but the live API enum
// (packages/core/src/learning-types.ts → OverrideReasonCategory) is lowercase
// snake_case. Using the actual implementation values here.
const VALID_REASONS = new Set([
  "dti_exception", "income_adjustment", "credit_reassessment", "doc_sufficiency",
  "compliance_exception", "guideline_exception", "risk_tolerance", "data_error",
  "other",
]);

export const W2: WorkflowDef = {
  id: "W2_uw_override",
  name: "UW Decision — Override",
  specRefs: ["learning-engine §1.3", "learning-engine §1.4"],
  appliesTo: APPLIES_TO_ALL,
  run: async (fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const agentOpts: HttpOptions = { baseUrl: ctx.agentUrl, timeoutMs: 600_000 };
    const assertions: AssertionResult[] = [];

    await http.post(apiOpts, "/world/reset");
    await http.post(apiOpts, "/world/load-scenario", { scenarioId: fixture.id });

    // Wrap agent call: a fetch-failed here usually means the agent's stage_recommendation
    // callback fired after the loan was reset by the next test cell. Record as a P1
    // finding rather than crashing the cell. Pass tenant_id so the agent's calls
    // back to the (now tenant-strict) API resolve correctly.
    const tenantQ = process.env.DEMO_TENANT_ID ? `?tenant_id=${process.env.DEMO_TENANT_ID}` : "";
    try {
      await http.post(agentOpts, `/api/twin/underwrite-multi/${fixture.loanId}${tenantQ}`);
      assertions.push({ name: "agent_pipeline_completed", expected: "no-throw", actual: "ok", ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertions.push({ name: "agent_pipeline_completed", expected: "no-throw", actual: msg, ok: false });
      return cell(fixture, start, "fail", "P1", assertions, {}, "AGENT_PIPELINE_FAILED", msg);
    }

    type Loan = { decision?: string; pendingRecommendation?: { recommendation: string } | null };
    const before = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const original = before.pendingRecommendation?.recommendation ?? null;
    assertions.push({ name: "staged_recommendation_present", expected: "non-null", actual: original, ok: original !== null });
    if (!original) return cell(fixture, start, "fail", "P0", assertions, {}, "NO_RECOMMENDATION", "no rec to override");

    const overrideTo = original === "approved" ? "suspended" : "approved";
    const reason = "dti_exception";
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

    // Decision record: query Supabase decision_records directly. The API doesn't
    // expose a GET endpoint; the writer (decision-writer.ts) inserts after
    // OverrideDecision. The schema's `agent_recommendation` column holds the
    // original (pre-override) value — it's not called `original_recommendation`.
    let latest = null;
    try {
      latest = await getLatestDecisionRecord(fixture.loanId);
    } catch (e) {
      assertions.push({ name: "decision_record_query_ok", expected: "no-throw", actual: e instanceof Error ? e.message : String(e), ok: false });
    }
    assertions.push({ name: "decision_record_exists", expected: "non-null", actual: latest?.id ?? null, ok: !!latest });
    assertions.push({ name: "decision_record_type", expected: "overridden", actual: latest?.decision_type ?? null, ok: latest?.decision_type === "overridden" });
    assertions.push({ name: "decision_record_original", expected: original, actual: latest?.agent_recommendation ?? null, ok: latest?.agent_recommendation === original });
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
