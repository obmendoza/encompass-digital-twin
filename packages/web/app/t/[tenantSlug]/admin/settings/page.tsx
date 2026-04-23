export default async function TenantSettingsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  return (
    <div className="p-4">
      <h1 className="text-lg font-bold text-[#1a2b4a]">Tenant Settings — {tenantSlug}</h1>
      <p className="text-sm text-gray-500">Settings — implemented in Task 12</p>
    </div>
  );
}
