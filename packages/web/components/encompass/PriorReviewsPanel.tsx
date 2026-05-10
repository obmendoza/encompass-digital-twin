"use client";

import { useState } from "react";

interface PriorReview {
  id: string;
  va_id: string;
  pool_kind: "internal" | "bpo";
  verdict: "concur" | "request_docs";
  overall_rationale: string;
  doc_request: unknown;          // null OR { docs, deadline, messageToOriginator }
  submitted_at: string;
  review_time_seconds: number;
}

export function PriorReviewsPanel({ reviews }: { reviews: PriorReview[] }) {
  const [open, setOpen] = useState(false);

  if (reviews.length === 0) return null;

  return (
    <div className="enc-panel mb-3 border-l-4 border-[#8a4b00]">
      <button
        type="button"
        className="text-[12px] font-bold text-[#1a2b4a] w-full text-left"
        onClick={() => setOpen(!open)}
        data-testid="prior-reviews-toggle"
      >
        {open ? "▼" : "▶"} Prior reviews ({reviews.length}) — see why earlier VAs sent this back
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {reviews.map((r) => {
            const dr = r.doc_request as null | { docs?: unknown[]; deadline?: string; messageToOriginator?: string };
            return (
              <div key={r.id} className="text-[11px] border-t border-[#c8c4b5] pt-2">
                <div className="text-[#6b7a8f]">
                  <b>{new Date(r.submitted_at).toLocaleString()}</b>
                  {" · "}{r.pool_kind === "bpo" ? "BPO SME" : "Internal"}
                  {" · "}reviewed {r.review_time_seconds}s
                  {" · "}verdict: <b className={r.verdict === "request_docs" ? "text-[#8a4b00]" : "text-[#1b5e20]"}>{r.verdict}</b>
                </div>
                <div className="mt-1 text-[#1a2b4a] whitespace-pre-wrap">{r.overall_rationale}</div>
                {dr && Array.isArray(dr.docs) && (
                  <div className="mt-1 text-[#8a4b00]">
                    Requested {dr.docs.length} doc{dr.docs.length === 1 ? "" : "s"}
                    {dr.deadline ? ` by ${dr.deadline}` : ""}
                    {dr.messageToOriginator ? `: ${dr.messageToOriginator}` : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
