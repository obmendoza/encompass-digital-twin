"use client";

import { OVERRIDE_REASON_LABELS } from "@twin/core";
import type { OverrideReasonCategory } from "@twin/core";

interface Props {
  value: OverrideReasonCategory | "";
  onChange: (reason: OverrideReasonCategory) => void;
}

export function OverrideReasonSelect({ value, onChange }: Props) {
  return (
    <div className="mb-2">
      <label className="block text-[10px] font-semibold text-[#404040] mb-1">
        Override Reason <span className="text-[#c00]">*</span>
      </label>
      <select
        className="enc-input w-full text-[11px]"
        value={value}
        onChange={(e) => onChange(e.target.value as OverrideReasonCategory)}
        required
      >
        <option value="">Select reason...</option>
        {Object.entries(OVERRIDE_REASON_LABELS).map(([code, label]) => (
          <option key={code} value={code}>{label}</option>
        ))}
      </select>
    </div>
  );
}
