"use client";

import { useState, useTransition } from "react";
import { actionRunAgent } from "@/app/loan/[loanId]/actions";
import { AgentActivityFeed } from "./AgentActivityFeed";

export function RunAgentButton({ loanId, hasRecommendation, userRole }: {
  loanId: string;
  hasRecommendation: boolean;
  userRole?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = () => {
    setError(null);
    setRunning(true);
    startTransition(async () => {
      const result = await actionRunAgent(loanId);
      if (!result.ok) {
        setError(result.error?.message ?? "Agent failed");
        setRunning(false);
      }
      // Don't setRunning(false) on success — feed will detect StageRecommendation
    });
  };

  if (userRole && !["va", "uw", "admin"].includes(userRole)) {
    return <div className="text-[10px] text-[#6b7a8f]">Agent requires VA or UW role</div>;
  }

  if (hasRecommendation) {
    return (
      <div className="text-[10px] text-[#404040]">
        Agent recommendation pending below ↓
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          className="enc-btn enc-btn--primary"
          disabled={pending}
          onClick={run}
        >
          {pending ? "🤖 Analyzing…" : "🤖 Run AI Agent"}
        </button>
        {error && <span className="text-[10px] text-[#c00]">{error}</span>}
      </div>
      <AgentActivityFeed loanId={loanId} active={running} />
    </div>
  );
}
