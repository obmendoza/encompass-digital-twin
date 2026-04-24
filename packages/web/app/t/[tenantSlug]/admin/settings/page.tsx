import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { TenantSettings } from "@/components/encompass/TenantSettings";

export const dynamic = "force-dynamic";

export default async function TenantSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const user = await getUser();
  if (!user || !["admin", "uw"].includes(user.role)) redirect("/");

  const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
  let tenant: { id?: string; name: string; status: string; settings: Record<string, unknown> } = {
    name: tenantSlug, status: "unknown", settings: {},
  };
  try {
    const res = await fetch(`${apiUrl}/tenants/${tenantSlug}`, {
      headers: { "x-super-admin": "true", "x-user-id": user?.email ?? "admin" },
      cache: "no-store",
    });
    if (res.ok) tenant = await res.json();
  } catch (e) {
    console.error("Failed to fetch tenant:", e);
  }

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId={`Tenant: ${tenant.name}`} user={user} />
      <MenuBar showPlatform />
      <Toolbar userRole={user.role} />
      <div className="bg-white p-3">
        <TenantSettings tenantSlug={tenantSlug} tenant={tenant} />
      </div>
    </div>
  );
}
