"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api-client";

const AGENT_URL = process.env.AGENT_SERVICE_URL ?? "http://localhost:8000";

export interface WorkshopResult {
  ok: boolean;
  loan?: Record<string, unknown>;
  error?: string;
}

export async function actionGenerateScenario(prompt: string, baseLoan?: Record<string, unknown>): Promise<WorkshopResult> {
  try {
    const res = await fetch(`${AGENT_URL}/api/workshop/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, baseLoan }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Generation failed (${res.status}): ${text.slice(0, 200)}` };
    }
    const data = await res.json();
    return { ok: true, loan: data.loan };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function actionRefineScenario(loan: Record<string, unknown>, instruction: string): Promise<WorkshopResult> {
  try {
    const res = await fetch(`${AGENT_URL}/api/workshop/refine`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loan, instruction }),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Refinement failed (${res.status}): ${text.slice(0, 200)}` };
    }
    const data = await res.json();
    return { ok: true, loan: data.loan };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function actionInjectLoan(loan: Record<string, unknown>): Promise<{ ok: boolean; loanId?: string; error?: string }> {
  try {
    const result = await api.injectLoan(loan);
    revalidatePath("/", "layout");
    return { ok: true, loanId: result.loanId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
