"use client";

import type { PatternSuggestion } from "@twin/core";

interface SuggestionCardsProps {
  patterns: PatternSuggestion[];
  onApply?: (id: string) => void;
  onDismiss?: (id: string) => void;
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 80
      ? "bg-[#1a7a3a] text-white"
      : pct >= 50
        ? "bg-[#8a6800] text-white"
        : "bg-[#8a3a1a] text-white";
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${color}`}>
      {pct}%
    </span>
  );
}

export function SuggestionCards({ patterns, onApply, onDismiss }: SuggestionCardsProps) {
  const pending = patterns.filter((p) => p.status === "pending");

  if (pending.length === 0) {
    return (
      <div className="enc-panel p-4 text-center text-[11px] text-[#8899aa]">
        No active suggestions
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {pending.map((s) => (
        <div key={s.id} className="enc-panel p-3">
          <div className="flex items-start justify-between mb-2">
            <div>
              <div className="text-[11px] font-semibold text-[#1a2b4a]">
                {s.suggestionType}
              </div>
              <div className="text-[10px] text-[#6b7a8f] mt-0.5">
                {s.rootCause}
              </div>
            </div>
            <ConfidenceBadge confidence={s.confidence} />
          </div>

          {/* Specific change */}
          <div className="bg-[#f5f7fa] rounded p-2 mb-2 text-[10px] font-mono">
            <span className="text-[#6b7a8f]">{s.specificChange.path}:</span>{" "}
            {s.specificChange.from !== undefined && (
              <>
                <span className="text-[#8a3a1a] line-through">{String(s.specificChange.from)}</span>
                <span className="text-[#6b7a8f] mx-1">&rarr;</span>
              </>
            )}
            <span className="text-[#1a7a3a] font-semibold">{String(s.specificChange.to)}</span>
          </div>

          {/* Risk assessment preview */}
          <div className="text-[10px] text-[#6b7a8f] mb-2 line-clamp-2">
            {s.riskAssessment}
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button
              className="enc-btn text-[10px] px-3 py-1"
              onClick={() => onDismiss?.(s.id)}
            >
              Dismiss
            </button>
            <button
              className="enc-btn enc-btn--primary text-[10px] px-3 py-1"
              onClick={() => onApply?.(s.id)}
            >
              Apply
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
