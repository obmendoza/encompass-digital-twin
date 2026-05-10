import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { api } from "@/lib/api-client";
import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { VADashboard } from "@/components/encompass/VADashboard";
import ChatPanelWrapper from "@/components/chatbot/ChatPanelWrapper";

export const dynamic = "force-dynamic";

export default async function VAPage() {
  const user = await getUser();
  if (!user || !["va", "uw", "admin"].includes(user.role)) redirect("/");

  const loans = await api.listLoans();
  const allLoansData = await Promise.all(
    loans.map(async (l) => {
      try {
        return await api.getLoan(l.id);
      } catch {
        return null;
      }
    })
  );
  const fullLoans = allLoansData.filter(Boolean);

  // VA review state lives in the va_loan_state side-table, not on Loan.
  // Fetch the current va_review_pending queue so the dashboard can populate
  // the Pool Queue tab. Empty list is fine (e.g., va.required=false).
  let queueItems: Array<{ loan_id: string; assigned_pool_id: string }> = [];
  try {
    const q = await api.vaQueue();
    queueItems = q.items.map((i) => ({ loan_id: i.loan_id, assigned_pool_id: i.assigned_pool_id }));
  } catch {
    // VA layer not configured for this tenant — leave queueItems empty.
  }

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId="VA Dashboard" user={user} />
      <MenuBar />
      <Toolbar userRole={user.role} />
      <div className="bg-white p-3">
        <VADashboard loans={fullLoans} currentUser={user} queueItems={queueItems} />
      </div>
      <ChatPanelWrapper />
    </div>
  );
}
