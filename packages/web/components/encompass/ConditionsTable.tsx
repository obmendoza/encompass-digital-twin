"use client";

import { useTransition } from "react";
import type { Condition } from "@twin/core";
import { actionClearCondition, actionWaiveCondition, actionRemoveCondition } from "@/app/loan/[loanId]/actions";

const PILL: Record<Condition["status"], string> = {
  Open: "enc-pill enc-pill--open",
  Requested: "enc-pill enc-pill--reqd",
  Received: "enc-pill enc-pill--rcvd",
  Cleared: "enc-pill enc-pill--cleared",
  Waived: "enc-pill enc-pill--waived",
};

export function ConditionsTable({ loanId, conditions }: { loanId: string; conditions: Condition[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <table className="w-full border-collapse text-[10px]">
      <thead>
        <tr className="bg-gradient-to-b from-[#0a52a0] to-[#08407d] text-white">
          <th className="text-left px-1 py-[2px] border-r border-[#08407d]">#</th>
          <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Cat</th>
          <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Source</th>
          <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Description</th>
          <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Status</th>
          <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Added</th>
          <th className="text-left px-1 py-[2px]">Actions</th>
        </tr>
      </thead>
      <tbody>
        {conditions.map((c, i) => (
          <tr key={c.id} className={i % 2 ? "bg-[#f5f3e8]" : ""}>
            <td className="px-1">{i + 1}</td>
            <td className="px-1">{c.category}</td>
            <td className="px-1">{c.source}</td>
            <td className="px-1">{c.description}</td>
            <td className="px-1"><span className={PILL[c.status]}>{c.status}</span></td>
            <td className="px-1">{c.addedAt.slice(5, 10).replace("-", "/")}</td>
            <td className="px-1 flex gap-1">
              <button className="enc-btn" disabled={pending}
                onClick={() => startTransition(() => { actionClearCondition(loanId, c.id, "verified"); })}>
                Clear
              </button>
              <button className="enc-btn" disabled={pending}
                onClick={() => {
                  const r = prompt("Waive rationale?");
                  if (r) startTransition(() => { actionWaiveCondition(loanId, c.id, r); });
                }}>
                Waive
              </button>
              <button className="enc-btn" disabled={pending}
                onClick={() => startTransition(() => { actionRemoveCondition(loanId, c.id); })}>
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
