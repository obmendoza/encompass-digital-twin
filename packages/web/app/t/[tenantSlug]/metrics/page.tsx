import { MetricsCards } from "@/components/encompass/MetricsCards";
import { OverrideBreakdown } from "@/components/encompass/OverrideBreakdown";
import { SuggestionCards } from "@/components/encompass/SuggestionCard";

export default async function TenantMetricsPage({ params }: { params: Promise<{ tenantSlug: string }> }) {
  const { tenantSlug } = await params;
  return (
    <div className="p-4 max-w-6xl mx-auto">
      <h1 className="text-lg font-bold text-[#1a2b4a] mb-4">Learning &amp; Metrics — {tenantSlug}</h1>
      <MetricsCards alignmentRate={87.3} overrideRate={12.7} avgDecisionTime={2520} slaCompliance={96.2} />
      <div className="mt-4">
        <h2 className="text-[12px] font-semibold text-[#1a2b4a] mb-2">Override Analysis</h2>
        <OverrideBreakdown byReason={{}} byProgram={{}} />
      </div>
      <div className="mt-4">
        <h2 className="text-[12px] font-semibold text-[#1a2b4a] mb-2">Active Suggestions</h2>
        <SuggestionCards patterns={[]} />
      </div>
    </div>
  );
}
