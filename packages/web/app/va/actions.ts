"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api-client";
import { getUser } from "@/lib/auth";
import type { Actor } from "@twin/core";

async function getActor(): Promise<Actor> {
  const user = await getUser();
  return { kind: "human", id: user?.displayName ?? user?.email ?? "anonymous" };
}

export async function actionAssignLoan(loanId: string, assignedTo: string, priority: string = "normal") {
  const actor = await getActor();
  try {
    await api.assignLoan(loanId, assignedTo, priority, actor);
    revalidatePath("/");
    revalidatePath("/va");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function actionUpdateAssignmentStatus(loanId: string, status: string) {
  const actor = await getActor();
  try {
    await api.updateAssignmentStatus(loanId, status, actor);
    revalidatePath("/va");
    revalidatePath(`/loan/${loanId}`, "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function actionUnassignLoan(loanId: string) {
  const actor = await getActor();
  try {
    await api.unassignLoan(loanId, actor);
    revalidatePath("/");
    revalidatePath("/va");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function actionGetVAPools(): Promise<
  | { ok: true; pools: Array<{ id: string; name: string; kind: "internal" | "bpo" }> }
  | { ok: false; error: string }
> {
  try {
    const result = await api.vaPools();
    return { ok: true, pools: result.pools };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
