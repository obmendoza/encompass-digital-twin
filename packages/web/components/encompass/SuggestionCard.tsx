"use client";

import type { PatternSuggestion } from "@twin/core";

interface SuggestionCardsProps {
  patterns: PatternSuggestion[];
  onApply?: (id: string) => void;
  onDismiss?: (id: string) => void;
  onPreview?: (id: string) => void;
  userRole?: "admin" | "compliance_officer" | "uw" | string;
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

function QueueAgeBadge({ approvedAt }: { approvedAt?: string }) {
  if (!approvedAt) return null;
  const hours = Math.max(0, (Date.now() - new Date(approvedAt).getTime()) / (1000 * 60 * 60));
  const label = hours < 1 ? "<1h" : `${Math.round(hours)}h`;
  const color =
    hours < 24
      ? "bg-[#d1fae5] text-[#065f46]"
      : hours < 48
        ? "bg-[#fef3c7] text-[#92400e]"
        : "bg-[#fee2e2] text-[#991b1b]";
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${color}`} title="Time since admin approval">
      {label} in queue
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-[#fef3c7] text-[#92400e]",
    approved: "bg-[#d1fae5] text-[#065f46]",
    rejected: "bg-[#fee2e2] text-[#991b1b]",
    applied: "bg-[#e0e7ff] text-[#3730a3]",
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${colors[status] ?? "bg-[#e5e7eb] text-[#374151]"}`}>
      {status.toUpperCase()}
    </span>
  );
}

export function SuggestionCards({ patterns, onApply, onDismiss, onPreview, userRole }: SuggestionCardsProps) {
  // Without userRole, show original behavior (pending only)
  const visible = userRole
    ? patterns.filter((p) => {
        if (userRole === "admin") return p.status === "pending" || p.status === "approved";
        if (userRole === "compliance_officer") return p.status === "approved" || p.status === "pending";
        return p.status === "pending";
      })
    : patterns.filter((p) => p.status === "pending");

  if (visible.length === 0) {
    return (
      <div className="enc-panel p-4 text-center text-[11px] text-[#8899aa]">
        No active suggestions
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3">
      {visible.map((s) => (
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
            <div className="flex items-center gap-1.5">
              {/* Queue-age indicator for admin-approved suggestions awaiting compliance */}
              {userRole === "compliance_officer" && s.status === "approved" && (
                <QueueAgeBadge approvedAt={s.reviewedBy ? s.createdAt : undefined} />
              )}
              {userRole && s.status !== "pending" && <StatusBadge status={s.status} />}
              <ConfidenceBadge confidence={s.confidence} />
            </div>
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

          {/* Actions — role-aware */}
          <div className="flex gap-2 justify-end">
            {/* Preview button for all roles when callback provided */}
            {onPreview && (
              <button
                className="enc-btn text-[10px] px-3 py-1"
                onClick={() => onPreview(s.id)}
              >
                Preview
              </button>
            )}

            {/* Admin: pending suggestions get Approve/Dismiss */}
            {userRole === "admin" && s.status === "pending" && (
              <>
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
                  Approve
                </button>
              </>
            )}

            {/* Admin: approved suggestions show awaiting badge */}
            {userRole === "admin" && s.status === "approved" && (
              <span className="text-[9px] px-2 py-1 bg-[#fef3c7] text-[#92400e] rounded font-semibold">
                Awaiting Compliance
              </span>
            )}

            {/* Compliance officer: admin-approved suggestions get Confirm/Reject */}
            {userRole === "compliance_officer" && s.status === "approved" && (
              <>
                <button
                  className="enc-btn text-[10px] px-3 py-1 border-[#991b1b] text-[#991b1b]"
                  onClick={() => onDismiss?.(s.id)}
                >
                  Reject
                </button>
                <button
                  className="enc-btn enc-btn--primary text-[10px] px-3 py-1"
                  onClick={() => onApply?.(s.id)}
                >
                  Confirm
                </button>
              </>
            )}

            {/* Default (no role or other roles): original behavior */}
            {!userRole && (
              <>
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
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
