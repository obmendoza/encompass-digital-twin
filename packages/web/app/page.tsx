import { api } from "@/lib/api-client";
import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { PipelineTable } from "@/components/encompass/PipelineTable";
import { SandboxControls } from "@/components/encompass/ScenarioSelector";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  const [loans, user] = await Promise.all([api.listLoans(), getUser()]);
  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId="Pipeline" user={user} />
      <MenuBar />
      <Toolbar />
      <div className="bg-white p-3">
        <SandboxControls loans={loans} />
        <div className="enc-sec mt-2">
          <h4>Pipeline — {loans.length} Loans</h4>
          <div className="p-2">
            <PipelineTable loans={loans} />
          </div>
        </div>
      </div>
    </div>
  );
}
