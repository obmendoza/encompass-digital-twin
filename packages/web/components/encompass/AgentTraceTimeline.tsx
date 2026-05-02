"use client";

import { useState } from "react";

interface TraceStep {
  phase: string; // "message" | "tool_call" | "tool_result" | "validation" | "decision" | "thinking"
  content: string;
  at: string; // ISO timestamp
  metadata?: {
    tool?: string;
    args?: Record<string, unknown>;
    severity?: string; // "info" | "warning" | "error"
    expected?: string;
    actual?: string;
  };
}

interface AgentTraceTimelineProps {
  trace: TraceStep[];
  loanId: string;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(first: string, last: string): string {
  const ms = new Date(last).getTime() - new Date(first).getTime();
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function getStepIcon(step: TraceStep, index: number): string {
  switch (step.phase) {
    case "message":
      if (index === 0) return "🚀";
      // Try to detect agent icon from content
      if (step.content.includes("📄")) return "📄";
      if (step.content.includes("💰")) return "💰";
      if (step.content.includes("📊")) return "📊";
      if (step.content.includes("⚖️")) return "⚖️";
      if (step.content.includes("🎯")) return "🎯";
      return "💬";
    case "tool_call":
      return "🔧";
    case "tool_result":
      return "📋";
    case "validation":
      if (step.content.startsWith("✅")) return "✅";
      if (step.content.startsWith("⚠️")) return "⚠️";
      if (step.content.startsWith("❌")) return "❌";
      return "✅";
    case "decision":
      return "🎯";
    case "thinking":
      return "💭";
    default:
      return "•";
  }
}

function getDotColor(step: TraceStep): string {
  switch (step.phase) {
    case "message":
      return "bg-blue-600";
    case "tool_call":
    case "tool_result":
      return "bg-gray-400";
    case "validation":
      if (step.content.startsWith("✅")) return "bg-green-500";
      if (step.content.startsWith("⚠️")) return "bg-yellow-500";
      if (step.content.startsWith("❌")) return "bg-red-500";
      return "bg-green-500";
    case "decision":
      return "bg-blue-800";
    case "thinking":
      return "bg-gray-300";
    default:
      return "bg-gray-400";
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function StepContent({
  step,
  expanded,
  onToggle,
}: {
  step: TraceStep;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { phase, content, metadata } = step;

  // ── tool_call ──────────────────────────────────────────────────
  if (phase === "tool_call") {
    // Tool name may be in metadata.tool or parsed from content like "tool_name({...})"
    const toolName = metadata?.tool ?? content.split("(")[0] ?? "unknown_tool";
    const args = metadata?.args;
    return (
      <div>
        <span className="font-mono text-[11px] text-gray-600">{toolName}(...)</span>
        {args !== undefined && (
          <>
            <div>
              <button
                onClick={onToggle}
                className="text-[10px] text-blue-500 hover:text-blue-700 mt-0.5"
              >
                {expanded ? "▾ Hide arguments" : "▸ Show arguments"}
              </button>
            </div>
            {expanded && (
              <pre className="text-[10px] bg-gray-50 p-2 rounded mt-1 overflow-x-auto border border-gray-200">
                {safeStringify(args)}
              </pre>
            )}
          </>
        )}
      </div>
    );
  }

  // ── tool_result ────────────────────────────────────────────────
  if (phase === "tool_result") {
    const preview = content.length > 100 ? content.slice(0, 100) : content;
    const needsTruncation = content.length > 100;
    return (
      <div>
        <div className="text-[10px] text-gray-500 truncate max-w-md">
          {preview}
          {needsTruncation && "..."}
        </div>
        <div>
          <button
            onClick={onToggle}
            className="text-[10px] text-blue-500 hover:text-blue-700 mt-0.5"
          >
            {expanded ? "▾ Hide full result" : "▸ Show full result"}
          </button>
        </div>
        {expanded && (
          <pre className="text-[10px] bg-gray-50 p-2 rounded mt-1 overflow-x-auto border border-gray-200 whitespace-pre-wrap break-all">
            {content}
          </pre>
        )}
      </div>
    );
  }

  // ── thinking ───────────────────────────────────────────────────
  if (phase === "thinking") {
    const preview = content.length > 80 ? content.slice(0, 80) + "..." : content;
    return (
      <div>
        <div className="text-[11px] text-gray-400 italic">
          {expanded ? content : preview}
        </div>
        {content.length > 80 && (
          <button
            onClick={onToggle}
            className="text-[10px] text-blue-500 hover:text-blue-700 mt-0.5"
          >
            {expanded ? "▾ Collapse" : "▸ Show more"}
          </button>
        )}
      </div>
    );
  }

  // ── validation ─────────────────────────────────────────────────
  if (phase === "validation") {
    let bgClass = "bg-green-50 border-green-200 text-green-800";
    if (content.startsWith("⚠️")) bgClass = "bg-yellow-50 border-yellow-200 text-yellow-800";
    else if (content.startsWith("❌")) bgClass = "bg-red-50 border-red-200 text-red-800";

    return (
      <div className={`text-[11px] rounded px-2 py-1 border ${bgClass} mt-0.5`}>
        {content}
      </div>
    );
  }

  // ── decision ───────────────────────────────────────────────────
  if (phase === "decision") {
    return (
      <div className="mt-0.5 rounded px-2 py-1.5 bg-blue-50 border border-blue-200">
        <span className="text-[12px] font-bold text-blue-800">{content}</span>
      </div>
    );
  }

  // ── message (default) ──────────────────────────────────────────
  return (
    <div className="text-[11px] text-gray-700 mt-0.5 whitespace-pre-wrap">{content}</div>
  );
}

export default function AgentTraceTimeline({ trace, loanId: _loanId }: AgentTraceTimelineProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function toggle(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // ── Stats ──────────────────────────────────────────────────────
  const duration =
    trace.length >= 2 ? formatDuration(trace[0].at, trace[trace.length - 1].at) : "—";

  const toolCount = new Set(
    trace
      .filter((s) => s.phase === "tool_call")
      .map((s) => s.metadata?.tool ?? s.content.split("(")[0] ?? "")
      .filter((t) => t.length > 0)
  ).size;

  return (
    <div className="font-sans">
      {/* Stats header */}
      <div className="flex items-center gap-4 mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="text-[11px]">
          <span className="text-gray-500">Steps:</span>{" "}
          <span className="font-bold">{trace.length}</span>
        </div>
        <div className="text-[11px]">
          <span className="text-gray-500">Duration:</span>{" "}
          <span className="font-bold">{duration}</span>
        </div>
        <div className="text-[11px]">
          <span className="text-gray-500">Tools Used:</span>{" "}
          <span className="font-bold">{toolCount}</span>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[19px] top-0 bottom-0 w-px bg-gray-200" />

        {trace.map((step, i) => {
          const icon = getStepIcon(step, i);
          const dotColor = getDotColor(step);
          const isExpanded = expanded.has(i);
          const isCollapsible =
            step.phase === "tool_call" ||
            step.phase === "tool_result" ||
            step.phase === "thinking";

          return (
            <div key={i} className="relative flex gap-3 pb-4">
              {/* Dot on the line */}
              <div
                className={`w-[10px] h-[10px] rounded-full mt-1.5 flex-shrink-0 z-10 ${dotColor}`}
              />

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400 font-mono">
                    {formatTime(step.at)}
                  </span>
                  <span>{icon}</span>
                </div>
                <StepContent
                  step={step}
                  expanded={isExpanded}
                  onToggle={isCollapsible ? () => toggle(i) : () => {}}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
