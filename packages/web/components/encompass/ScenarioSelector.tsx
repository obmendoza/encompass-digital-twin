"use client";

import { useTransition } from "react";
import { actionSwitchScenario, actionResetAndReloadAll } from "@/app/actions";

interface Scenario {
  id: string;
  name: string;
  description: string;
}

export function ScenarioSelector({ scenarios }: { scenarios: Scenario[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <label className="font-bold">Scenario:</label>
      <select
        className="border border-[#7f9db9] text-[11px] px-1"
        disabled={pending}
        onChange={(e) => {
          if (e.target.value) {
            startTransition(() => { actionSwitchScenario(e.target.value); });
          }
        }}
        defaultValue=""
      >
        <option value="" disabled>Load a scenario…</option>
        {scenarios.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <button
        className="enc-btn"
        disabled={pending}
        onClick={() => startTransition(() => { actionResetAndReloadAll(); })}
      >
        Reset All
      </button>
      {pending && <span className="text-[#404040]">Loading…</span>}
    </div>
  );
}
