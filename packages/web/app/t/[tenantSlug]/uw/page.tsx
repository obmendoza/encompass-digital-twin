import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { api } from "@/lib/api-client";
import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { UWDashboard } from "@/components/encompass/UWDashboard";
import ChatPanelWrapper from "@/components/chatbot/ChatPanelWrapper";

export const dynamic = "force-dynamic";

export default async function TenantUWPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  let user = null;
  try { user = await getUser(); } catch (e) { console.error("[tenant-uw] getUser error:", e); }
  const effectiveUser = user ?? { id: "dev", email: "dev", role: "uw" as const, displayName: "Dev", tenantId: "", isSuperAdmin: true };
  console.log(`[tenant-uw] effectiveUser role=${effectiveUser.role}`);

  // Resolve tenant slug to ID for API calls
  const tenantId = await api.getTenantIdBySlug(tenantSlug);
  console.log(`[tenant-uw] slug=${tenantSlug} → tenantId=${tenantId}`);
  const tenantOverride = tenantId ? { headers: { "x-tenant-id": tenantId } } : undefined;
  const loans = await api.listLoans(tenantOverride);
  console.log(`[tenant-uw] loans=${loans.length}`);
  const allLoansData = await Promise.all(
    loans.map(async (l) => {
      try { return await api.getLoan(l.id, tenantOverride); } catch { return null; }
    })
  );
  const fullLoans = allLoansData.filter(Boolean);

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId={`UW Review Queue — ${tenantSlug}`} user={effectiveUser} />
      <MenuBar showPlatform />
      <Toolbar userRole={effectiveUser.role} />
      <div className="bg-white p-3">
        <UWDashboard loans={fullLoans} currentUser={effectiveUser} />
      </div>
      <ChatPanelWrapper />
    </div>
  );
}
