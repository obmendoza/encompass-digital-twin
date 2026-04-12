import { api } from "@/lib/api-client";
import { Section } from "@/components/encompass/Section";
import { Field } from "@/components/encompass/Field";
import { TabBar } from "@/components/encompass/TabBar";
import { money, pct } from "@/lib/format";

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

  return (
    <>
      <TabBar
        tabs={[
          { label: "Transmittal", href: `/loan/${loanId}/transmittal` },
          { label: "1003 Page 1", href: `/loan/${loanId}/1003/page1` },
          { label: "1003 Page 2", href: `/loan/${loanId}/1003/page2` },
          { label: "1003 Page 3", href: `/loan/${loanId}/1003/page3` },
        ]}
        activeLabel="1003 Page 3"
      />

      <Section title="VII. Transaction Details">
        <Field label="Purpose" value={t.loanPurpose} />
        <Field label="Loan Amount" value={money(t.loanAmount)} />
        <Field label="Sales Price" value={t.salesPrice ? money(t.salesPrice) : "—"} />
        <Field label="Appraised Value" value={money(t.appraisedValue)} />
        <Field label="LTV" value={pct(t.ltv)} />
        <Field label="CLTV" value={pct(t.cltv)} />
        <Field label="HCLTV" value={pct(t.hcltv)} />
        <Field label="Down Payment" value={t.salesPrice ? money(t.salesPrice - t.loanAmount) : "—"} />
        <Field label="Note Rate" value={pct(t.noteRate, 4)} />
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
        <Field label="Expense Factor" value={w.expenseFactor != null ? `${(w.expenseFactor * 100).toFixed(0)}%` : "—"} />
        <Field label="NSF Count" value={w.nsfCount != null ? w.nsfCount : "—"} />
        <Field label="DSCR Ratio" value={t.dscrRatio != null ? t.dscrRatio.toFixed(2) : "—"} />
        <Field label="Months Covered" value={w.monthsCovered != null ? w.monthsCovered : "—"} />
        <Field label="Avg Deposits" value={w.avgDeposits != null ? money(w.avgDeposits) : "—"} />
        <Field label="Total Assets" value={w.totalAssets != null ? money(w.totalAssets) : "—"} />
        <Field label="Depletion (mo)" value={w.depletionMonths != null ? w.depletionMonths : "—"} />
        <Field label="Gross 1099" value={w.gross1099 != null ? money(w.gross1099) : "—"} />
        <Field label="CPA Net Inc." value={w.cpaCertifiedNetIncome != null ? money(w.cpaCertifiedNetIncome) : "—"} />
        <Field label="Housing Ratio" value={pct(q.housingRatio)} />
        <Field label="Total DTI" value={pct(q.totalDti)} />
        <Field label="PI Payment" value={money(q.piPayment)} />
        <Field label="Qual Rate" value={pct(q.qualifyingRate, 4)} />
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
