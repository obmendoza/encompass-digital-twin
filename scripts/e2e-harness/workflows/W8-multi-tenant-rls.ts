// scripts/e2e-harness/workflows/W8-multi-tenant-rls.ts
// Tests the API tier's enforcement of tenant scoping (Tenant Isolation v2 §1.1).
//
// Critical attack: tenant B forges `x-tenant-id: <B>` directly to the API and
// requests a loan that belongs to tenant A. The API must NOT trust the header
// and return A's data — it must respond 403 or 404. The harness's http.ts
// already injects `x-tenant-id` when HttpOptions.tenantId is set, so giving a
// request opts a different tenantId IS the forged-header attack.
//
// Endpoint reality (verified from packages/api/src/routes/tenants.ts):
//   GET    /tenants               → super_admin only, returns rows[] directly
//   GET    /tenants/:slug         → returns row directly, 404 if missing
//   POST   /tenants               → super_admin only, returns created row (201)
//   PATCH  /tenants/:slug         → super_admin only, soft-delete via {status:"offboarding"}
//   (NO DELETE /tenants/:slug — soft delete only via PATCH)
// Super-admin gating: middleware reads `x-super-admin: true` header.
// In-memory mode (no DATABASE_URL): tenant routes hit withDb and will fail —
// we record the failure honestly via assertions instead of crashing.

import { http, HttpError, type HttpOptions } from "../http.js";
import { APPLIES_TO_RLS } from "../fixtures.js";
import type { AssertionResult, CellResult, FixtureMeta, WorkflowDef } from "../types.js";

const TENANT_PREFIX = "e2e-test-rls-";

interface TenantRow {
  id: string;
  slug: string;
  name?: string;
  status?: string;
}

// Raw fetch helper for super_admin endpoints. Captures status + body for evidence.
// Sends x-user-id (internal-service trust) + x-super-admin per the API's
// jwt-tenant-resolver middleware (lines 35-41).
async function superAdminFetch(
  apiUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    "x-user-id": "e2e-harness-superadmin",
    "x-super-admin": "true",
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  return { status: res.status, data };
}

