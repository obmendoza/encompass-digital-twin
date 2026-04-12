import { api } from "@/lib/api-client";
import { ProgramOverlayReport } from "@/components/encompass/ProgramOverlayReport";

export default async function OverlaysPage({
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
  return <ProgramOverlayReport loan={loan} />;
}
