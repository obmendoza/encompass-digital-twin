"use client";

import { useState, useTransition } from "react";
import type { PendingRecommendation } from "@twin/core";
import { actionAcceptRecommendation, actionClearRecommendation } from "@/app/loan/[loanId]/actions";

const DECISION_COLORS: Record<string, string> = {
  approved: "bg-[#d7ecd0] text-[#1b5e20] border-[#1b5e20]",
  denied: "bg-[#f8d7d7] text-[#8a0000] border-[#8a0000]",
  suspended: "bg-[#ffe8c2] text-[#8a4b00] border-[#8a4b00]",
  counter: "bg-[#cfe0f5] text-[#0d47a1] border-[#0d47a1]",
  pending: "bg-[#e6e6e6] text-[#333] border-[#555]",
};

const PHASE_ICONS: Record<string, string> = {
  thinking: "💭",
  tool_call: "🔧",
  tool_result: "📊",
  message: "💬",
  decision: "📋",
};

export function RecommendationPanel({ loanId, rec }: {
  loanId: string;
  rec: PendingRecommendation;
}) {
  const [pending, startTransition] = useTransition();
  const [showTrace, setShowTrace] = useState(false);

  const accept = () => startTransition(() => { actionAcceptRecommendation(loanId); });
  const reject = () => startTransition(() => { actionClearRecommendation(loanId); });

  const colorClass = DECISION_COLORS[rec.recommendation] ?? DECISION_COLORS.pending;
  const confidencePct = Math.round(rec.confidence * 100);

  return (
    <div className="enc-sec mt-2 border-2 border-[#0a52a0]">
      <h4 className="!bg-gradient-to-b from-[#d79a1f] to-[#8a6110]">
        🤖 AI Agent Recommendation — mlb-uw-agent
      </h4>
      <div className="p-3 bg-[#fffdf5]">
        <div className="flex items-center gap-3 mb-3">
          <div className={`border-2 px-3 py-1 text-[12px] font-bold uppercase ${colorClass}`}>
            {rec.recommendation}
          </div>
          <div className="text-[11px]">
            <b>Confidence:</b> {confidencePct}%
          </div>
          <div className="text-[10px] text-[#404040] ml-auto">
            Staged at {new Date(rec.stagedAt).toLocaleString()}
          </div>
        </div>

        <div className="text-[10px] mb-3 bg-white p-2 border border-[#c8c4b5] max-h-[200px] overflow-auto">
          <div className="font-bold mb-1">Rationale:</div>
          <div className="whitespace-pre-wrap">{rec.rationale.slice(0, 1500)}
            {rec.rationale.length > 1500 && "…"}
          </div>
        </div>

        {rec.conditions.length > 0 && (
          <div className="text-[10px] mb-3 bg-white p-2 border border-[#c8c4b5]">
            <div className="font-bold mb-1">Suggested Conditions ({rec.conditions.length}):</div>
            <ul className="list-disc pl-4">
              {rec.conditions.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        )}

        <div className="mb-3">
          <button className="enc-btn text-[10px]" onClick={() => setShowTrace(!showTrace)}>
            {showTrace ? "▼ Hide" : "▶ Show"} reasoning trace ({rec.trace.length} steps)
          </button>
          {showTrace && (
            <div className="mt-2 bg-white border border-[#c8c4b5] max-h-[300px] overflow-auto text-[10px]">
              {rec.trace.map((step, i) => (
                <div key={i} className="border-b border-[#e0dfdb] p-2">
                  <div className="font-bold">
                    {PHASE_ICONS[step.phase] ?? "•"} {step.phase}
                  </div>
                  <div className="text-[#404040] whitespace-pre-wrap break-all">
                    {step.content.slice(0, 300)}{step.content.length > 300 && "…"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 pt-2 border-t border-[#c8c4b5]">
          <button
            className="enc-btn enc-btn--primary"
            disabled={pending}
            onClick={accept}
          >
            ✓ Accept Recommendation
          </button>
          <button
            className="enc-btn"
            disabled={pending}
            onClick={reject}
          >
            ✗ Reject
          </button>
          <span className="text-[10px] text-[#404040] ml-auto">
            Accepting converts to a {rec.recommendation.toUpperCase()} decision
          </span>
        </div>
      </div>
    </div>
  );
}
