"use client";

import { useState, useEffect, useRef } from "react";

interface AuditEntry {
  seq: number;
  at: string;
  action: {
    type: string;
    step?: { phase: string; content: string };
    recommendation?: { recommendation: string; confidence: number };
    [key: string]: unknown;
  };
}

const PHASE_ICON: Record<string, string> = {
  thinking: "💭",
  tool_call: "🔧",
  tool_result: "📊",
  message: "💬",
  decision: "📋",
  validation: "🔍",
};

const PHASE_LABEL: Record<string, string> = {
  thinking: "Analysis",
  tool_call: "Tool Call",
  tool_result: "Result",
  message: "Agent",
  decision: "Decision",
  validation: "Validation",
};

export function AgentActivityFeed({ loanId, active }: {
  loanId: string;
  active: boolean;
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [done, setDone] = useState(false);
  const startSeq = useRef<number | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const apiUrl = typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_TWIN_API_URL ?? "")
    : "";

  useEffect(() => {
    if (!active || done) return;

    const twinBase = apiUrl || "";
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/audit-proxy?loanId=${loanId}`, { cache: "no-store" });
        if (!res.ok) return;
        const log: AuditEntry[] = await res.json();

        if (startSeq.current === null && log.length > 0) {
          startSeq.current = log[log.length - 1]!.seq;
        }

        const newEntries = startSeq.current !== null
          ? log.filter((e) => e.seq > startSeq.current!)
          : [];

        const agentEntries = newEntries.filter(
          (e) => e.action.type === "RecordAgentStep" || e.action.type === "StageRecommendation"
        );

        if (agentEntries.length > 0) {
          setEntries((prev) => {
            const seqs = new Set(prev.map((e) => e.seq));
            const fresh = agentEntries.filter((e) => !seqs.has(e.seq));
            return [...prev, ...fresh];
          });
        }

        if (newEntries.some((e) => e.action.type === "StageRecommendation")) {
          setDone(true);
        }
      } catch {
        // polling failure — silent
      }
    };

    const interval = setInterval(() => {
      if (!cancelled) poll();
    }, 3000);
    poll(); // immediate first poll

    return () => { cancelled = true; clearInterval(interval); };
  }, [active, done, loanId, apiUrl]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [entries]);

  if (!active && entries.length === 0) return null;

  return (
    <div className="enc-sec mt-2 border-2 border-[#0a52a0]">
      <h4 className="!bg-gradient-to-b from-[#1f4478] to-[#0a3060]">
        🤖 Agent Activity {done ? "— Complete" : "— Live"}
        {!done && <span className="ml-2 animate-pulse">●</span>}
      </h4>
      <div ref={feedRef} className="max-h-[300px] overflow-auto bg-[#0f1419] text-[#e6e1d5] p-2 font-mono text-[10px]">
        {entries.length === 0 && !done && (
          <div className="text-[#6b7a8f] animate-pulse">Waiting for agent events...</div>
        )}
        {entries.map((e) => {
          if (e.action.type === "RecordAgentStep" && e.action.step) {
            const step = e.action.step;
            const icon = PHASE_ICON[step.phase] ?? "•";
            const label = PHASE_LABEL[step.phase] ?? step.phase;
            const time = new Date(e.at).toLocaleTimeString();
            const content = step.content.replace(/\*\*/g, "").split("\n")[0]?.slice(0, 120) ?? "";

            const phaseColor: Record<string, string> = {
              thinking: "text-[#a78bfa]",
              tool_call: "text-[#60a5fa]",
              tool_result: "text-[#34d399]",
              message: "text-[#fbbf24]",
              decision: "text-[#f87171]",
              validation: "text-[#fb923c]",
            };

            return (
              <div key={e.seq} className="py-[2px] border-b border-[#2a3441]">
                <span className="text-[#6b7a8f]">{time}</span>
                {" "}
                <span className={phaseColor[step.phase] ?? "text-[#e6e1d5]"}>
                  {icon} {label}
                </span>
                {" "}
                <span className="text-[#c8c4b5]">{content}</span>
              </div>
            );
          }
          if (e.action.type === "StageRecommendation" && e.action.recommendation) {
            const rec = e.action.recommendation;
            return (
              <div key={e.seq} className="py-[2px] border-b border-[#2a3441] text-[#4ade80] font-bold">
                📋 Recommendation staged: {rec.recommendation.toUpperCase()} ({Math.round(rec.confidence * 100)}% confidence)
              </div>
            );
          }
          return null;
        })}
        {done && (
          <div className="pt-2 text-[#4ade80]">
            ✓ Agent run complete — refresh to see full recommendation panel
          </div>
        )}
      </div>
    </div>
  );
}
