"use server";

import { api } from "@/lib/api-client";
import { revalidatePath } from "next/cache";

export async function actionClaimVA(loanId: string) {
  try {
    const result = await api.vaClaim(loanId);
    revalidatePath(`/loan/${loanId}`);
    return { ok: true as const, ...result };
  } catch (e: unknown) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function actionReleaseVA(loanId: string) {
  try {
    const result = await api.vaRelease(loanId);
    revalidatePath(`/loan/${loanId}`);
    return { ok: true as const, ...result };
  } catch (e: unknown) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function actionSubmitVAReview(loanId: string, payload: unknown) {
  try {
    const result = await api.vaSubmitReview(loanId, payload);
    revalidatePath(`/loan/${loanId}`);
    return { ok: true as const, ...result };
  } catch (e: unknown) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
