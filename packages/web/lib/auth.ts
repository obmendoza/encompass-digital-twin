import { createServerSupabase } from "./supabase-server";

export type UserRole = "demo" | "va" | "uw" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  displayName: string | null;
}

export async function getUser(): Promise<AuthUser | null> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  // Get role from user_roles table
  const { data: roleData } = await supabase
    .from("user_roles")
    .select("role, display_name")
    .eq("id", user.id)
    .single();

  if (!roleData) {
    // Auto-create role for new user
    await supabase.from("user_roles").insert({
      id: user.id,
      email: user.email ?? "",
      role: "demo",
      display_name: user.email?.split("@")[0] ?? null,
    });
    return {
      id: user.id,
      email: user.email ?? "",
      role: "demo",
      displayName: user.email?.split("@")[0] ?? null,
    };
  }

  return {
    id: user.id,
    email: user.email ?? "",
    role: (roleData?.role as UserRole) ?? "demo",
    displayName: roleData?.display_name ?? user.email?.split("@")[0] ?? null,
  };
}

export function canAccess(role: UserRole, required: UserRole[]): boolean {
  return required.includes(role);
}
