import { redirect } from "next/navigation";

export default async function TenantTransmittalPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; loanId: string }>;
}) {
  const { loanId } = await params;
  redirect(`/loan/${loanId}/transmittal`);
}
