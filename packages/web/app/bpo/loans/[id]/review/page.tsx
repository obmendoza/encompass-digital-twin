import { redirect } from "next/navigation";
import { bpoApi } from "@/lib/bpo-client";
import { ReviewClient } from "./ReviewClient";

export const dynamic = "force-dynamic";

export default async function BpoLoanReview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: loanId } = await params;

  let auth;
  try {
    auth = await bpoApi.auth();
  } catch {
    redirect("/bpo/login");
  }

  let loanResult;
  try {
    loanResult = await bpoApi.getLoan(loanId);
  } catch (e: unknown) {
    return (
      <div className="enc-panel">
        <h2 className="text-[14px] font-bold text-[#1a2b4a]">Loan Not Found</h2>
        <p className="text-[11px] text-[#c00]">
          {e instanceof Error ? e.message : "Failed to fetch loan"}
        </p>
        <p className="text-[11px] text-[#6b7a8f] mt-2">
          If you believe this is an error, contact your administrator.
        </p>
      </div>
    );
  }
  const loan = loanResult.loan;

  // The BPO loan-detail response includes the full loan; the in-memory loan
  // carries vaId via Task 12's upsert from va_loan_state. We treat the loan
  // as "already claimed" if vaId === auth.smeId.
  const alreadyClaimed = loan.vaId === auth.smeId;

  // Provenance placeholders — same approach as the internal page.
  const agentRecommendationId = "00000000-0000-0000-0000-000000000000";
  const kbVersion = "kb-current";

  return (
    <div>
      <div className="enc-panel mb-3">
        <div className="text-[11px] text-[#6b7a8f]">
          Reviewing as <b>{auth.smeName}</b> · {loan.borrower.fullName} · {loan.nqmProgram}
        </div>
      </div>
      <ReviewClient
        loan={loan}
        loanId={loanId}
        agentRecommendationId={agentRecommendationId}
        kbVersion={kbVersion}
        alreadyClaimed={alreadyClaimed}
      />
    </div>
  );
}
