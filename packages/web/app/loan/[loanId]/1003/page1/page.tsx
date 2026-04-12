import { api } from "@/lib/api-client";
import { Section } from "@/components/encompass/Section";
import { Field } from "@/components/encompass/Field";
import { TabBar } from "@/components/encompass/TabBar";
import { money } from "@/lib/format";

export default async function Page1({
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
  const b = loan.borrower;
  const p = loan.property;

  return (
    <>
      <TabBar
        tabs={[
          { label: "Transmittal", href: `/loan/${loanId}/transmittal` },
          { label: "1003 Page 1", href: `/loan/${loanId}/1003/page1` },
          { label: "1003 Page 2", href: `/loan/${loanId}/1003/page2` },
          { label: "1003 Page 3", href: `/loan/${loanId}/1003/page3` },
        ]}
        activeLabel="1003 Page 1"
      />

      <Section title="I. Borrower Information">
        <Field label="Borrower Name" value={b.fullName} />
        <Field label="SSN" value={b.ssnMasked} />
        <Field label="Date of Birth" value={b.dob} />
        <Field label="Marital Status" value={b.maritalStatus} />
        <Field label="Dependents" value="—" />
        <Field label="Yrs School" value="—" />
        <Field label="Citizenship" value="—" />
        <Field label="Email" value="—" />
      </Section>

      <Section title="II. Present Address">
        <Field label="Street" value={p.street} />
        <Field label="City" value={p.city} />
        <Field label="State" value={p.state} />
        <Field label="Zip" value={p.zip} />
        <Field label="Own / Rent" value="—" />
        <Field label="Years at Address" value="—" />
        <Field label="Former Address" value="—" />
        <Field label="Former City/St" value="—" />
      </Section>

      <Section title="III. Employment Information">
        <Field label="Employer" value="—" />
        <Field label="Position / Title" value="—" />
        <Field label="Yrs on Job" value="—" />
        <Field label="Business Phone" value="—" />
        <Field label="Monthly Income" value={money(loan.income.totalMonthlyIncome)} />
        <Field label="Self-Employed" value={
          ["BankStatement12", "BankStatement24", "1099Only", "PnL"].includes(loan.nqmProgram) ? "Yes" : "No"
        } />
        <Field label="Yrs in Line of Work" value="—" />
        <Field label="Income Notes" value={loan.income.notes ?? "—"} />
      </Section>
    </>
  );
}
