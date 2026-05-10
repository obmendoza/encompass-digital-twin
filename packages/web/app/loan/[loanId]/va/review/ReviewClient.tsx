"use client";

import type { Loan } from "@twin/core";
import { useRouter } from "next/navigation";
import { VAReviewWorkspace } from "@/components/encompass/VAReviewWorkspace";
import { actionSubmitVAReview } from "./actions";

interface Props {
  loan: Loan;
  loanId: string;
  agentRecommendationId: string;
  kbVersion: string;
}

export function ReviewClient({ loan, loanId, agentRecommendationId, kbVersion }: Props) {
  const router = useRouter();
  return (
    <VAReviewWorkspace
      loan={loan}
      agentRecommendationId={agentRecommendationId}
      kbVersion={kbVersion}
      onSubmit={async (payload) => {
        const res = await actionSubmitVAReview(loanId, payload);
        if (!res.ok) return { ok: false, error: res.error };
        // Route forward on success.
        //   concur       → UW page (loan is now uw_review_pending)
        //   request_docs → VA dashboard (loan moved to va_doc_request_pending)
        const next =
          payload.verdict === "concur"
            ? `/loan/${loanId}/transmittal`
            : `/va`;
        router.push(next);
        return { ok: true };
      }}
    />
  );
}
