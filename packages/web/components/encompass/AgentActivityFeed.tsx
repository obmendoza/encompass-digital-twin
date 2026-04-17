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

const PHASE_CONFIG: Record<string, { icon: string; label: string; color: string; glow: string }> = {
  thinking:   { icon: "💭", label: "ANALYZING",   color: "text-[#c4b5fd]", glow: "shadow-[0_0_8px_rgba(167,139,250,0.4)]" },
  tool_call:  { icon: "🔧", label: "TOOL CALL",   color: "text-[#93c5fd]", glow: "shadow-[0_0_8px_rgba(96,165,250,0.4)]" },
  tool_result:{ icon: "📊", label: "RESULT",      color: "text-[#6ee7b7]", glow: "shadow-[0_0_8px_rgba(52,211,153,0.4)]" },
  message:    { icon: "💬", label: "AGENT",        color: "text-[#fde68a]", glow: "shadow-[0_0_8px_rgba(251,191,36,0.4)]" },
  decision:   { icon: "📋", label: "DECISION",     color: "text-[#fca5a5]", glow: "shadow-[0_0_12px_rgba(248,113,113,0.6)]" },
  validation: { icon: "🔍", label: "VALIDATION",  color: "text-[#fdba74]", glow: "shadow-[0_0_8px_rgba(251,146,60,0.4)]" },
};

function ProgressBar({ done, entryCount }: { done: boolean; entryCount: number }) {
  const [width, setWidth] = useState(5);

  useEffect(() => {
    if (done) { setWidth(100); return; }
    const estimated = Math.min(95, 5 + entryCount * 4);
    setWidth(estimated);
  }, [done, entryCount]);

  return (
    <div className="h-[3px] bg-[#1a232e] w-full overflow-hidden">
      <div
        className={`h-full transition-all duration-1000 ease-out ${done ? "bg-[#4ade80]" : "bg-gradient-to-r from-[#3b82f6] via-[#8b5cf6] to-[#06b6d4]"}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function StatusHeader({ done, entryCount }: { done: boolean; entryCount: number }) {
  const [dots, setDots] = useState("");

  useEffect(() => {
    if (done) return;
    const interval = setInterval(() => {
      setDots((d) => d.length >= 3 ? "" : d + ".");
    }, 500);
    return () => clearInterval(interval);
  }, [done]);

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-gradient-to-r from-[#0f1419] to-[#1a232e]">
      <div className="flex items-center gap-2">
        {done ? (
          <span className="text-[#4ade80] text-[12px] font-bold">✓ COMPLETE</span>
        ) : (
          <>
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3b82f6] opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#60a5fa]" />
            </span>
            <span className="text-[#60a5fa] text-[12px] font-bold tracking-wider">
              AGENT RUNNING{dots}
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 ml-auto text-[10px] text-[#6b7a8f]">
        <span>{entryCount} events</span>
        <span>|</span>
        <span>mlb-uw-agent</span>
      </div>
    </div>
  );
}

export function AgentActivityFeed({ loanId, active }: {
  loanId: string;
  active: boolean;
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [done, setDone] = useState(false);
  const startSeq = useRef<number | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // Polling
  useEffect(() => {
    if (!active || done) return;
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
        // silent
      }
    };

    const interval = setInterval(() => { if (!cancelled) poll(); }, 3000);
    poll();
    return () => { cancelled = true; clearInterval(interval); };
  }, [active, done, loanId]);

  // Staggered reveal animation — show entries one by one
  useEffect(() => {
    if (visibleCount < entries.length) {
      const timer = setTimeout(() => setVisibleCount((c) => c + 1), 150);
      return () => clearTimeout(timer);
    }
  }, [entries.length, visibleCount]);

  // Auto-scroll
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [visibleCount]);

  if (!active && entries.length === 0) return null;

  const visibleEntries = entries.slice(0, visibleCount);

  return (
    <div className="mt-2 rounded overflow-hidden border border-[#2a3441]"
      style={{ boxShadow: "0 0 20px rgba(59,130,246,0.15)" }}>
      <StatusHeader done={done} entryCount={entries.length} />
      <ProgressBar done={done} entryCount={entries.length} />

      <div ref={feedRef} className="max-h-[350px] overflow-auto bg-[#0f1419] p-3 font-mono text-[10px] leading-relaxed">
        {entries.length === 0 && !done && (
          <div className="flex items-center gap-2 text-[#4b5563]">
            <span className="animate-bounce">▸</span>
            Initializing agent pipeline...
          </div>
        )}

        {visibleEntries.map((e, idx) => {
          const isLatest = idx === visibleEntries.length - 1 && !done;

          if (e.action.type === "RecordAgentStep" && e.action.step) {
            const step = e.action.step;
            const cfg = PHASE_CONFIG[step.phase] ?? PHASE_CONFIG.message!;
            const time = new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
            const content = step.content.replace(/\*\*/g, "").split("\n")[0]?.slice(0, 140) ?? "";

            return (
              <div key={e.seq}
                className={`py-[3px] border-b border-[#1a232e] transition-all duration-500 ${isLatest ? `${cfg.glow} bg-[#1a232e] rounded px-1 -mx-1` : ""}`}
                style={{ animation: "fadeSlideIn 0.4s ease-out" }}>
                <span className="text-[#4b5563] tabular-nums">{time}</span>
                {" "}
                <span className={`${cfg.color} font-bold`}>
                  {cfg.icon} {cfg.label}
                </span>
                {" "}
                <span className="text-[#9ca3af]">{content}</span>
              </div>
            );
          }

          if (e.action.type === "StageRecommendation" && e.action.recommendation) {
            const rec = e.action.recommendation;
            const decColor = rec.recommendation === "approved" ? "text-[#4ade80]"
              : rec.recommendation === "denied" ? "text-[#f87171]"
              : "text-[#fbbf24]";
            return (
              <div key={e.seq}
                className="py-2 mt-2 border-t border-[#2a3441] text-center"
                style={{ animation: "fadeSlideIn 0.6s ease-out" }}>
                <div className={`text-[14px] font-bold ${decColor}`}>
                  {rec.recommendation === "approved" ? "✅" : rec.recommendation === "denied" ? "🚫" : "⚠️"}
                  {" "}RECOMMENDATION: {rec.recommendation.toUpperCase()}
                </div>
                <div className="text-[#6b7a8f] text-[10px] mt-1">
                  Confidence: {Math.round(rec.confidence * 100)}%
                </div>
              </div>
            );
          }
          return null;
        })}

        {done && (
          <div className="mt-3 pt-2 border-t border-[#2a3441] text-center">
            <div className="text-[#4ade80] text-[11px] font-bold mb-1">
              Agent run complete
            </div>
            <div className="text-[#6b7a8f] text-[10px]">
              Refresh the page to see the full AI Underwriting Report
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
