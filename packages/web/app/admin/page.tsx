import { getUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { AdminPanel } from "@/components/encompass/AdminPanel";
import { TestDashboard } from "@/components/encompass/TestDashboard";
import { createServerSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getUser();
  if (!user || user.role !== "admin") redirect("/");

  const supabase = await createServerSupabase();
  const { data: users } = await supabase
    .from("user_roles")
    .select("id, email, role, display_name, created_at")
    .order("created_at", { ascending: true });

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId="Admin" user={user} />
      <MenuBar showPlatform />
      <Toolbar userRole={user.role} />
      <div className="bg-white p-3">
        <div className="mb-3">
          <Link href="/platform/tenants" className="inline-block enc-btn enc-btn--primary text-[11px]">
            Manage Tenants
          </Link>
        </div>
        <div className="enc-sec">
          <h4>User Management — {users?.length ?? 0} Users</h4>
          <div className="p-2">
            <AdminPanel users={users ?? []} />
          </div>
        </div>
        <div className="mt-3">
          <TestDashboard />
        </div>
      </div>
    </div>
  );
}
