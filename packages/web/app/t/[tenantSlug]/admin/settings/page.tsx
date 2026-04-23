import { TenantSettings } from "@/components/encompass/TenantSettings";

export const dynamic = "force-dynamic";

export default async function TenantSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;

  const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
  let tenant: { id?: string; name: string; status: string; settings: Record<string, unknown> } = { name: tenantSlug, status: "unknown", settings: {} };
  try {
    const res = await fetch(`${apiUrl}/tenants/${tenantSlug}`, {
      headers: { "x-super-admin": "true", "x-user-id": "admin" },
      cache: "no-store",
    });
    if (res.ok) tenant = await res.json();
  } catch (e) {
    console.error("Failed to fetch tenant:", e);
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-lg font-bold text-[#1a2b4a] mb-4">Tenant Settings — {tenant.name}</h1>
      <TenantSettings tenantSlug={tenantSlug} tenant={tenant} />
    </div>
  );
}
