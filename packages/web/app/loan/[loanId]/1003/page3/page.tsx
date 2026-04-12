import { api } from "@/lib/api-client";
import { Section } from "@/components/encompass/Section";
import { Field } from "@/components/encompass/Field";

export default async function Page3({
  params,
}: { params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;
  let loan;
  try {
    loan = await api.getLoan(loanId);
  } catch {
    await api.loadByLoan(loanId);
    loan = await api.getLoan(loanId);
  }
  const t = loan.transaction;
  const q = loan.qualifying;
  const w = loan.qualifyingWorksheet;
  const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <>
      <div className="flex gap-[2px] border-b-2 border-[#1f4478] mb-1">
        <div className="px-3 py-[2px] bg-[#d4d0c8] border border-b-0 border-[#6b7a8f] text-[10px]">Page 1</div>
        <div className="px-3 py-[2px] bg-[#d4d0c8] border border-b-0 border-[#6b7a8f] text-[10px]">Page 2</div>
        <div className="px-3 py-[2px] bg-white font-bold border border-b-0 border-[#6b7a8f] text-[10px]">Page 3</div>
      </div>

      <Section title="VII. Transaction Details">
        <Field label="Purpose" value={t.loanPurpose} />
        <Field label="Loan Amount" value={money(t.loanAmount)} />
        <Field label="Sales Price" value={t.salesPrice ? money(t.salesPrice) : "—"} />
        <Field label="Appraised Value" value={money(t.appraisedValue)} />
        <Field label="LTV" value={`${t.ltv.toFixed(2)}%`} />
        <Field label="CLTV" value={`${t.cltv.toFixed(2)}%`} />
        <Field label="HCLTV" value={`${t.hcltv.toFixed(2)}%`} />
        <Field label="Down Payment" value={t.salesPrice ? money(t.salesPrice - t.loanAmount) : "—"} />
        <Field label="Note Rate" value={`${t.noteRate.toFixed(4)}%`} />
        <Field label="Term (months)" value={t.term} />
        <Field label="Amort Type" value={t.amortType} />
        <Field label="Lien Position" value={t.lienPosition === 1 ? "1st" : "2nd"} />
        <Field label="Product" value={loan.nqmProgram} />
        <Field label="Channel" value="Retail" />
        <Field label="Investor" value="Non-QM" />
        <Field label="Occupancy" value={t.occupancy} />
      </Section>

      <Section title="VIII. NQM Qualifying Details">
        <Field label="Program" value={loan.nqmProgram} />
        <Field label="Method" value={w.method} />
        <Field label="Derived Income" value={money(w.derivedMonthlyIncome)} />
        <Field label="Expense Factor" value={w.expenseFactor !== undefined ? `${(w.expenseFactor * 100).toFixed(0)}%` : "—"} />
        <Field label="NSF Count" value={w.nsfCount !== undefined ? w.nsfCount : "—"} />
        <Field label="DSCR Ratio" value={t.dscrRatio !== undefined ? t.dscrRatio.toFixed(2) : "—"} />
        <Field label="Months Covered" value={w.monthsCovered ?? "—"} />
        <Field label="Avg Deposits" value={w.avgDeposits ? money(w.avgDeposits) : "—"} />
        <Field label="Total Assets" value={w.totalAssets ? money(w.totalAssets) : "—"} />
        <Field label="Depletion (mo)" value={w.depletionMonths ?? "—"} />
        <Field label="Gross 1099" value={w.gross1099 ? money(w.gross1099) : "—"} />
        <Field label="CPA Net Inc." value={w.cpaCertifiedNetIncome ? money(w.cpaCertifiedNetIncome) : "—"} />
        <Field label="Housing Ratio" value={`${q.housingRatio.toFixed(2)}%`} />
        <Field label="Total DTI" value={`${q.totalDti.toFixed(2)}%`} />
        <Field label="PI Payment" value={money(q.piPayment)} />
        <Field label="Qual Rate" value={`${q.qualifyingRate.toFixed(4)}%`} />
      </Section>

      <Section title="IX. Declarations">
        <Field label="Occupancy Intent" value={t.occupancy} />
        <Field label="Outstanding Judgments" value="—" />
        <Field label="Bankruptcy" value="—" />
        <Field label="Foreclosure" value="—" />
        <Field label="Lawsuit Pending" value="—" />
        <Field label="Obligations" value="—" />
        <Field label="Delinquent Fed Debt" value="—" />
        <Field label="US Citizen" value="—" />
      </Section>
    </>
  );
}
