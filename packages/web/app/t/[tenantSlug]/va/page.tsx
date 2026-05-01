import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { api } from "@/lib/api-client";
import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { VADashboard } from "@/components/encompass/VADashboard";
import ChatPanelWrapper from "@/components/chatbot/ChatPanelWrapper";

export const dynamic = "force-dynamic";

export default async function TenantVAPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let user = null;
  try { user = await getUser(); } catch {}
  const effectiveUser = user ?? { id: "dev", email: "dev", role: "va" as const, displayName: "Dev", tenantId: "", isSuperAdmin: true };

  const tenantId = await api.getTenantIdBySlug(tenantSlug);
  const tenantOverride = tenantId ? { headers: { "x-tenant-id": tenantId } } : undefined;
  const loans = await api.listLoans(tenantOverride);
  const allLoansData = await Promise.all(
    loans.map(async (l) => {
      try { return await api.getLoan(l.id, tenantOverride); } catch { return null; }
    })
  );
  const fullLoans = allLoansData.filter(Boolean);

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId={`VA Dashboard — ${tenantSlug}`} user={effectiveUser} />
      <MenuBar showPlatform />
      <Toolbar userRole={effectiveUser.role} />
      <div className="bg-white p-3">
        <VADashboard loans={fullLoans} currentUser={effectiveUser} />
      </div>
      <ChatPanelWrapper />
    </div>
  );
}
