import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { HITLInbox } from "@/components/encompass/HITLInbox";
import { fetchTickets } from "./actions";

export const dynamic = "force-dynamic";

export default async function HITLPage() {
  const tickets = await fetchTickets();
  const pending = tickets.filter((t) => t.status === "pending").length;
  const resolved = tickets.filter((t) => t.status !== "pending").length;

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId="HITL Inbox" />
      <MenuBar />
      <Toolbar />
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
