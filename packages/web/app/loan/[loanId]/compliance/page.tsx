import { api } from "@/lib/api-client";
import { ComplianceReport } from "@/components/encompass/ComplianceReport";

export default async function CompliancePage({
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
  return <ComplianceReport loan={loan} />;
}
