import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TenantListPage } from "@/components/encompass/TenantListPage";

export const dynamic = "force-dynamic";

export default async function PlatformTenantsPage() {
  const user = await getUser();
  if (!user || !user.isSuperAdmin) {
    // For now, allow admin role too since isSuperAdmin may not be set
    if (!user || !["admin"].includes(user.role)) redirect("/");
  }

  const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
  let tenants = [];
  try {
    const res = await fetch(`${apiUrl}/tenants`, {
      headers: { "x-super-admin": "true", "x-user-id": user?.email ?? "admin" },
      cache: "no-store",
    });
    if (res.ok) tenants = await res.json();
  } catch (e) {
    console.error("Failed to fetch tenants:", e);
  }

  return <TenantListPage tenants={tenants} />;
}
