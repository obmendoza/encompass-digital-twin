import { TenantSettings } from "@/components/encompass/TenantSettings";

export default async function TenantSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  const tenant = { name: tenantSlug, status: "active", settings: {} };
  return (
    <div className="p-4 max-w-4xl mx-auto">
      <h1 className="text-lg font-bold text-[#1a2b4a] mb-4">Tenant Settings — {tenantSlug}</h1>
      <TenantSettings tenantSlug={tenantSlug} tenant={tenant} />
    </div>
  );
}
