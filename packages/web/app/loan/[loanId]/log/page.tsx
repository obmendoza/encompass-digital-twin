import { api } from "@/lib/api-client";
import { ConversationLog } from "@/components/encompass/ConversationLog";

export default async function LogPage({
  params,
}: { params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;
  try { await api.getLoan(loanId); } catch { await api.loadByLoan(loanId); }
  const audit = await api.getAudit(loanId);
  return (
    <div className="enc-sec">
      <h4>Conversation Log — {audit.length} Events</h4>
      <div className="p-2">
        <ConversationLog entries={audit} />
      </div>
    </div>
  );
}
