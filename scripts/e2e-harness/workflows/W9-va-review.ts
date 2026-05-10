// scripts/e2e-harness/workflows/W9-va-review.ts
// Exercises the agent → VA claim → submit-concur → UW accept happy path.
// Requires the configured tenant to have tenant.settings.va.required = true.
// Skips cleanly when va.required is false (e.g. running against the demo tenant).

import { ACTORS, http, type HttpOptions } from "../http.js";
import { APPLIES_TO_ALL } from "../fixtures.js";
import type { AssertionResult, CellResult, FixtureMeta, WorkflowDef } from "../types.js";

export const W9: WorkflowDef = {
  id: "W9_va_review",
  name: "VA Review — Concur Path",
  specRefs: ["va-review-layer §State Machine", "va-review-layer §Routing & Claim Flow"],
  appliesTo: APPLIES_TO_ALL,
  run: async (fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const agentOpts: HttpOptions = { baseUrl: ctx.agentUrl, timeoutMs: 600_000 };
    const assertions: AssertionResult[] = [];

    // 0. Check tenant policy. Skip the cell when va.required = false.
    const tenantId = process.env.DEMO_TENANT_ID ?? "";
    if (!tenantId) {
      return finalize(fixture, start, "skip", null, assertions, { skipReason: "DEMO_TENANT_ID env var not set" }, null, null);
    }
    type TenantResp = { id: string; slug: string; settings?: { va?: { required?: boolean } } };
    let vaRequired = false;
    try {
      const tenant = await http.get<TenantResp>(apiOpts, `/tenants/${tenantId}`);
      vaRequired = tenant.settings?.va?.required === true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertions.push({ name: "tenant_settings_readable", expected: "200", actual: msg, ok: false });
      return finalize(fixture, start, "fail", "P1", assertions, {}, "TENANT_SETTINGS_FAILED", msg);
    }
    if (!vaRequired) {
      return finalize(
        fixture, start, "skip", null, assertions,
        { skipReason: "tenant.settings.va.required is false (no VA gate to exercise)" },
        null, null,
      );
    }

    // 1. Reset + load fixture.
    await http.post(apiOpts, "/world/reset");
    await http.post(apiOpts, "/world/load-scenario", { scenarioId: fixture.id });

    // 2. Run agent (stages recommendation; with va.required=true the routing
    //    hook from Task 12 puts the loan into va_review_pending).
    const tenantQ = `?tenant_id=${tenantId}`;
    try {
      await http.post(agentOpts, `/api/twin/underwrite-multi/${fixture.loanId}${tenantQ}`);
      assertions.push({ name: "agent_pipeline_completed", expected: "no-throw", actual: "ok", ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertions.push({ name: "agent_pipeline_completed", expected: "no-throw", actual: msg, ok: false });
      return finalize(fixture, start, "fail", "P1", assertions, {}, "AGENT_PIPELINE_FAILED", msg);
    }

    // 3. Verify loan reached va_review_pending. VA state is in the side table
    //    va_loan_state, exposed via GET /va/queue (which filters to
    //    va_review_pending). Loan id appearing in the queue == correct state.
    type QueueResp = { items: Array<{ loan_id: string; assigned_pool_id: string }> };
    const queue = await http.get<QueueResp>(apiOpts, `/va/queue?limit=200`);
    const queued = queue.items.find((i) => i.loan_id === fixture.loanId);
    assertions.push({
      name: "loan_in_va_review_pending",
      expected: "loan in va queue",
      actual: queued ? "queued" : "not in queue",
      ok: !!queued,
    });
    if (!queued) {
      return finalize(
        fixture, start, "fail", "P0", assertions, {},
        "VA_ROUTING_DID_NOT_FIRE",
        `loan ${fixture.loanId} not in /va/queue after agent — VA routing did not stage va_review_pending`,
      );
    }

    // 4. Claim the loan as VA. The harness identity must be a member of the
    //    loan's assigned pool. If the harness user isn't seeded as a member,
    //    claim returns 409 — record as P0 so operators know to seed.
    type ClaimResp = { claimed: boolean; reason?: string };
    let claimResp: ClaimResp;
    try {
      claimResp = await http.post<ClaimResp>(apiOpts, `/loans/${fixture.loanId}/va/claim`, {});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertions.push({ name: "va_claim_succeeded", expected: "claimed=true", actual: msg, ok: false });
      return finalize(
        fixture, start, "fail", "P0", assertions, {},
        "VA_CLAIM_FAILED",
        `Claim failed: ${msg}. Ensure the harness e2e-harness user is a member of the tenant's default pool.`,
      );
    }
    assertions.push({
      name: "va_claim_succeeded",
      expected: "claimed=true",
      actual: claimResp.claimed ? "claimed" : `failed: ${claimResp.reason ?? "unknown"}`,
      ok: claimResp.claimed === true,
    });
    if (!claimResp.claimed) {
      return finalize(
        fixture, start, "fail", "P0", assertions, {},
        "VA_CLAIM_FAILED",
        `Claim failed: ${claimResp.reason ?? "unknown"}. Ensure the harness e2e-harness user is a member of the tenant's default pool.`,
      );
    }

    // 5. Submit concur review. Six concur signoffs, no condition actions,
    //    overall rationale ≥ 20 chars per Spec validation.
    const reviewBody = {
      verdict: "concur" as const,
      specialistSignoffs: ["doc", "income", "asset", "credit", "property", "compliance"].map((s) => ({
        specialist: s,
        signoff: "concur" as const,
        notes: null,
      })),
      conditionActions: [],
      overallRationale: "All specialists concur with the agent's analysis. Loan presents no anomalies.",
      docRequest: null,
      agentRecommendationId: "00000000-0000-0000-0000-000000000099",
      kbVersion: "harness-test",
      chatbotConsultationIds: [],
    };
    type SubmitResp = { reviewId?: string; newState?: string; error?: string };
    let submitResp: SubmitResp;
    try {
      submitResp = await http.post<SubmitResp>(apiOpts, `/loans/${fixture.loanId}/va/review`, reviewBody);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertions.push({
        name: "submit_concur_to_uw_review_pending",
        expected: "newState=uw_review_pending",
        actual: msg, ok: false,
      });
      return finalize(fixture, start, "fail", "P0", assertions, {}, "VA_SUBMIT_FAILED", msg);
    }
    assertions.push({
      name: "submit_concur_to_uw_review_pending",
      expected: "newState=uw_review_pending",
      actual: submitResp.newState ?? `error: ${submitResp.error ?? "unknown"}`,
      ok: submitResp.newState === "uw_review_pending",
    });
    if (submitResp.newState !== "uw_review_pending") {
      return finalize(
        fixture, start, "fail", "P0", assertions, {},
        "VA_SUBMIT_FAILED",
        `Submit failed: ${submitResp.error ?? "no newState in response"}`,
      );
    }

    // 6. UW accepts. State is now uw_review_pending; the gate invariant from
    //    Task 6 should permit AcceptRecommendation.
    type AcceptResp = { ok?: boolean; decision?: string };
    let acceptResp: AcceptResp;
    try {
      acceptResp = await http.post<AcceptResp>(
        apiOpts, `/loans/${fixture.loanId}/recommendation/accept`,
        { actor: ACTORS.human },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertions.push({ name: "uw_accept_succeeded", expected: "200", actual: msg, ok: false });
      return finalize(fixture, start, "fail", "P0", assertions, {}, "UW_ACCEPT_FAILED", msg);
    }
    assertions.push({
      name: "uw_accept_succeeded",
      expected: "non-pending decision",
      actual: acceptResp.decision ?? "unknown",
      ok: typeof acceptResp.decision === "string" && acceptResp.decision !== "pending",
    });

    const allOk = assertions.every((a) => a.ok);
    return finalize(
      fixture, start, allOk ? "pass" : "fail",
      allOk ? null : "P0",
      assertions,
      { reviewId: submitResp.reviewId, decision: acceptResp.decision ?? null },
      null, null,
    );
  },
};

function finalize(
  fixture: FixtureMeta,
  start: number,
  status: "pass" | "fail" | "skip",
  severity: "P0" | "P1" | "P2" | null,
  assertions: AssertionResult[],
  evidence: Record<string, unknown>,
  errCode: string | null,
  errMsg: string | null,
): CellResult {
  return {
    loanId: fixture.loanId,
    fixture: fixture.id,
    workflow: "W9_va_review",
    status,
    severity,
    durationMs: Date.now() - start,
    assertions,
    evidence,
    error: errCode ? { code: errCode, message: errMsg ?? "" } : null,
  };
}
