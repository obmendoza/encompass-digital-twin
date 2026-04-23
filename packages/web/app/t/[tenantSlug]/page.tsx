export default async function TenantPipelinePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  return (
    <div className="p-4">
      <h1 className="text-lg font-bold">Tenant: {tenantSlug}</h1>
      <p className="text-sm text-gray-500">Tenant-scoped pipeline view — coming in UI migration</p>
    </div>
  );
}
