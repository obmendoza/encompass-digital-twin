"use server";
import { revalidatePath } from "next/cache";
import { bpoApi } from "@/lib/bpo-client";

export async function actionBpoClaim(loanId: string) {
  try {
    const result = await bpoApi.claim(loanId);
    revalidatePath(`/bpo/loans/${loanId}/review`);
    return { ok: true as const, ...result };
  } catch (e: unknown) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function actionBpoSubmitReview(loanId: string, payload: unknown) {
  try {
    const result = await bpoApi.submitReview(loanId, payload);
    revalidatePath(`/bpo/loans/${loanId}/review`);
    return { ok: true as const, ...result };
  } catch (e: unknown) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}
