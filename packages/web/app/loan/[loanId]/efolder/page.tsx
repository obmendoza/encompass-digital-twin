import { api } from "@/lib/api-client";
import { DocumentTable } from "@/components/encompass/DocumentTable";
import { AddDocumentModal } from "@/components/encompass/AddDocumentModal";

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

  const pendingCount = loan.documents.filter((d) => d.status === "Pending").length;
  const receivedCount = loan.documents.filter((d) => d.status === "Received").length;
  const reviewedCount = loan.documents.filter((d) => d.status === "Reviewed").length;

  return (
    <div className="enc-sec">
      <h4>eFolder — {loan.documents.length} Documents · {pendingCount} Pending · {receivedCount} Received · {reviewedCount} Reviewed</h4>
      <div className="p-2">
        <DocumentTable loanId={loan.id} documents={loan.documents} conditions={loan.conditions} />
        <div className="mt-2">
          <AddDocumentModal loanId={loan.id} />
        </div>
      </div>
    </div>
  );
}
