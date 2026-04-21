import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { api } from "@/lib/api-client";
import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { VADashboard } from "@/components/encompass/VADashboard";

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

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId="VA Dashboard" user={user} />
      <MenuBar />
      <Toolbar userRole={user.role} />
      <div className="bg-white p-3">
        <VADashboard loans={fullLoans} currentUser={user} />
      </div>
    </div>
  );
}
