import { createServerSupabase } from "./supabase-server";

const DEFAULT_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export type UserRole = "demo" | "va" | "uw" | "compliance_officer" | "admin";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  displayName: string | null;
  tenantId: string;
  isSuperAdmin?: boolean;
}

export async function getUser(): Promise<AuthUser | null> {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  // Extract tenant info from app_metadata (set by Supabase admin API / hooks)
  const appMeta = user.app_metadata ?? {};
  const tenantId = (appMeta.tenant_id as string) ?? DEFAULT_TENANT_ID;
  const isSuperAdmin = appMeta.is_super_admin === true;

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
      tenantId,
      isSuperAdmin,
    };
  }

  return {
    id: user.id,
    email: user.email ?? "",
    role: (roleData?.role as UserRole) ?? "demo",
    displayName: roleData?.display_name ?? user.email?.split("@")[0] ?? null,
    tenantId,
    isSuperAdmin,
  };
}

export function canAccess(role: UserRole, required: UserRole[]): boolean {
  return required.includes(role);
}
