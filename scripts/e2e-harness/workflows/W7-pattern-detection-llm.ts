// scripts/e2e-harness/workflows/W7-pattern-detection-llm.ts
// Sub-cells: W7.seed, W7.detect, W7.suggestion_created,
//            W7.same_user_blocked, W7.two_key_approved, W7.guideline_applied
//
// Endpoint reality (verified from packages/api/src/routes/patterns.ts):
//   - The 6-hour worker (learning-worker.ts, advisory lock 43) is the canonical
//     production trigger. For tests, system-check.ts:run-pattern-detection
//     synchronously calls detectPatterns + persistPatterns for the request's
//     tenant — same code path as the worker, no waiting.
//   - The two-key approval flow is folded into a single endpoint:
//       POST /metrics/:tenantId/patterns/:patternId/apply
//     First call (admin) returns { ok: true, status: "awaiting_compliance" }.
//     Second call by the SAME user → 409 (separation-of-duties).
//     Second call by a DIFFERENT user → applies the suggestion.

import { ACTORS, http, type HttpOptions } from "../http.js";
import { getLatestActivePattern } from "../supabase.js";
import type { AssertionResult, CellResult, WorkflowDef } from "../types.js";

const SEED_FIXTURE = "nqm-bankstmt-12mo-clean";
const SEED_LOAN_ID = "2501000101";
// minSample for high_override_rate is 20 (packages/core/src/learning-types.ts:178);
// 10 overrides combined with prior runs' decisions reliably cross that threshold.
// The seed loop dispatches OverrideDecision via the API only — no agent calls,
// so this remains zero LLM cost.
const SEED_COUNT = 10;

