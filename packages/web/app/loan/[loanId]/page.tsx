import { redirect } from "next/navigation";
export default async function LoanIndex({ params }: { params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;
  redirect(`/loan/${loanId}/transmittal`);
}
