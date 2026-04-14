"use client";

import { useState, useTransition } from "react";
import { actionRunAgent } from "@/app/loan/[loanId]/actions";

export function RunAgentButton({ loanId, hasRecommendation }: {
  loanId: string;
  hasRecommendation: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    setError(null);
    startTransition(async () => {
      const result = await actionRunAgent(loanId);
      if (!result.ok) setError(result.error?.message ?? "Agent failed");
    });
  };

  if (hasRecommendation) {
    return (
      <div className="text-[10px] text-[#404040]">
        Agent recommendation pending below ↓
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        className="enc-btn enc-btn--primary"
        disabled={pending}
        onClick={run}
      >
        {pending ? "🤖 Analyzing… (~60s)" : "🤖 Run AI Agent"}
      </button>
      {error && <span className="text-[10px] text-[#c00]">{error}</span>}
    </div>
  );
}
