import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { WorkshopChat } from "@/components/encompass/WorkshopChat";
import { getUser } from "@/lib/auth";

export default async function WorkshopPage() {
  const user = await getUser();
  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId="Scenario Workshop" user={user} />
      <MenuBar />
      <Toolbar />
      <div className="bg-white p-3">
        <div className="enc-sec">
          <h4>Scenario Workshop — Chat-Driven Loan Generation</h4>
          <div className="p-3">
            <WorkshopChat />
          </div>
        </div>
      </div>
    </div>
  );
}
