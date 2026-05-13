"use server";

import { api } from "@/lib/api-client";
import { getUser } from "@/lib/auth";
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
  // Server-derived role. The api-client sends x-user-role to the API so the
  // audit row records the right acted_role; reading the real Supabase session
  // here keeps client input out of the role-determination path. Codex
  // round-1 P2 follow-up (VA actions were being audited as operator because
  // accept/dismiss did not forward the role).
  const user = await getUser();
  const role: "operator" | "va" = user?.role === "va" ? "va" : "operator";
  try {
    const r = await api.acceptPrediction(loanId, predictionId, role);
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}

export async function actionDismissPrediction(loanId: string, predictionId: string, reason: string): Promise<Result<{ predictionId: string }>> {
  // Same role-derivation as actionAcceptPrediction. Particularly important
  // because the VA panel's "operator dismissed" bucket is filtered on
  // acted_role === "operator" — without this, VA-dismissed predictions
  // would land in that bucket and the VA could "Reopen + Accept" their own
  // prior dismissal as if it were an operator override.
  const user = await getUser();
  const role: "operator" | "va" = user?.role === "va" ? "va" : "operator";
  try {
    const r = await api.dismissPrediction(loanId, predictionId, reason, role);
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}

export async function actionReopenAndAcceptPrediction(loanId: string, predictionId: string): Promise<Result<{ conditionId: string; predictionId: string }>> {
  // Server-side role gate. The api-client method below sets x-user-role: va
  // on the request, which the API trusts on its internal-service-call bypass
  // path (web server → API uses x-user-id). Without this gate, any logged-in
  // operator could invoke this server action (server actions are POST
  // endpoints reachable from any client component) and the API would honor
  // the hard-coded header. Read the real session role here and reject early.
  // Codex P1 follow-up.
  const user = await getUser();
  if (!user || user.role !== "va") {
    return { ok: false, error: "VA-only action — only users with the va role can reopen-and-accept dismissed predictions" };
  }
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
