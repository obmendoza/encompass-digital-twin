import { TenantList } from "@/components/encompass/TenantList";

export default function PlatformTenantsPage() {
  // Placeholder — will fetch from API
  const tenants = [
    { id: "00000000-0000-0000-0000-000000000000", name: "Default Tenant", slug: "default", status: "active", created_at: "2026-04-23T00:00:00Z" },
  ];

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-bold text-[#1a2b4a]">Platform Admin — Tenants</h1>
      </div>
      <TenantList tenants={tenants} />
    </div>
  );
}
