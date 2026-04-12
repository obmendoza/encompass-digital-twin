"use client";

import { useState, useTransition } from "react";
import { actionAddDocument } from "@/app/loan/[loanId]/actions";

const DOC_TYPES = [
  "BankStatement", "TaxReturn", "PayStub", "1099", "PnL",
  "CPA_Letter", "ID", "Insurance", "Appraisal", "Title",
  "LeaseAgreement", "LOX", "BKDocs", "CreditReport", "Other",
];

export function AddDocumentModal({ loanId }: { loanId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [docType, setDocType] = useState("Other");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return <button className="enc-btn" onClick={() => setOpen(true)}>+ Add Document</button>;
  }

  const submit = () => {
    if (!name.trim()) return;
    startTransition(async () => {
      await actionAddDocument(loanId, { name, docType });
      setOpen(false); setName("");
    });
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-[#ece9d8] border border-[#6b7a8f] w-[420px]">
        <div className="bg-gradient-to-b from-[#0a52a0] to-[#07305e] text-white px-2 py-1 text-[11px] font-bold">
          Add Document
        </div>
        <div className="p-3 flex flex-col gap-2 text-[11px]">
          <label className="flex flex-col">Document Name
            <input className="border border-[#7f9db9] px-1" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>Document Type
            <select className="ml-2 border border-[#7f9db9]" value={docType}
              onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
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
