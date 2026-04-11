"use client";

import { useState, useTransition } from "react";
import type { NewCondition } from "@twin/core";
import { actionAddCondition } from "@/app/loan/[loanId]/actions";

export function ConditionModal({ loanId }: { loanId: string }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<NewCondition["category"]>("PTD");
  const [src, setSrc] = useState<NewCondition["source"]>("UW");
  const [desc, setDesc] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return <button className="enc-btn" onClick={() => setOpen(true)}>+ Add Condition</button>;
  }

  const submit = () => {
    if (!desc.trim()) return;
    startTransition(async () => {
      await actionAddCondition(loanId, { category: cat, source: src, description: desc });
      setOpen(false); setDesc("");
    });
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-[#ece9d8] border border-[#6b7a8f] w-[420px]">
        <div className="bg-gradient-to-b from-[#0a52a0] to-[#07305e] text-white px-2 py-1 text-[11px] font-bold">
          Add Condition
        </div>
        <div className="p-3 flex flex-col gap-2 text-[11px]">
          <label>Category
            <select className="ml-2 border border-[#7f9db9]" value={cat}
              onChange={(e) => setCat(e.target.value as NewCondition["category"])}>
              <option>PTA</option><option>PTD</option><option>PTF</option><option>PTP</option>
            </select>
          </label>
          <label>Source
            <select className="ml-2 border border-[#7f9db9]" value={src}
              onChange={(e) => setSrc(e.target.value as NewCondition["source"])}>
              <option>UW</option><option>AUS</option><option>Compliance</option><option>Investor</option>
            </select>
          </label>
          <label className="flex flex-col">Description
            <input className="border border-[#7f9db9] px-1" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </label>
          <div className="flex gap-2 justify-end mt-2">
            <button className="enc-btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="enc-btn enc-btn--primary" disabled={pending} onClick={submit}>Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}
