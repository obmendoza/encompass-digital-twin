import { api } from "@/lib/api-client";
import { ConversationLog } from "@/components/encompass/ConversationLog";
import AgentTraceTimeline from "@/components/encompass/AgentTraceTimeline";

export const dynamic_config = "force-dynamic";

export default async function LogPage({
  params,
}: { params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;
  let loan;
  try { loan = await api.getLoan(loanId); } catch { await api.loadByLoan(loanId); loan = await api.getLoan(loanId); }
  const audit = await api.getAudit(loanId);
  const trace = loan.pendingRecommendation?.trace ?? [];

  return (
    <div>
      {trace.length > 0 && (
        <div className="enc-sec mb-3">
          <h4>Agent Analysis Trace — {trace.length} Steps</h4>
          <div className="p-2">
            <AgentTraceTimeline trace={trace} loanId={loanId} />
          </div>
        </div>
      )}
      <div className="enc-sec">
        <h4>Conversation Log — {audit.length} Events</h4>
        <div className="p-2">
          <ConversationLog entries={audit} />
        </div>
      </div>
    </div>
  );
}
