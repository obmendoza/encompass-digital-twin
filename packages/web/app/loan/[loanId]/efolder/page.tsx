import { api } from "@/lib/api-client";
import { EFolderWorkspace } from "@/components/encompass/EFolderWorkspace";

export const dynamic = "force-dynamic";

export default async function EFolderPage({
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

  const twinApiUrl = process.env.TWIN_API_URL ?? "http://127.0.0.1:4000";

  return <EFolderWorkspace loan={loan} twinApiUrl={twinApiUrl} />;
}
