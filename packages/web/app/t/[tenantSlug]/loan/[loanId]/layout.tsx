import { api } from "@/lib/api-client";
import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { LoanHeader } from "@/components/encompass/LoanHeader";
import { NavTree } from "@/components/encompass/NavTree";
import LoanChatPanel from "@/components/chatbot/LoanChatPanel";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { Loan } from "@twin/core";
import { getUser } from "@/lib/auth";

export default async function TenantLoanLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenantSlug: string; loanId: string }>;
}) {
  const { tenantSlug, loanId } = await params;

  // Resolve tenant for API calls
  const tenantId = await api.getTenantIdBySlug(tenantSlug);
  const tenantOverride = tenantId ? { headers: { "x-tenant-id": tenantId } } : undefined;

  let loan: Loan;
  try {
    loan = await api.getLoan(loanId, tenantOverride);
  } catch {
    try {
      await api.loadByLoan(loanId);
      loan = await api.getLoan(loanId, tenantOverride);
    } catch {
      redirect(`/t/${tenantSlug}`);
    }
  }

  let user = null;
  try { user = await getUser(); } catch {}
  const effectiveUser = user ?? {
    id: "dev", email: "dev", role: "uw" as const,
    displayName: "Dev", tenantId: tenantId ?? "", isSuperAdmin: true,
  };

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId={loan.id} user={effectiveUser} />
      <MenuBar showPlatform />
      <Toolbar userRole={effectiveUser.role} />
      <LoanHeader loan={loan} />
      <div className="grid grid-cols-[172px_1fr] min-h-[540px]">
        <NavTree loanId={loanId} />
        <div className="bg-white p-1">{children}</div>
      </div>
      {tenantId && (
        <LoanChatPanel
          tenantId={tenantId}
          loanId={loanId}
          program={loan.nqmProgram}
          fico={loan.credit?.repScore}
          ltv={loan.transaction?.ltv}
          occupancy={loan.occupancy}
        />
      )}
    </div>
  );
}
