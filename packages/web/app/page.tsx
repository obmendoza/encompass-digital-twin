import { api } from "@/lib/api-client";
import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { PipelineTable } from "@/components/encompass/PipelineTable";

export default async function PipelinePage() {
  const loans = await api.listLoans();
  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId="Pipeline" />
      <MenuBar />
      <Toolbar />
      <div className="bg-white p-3">
        <div className="enc-sec">
          <h4>Pipeline — {loans.length} Loans</h4>
          <div className="p-2">
            <PipelineTable loans={loans} />
          </div>
        </div>
      </div>
    </div>
  );
}