export const W8: WorkflowDef = {
  id: "W8_multi_tenant_rls",
  name: "Multi-Tenant Isolation",
  specRefs: ["tenant-isolation-v2 §1.1", "tenant-isolation-v2 §1.2"],
  appliesTo: APPLIES_TO_RLS,
  run: async (fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const assertions: AssertionResult[] = [];
    const evidence: Record<string, unknown> = {};

    // --- Cleanup: soft-delete any leftover e2e-test-rls-* tenants. -----
    const listRes = await superAdminFetch(ctx.apiUrl, "GET", "/tenants").catch(() => ({ status: 0, data: null }));
    evidence.preexistingTenantsList = { status: listRes.status };
    const existing: TenantRow[] = Array.isArray(listRes.data) ? (listRes.data as TenantRow[]) : [];
    for (const t of existing) {
      if (t.slug?.startsWith(TENANT_PREFIX)) {
        await superAdminFetch(ctx.apiUrl, "PATCH", `/tenants/${t.slug}`, {
          status: "offboarding",
          reason: "e2e-harness cleanup",
        }).catch(() => undefined);
      }
    }

    // --- Create tenant A and tenant B. ---------------------------------
    const stamp = Date.now();
    const aSlug = `${TENANT_PREFIX}a-${stamp}`;
    const bSlug = `${TENANT_PREFIX}b-${stamp + 1}`;
    const createA = await superAdminFetch(ctx.apiUrl, "POST", "/tenants", {
      name: "E2E RLS Tenant A",
      slug: aSlug,
    }).catch((e) => ({ status: 0, data: { error: e instanceof Error ? e.message : String(e) } }));
    const createB = await superAdminFetch(ctx.apiUrl, "POST", "/tenants", {
      name: "E2E RLS Tenant B",
      slug: bSlug,
    }).catch((e) => ({ status: 0, data: { error: e instanceof Error ? e.message : String(e) } }));

    const a = (createA.status === 201 && createA.data && typeof createA.data === "object")
      ? (createA.data as TenantRow) : null;
    const b = (createB.status === 201 && createB.data && typeof createB.data === "object")
      ? (createB.data as TenantRow) : null;

    evidence.createA = { status: createA.status, slug: aSlug, id: a?.id ?? null };
    evidence.createB = { status: createB.status, slug: bSlug, id: b?.id ?? null };

    assertions.push({
      name: "tenant_a_created",
      expected: "201 with id",
      actual: a?.id ? `201 ${a.id}` : `status_${createA.status}`,
      ok: !!a?.id,
    });
    assertions.push({
      name: "tenant_b_created",
      expected: "201 with id",
      actual: b?.id ? `201 ${b.id}` : `status_${createB.status}`,
      ok: !!b?.id,
    });

    if (!a?.id || !b?.id) {
      // Cannot run isolation test without both tenants. Record honestly.
      // In in-memory mode (no DATABASE_URL), this is the expected outcome:
      // POST /tenants hits withDb() and fails before any insert. This is a
      // setup gap (P1), NOT a data leak — reserve P0 for an actual leak.
      return cell(fixture, start, "fail", "P1", assertions, {
        ...evidence,
        note: "Tenant creation failed — likely in-memory mode (no DATABASE_URL) or super_admin gate. RLS isolation could not be exercised.",
      });
    }

    // --- Demo tenant loads the fixture (only demo can use /world/*). ----
    // /world/reset and /world/load-scenario are restricted to the demo tenant
    // (per packages/api/src/routes/world.ts requireDemoTenant). A and B are
    // just stub tenants we use to test cross-tenant access; the loan we
    // attack lives in the demo tenant's scope.
    const demoOpts: HttpOptions = { baseUrl: ctx.apiUrl };  // default tenant = DEMO_TENANT_ID
    await http.post(demoOpts, "/world/reset").catch(() => undefined);
    await http.post(demoOpts, "/world/load-scenario", { scenarioId: fixture.id }).catch(() => undefined);

    // --- Demo can read its own loan (sanity). ---------------------------
    type Loan = { id: string };
    let demoRead: Loan | null = null;
    let demoErr: number | null = null;
    try {
      demoRead = await http.get<Loan>(demoOpts, `/loans/${fixture.loanId}`);
    } catch (e) {
      if (e instanceof HttpError) demoErr = e.status;
      else throw e;
    }
    evidence.demoReadStatus = demoRead?.id ? 200 : demoErr;
    assertions.push({
      name: "demo_can_read_loaded_loan",
      expected: fixture.loanId,
      actual: demoRead?.id ?? `error_${demoErr}`,
      ok: demoRead?.id === fixture.loanId,
    });

    // --- Forged-header attack: tenant B asks for demo's loan. ----------
    // http.ts injects `x-tenant-id: <b.id>` from HttpOptions.tenantId.
    // If the API returns the loan, that is a P0 RLS leak (§1.1).
    const bOpts: HttpOptions = { baseUrl: ctx.apiUrl, tenantId: b.id };
    let bStatus: number | null = null;
    let bData: unknown = null;
    let bRawBody: string | null = null;
    try {
      bData = await http.get<Loan>(bOpts, `/loans/${fixture.loanId}`);
      bStatus = 200;
    } catch (e) {
      if (e instanceof HttpError) {
        bStatus = e.status;
        bRawBody = e.bodyText;
      } else {
        throw e;
      }
    }
    evidence.tenantBProbe = { status: bStatus, body: bRawBody, data: bData };

    // 400 LOAN_NOT_FOUND, 403, and 404 are all valid "blocked" outcomes — the API
    // is hiding the loan from B regardless of the specific status code. The leak
    // would be 200 with A's data; anything that's not 200 with data is blocked.
    assertions.push({
      name: "tenant_b_blocked_or_not_found",
      expected: "400, 403, or 404",
      actual: bStatus ?? "no_response",
      ok: bStatus === 400 || bStatus === 403 || bStatus === 404,
    });
    assertions.push({
      name: "tenant_b_did_not_receive_data",
      expected: null,
      actual: bData ?? null,
      ok: bData === null,
    });

    // --- Cleanup: soft-delete A and B. ---------------------------------
    await superAdminFetch(ctx.apiUrl, "PATCH", `/tenants/${aSlug}`, {
      status: "offboarding",
      reason: "e2e-harness teardown",
    }).catch(() => undefined);
    await superAdminFetch(ctx.apiUrl, "PATCH", `/tenants/${bSlug}`, {
      status: "offboarding",
      reason: "e2e-harness teardown",
    }).catch(() => undefined);

    const allOk = assertions.every((x) => x.ok);
    // P0 if the isolation assertions failed (data leak); P1 for setup failures.
    const leakAssertion = assertions.find(
      (x) =>
        !x.ok &&
        (x.name === "tenant_b_blocked_or_not_found" ||
          x.name === "tenant_b_did_not_receive_data"),
    );
    const severity: "P0" | "P1" | "P2" | null = allOk ? null : (leakAssertion ? "P0" : "P1");
    return cell(fixture, start, allOk ? "pass" : "fail", severity, assertions, evidence);
  },
};

function cell(
  fixture: FixtureMeta,
  start: number,
  status: "pass" | "fail",
  severity: "P0" | "P1" | "P2" | null,
  assertions: AssertionResult[],
  evidence: Record<string, unknown> = {},
): CellResult {
  return {
    loanId: fixture.loanId,
    fixture: fixture.id,
    workflow: "W8_multi_tenant_rls",
    status,
    severity,
    durationMs: Date.now() - start,
    assertions,
    evidence,
    error: null,
  };
}
