"use server";

import { api } from "@/lib/api-client";
import { getUser } from "@/lib/auth";
import { revalidatePath } from "next/cache";

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

function err(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

/**
 * Resolve the real Supabase session's user id + role for every prediction
 * mutation. Returns null when the caller isn't authenticated; callers reject
 * the action in that case so we never silently fall back to a default actor.
 * Codex round-5 follow-up — previously the api-client sent x-user-id:
 * "web-server" by default which polluted audit rows.
 */
async function resolveActor(): Promise<{ actorId: string; role: "operator" | "va" } | null> {
  const user = await getUser();
  if (!user?.id) return null;
  return { actorId: user.id, role: user.role === "va" ? "va" : "operator" };
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
  const actor = await resolveActor();
  if (!actor) return { ok: false, error: "not authenticated" };
  try {
    const r = await api.runPredictions(loanId, actor.actorId);
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}

export async function actionAcceptPrediction(loanId: string, predictionId: string): Promise<Result<{ conditionId: string; predictionId: string }>> {
  // Server-derived role + actor id. The api-client sends both x-user-role
  // (drives acted_role in the audit row) and x-user-id (drives acted_by on
  // predicted_conditions + actor_id in the audit row). Reading the real
  // Supabase session here keeps client input out of either path. Codex
  // round-1 + round-5 P2 follow-ups.
  const actor = await resolveActor();
  if (!actor) return { ok: false, error: "not authenticated" };
  try {
    const r = await api.acceptPrediction(loanId, predictionId, actor.role, actor.actorId);
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}

export async function actionDismissPrediction(loanId: string, predictionId: string, reason: string): Promise<Result<{ predictionId: string }>> {
  // Same role + actor-id resolution as actionAcceptPrediction. Role matters
  // particularly here because the VA panel's "operator dismissed" bucket is
  // filtered on acted_role === "operator" — without this, VA-dismissed
  // predictions would land in that bucket.
  const actor = await resolveActor();
  if (!actor) return { ok: false, error: "not authenticated" };
  try {
    const r = await api.dismissPrediction(loanId, predictionId, reason, actor.role, actor.actorId);
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
  const actor = await resolveActor();
  if (!actor) return { ok: false, error: "not authenticated" };
  if (actor.role !== "va") {
    return { ok: false, error: "VA-only action — only users with the va role can reopen-and-accept dismissed predictions" };
  }
  try {
    const r = await api.reopenAndAcceptPrediction(loanId, predictionId, actor.actorId);
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}

export async function actionClearPredictionAlert(loanId: string, alertId: string): Promise<Result<{ alertId: string }>> {
  const actor = await resolveActor();
  if (!actor) return { ok: false, error: "not authenticated" };
  try {
    const r = await api.clearPredictionAlert(loanId, alertId, actor.actorId);
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true, ...r };
  } catch (e) {
    return err(e);
  }
}
