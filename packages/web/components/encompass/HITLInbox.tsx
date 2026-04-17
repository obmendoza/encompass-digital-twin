"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { HITLTicket } from "@/app/hitl/actions";
import { resolveTicket } from "@/app/hitl/actions";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-[#ffe8c2] text-[#8a4b00] border-[#8a4b00]",
  approved: "bg-[#d7ecd0] text-[#1b5e20] border-[#1b5e20]",
  rejected: "bg-[#f8d7d7] text-[#8a0000] border-[#8a0000]",
};

function TicketCard({ ticket }: { ticket: HITLTicket }) {
  const [expanded, setExpanded] = useState(ticket.status === "pending");
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");

  const resolve = (decision: "approve" | "reject") => {
    startTransition(async () => {
      await resolveTicket(ticket.ticket_id, decision, "uw-local", note || undefined);
    });
  };

  const statusCls = STATUS_STYLE[ticket.status] ?? STATUS_STYLE.pending;

  return (
    <div className={`border mb-2 ${ticket.status === "pending" ? "border-[#8a4b00] border-2" : "border-[#c8c4b5]"}`}>
      {/* Header row */}
      <div
        className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${ticket.status === "pending" ? "bg-[#fffdf5]" : "bg-[#f6f8fb]"}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[10px]">{expanded ? "▼" : "▶"}</span>
        <span className={`border px-2 py-[1px] text-[10px] font-bold uppercase ${statusCls}`}>
          {ticket.status}
        </span>
        <span className="text-[11px] font-bold">{ticket.ticket_id}</span>
        <span className="text-[10px] text-[#404040]">
          Loan{" "}
          <Link href={`/loan/${ticket.loan_id}/transmittal`} className="text-[#0a52a0] underline">
            {ticket.loan_id}
          </Link>
        </span>
        {ticket.program && (
          <span className="text-[10px] bg-[#e8f0fe] px-1 border border-[#b7c2d3]">{ticket.program}</span>
        )}
        <span className="text-[9px] text-[#6b7a8f] ml-auto">
          {new Date(ticket.created_at).toLocaleString()}
        </span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 py-2 border-t border-[#c8c4b5] text-[11px]">
          <div className="mb-2">
            <div className="font-bold text-[10px] text-[#1f4478] uppercase mb-1">Reason for Escalation</div>
            <div className="bg-white border border-[#c8c4b5] p-2">{ticket.reason}</div>
          </div>

          <div className="mb-2">
            <div className="font-bold text-[10px] text-[#1f4478] uppercase mb-1">Loan Summary</div>
            <div className="bg-white border border-[#c8c4b5] p-2 whitespace-pre-wrap text-[10px]">
              {ticket.summary}
            </div>
          </div>

          {ticket.fields && Object.keys(ticket.fields).length > 0 && (
            <div className="mb-2">
              <div className="font-bold text-[10px] text-[#1f4478] uppercase mb-1">Key Fields</div>
              <div className="bg-white border border-[#c8c4b5] p-2 text-[10px] grid grid-cols-[auto_1fr_auto_1fr] gap-x-4 gap-y-1">
                {Object.entries(ticket.fields).map(([k, v]) => {
                  const label = k.replace(/_/g, " ");
                  let display: string;
                  if (typeof v === "number") {
                    const isPercent = /ltv|dti|rate/i.test(k);
                    const isDollar = /amount|income|pitia|piti|payment/i.test(k);
                    if (isPercent) display = `${v.toLocaleString()}%`;
                    else if (isDollar) display = `$${v.toLocaleString()}`;
                    else if (v >= 1000) display = v.toLocaleString();
                    else display = String(v);
                  } else if (typeof v === "boolean") {
                    display = v ? "Yes" : "No";
                  } else {
                    display = String(v);
                  }
                  return (
                    <><span key={k + "-label"} className="font-bold text-[#404040] whitespace-nowrap">{label}:</span>
                    <span key={k + "-value"} className="tabular-nums">{display}</span></>
                  );
                })}
              </div>
            </div>
          )}

          {ticket.status === "pending" ? (
            <div className="mt-3 pt-2 border-t border-[#c8c4b5]">
              <div className="flex items-center gap-2 mb-2">
                <input
                  className="border border-[#7f9db9] text-[11px] px-2 py-1 flex-1"
                  placeholder="Approver notes (optional)..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={pending}
                />
              </div>
              <div className="flex gap-2">
                <button
                  className="enc-btn enc-btn--primary"
                  disabled={pending}
                  onClick={() => resolve("approve")}
                >
                  ✓ Approve
                </button>
                <button
                  className="enc-btn"
                  disabled={pending}
                  onClick={() => resolve("reject")}
                >
                  ✗ Reject
                </button>
                <Link
                  href={`/loan/${ticket.loan_id}/transmittal`}
                  className="enc-btn no-underline text-black"
                >
                  View Loan →
                </Link>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-[10px] text-[#404040]">
              Resolved by <b>{ticket.approver}</b> at {ticket.resolved_at ? new Date(ticket.resolved_at).toLocaleString() : "—"}
              {ticket.approver_note && <span> — "{ticket.approver_note}"</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function HITLInbox({ tickets }: { tickets: HITLTicket[] }) {
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");

  const filtered = filter === "all" ? tickets : tickets.filter((t) => t.status === filter);
  const pendingCount = tickets.filter((t) => t.status === "pending").length;

  return (
    <div>
      <div className="flex gap-2 mb-3 text-[11px]">
        {(["all", "pending", "approved", "rejected"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-2 py-[1px] border border-[#6b7a8f] cursor-pointer capitalize ${
              filter === f ? "bg-[#1a2b4a] text-white" : "bg-white hover:bg-[#e2ddc7]"
            }`}
          >
            {f}{f === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-[#404040] py-8 text-[11px]">
          {filter === "pending"
            ? "No pending approval requests. The agent hasn't escalated any loans."
            : "No tickets match this filter."}
        </div>
      ) : (
        filtered.map((t) => <TicketCard key={t.ticket_id} ticket={t} />)
      )}
    </div>
  );
}