export const W7: WorkflowDef = {
  id: "W7_pattern_detection",
  name: "Pattern Detection + LLM Insight",
  specRefs: ["learning-engine-v2 §1.4", "learning-engine-v2 §2"],
  appliesTo: () => true, // global
  run: async (_fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const agentOpts: HttpOptions = { baseUrl: ctx.agentUrl, timeoutMs: 600_000 };
    const assertions: AssertionResult[] = [];

    // Resolve a tenant for the path-scoped pattern routes. Prefer the demo
    // tenant from env (the seeded overrides write to that tenant's
    // decision_records), then fall back to the first tenant in /tenants.
    // /tenants returns the array directly, NOT wrapped in {tenants: [...]}
    // (verified earlier — the wrapper-shape assumption was a W8 finding).
    type TenantRow = { id: string; slug: string };
    let tenantId: string | null = process.env.DEMO_TENANT_ID ?? null;
    if (!tenantId) {
      const tenantsRes = await http.get<TenantRow[] | { tenants?: TenantRow[] }>(
        { ...apiOpts, superAdmin: true },
        "/tenants",
      ).catch(() => [] as TenantRow[]);
      const list = Array.isArray(tenantsRes) ? tenantsRes : (tenantsRes.tenants ?? []);
      tenantId = list[0]?.id ?? null;
    }
    const tenantOpts: HttpOptions = { baseUrl: ctx.apiUrl, tenantId: tenantId ?? undefined };

    // Reset + load once; the world/loan state persists across the seed loop.
    const tenantQ = process.env.DEMO_TENANT_ID ? `?tenant_id=${process.env.DEMO_TENANT_ID}` : "";
    await http.post(apiOpts, "/world/reset").catch(() => undefined);
    await http.post(apiOpts, "/world/load-scenario", { scenarioId: SEED_FIXTURE }).catch(() => undefined);
    await http.post(agentOpts, `/api/twin/underwrite-multi/${SEED_LOAN_ID}${tenantQ}`).catch(() => undefined);

    // Seed N overrides for the same reason against the same fixture/loan.
    let seedSucceeded = 0;
    for (let i = 0; i < SEED_COUNT; i++) {
      try {
        type Loan = { pendingRecommendation?: { recommendation: string } | null; decision?: string };
        const l = await http.get<Loan>(apiOpts, `/loans/${SEED_LOAN_ID}`);
        const original = l.pendingRecommendation?.recommendation ?? "approved";
        const overrideTo = original === "approved" ? "suspended" : "approved";
        await http.post(apiOpts, `/loans/${SEED_LOAN_ID}/override`, {
          originalRecommendation: original,
          overrideDecision: overrideTo,
          overrideReason: "dti_exception",
          rationale: `e2e-pattern-seed-${i}`,
          actor: ACTORS.human,
        });
        seedSucceeded++;
      } catch {
        // continue; seed assertion will reflect the partial count
      }
    }
    assertions.push({ name: "seeded_overrides", expected: SEED_COUNT, actual: seedSucceeded, ok: seedSucceeded === SEED_COUNT, subCell: "W7.seed" });

    // Trigger pattern detection synchronously via /system/run-pattern-detection
    // (added to system-check.ts for harness use; the production worker runs on
    // a 6h advisory lock and isn't suitable for tests).
    type DetectResp = {
      candidatesDetected?: number;
      suggestionsPersisted?: number;
      suggestionIds?: string[];
      candidates?: Array<{ ruleName?: string; program?: string; overrideReason?: string }>;
      error?: string;
    };
    const detect = await http.post<DetectResp>(apiOpts, "/system/run-pattern-detection")
      .catch((e) => ({ error: e instanceof Error ? e.message : String(e) } as DetectResp));
    const patternsFound = detect.candidatesDetected ?? 0;
    assertions.push({ name: "patterns_detected", expected: ">0", actual: patternsFound, ok: patternsFound > 0, subCell: "W7.detect" });

    // suggestionsPersisted may be 0 if persistPatterns matched an existing
    // active pattern (idempotent on rule/program/reason). Fall back to a
    // direct query for the most recent active suggestion in detected_patterns.
    let suggestionId: string | null = detect.suggestionIds?.[0] ?? null;
    let suggestionStatus: string | null = null;
    if (tenantId) {
      const existing = await getLatestActivePattern(tenantId).catch(() => null);
      if (!suggestionId) suggestionId = existing?.id ?? null;
      suggestionStatus = existing?.status ?? null;
    }
    assertions.push({ name: "suggestion_id_present", expected: "non-null", actual: suggestionId, ok: !!suggestionId, subCell: "W7.suggestion_created" });

    if (!suggestionId || !tenantId) {
      const reason = !tenantId ? "no_tenant" : "no_suggestion_id";
      assertions.push({ name: "first_approval_ok", expected: true, actual: reason, ok: false, subCell: "W7.two_key_approved" });
      assertions.push({ name: "self_approval_blocked", expected: "blocked", actual: reason, ok: false, subCell: "W7.same_user_blocked" });
      assertions.push({ name: "second_approval_ok", expected: true, actual: reason, ok: false, subCell: "W7.two_key_approved" });
      assertions.push({ name: "guideline_kb_version_present_after_apply", expected: "non-null", actual: reason, ok: false, subCell: "W7.guideline_applied" });
      return cell(start, "fail", "P0", assertions);
    }

    // The /apply endpoint requires a pattern_suggestions row in 'pending' status,
    // produced by the worker's processNewPatterns step (LLM insight generation).
    // /system/run-pattern-detection runs detect+persist only; it doesn't run the
    // analysis/insight step that would lift status from 'new'/'analyzing' to
    // 'suggestion_ready' with a corresponding pattern_suggestions row. Skip the
    // apply assertions cleanly with a descriptive reason rather than reporting
    // unconditional fails. Re-add when /system/run-pattern-detection is extended
    // to also call processNewPatterns (see learning-worker.ts:54).
    if (suggestionStatus !== "suggestion_ready" && suggestionStatus !== "awaiting_compliance") {
      const reason = `suggestion_not_ready_for_apply:${suggestionStatus}`;
      assertions.push({ name: "first_approval_ok", expected: true, actual: reason, ok: false, subCell: "W7.two_key_approved", auditClaim: null });
      assertions.push({ name: "self_approval_blocked", expected: "blocked", actual: reason, ok: false, subCell: "W7.same_user_blocked" });
      assertions.push({ name: "second_approval_ok", expected: true, actual: reason, ok: false, subCell: "W7.two_key_approved" });
      assertions.push({ name: "guideline_kb_version_present_after_apply", expected: "non-null", actual: reason, ok: false, subCell: "W7.guideline_applied" });
      return cell(start, "fail", "P1", assertions);
    }

    // Two-key approval via /metrics/:tenantId/patterns/:patternId/apply.
    // First call: admin (user A) → expect ok=true, status="awaiting_compliance".
    type ApplyResp = { ok?: boolean; status?: string; error?: string };
    const userAOpts: HttpOptions = { ...tenantOpts };
    const op1 = await http.post<ApplyResp>(userAOpts, `/metrics/${tenantId}/patterns/${suggestionId}/apply`, { role: "admin", actor: { kind: "human", id: "e2e-user-A" } })
      .catch((e) => ({ error: e instanceof Error ? e.message : String(e) } as ApplyResp));
    assertions.push({ name: "first_approval_ok", expected: true, actual: op1.ok ?? false, ok: !!op1.ok, subCell: "W7.two_key_approved" });

    // Same user attempts the compliance step — expect 409 (separation-of-duties).
    let selfBlocked = false;
    try {
      const opSelf = await http.post<ApplyResp>(userAOpts, `/metrics/${tenantId}/patterns/${suggestionId}/apply`, { role: "compliance_officer", actor: { kind: "human", id: "e2e-user-A" } });
      selfBlocked = !opSelf.ok;
    } catch {
      // HttpError on 409 → blocked, as expected.
      selfBlocked = true;
    }
    assertions.push({ name: "self_approval_blocked", expected: "blocked", actual: selfBlocked ? "blocked" : "allowed", ok: selfBlocked, subCell: "W7.same_user_blocked" });

    // Different user (B) provides compliance approval and applies.
    const op2 = await http.post<ApplyResp>(tenantOpts, `/metrics/${tenantId}/patterns/${suggestionId}/apply`, { role: "compliance_officer", actor: { kind: "human", id: "e2e-user-B" } })
      .catch((e) => ({ error: e instanceof Error ? e.message : String(e) } as ApplyResp));
    assertions.push({ name: "second_approval_ok", expected: true, actual: op2.ok ?? false, ok: !!op2.ok, subCell: "W7.two_key_approved" });

    // Guideline applied check — fetch guidelines and confirm a kb_version is present.
    // In in-memory mode this may be limited; we just record what we get.
    type GuidelinesResp = { kb_version?: string | null };
    const guidelines = await http.get<GuidelinesResp>(tenantOpts, "/guidelines").catch(() => ({} as GuidelinesResp));
    assertions.push({ name: "guideline_kb_version_present_after_apply", expected: "non-null", actual: guidelines.kb_version ?? null, ok: !!guidelines.kb_version, subCell: "W7.guideline_applied" });

    const allOk = assertions.every((a) => a.ok);
    const severity = allOk
      ? null
      : (assertions.find((a) => !a.ok && (a.name === "self_approval_blocked" || a.name === "patterns_detected" || a.name === "suggestion_id_present")) ? "P0" : "P1");
    return cell(start, allOk ? "pass" : "fail", severity, assertions);
  },
};

function cell(start: number, status: "pass" | "fail", severity: "P0" | "P1" | "P2" | null, assertions: AssertionResult[], evidence: Record<string, unknown> = {}): CellResult {
  return { loanId: null, fixture: "_global", workflow: "W7_pattern_detection", status, severity, durationMs: Date.now() - start, assertions, evidence, error: null };
}
