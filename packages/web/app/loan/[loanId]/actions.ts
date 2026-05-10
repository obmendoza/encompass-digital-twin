"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { api } from "@/lib/api-client";
import { getUser } from "@/lib/auth";
import type { Actor, UwDecision, NewCondition, QualifyingIncomeWorksheet } from "@twin/core";

// Resolve the active user's tenant id from request headers (set by web
// middleware via x-user-tenant-id). When unset, fall back to looking up the
// demo tenant the same way api-client does. The agent service uses this
// value to scope its own callbacks into the API — without it, the agent
// defaults to its hard-coded tenant and the API rejects the fetch.
async function resolveTenantId(): Promise<string | null> {
  try {
    const h = await headers();
    const fromHeader = h.get("x-user-tenant-id");
    if (fromHeader) return fromHeader;
  } catch { /* not in a request context */ }
  try {
    return await api.getTenantIdBySlug("demo");
  } catch {
    return null;
  }
}

async function getActor(): Promise<Actor> {
  const user = await getUser();
  if (user) {
    return { kind: "human", id: user.displayName ?? user.email };
  }
  return { kind: "human", id: "anonymous" };
}

export interface ActionResult {
  ok: boolean;
  error?: { code: string; message: string };
}

async function run(loanId: string, fn: (actor: Actor, init?: RequestInit) => Promise<unknown>, tenantId?: string): Promise<ActionResult> {
  const actor = await getActor();
  const init = tenantId ? { headers: { "x-tenant-id": tenantId } } : undefined;
  try {
    await fn(actor, init);
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const [code, ...rest] = msg.split(": ");
    return { ok: false, error: { code: code ?? "INTERNAL", message: rest.join(": ") || msg } };
  }
}

export async function actionLoadScenario(scenarioId: string): Promise<ActionResult> {
  try {
    await api.loadScenario(scenarioId);
    revalidatePath("/loan", "layout");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const [code, ...rest] = msg.split(": ");
    return { ok: false, error: { code: code ?? "INTERNAL", message: rest.join(": ") || msg } };
  }
}

export async function actionSetDecision(loanId: string, decision: UwDecision, rationale: string, tenantId?: string) {
  return run(loanId, (actor, init) => api.setDecision(loanId, decision, rationale, actor, init), tenantId);
}

export async function actionAddCondition(loanId: string, condition: NewCondition) {
  return run(loanId, (actor) => api.addCondition(loanId, condition, actor));
}

export async function actionClearCondition(loanId: string, conditionId: string, notes: string) {
  return run(loanId, (actor) => api.clearCondition(loanId, conditionId, notes, actor));
}

export async function actionWaiveCondition(loanId: string, conditionId: string, rationale: string) {
  return run(loanId, (actor) => api.waiveCondition(loanId, conditionId, rationale, actor));
}

export async function actionRemoveCondition(loanId: string, conditionId: string) {
  return run(loanId, (actor) => api.removeCondition(loanId, conditionId, actor));
}

export async function actionRecalcIncome(loanId: string, worksheet: QualifyingIncomeWorksheet) {
  return run(loanId, (actor) => api.recalcIncome(loanId, worksheet, actor));
}

export async function actionAddDocument(loanId: string, doc: { name: string; docType: string }) {
  return run(loanId, (actor) => api.addDocument(loanId, doc, actor));
}

export async function actionUpdateDocumentStatus(loanId: string, docId: string, status: string) {
  return run(loanId, (actor) => api.updateDocument(loanId, docId, { status }, actor));
}

export async function actionLinkDocument(loanId: string, docId: string, conditionId: string) {
  return run(loanId, (actor) => api.linkDocument(loanId, docId, conditionId, actor));
}

export async function actionRunAgentMulti(loanId: string): Promise<ActionResult> {
  const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:8000";
  const tenantId = await resolveTenantId();
  const tenantQ = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  try {
    const res = await fetch(`${agentUrl}/api/twin/underwrite-multi/${loanId}${tenantQ}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(600_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Multi-agent returned ${res.status}: ${body.slice(0, 200)}`);
    }
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { code: "AGENT_ERROR", message: msg } };
  }
}

export async function actionRunAgent(loanId: string): Promise<ActionResult> {
  const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:8000";
  const tenantId = await resolveTenantId();
  const tenantQ = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  try {
    const res = await fetch(`${agentUrl}/api/twin/underwrite/${loanId}${tenantQ}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Agent service returned ${res.status}: ${body.slice(0, 200)}`);
    }
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { code: "AGENT_ERROR", message: msg } };
  }
}

export async function actionAcceptRecommendation(loanId: string, tenantId?: string) {
  return run(loanId, (actor, init) => api.acceptRecommendation(loanId, actor, init), tenantId);
}

export async function actionClearRecommendation(loanId: string) {
  return run(loanId, (actor) => api.clearRecommendation(loanId, actor));
}

export async function actionOverrideDecision(loanId: string, original: string, override: string, overrideReason: string, rationale: string, tenantId?: string) {
  return run(loanId, (actor, init) =>
    api.overrideDecision(loanId, original as UwDecision, override as UwDecision, overrideReason, rationale, actor, init), tenantId
  );
}

export async function actionSendBackToVA(loanId: string, notes: string, tenantId?: string) {
  return run(loanId, (actor, init) => api.sendBackToVA(loanId, notes, actor, init), tenantId);
}

export async function actionGenerateDocs(loanId: string): Promise<ActionResult & { count?: number }> {
  const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${agentUrl}/api/workshop/generate-docs/${loanId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: { code: "DOC_GEN_FAILED", message: text.slice(0, 200) } };
    }
    const data = await res.json();
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, count: data.documentsGenerated };
  } catch (e) {
    return { ok: false, error: { code: "DOC_GEN_ERROR", message: e instanceof Error ? e.message : String(e) } };
  }
}

export async function actionRunIDP(loanId: string, docId: string): Promise<ActionResult & { extracted?: Record<string, unknown> }> {
  const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${agentUrl}/api/idp/extract-from-twin/${loanId}/${docId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: { code: "IDP_FAILED", message: text.slice(0, 200) } };
    }
    const data = await res.json();
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, extracted: data.extracted };
  } catch (e) {
    return { ok: false, error: { code: "IDP_ERROR", message: e instanceof Error ? e.message : String(e) } };
  }
}

export async function actionAddConditionBatch(
  loanId: string,
  conditions: Array<{ category: string; source: string; description: string }>
): Promise<ActionResult & { added?: number }> {
  const actor = await getActor();
  try {
    for (const c of conditions) {
      await api.addCondition(
        loanId,
        {
          category: c.category as "PTA" | "PTD" | "PTF" | "PTP",
          source: c.source as "UW" | "AUS" | "Compliance" | "Investor",
          description: c.description,
        },
        actor
      );
    }
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, added: conditions.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { code: "BATCH_FAILED", message: msg } };
  }
}

export async function actionUploadFile(loanId: string, docId: string, formData: FormData): Promise<ActionResult & { fileUrl?: string }> {
  const twinApi = process.env.TWIN_API_URL ?? "http://127.0.0.1:4000";
  try {
    const res = await fetch(`${twinApi}/loans/${loanId}/documents/${docId}/upload`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: { code: "UPLOAD_FAILED", message: `Upload failed: ${text.slice(0, 200)}` } };
    }
    const data = await res.json();
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, fileUrl: data.fileUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: { code: "UPLOAD_ERROR", message: msg } };
  }
}
