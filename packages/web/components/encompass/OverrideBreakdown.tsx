"use client";

import { OVERRIDE_REASON_LABELS } from "@twin/core";
import type { OverrideReasonCategory } from "@twin/core";

interface OverrideBreakdownProps {
  byReason: Partial<Record<OverrideReasonCategory, number>>;
  byProgram: Record<string, { total: number; aligned: number }>;
}

function HBar({ value, max, color }: { value: number; max: number; color: string }) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex-1 h-3 bg-[#e4e8ec] rounded overflow-hidden">
      <div className={`h-full rounded ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function OverrideBreakdown({ byReason, byProgram }: OverrideBreakdownProps) {
  const reasonEntries = Object.entries(byReason)
    .filter(([, count]) => (count ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));

  const programEntries = Object.entries(byProgram)
    .sort((a, b) => b[1].total - a[1].total);

  const maxReasonCount = reasonEntries.length > 0
    ? Math.max(...reasonEntries.map(([, c]) => c ?? 0))
    : 0;

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Left: Override reasons */}
      <div className="enc-panel p-3">
        <div className="text-[10px] font-semibold text-[#6b7a8f] uppercase mb-2">By Reason</div>
        {reasonEntries.length === 0 ? (
          <div className="text-[11px] text-[#8899aa] py-4 text-center">No override data yet</div>
        ) : (
          reasonEntries.map(([reason, count]) => (
            <div key={reason} className="flex items-center gap-2 mb-1">
              <span className="text-[10px] text-[#1a2b4a] w-28 truncate shrink-0" title={OVERRIDE_REASON_LABELS[reason as OverrideReasonCategory] ?? reason}>
                {OVERRIDE_REASON_LABELS[reason as OverrideReasonCategory] ?? reason}
              </span>
              <HBar value={count ?? 0} max={maxReasonCount} color="bg-[#2d5f8a]" />
              <span className="text-[10px] text-[#6b7a8f] w-6 text-right shrink-0">{count}</span>
            </div>
          ))
        )}
      </div>

      {/* Right: Alignment by program */}
      <div className="enc-panel p-3">
        <div className="text-[10px] font-semibold text-[#6b7a8f] uppercase mb-2">By Program</div>
        {programEntries.length === 0 ? (
          <div className="text-[11px] text-[#8899aa] py-4 text-center">No program data yet</div>
        ) : (
          programEntries.map(([program, { total, aligned }]) => {
            const rate = total > 0 ? Math.round((aligned / total) * 100) : 0;
            return (
              <div key={program} className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-[#1a2b4a] w-28 truncate shrink-0" title={program}>
                  {program}
                </span>
                <HBar value={rate} max={100} color="bg-[#1a7a3a]" />
                <span className="text-[10px] text-[#6b7a8f] w-12 text-right shrink-0">{rate}% ({total})</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
