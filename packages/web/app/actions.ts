"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api-client";

export async function actionSwitchScenario(scenarioId: string) {
  await api.loadScenario(scenarioId);
  revalidatePath("/", "layout");
}

export async function actionResetAndReloadAll() {
  await api.reset();
  const scenarios = await api.listScenarios();
  for (const s of scenarios) {
    await api.loadScenario(s.id);
  }
  revalidatePath("/", "layout");
}
