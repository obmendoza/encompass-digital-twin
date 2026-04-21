import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { HITLInbox } from "@/components/encompass/HITLInbox";
import { fetchTickets } from "./actions";
import { getUser } from "@/lib/auth";
import { api } from "@/lib/api-client";

export const dynamic = "force-dynamic";

export default async function HITLPage() {
  const [allTickets, user] = await Promise.all([fetchTickets(), getUser()]);

  // Filter tickets by role:
  // admin/uw: see all tickets
  // va: see only tickets for loans assigned to them
  // demo: see nothing
  let tickets = allTickets;
  if (user?.role === "va") {
    const loans = await api.listLoans();
    const allLoans = await Promise.all(loans.map((l) => api.getLoan(l.id).catch(() => null)));
    const myLoanIds = new Set(
      allLoans
        .filter((l): l is NonNullable<typeof l> => l !== null && l.assignment?.assignedTo === user.email)
        .map((l) => l.id)
    );
    tickets = allTickets.filter((t) => myLoanIds.has(t.loan_id));
  } else if (user?.role === "demo") {
    tickets = [];
  }

  const pending = tickets.filter((t) => t.status === "pending").length;
  const resolved = tickets.filter((t) => t.status !== "pending").length;

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId="HITL Inbox" user={user} />
      <MenuBar />
      <Toolbar userRole={user?.role} />
      <div className="bg-white p-3">
        <div className="enc-sec">
          <h4>Human-in-the-Loop Inbox — {pending} Pending · {resolved} Resolved</h4>
          <div className="p-2">
            <HITLInbox tickets={tickets} defaultFilter="pending" />
          </div>
        </div>
      </div>
    </div>
  );
}
