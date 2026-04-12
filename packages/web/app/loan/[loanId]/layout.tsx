import { api } from "@/lib/api-client";
import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { LoanHeader } from "@/components/encompass/LoanHeader";
import { NavTree } from "@/components/encompass/NavTree";
import type { ReactNode } from "react";

export default async function LoanLayout({
  children, params,
}: { children: ReactNode; params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;

  try {
    await api.getLoan(loanId);
  } catch {
    await api.loadByLoan(loanId);
  }

  const loan = await api.getLoan(loanId);

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId={loan.id} />
      <MenuBar />
      <Toolbar />
      <LoanHeader loan={loan} />
      <div className="grid grid-cols-[172px_1fr] min-h-[540px]">
        <NavTree loanId={loanId} />
        <div className="bg-white p-1">{children}</div>
      </div>
    </div>
  );
}
