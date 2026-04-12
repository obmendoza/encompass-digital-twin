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
