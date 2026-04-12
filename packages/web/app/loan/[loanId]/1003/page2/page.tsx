import { api } from "@/lib/api-client";
import { Section } from "@/components/encompass/Section";
import { Field } from "@/components/encompass/Field";
import { TabBar } from "@/components/encompass/TabBar";
import { money, pct } from "@/lib/format";

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

  return (
    <>
      <TabBar
        tabs={[
          { label: "Transmittal", href: `/loan/${loanId}/transmittal` },
          { label: "1003 Page 1", href: `/loan/${loanId}/1003/page1` },
          { label: "1003 Page 2", href: `/loan/${loanId}/1003/page2` },
          { label: "1003 Page 3", href: `/loan/${loanId}/1003/page3` },
        ]}
        activeLabel="1003 Page 2"
      />

      <Section title="IV. Assets">
        <Field label="Total Liquid" value={money(a.totalLiquid)} />
        <Field label="Total Retirement" value={money(a.totalRetirement)} />
        <Field label="Reserves (months)" value={a.reservesMonths != null ? a.reservesMonths.toFixed(1) : "—"} />
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
        <Field label="Total DTI" value={pct(loan.qualifying.totalDti)} />
      </Section>
    </>
  );
}
