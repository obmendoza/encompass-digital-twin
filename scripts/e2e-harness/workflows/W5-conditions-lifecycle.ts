// scripts/e2e-harness/workflows/W5-conditions-lifecycle.ts
import { ACTORS, http, type HttpOptions } from "../http.js";
import { APPLIES_TO_ALL } from "../fixtures.js";
import type { AssertionResult, CellResult, FixtureMeta, WorkflowDef } from "../types.js";

export const W5: WorkflowDef = {
  id: "W5_conditions_lifecycle",
  name: "Conditions lifecycle",
  specRefs: ["core/conditions"],
  appliesTo: APPLIES_TO_ALL,
  run: async (fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const assertions: AssertionResult[] = [];

    await http.post(apiOpts, "/world/reset");
    await http.post(apiOpts, "/world/load-scenario", { scenarioId: fixture.id });

    type Cond = { id: string; status?: string; description: string };
    type Loan = { conditions?: Cond[]; documents?: Array<{ id: string; linkedConditionId?: string }> };
    const before = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const baselineCount = before.conditions?.length ?? 0;
    const baselineIds = new Set((before.conditions ?? []).map((c) => c.id));

    const condition = { category: "PTD" as const, source: "UW" as const, description: "e2e-test condition unique-marker-W5" };

    // Add. Endpoint expects { condition: {...}, actor }; response is the full loan.
    const addResp = await http.post<Loan>(apiOpts, `/loans/${fixture.loanId}/conditions`, { condition, actor: ACTORS.human });
    const added = (addResp.conditions ?? []).find((c) => !baselineIds.has(c.id) && c.description === condition.description);
    const addedId = added?.id ?? null;
    assertions.push({ name: "condition_added", expected: "non-null id", actual: addedId, ok: !!addedId });
    if (!addedId) return cell(fixture, start, "fail", "P0", assertions);

    // Dedup: try adding the same condition again — reducer silently no-ops on dup.
    await http.post<Loan>(apiOpts, `/loans/${fixture.loanId}/conditions`, { condition, actor: ACTORS.human }).catch(() => ({} as Loan));
    const loanAfterDup = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const matchingCount = (loanAfterDup.conditions ?? []).filter((c) => c.description === condition.description).length;
    assertions.push({ name: "dedup_blocks_duplicate", expected: 1, actual: matchingCount, ok: matchingCount === 1 });

    // Clear. Endpoint is POST in current API; try PUT first to remain robust to future REST conventions.
    await http.put(apiOpts, `/loans/${fixture.loanId}/conditions/${addedId}/clear`, { notes: "e2e: cleared", actor: ACTORS.human }).catch(async () => {
      await http.post(apiOpts, `/loans/${fixture.loanId}/conditions/${addedId}/clear`, { notes: "e2e: cleared", actor: ACTORS.human });
    });

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
