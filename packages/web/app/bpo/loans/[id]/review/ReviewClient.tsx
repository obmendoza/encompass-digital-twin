"use client";
import { useState, useTransition } from "react";
import type { Loan } from "@twin/core";
import { VAReviewWorkspace } from "@/components/encompass/VAReviewWorkspace";
import { actionBpoClaim, actionBpoSubmitReview } from "./actions";

interface Props {
  loan: Loan;
  loanId: string;
  agentRecommendationId: string;
  kbVersion: string;
  alreadyClaimed: boolean;
}

export function ReviewClient({
  loan,
  loanId,
  agentRecommendationId,
  kbVersion,
  alreadyClaimed,
}: Props) {
  const [claimed, setClaimed] = useState(alreadyClaimed);
  const [claimErr, setClaimErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!claimed) {
    return (
      <div className="enc-panel">
        <p className="text-[12px] mb-2">
          This loan is not yet claimed by you. Claim it to begin review.
        </p>
        {claimErr && <div className="text-[11px] text-[#c00] mb-2">{claimErr}</div>}
        <button
          className="enc-btn enc-btn--primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await actionBpoClaim(loanId);
              if (r.ok && r.claimed) setClaimed(true);
              else setClaimErr(r.ok ? r.reason ?? "Claim failed" : r.error);
            })
          }
        >
          {pending ? "Claiming…" : "Claim Loan"}
        </button>
      </div>
    );
  }

  return (
    <VAReviewWorkspace
      loan={loan}
      agentRecommendationId={agentRecommendationId}
      kbVersion={kbVersion}
      onSubmit={async (payload) => {
        const res = await actionBpoSubmitReview(loanId, payload);
        if (res.ok) return { ok: true };
        return { ok: false, error: res.error };
      }}
    />
  );
}
