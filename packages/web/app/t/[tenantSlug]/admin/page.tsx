import { redirect } from "next/navigation";

export default async function TenantAdminPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  // Redirect to the tenant's settings page
  redirect(`/t/${tenantSlug}/admin/settings`);
}
