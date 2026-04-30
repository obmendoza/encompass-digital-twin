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

export default async function LoanLayout({
  children, params,
}: { children: ReactNode; params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;

  let loan: Loan;
  try {
    loan = await api.getLoan(loanId);
  } catch {
    try {
      await api.loadByLoan(loanId);
      loan = await api.getLoan(loanId);
    } catch {
      redirect("/");
    }
  }

  const user = await getUser();

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId={loan.id} user={user} />
      <MenuBar />
      <Toolbar userRole={user?.role} />
      <LoanHeader loan={loan} />
      <div className="grid grid-cols-[172px_1fr] min-h-[540px]">
        <NavTree loanId={loanId} />
        <div className="bg-white p-1">{children}</div>
      </div>
      {user?.tenantId && (
        <LoanChatPanel
          tenantId={user.tenantId}
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
