import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { HITLInbox } from "@/components/encompass/HITLInbox";
import { fetchTickets } from "./actions";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HITLPage() {
  const [tickets, user] = await Promise.all([fetchTickets(), getUser()]);
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
            <HITLInbox tickets={tickets} />
          </div>
        </div>
      </div>
    </div>
  );
}
