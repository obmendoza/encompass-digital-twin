"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api-client";
import type { Actor, UwDecision, NewCondition } from "@twin/core";

const humanActor: Actor = { kind: "human", id: "uw-local" };

export async function actionLoadScenario(scenarioId: string) {
  await api.loadScenario(scenarioId);
  revalidatePath("/loan", "layout");
}

export async function actionSetDecision(loanId: string, decision: UwDecision, rationale: string) {
  await api.setDecision(loanId, decision, rationale, humanActor);
  revalidatePath(`/loan/${loanId}`, "layout");
}

export async function actionAddCondition(loanId: string, condition: NewCondition) {
  await api.addCondition(loanId, condition, humanActor);
  revalidatePath(`/loan/${loanId}`, "layout");
}

export async function actionClearCondition(loanId: string, conditionId: string, notes: string) {
  await api.clearCondition(loanId, conditionId, notes, humanActor);
  revalidatePath(`/loan/${loanId}`, "layout");
}

export async function actionWaiveCondition(loanId: string, conditionId: string, rationale: string) {
  await api.waiveCondition(loanId, conditionId, rationale, humanActor);
  revalidatePath(`/loan/${loanId}`, "layout");
}

export async function actionRemoveCondition(loanId: string, conditionId: string) {
  await api.removeCondition(loanId, conditionId, humanActor);
  revalidatePath(`/loan/${loanId}`, "layout");
}
