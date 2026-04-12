import { api } from "@/lib/api-client";
import { Section } from "@/components/encompass/Section";
import { Field } from "@/components/encompass/Field";

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
      <div className="flex gap-[2px] border-b-2 border-[#1f4478] mb-1">
        <div className="px-3 py-[2px] bg-white font-bold border border-b-0 border-[#6b7a8f] text-[10px]">Page 1</div>
        <div className="px-3 py-[2px] bg-[#d4d0c8] border border-b-0 border-[#6b7a8f] text-[10px]">Page 2</div>
        <div className="px-3 py-[2px] bg-[#d4d0c8] border border-b-0 border-[#6b7a8f] text-[10px]">Page 3</div>
      </div>

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
        <Field label="Monthly Income" value={`$${loan.income.totalMonthlyIncome.toLocaleString()}`} />
        <Field label="Self-Employed" value={
          ["BankStatement12", "BankStatement24", "1099Only", "PnL"].includes(loan.nqmProgram) ? "Yes" : "No"
        } />
        <Field label="Yrs in Line of Work" value="—" />
        <Field label="Income Notes" value={loan.income.notes ?? "—"} />
      </Section>
    </>
  );
}
