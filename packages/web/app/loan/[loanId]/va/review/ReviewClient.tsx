"use client";

import type { Loan } from "@twin/core";
import { VAReviewWorkspace } from "@/components/encompass/VAReviewWorkspace";
import { actionSubmitVAReview } from "./actions";

interface Props {
  loan: Loan;
  loanId: string;
  agentRecommendationId: string;
  kbVersion: string;
}

export function ReviewClient({ loan, loanId, agentRecommendationId, kbVersion }: Props) {
  return (
    <VAReviewWorkspace
      loan={loan}
      agentRecommendationId={agentRecommendationId}
      kbVersion={kbVersion}
      onSubmit={async (payload) => {
        const res = await actionSubmitVAReview(loanId, payload);
        if (res.ok) return { ok: true };
        return { ok: false, error: res.error };
      }}
    />
  );
}
