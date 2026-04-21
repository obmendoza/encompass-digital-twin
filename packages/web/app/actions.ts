"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api-client";

export async function actionSwitchScenario(scenarioId: string) {
  await api.loadScenario(scenarioId);
  revalidatePath("/", "layout");
}

export async function actionResetAndReloadAll(): Promise<{ ok: boolean; error?: string }> {
  try {
    await api.reset();
    // Clear stale HITL tickets on the agent service
    const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:8000";
    const tickets = await fetch(`${agentUrl}/api/hitl/tickets`, { cache: "no-store" }).then(r => r.json()).catch(() => []);
    for (const t of tickets) {
      if (t.status === "pending") {
        await fetch(`${agentUrl}/api/hitl/tickets/${t.ticket_id}/resolve`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ decision: "reject", approver: "system-reset", note: "Cleared by sandbox reset" }),
        }).catch(() => null);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[actionResetAndReloadAll] reset failed:", msg);
    revalidatePath("/");
    return { ok: false, error: `Reset failed: ${msg}` };
  }
  try {
    const scenarios = await api.listScenarios();
    for (let i = 0; i < scenarios.length; i += 5) {
      const batch = scenarios.slice(i, i + 5);
      await Promise.all(batch.map((s) => api.loadScenario(s.id).catch(() => null)));
    }
  } catch (e) {
    console.error("[actionResetAndReloadAll] reload failed:", e);
  }
  revalidatePath("/");
  revalidatePath("/loan", "layout");
  return { ok: true };
}
