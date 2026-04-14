"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api-client";
import type { Actor, UwDecision, NewCondition, QualifyingIncomeWorksheet } from "@twin/core";

const humanActor: Actor = { kind: "human", id: "uw-local" };

export interface ActionResult {
  ok: boolean;
  error?: { code: string; message: string };
}

async function run(loanId: string, fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
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

export async function actionSetDecision(loanId: string, decision: UwDecision, rationale: string) {
  return run(loanId, () => api.setDecision(loanId, decision, rationale, humanActor));
}

export async function actionAddCondition(loanId: string, condition: NewCondition) {
  return run(loanId, () => api.addCondition(loanId, condition, humanActor));
}

export async function actionClearCondition(loanId: string, conditionId: string, notes: string) {
  return run(loanId, () => api.clearCondition(loanId, conditionId, notes, humanActor));
}

export async function actionWaiveCondition(loanId: string, conditionId: string, rationale: string) {
  return run(loanId, () => api.waiveCondition(loanId, conditionId, rationale, humanActor));
}

export async function actionRemoveCondition(loanId: string, conditionId: string) {
  return run(loanId, () => api.removeCondition(loanId, conditionId, humanActor));
}

export async function actionRecalcIncome(loanId: string, worksheet: QualifyingIncomeWorksheet) {
  return run(loanId, () => api.recalcIncome(loanId, worksheet, humanActor));
}

export async function actionAddDocument(loanId: string, doc: { name: string; docType: string }) {
  return run(loanId, () => api.addDocument(loanId, doc, humanActor));
}

export async function actionUpdateDocumentStatus(loanId: string, docId: string, status: string) {
  return run(loanId, () => api.updateDocument(loanId, docId, { status }, humanActor));
}

export async function actionLinkDocument(loanId: string, docId: string, conditionId: string) {
  return run(loanId, () => api.linkDocument(loanId, docId, conditionId, humanActor));
}

export async function actionRunAgent(loanId: string): Promise<ActionResult> {
  const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(`${agentUrl}/api/twin/underwrite/${loanId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(90_000),
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

export async function actionAcceptRecommendation(loanId: string) {
  return run(loanId, () => api.acceptRecommendation(loanId, humanActor));
}

export async function actionClearRecommendation(loanId: string) {
  return run(loanId, () => api.clearRecommendation(loanId, humanActor));
}
