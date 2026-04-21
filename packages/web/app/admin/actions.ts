"use server";

import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase-server";
import { getUser } from "@/lib/auth";

export async function actionUpdateRole(userId: string, newRole: string): Promise<{ ok: boolean; error?: string }> {
  const currentUser = await getUser();
  if (!currentUser || currentUser.role !== "admin") {
    return { ok: false, error: "Unauthorized" };
  }

  if (!["demo", "va", "uw", "admin"].includes(newRole)) {
    return { ok: false, error: "Invalid role" };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("user_roles")
    .update({ role: newRole })
    .eq("id", userId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export async function actionUpdateDisplayName(userId: string, displayName: string): Promise<{ ok: boolean; error?: string }> {
  const currentUser = await getUser();
  if (!currentUser || currentUser.role !== "admin") {
    return { ok: false, error: "Unauthorized" };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("user_roles")
    .update({ display_name: displayName })
    .eq("id", userId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}
