import { api } from "@/lib/api-client";
import { IncomeWorksheet } from "@/components/encompass/IncomeWorksheet";

export default async function IncomePage({
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

  return <IncomeWorksheet loan={loan} />;
}
