import type { Loan } from "@twin/core";
import { money, pct } from "@/lib/format";

function Cell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-r border-[#b0aa99] px-2">
      <label className="block text-[9px] text-[#404040]">{label}</label>
      <b>{value}</b>
    </div>
  );
}

export function LoanHeader({ loan }: { loan: Loan }) {
  return (
    <div className="bg-[#d4d0c8] border-b border-[#6b7a8f] py-1 grid grid-cols-8 text-[10px]">
      <Cell label="Borrower" value={loan.borrower.fullName} />
      <Cell label="Loan #" value={loan.id} />
      <Cell label="Program" value={loan.nqmProgram} />
      <Cell label="Loan Amt" value={money(loan.transaction.loanAmount)} />
      <Cell label="Rate" value={pct(loan.transaction.noteRate, 4)} />
      <Cell label="LTV/CLTV" value={`${pct(loan.transaction.ltv)} / ${pct(loan.transaction.cltv)}`} />
      <Cell label="DTI" value={`${pct(loan.qualifying.housingRatio, 1)} / ${pct(loan.qualifying.totalDti, 1)}`} />
      <Cell label="Decision" value={loan.decision} />
    </div>
  );
}
