import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { MetricsCards } from "@/components/encompass/MetricsCards";
import { OverrideBreakdown } from "@/components/encompass/OverrideBreakdown";
import { SuggestionCards } from "@/components/encompass/SuggestionCard";

export const dynamic = "force-dynamic";

export default async function TenantMetricsPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  const user = await getUser();
  if (!user) redirect("/login");

  const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

  // Resolve tenant ID from slug
  let tenantId = "00000000-0000-0000-0000-000000000000";
  try {
    const tenantRes = await fetch(`${apiUrl}/tenants/${tenantSlug}`, {
      headers: { "x-super-admin": "true", "x-user-id": user.email },
      cache: "no-store",
    });
    if (tenantRes.ok) {
      const tenant = await tenantRes.json();
      tenantId = tenant.id;
    }
  } catch { /* use default */ }

  // Fetch alignment metrics
  let alignmentRate = 0;
  let overrideRate = 0;
  let totalDecisions = 0;
  let avgDecisionTime = 0;
  let calibration: Array<{ bucket: string; confidence: number; acceptanceRate: number; count: number }> = [];
  try {
    const res = await fetch(`${apiUrl}/metrics/${tenantId}/alignment?window=30`, {
      headers: { "x-tenant-id": tenantId, "x-user-id": user.email },
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      alignmentRate = data.overallRate ?? 0;
      totalDecisions = data.totalDecisions ?? 0;
      overrideRate = totalDecisions > 0 ? 100 - alignmentRate : 0;
      calibration = data.calibration ?? [];
      // Include today's live data
      if (data.todayLive) {
        const today = data.todayLive;
        const todayTotal = (today.accepted ?? 0) + (today.overridden ?? 0);
        if (todayTotal > 0) {
          totalDecisions += todayTotal;
          const totalAccepted = Math.round(alignmentRate / 100 * (totalDecisions - todayTotal)) + (today.accepted ?? 0);
          alignmentRate = totalDecisions > 0 ? Math.round(totalAccepted / totalDecisions * 10000) / 100 : 0;
          overrideRate = 100 - alignmentRate;
        }
      }
    }
  } catch { /* use defaults */ }

  // Fetch override breakdown
  let byReason: Record<string, number> = {};
  let byProgram: Record<string, { accepted: number; overridden: number; rate: number }> = {};
  try {
    const res = await fetch(`${apiUrl}/metrics/${tenantId}/overrides?window=30`, {
      headers: { "x-tenant-id": tenantId, "x-user-id": user.email },
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      byReason = data.byReason ?? {};
      byProgram = data.byProgram ?? {};
    }
  } catch { /* use defaults */ }

  // Fetch patterns
  let patterns: Array<{
    id: string;
    ruleName: string;
    program?: string;
    overrideReason?: string;
    status: string;
    suggestion: { id: string; type: string; rootCause: string; specificChange: { operation: string; path: string; from?: unknown; to: unknown }; confidence: number; riskAssessment: string; status: string } | null;
  }> = [];
  try {
    const res = await fetch(`${apiUrl}/metrics/${tenantId}/patterns`, {
      headers: { "x-tenant-id": tenantId, "x-user-id": user.email },
      cache: "no-store",
    });
    if (res.ok) {
      patterns = await res.json();
    }
  } catch { /* use defaults */ }

  const slaCompliance = 100; // placeholder until SLA data is wired

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId={`Metrics: ${tenantSlug}`} user={user} />
      <MenuBar showPlatform />
      <Toolbar userRole={user.role} />
      <div className="bg-white p-3">
        <div className="flex justify-between items-center mb-3 border-b border-[#c8c4b5] pb-2">
          <div>
            <h2 className="text-[13px] font-bold text-[#1a2b4a]">Learning & Metrics Dashboard</h2>
            <p className="text-[10px] text-[#6b7a8f]">{totalDecisions} decision{totalDecisions !== 1 ? "s" : ""} recorded (30-day window)</p>
          </div>
        </div>

        <MetricsCards
          alignmentRate={alignmentRate}
          overrideRate={overrideRate}
          avgDecisionTime={avgDecisionTime}
          slaCompliance={slaCompliance}
        />

        <div className="mt-4">
          <h3 className="text-[12px] font-semibold text-[#1a2b4a] mb-2">Override Analysis</h3>
          <OverrideBreakdown byReason={byReason} byProgram={byProgram} />
        </div>

        {calibration.some((c) => c.count > 0) && (
          <div className="mt-4">
            <h3 className="text-[12px] font-semibold text-[#1a2b4a] mb-2">Confidence Calibration</h3>
            <div className="enc-panel p-3">
              <div className="grid grid-cols-5 gap-2">
                {calibration.map((c) => (
                  <div key={c.bucket} className="text-center">
                    <div className="text-[9px] text-[#6b7a8f]">{c.bucket}%</div>
                    <div className="h-16 flex items-end justify-center">
                      <div
                        className="w-8 bg-[#2d5f8a] rounded-t"
                        style={{ height: `${Math.max(c.acceptanceRate * 100, 4)}%` }}
                      />
                    </div>
                    <div className="text-[9px] font-semibold text-[#1a2b4a]">{Math.round(c.acceptanceRate * 100)}%</div>
                    <div className="text-[8px] text-[#8899aa]">n={c.count}</div>
                  </div>
                ))}
              </div>
              <div className="text-[9px] text-[#8899aa] mt-2 text-center">Agent confidence bucket vs UW acceptance rate</div>
            </div>
          </div>
        )}

        <div className="mt-4">
          <h3 className="text-[12px] font-semibold text-[#1a2b4a] mb-2">Active Suggestions</h3>
          <SuggestionCards patterns={patterns} />
        </div>
      </div>
    </div>
  );
}
