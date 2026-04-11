import type { Loan } from "@twin/core";

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
      <Cell label="Loan Amt" value={`$${loan.transaction.loanAmount.toLocaleString()}`} />
      <Cell label="Rate" value={`${loan.transaction.noteRate.toFixed(4)}%`} />
      <Cell label="LTV/CLTV" value={`${loan.transaction.ltv.toFixed(2)} / ${loan.transaction.cltv.toFixed(2)}`} />
      <Cell label="DTI" value={`${loan.qualifying.housingRatio.toFixed(1)} / ${loan.qualifying.totalDti.toFixed(1)}`} />
      <Cell label="Decision" value={loan.decision} />
    </div>
  );
}
