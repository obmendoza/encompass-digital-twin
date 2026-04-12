"use client";

import { useState, useTransition } from "react";
import type { UwDecision } from "@twin/core";
import { actionSetDecision } from "@/app/loan/[loanId]/actions";

export function DecisionBar({ loanId, current }: { loanId: string; current: UwDecision }) {
  const [rationale, setRationale] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (decision: UwDecision) => {
    if (!rationale.trim()) { alert("Rationale required"); return; }
    startTransition(() => { actionSetDecision(loanId, decision, rationale); });
  };

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-[#ece9d8] border border-[#6b7a8f]">
      <button className="enc-btn enc-btn--primary" disabled={pending} onClick={() => run("approved")}>Approve</button>
      <button className="enc-btn" disabled={pending} onClick={() => run("suspended")}>Suspend</button>
      <button className="enc-btn" disabled={pending} onClick={() => run("counter")}>Counter</button>
      <button className="enc-btn" disabled={pending} onClick={() => run("denied")}>Deny</button>
      <input className="ml-2 border border-[#7f9db9] text-[11px] px-1 flex-1"
        placeholder="Rationale…" value={rationale} onChange={(e) => setRationale(e.target.value)} />
      <span className="ml-auto text-[10px]">Current: <b>{current}</b></span>
    </div>
  );
}
