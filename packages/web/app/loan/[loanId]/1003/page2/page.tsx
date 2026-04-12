import { api } from "@/lib/api-client";
import { Section } from "@/components/encompass/Section";
import { Field } from "@/components/encompass/Field";

export default async function Page2({
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
  const a = loan.assets;
  const c = loan.credit;
  const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <>
      <div className="flex gap-[2px] border-b-2 border-[#1f4478] mb-1">
        <div className="px-3 py-[2px] bg-[#d4d0c8] border border-b-0 border-[#6b7a8f] text-[10px]">Page 1</div>
        <div className="px-3 py-[2px] bg-white font-bold border border-b-0 border-[#6b7a8f] text-[10px]">Page 2</div>
        <div className="px-3 py-[2px] bg-[#d4d0c8] border border-b-0 border-[#6b7a8f] text-[10px]">Page 3</div>
      </div>

      <Section title="IV. Assets">
        <Field label="Total Liquid" value={money(a.totalLiquid)} />
        <Field label="Total Retirement" value={money(a.totalRetirement)} />
        <Field label="Reserves (months)" value={a.reservesMonths.toFixed(1)} />
        <Field label="Total Assets" value={money(a.totalLiquid + a.totalRetirement)} />
        <Field label="Gift Funds" value="—" />
        <Field label="Checking" value="—" />
        <Field label="Savings" value="—" />
        <Field label="Other" value="—" />
      </Section>

      <Section title="V. Credit Summary">
        <Field label="Rep Score" value={c.repScore !== null ? String(c.repScore) : "n/a"} />
        <Field label="Tradelines Open" value={c.tradelinesOpen} />
        <Field label="Tradelines Total" value={c.tradelinesTotal} />
        <Field label="Last Late 30d" value={c.lastLate30d ?? "—"} />
        <Field label="Inquiries" value="—" />
        <Field label="Collections" value="—" />
        <Field label="Public Records" value="—" />
        <Field label="Alt Credit" value={loan.nqmProgram === "ITIN" || loan.nqmProgram === "ForeignNational" ? "Required" : "—"} />
      </Section>

      <Section title="VI. Liabilities Summary">
        <Field label="Total Monthly" value="—" />
        <Field label="Revolving" value="—" />
        <Field label="Installment" value="—" />
        <Field label="Mortgage" value="—" />
        <Field label="Other" value="—" />
        <Field label="Alimony / CS" value="—" />
        <Field label="Student Loans" value="—" />
        <Field label="Total DTI" value={`${loan.qualifying.totalDti.toFixed(2)}%`} />
      </Section>
    </>
  );
}
