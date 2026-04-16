import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { WorkshopChat } from "@/components/encompass/WorkshopChat";

export default function WorkshopPage() {
  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId="Scenario Workshop" />
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
