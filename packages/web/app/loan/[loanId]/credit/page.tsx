import { api } from "@/lib/api-client";
import { CreditReport } from "@/components/encompass/CreditReport";

export default async function CreditPage({
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

  return <CreditReport loan={loan} />;
}
