"use server";

import { api } from "@/lib/api-client";
import { revalidatePath } from "next/cache";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

function err(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

export async function actionListPredictions(loanId: string): Promise<Result<{ predictions: unknown[]; alerts: unknown[] }>> {
  try {
    const r = await api.getPredictions(loanId);
    return { ok: true, predictions: r.predictions, alerts: r.alerts };
  } catch (e) {
    return err(e);
  }
}

export async function actionRunPredictions(loanId: string): Promise<Result<{ runId: string; predictionCount: number; alertCount: number; reused: boolean }>> {
  try {
    const r = await api.runPredictions(loanId);
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}

export async function actionAcceptPrediction(loanId: string, predictionId: string): Promise<Result<{ conditionId: string; predictionId: string }>> {
  try {
    const r = await api.acceptPrediction(loanId, predictionId);
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}

export async function actionDismissPrediction(loanId: string, predictionId: string, reason: string): Promise<Result<{ predictionId: string }>> {
  try {
    const r = await api.dismissPrediction(loanId, predictionId, reason);
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}

export async function actionReopenAndAcceptPrediction(loanId: string, predictionId: string): Promise<Result<{ conditionId: string; predictionId: string }>> {
  try {
    const r = await api.reopenAndAcceptPrediction(loanId, predictionId);
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}

export async function actionClearPredictionAlert(loanId: string, alertId: string): Promise<Result<{ alertId: string }>> {
  try {
    const r = await api.clearPredictionAlert(loanId, alertId);
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}
