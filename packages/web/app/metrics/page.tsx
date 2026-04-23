import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { api } from "@/lib/api-client";
import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { MetricsDashboard } from "@/components/encompass/MetricsDashboard";

export const dynamic = "force-dynamic";

export default async function MetricsPage() {
  const user = await getUser();
  if (!user || !["va", "uw", "admin"].includes(user.role)) redirect("/");

  const metrics = await api.getMetrics();

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId="Performance Metrics" user={user} />
      <MenuBar />
      <Toolbar userRole={user.role} />
      <div className="bg-white p-3">
        <MetricsDashboard metrics={metrics} />
      </div>
    </div>
  );
}
