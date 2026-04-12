import { api } from "@/lib/api-client";
import { AppraisalReport } from "@/components/encompass/AppraisalReport";

export default async function AppraisalPage({
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
  return <AppraisalReport loan={loan} />;
}
