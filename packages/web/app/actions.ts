"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api-client";

export async function actionSwitchScenario(scenarioId: string) {
  await api.loadScenario(scenarioId);
  revalidatePath("/", "layout");
}

export async function actionResetAndReloadAll() {
  try {
    await api.reset();
    const scenarios = await api.listScenarios();
    // Load in batches of 5 for speed, but ensure all complete
    for (let i = 0; i < scenarios.length; i += 5) {
      const batch = scenarios.slice(i, i + 5);
      await Promise.all(batch.map((s) => api.loadScenario(s.id).catch(() => null)));
    }
  } catch {
    // Even if some fail, revalidate to show current state
  }
  revalidatePath("/", "layout");
}
