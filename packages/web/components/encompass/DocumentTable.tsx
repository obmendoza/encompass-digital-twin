"use client";

import { useTransition } from "react";
import type { Document, Condition } from "@twin/core";
import { actionUpdateDocumentStatus, actionLinkDocument } from "@/app/loan/[loanId]/actions";

const STATUS_PILL: Record<string, string> = {
  Pending: "enc-pill enc-pill--open",
  Received: "enc-pill enc-pill--rcvd",
  Reviewed: "enc-pill enc-pill--cleared",
  Rejected: "enc-pill enc-pill--waived",
};

const STATUSES = ["Pending", "Received", "Reviewed", "Rejected"];

export function DocumentTable({ loanId, documents, conditions }: {
  loanId: string; documents: Document[]; conditions: Condition[];
}) {
  const [pending, startTransition] = useTransition();

  const conditionLabel = (cid?: string) => {
    if (!cid) return "—";
    const c = conditions.find((x) => x.id === cid);
    return c ? `${c.id}: ${c.description.slice(0, 40)}` : cid;
  };

  return (
    <table className="w-full border-collapse text-[10px]">
      <thead>
        <tr className="bg-gradient-to-b from-[#0a52a0] to-[#08407d] text-white">
          <th className="text-left px-2 py-[3px] border-r border-[#08407d]">#</th>
          <th className="text-left px-2 py-[3px] border-r border-[#08407d]">Name</th>
          <th className="text-left px-2 py-[3px] border-r border-[#08407d]">Type</th>
          <th className="text-left px-2 py-[3px] border-r border-[#08407d]">Linked Condition</th>
          <th className="text-left px-2 py-[3px] border-r border-[#08407d]">Status</th>
          <th className="text-left px-2 py-[3px] border-r border-[#08407d]">Uploaded</th>
          <th className="text-left px-2 py-[3px]">Actions</th>
        </tr>
      </thead>
      <tbody>
        {documents.map((doc, i) => (
          <tr key={doc.id} className={i % 2 ? "bg-[#f5f3e8]" : ""}>
            <td className="px-2 py-[2px] border-b border-[#c8c4b5]">{i + 1}</td>
            <td className="px-2 py-[2px] border-b border-[#c8c4b5]">{doc.name}</td>
            <td className="px-2 py-[2px] border-b border-[#c8c4b5]">{doc.docType}</td>
            <td className="px-2 py-[2px] border-b border-[#c8c4b5]">
              <select className="border border-[#7f9db9] text-[10px] w-full" disabled={pending}
                value={doc.linkedConditionId ?? ""}
                onChange={(e) => {
                  if (e.target.value) startTransition(() => { actionLinkDocument(loanId, doc.id, e.target.value); });
                }}>
                <option value="">— none —</option>
                {conditions.map((c) => (
                  <option key={c.id} value={c.id}>{c.id}: {c.description.slice(0, 35)}</option>
                ))}
              </select>
            </td>
            <td className="px-2 py-[2px] border-b border-[#c8c4b5]">
              <select className="border border-[#7f9db9] text-[10px]" disabled={pending}
                value={doc.status}
                onChange={(e) => startTransition(() => { actionUpdateDocumentStatus(loanId, doc.id, e.target.value); })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </td>
            <td className="px-2 py-[2px] border-b border-[#c8c4b5]">{doc.uploadedAt.slice(0, 10)}</td>
            <td className="px-2 py-[2px] border-b border-[#c8c4b5]">
              <span className={STATUS_PILL[doc.status] ?? ""}>{doc.status}</span>
            </td>
          </tr>
        ))}
        {documents.length === 0 && (
          <tr><td colSpan={7} className="px-2 py-4 text-center text-[#404040]">No documents</td></tr>
        )}
      </tbody>
    </table>
  );
}
