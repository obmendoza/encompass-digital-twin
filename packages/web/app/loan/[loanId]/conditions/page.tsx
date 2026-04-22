import { api } from "@/lib/api-client";
import { getUser } from "@/lib/auth";
import { ConditionsManager } from "@/components/encompass/ConditionsManager";

export const dynamic = "force-dynamic";

export default async function ConditionsPage({
  params,
}: {
  params: Promise<{ loanId: string }>;
}) {
  const { loanId } = await params;
  const user = await getUser();
  let loan;
  try {
    loan = await api.getLoan(loanId);
  } catch {
    await api.loadByLoan(loanId);
    loan = await api.getLoan(loanId);
  }

  return <ConditionsManager loan={loan} userRole={user?.role} />;
}
