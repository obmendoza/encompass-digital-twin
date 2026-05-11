// scripts/e2e-harness/workflows/W6-kb-ingest-twokey.ts
// Mirrors scripts/test-guideline-pipeline.sh in TypeScript. One cell per run.
// Sub-cells (subCell field on assertions):
//   W6.ingest, W6.operator_approve, W6.same_user_blocked,
//   W6.compliance_approve, W6.version_increment, W6.chatbot_cites_new_version

import { http, type HttpOptions } from "../http.js";
import type { AssertionResult, CellResult, FixtureMeta, WorkflowDef } from "../types.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GUIDELINES_PDF = process.env.GUIDELINES_PDF ?? join(homedir(), "Downloads", "Flex NonQM and DSCR Underwriting Guidelines_02 13 2026 Rev 1.pdf");
const MATRICES_PDF = process.env.MATRICES_PDF ?? join(homedir(), "Downloads", "NonQM and DSCR Matrices_02 13 2026 Rev1.pdf");

export const W6: WorkflowDef = {
  id: "W6_kb_ingest_twokey",
  name: "KB Ingest + Two-Key Approval",
  specRefs: ["spec-f-intelligent-guidelines §3", "onboarding-v2 §3.5"],
  appliesTo: () => true, // global
  run: async (_fixture: FixtureMeta, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const assertions: AssertionResult[] = [];

    // Pre-check: PDFs present.
    assertions.push({ name: "guidelines_pdf_present", expected: "exists", actual: existsSync(GUIDELINES_PDF), ok: existsSync(GUIDELINES_PDF), subCell: "W6.ingest" });
    assertions.push({ name: "matrices_pdf_present", expected: "exists", actual: existsSync(MATRICES_PDF), ok: existsSync(MATRICES_PDF), subCell: "W6.ingest" });
    if (!existsSync(GUIDELINES_PDF) || !existsSync(MATRICES_PDF)) {
      return cell(start, "fail", "P1", assertions, "MISSING_PDFS", "set GUIDELINES_PDF and MATRICES_PDF env vars");
    }

    // Resolve a tenant. Prefer NPNQM; otherwise first available. /tenants
    // requires super_admin — set the flag explicitly on this call.
    type TenantsResp = { tenants?: Array<{ id: string; slug: string }> };
    const adminOpts: HttpOptions = { ...apiOpts, superAdmin: true };
    const tenantsArr = await http.get<Array<{ id: string; slug: string }>>(adminOpts, "/tenants").catch(() => [] as Array<{ id: string; slug: string }>);
    // Endpoint returns a raw array (per tenants.ts); accept both shapes for safety.
    const tenantsList = Array.isArray(tenantsArr) ? tenantsArr : ((tenantsArr as TenantsResp).tenants ?? []);
    const npnqm = tenantsList.find((t) => t.slug.toLowerCase().includes("npnqm")) ?? tenantsList[0];
    assertions.push({ name: "tenant_resolved", expected: "non-null", actual: npnqm?.id ?? null, ok: !!npnqm, subCell: "W6.ingest" });
    if (!npnqm) return cell(start, "fail", "P0", assertions, "NO_TENANT", "no tenant available for KB ingest");

    const tenantOpts: HttpOptions = { baseUrl: ctx.apiUrl, tenantId: npnqm.id };
    const tenantAgentOpts: HttpOptions = { baseUrl: ctx.agentUrl, tenantId: npnqm.id, timeoutMs: 600_000 };

    // Read kb_version before.
    type GuidelinesResp = { kb_version?: string | null };
    const before = await http.get<GuidelinesResp>(tenantOpts, "/guidelines").catch(() => ({} as GuidelinesResp));
    const versionBefore = before.kb_version ?? null;

    // Ingest. Endpoint shape inferred from test-guideline-pipeline.sh; adjust if needed.
    type IngestResp = { ingestion_id?: string; status?: string; error?: string };
    const ingest = await http.post<IngestResp>(tenantAgentOpts, "/api/kb/ingest", {
      tenant_id: npnqm.id,
      guidelines_path: GUIDELINES_PDF,
      matrices_path: MATRICES_PDF,
    }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) } as IngestResp));
    assertions.push({ name: "ingestion_started", expected: "ingestion_id non-null", actual: ingest.ingestion_id ?? null, ok: !!ingest.ingestion_id, subCell: "W6.ingest" });
    if (!ingest.ingestion_id) return cell(start, "fail", "P0", assertions, "INGEST_FAILED", `ingestion did not start: ${ingest.error ?? "unknown"}`);

    // Operator approval (admin role).
    type ApprovalResp = { ok?: boolean; error?: string };
    const opActor = { kind: "human" as const, id: "e2e-operator" };
    const op = await http.post<ApprovalResp>(tenantOpts, `/guidelines/approvals/${ingest.ingestion_id}`, { role: "admin", actor: opActor })
      .catch((e) => ({ error: e instanceof Error ? e.message : String(e) } as ApprovalResp));
    assertions.push({ name: "operator_approval_ok", expected: true, actual: op.ok ?? false, ok: !!op.ok, subCell: "W6.operator_approve" });

    // Same-user blocked: same operator now tries to approve as compliance — must be rejected.
    let sameUserBlocked = false;
    try {
      const dup = await http.post<ApprovalResp>(tenantOpts, `/guidelines/approvals/${ingest.ingestion_id}`, { role: "compliance_officer", actor: opActor });
      sameUserBlocked = !dup.ok;
    } catch {
      sameUserBlocked = true;
    }
    assertions.push({ name: "same_user_blocked", expected: "blocked", actual: sameUserBlocked ? "blocked" : "allowed", ok: sameUserBlocked, subCell: "W6.same_user_blocked" });

    // Compliance approval (different user).
    const cpActor = { kind: "human" as const, id: "e2e-compliance" };
    const cp = await http.post<ApprovalResp>(tenantOpts, `/guidelines/approvals/${ingest.ingestion_id}`, { role: "compliance_officer", actor: cpActor })
      .catch((e) => ({ error: e instanceof Error ? e.message : String(e) } as ApprovalResp));
    assertions.push({ name: "compliance_approval_ok", expected: true, actual: cp.ok ?? false, ok: !!cp.ok, subCell: "W6.compliance_approve" });

    // Version increment.
    const after = await http.get<GuidelinesResp>(tenantOpts, "/guidelines").catch(() => ({} as GuidelinesResp));
    const versionAfter = after.kb_version ?? null;
    assertions.push({ name: "kb_version_changed", expected: `!= ${versionBefore}`, actual: versionAfter, ok: versionAfter !== versionBefore && !!versionAfter, subCell: "W6.version_increment" });

    // Chatbot smoke + citation.
    type ChatResp = { answer?: string; kb_version?: string };
    const chat = await http.post<ChatResp>(tenantAgentOpts, "/api/chatbot/query", { question: "What is the maximum LTV for a DSCR purchase?", tenant_id: npnqm.id })
      .catch(() => ({} as ChatResp));
    assertions.push({ name: "chatbot_answered", expected: "non-empty", actual: chat.answer?.length ?? 0, ok: (chat.answer?.length ?? 0) > 0, subCell: "W6.chatbot_cites_new_version" });
    assertions.push({ name: "chatbot_cites_kb_version", expected: versionAfter, actual: chat.kb_version ?? null, ok: chat.kb_version === versionAfter, subCell: "W6.chatbot_cites_new_version" });

    const allOk = assertions.every((a) => a.ok);
    const severity = allOk ? null : (assertions.find((a) => !a.ok && (a.name === "kb_version_changed" || a.name === "ingestion_started" || a.name === "same_user_blocked")) ? "P0" : "P1");
    return cell(start, allOk ? "pass" : "fail", severity, assertions, null, null, { kbVersionBefore: versionBefore, kbVersionAfter: versionAfter });
  },
};

function cell(start: number, status: "pass" | "fail", severity: "P0" | "P1" | "P2" | null, assertions: AssertionResult[], errCode: string | null, errMsg: string | null, evidence: Record<string, unknown> = {}): CellResult {
  return { loanId: null, fixture: "_global", workflow: "W6_kb_ingest_twokey", status, severity, durationMs: Date.now() - start, assertions, evidence, error: errCode ? { code: errCode, message: errMsg ?? "" } : null };
}
