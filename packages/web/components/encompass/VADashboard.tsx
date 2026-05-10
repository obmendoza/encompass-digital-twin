"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Loan } from "@twin/core";
import type { AuthUser } from "@/lib/auth";
import { actionAssignLoan, actionUpdateAssignmentStatus, actionUnassignLoan, actionGetVAPools } from "@/app/va/actions";
import { actionClaimVA } from "@/app/loan/[loanId]/va/review/actions";
import { actionRunAgent } from "@/app/loan/[loanId]/actions";
import { money } from "@/lib/format";

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  queued: { bg: "bg-[#e0dfdb]", text: "text-[#404040]" },
  in_progress: { bg: "bg-[#cfe0f5]", text: "text-[#0d47a1]" },
  report_ready: { bg: "bg-[#d7ecd0]", text: "text-[#1b5e20]" },
  under_review: { bg: "bg-[#ffe8c2]", text: "text-[#8a4b00]" },
  decided: { bg: "bg-[#d7ecd0]", text: "text-[#1b5e20]" },
};

const PRIORITY_COLORS: Record<string, string> = {
  normal: "text-[#6b7a8f]",
  high: "text-[#8a4b00] font-bold",
  urgent: "text-[#8a0000] font-bold",
};

interface Props {
  loans: (Loan | null)[];
  currentUser: AuthUser;
  /** Loans currently in va_review_pending. Sourced from /va/queue (the
   * va_loan_state side-table), not from Loan itself which has no VA fields. */
  queueItems?: Array<{ loan_id: string; assigned_pool_id: string }>;
}

type PoolInfo = { id: string; name: string; kind: "internal" | "bpo" };

export function VADashboard({ loans, currentUser, queueItems = [] }: Props) {
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"my" | "unassigned" | "all" | "pool">("my");
  const [pools, setPools] = useState<PoolInfo[]>([]);

  useEffect(() => {
    actionGetVAPools()
      .then((r) => {
        if (r.ok) setPools(r.pools);
      })
      .catch(() => {});
  }, []);

  const validLoans = loans.filter(Boolean) as Loan[];
  const myLoans = validLoans.filter((l) => l.assignment?.assignedTo === currentUser.email);
  const unassigned = validLoans.filter((l) => !l.assignment);
  const poolIds = new Set(pools.map((p) => p.id));
  const queuedPoolByLoan = new Map(
    queueItems
      .filter((i) => poolIds.has(i.assigned_pool_id))
      .map((i) => [i.loan_id, i.assigned_pool_id]),
  );
  const poolQueue = validLoans.filter((l) => queuedPoolByLoan.has(l.id));
  const displayed =
    filter === "my"
      ? myLoans
      : filter === "unassigned"
        ? unassigned
        : filter === "pool"
          ? poolQueue
          : validLoans;

  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const assignToMe = (loanId: string, priority: string = "normal") => {
    setError(null);
    startTransition(async () => {
      const result = await actionAssignLoan(loanId, currentUser.email, priority);
      if (!result.ok) setError(`Assign failed: ${result.error}`);
      else router.refresh();
    });
  };

  const updateStatus = (loanId: string, status: string) => {
    startTransition(async () => {
      await actionUpdateAssignmentStatus(loanId, status);
      router.refresh();
    });
  };

  const unassign = (loanId: string) => {
    startTransition(async () => {
      await actionUnassignLoan(loanId);
      router.refresh();
    });
  };

  const runAgent = (loanId: string) => {
    startTransition(async () => {
      await actionUpdateAssignmentStatus(loanId, "in_progress");
      router.refresh();
      await actionRunAgent(loanId);
      router.refresh();
    });
  };

  return (
    <div>
      {/* VA Header */}
      <div className="flex items-center gap-4 mb-3 p-3 bg-gradient-to-r from-[#1f4478] to-[#0a3060] text-white rounded">
        <div className="text-[30px]">🤖</div>
        <div>
          <div className="text-[14px] font-bold">{currentUser.displayName ?? currentUser.email}</div>
          <div className="text-[11px] opacity-80">Virtual Assistant · {myLoans.length} loans assigned</div>
        </div>
        <div className="ml-auto flex gap-4 text-[11px]">
          <div className="text-center">
            <div className="text-[18px] font-bold">{myLoans.filter(l => l.assignment?.status === "queued").length}</div>
            <div className="opacity-70">Queued</div>
          </div>
          <div className="text-center">
            <div className="text-[18px] font-bold">{myLoans.filter(l => l.assignment?.status === "in_progress").length}</div>
            <div className="opacity-70">In Progress</div>
          </div>
          <div className="text-center">
            <div className="text-[18px] font-bold">{myLoans.filter(l => l.assignment?.status === "report_ready").length}</div>
            <div className="opacity-70">Report Ready</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-2 p-2 text-[10px] text-[#c00] bg-[#fef0f0] border border-[#c00]">{error}</div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-3">
        {(["my", "unassigned", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1 text-[11px] border border-[#6b7a8f] capitalize ${filter === f ? "bg-[#1f4478] text-white" : "bg-white hover:bg-[#e8f0fe]"}`}>
            {f === "my" ? `My Queue (${myLoans.length})` : f === "unassigned" ? `Unassigned (${unassigned.length})` : `All (${validLoans.length})`}
          </button>
        ))}
        <button
          onClick={() => setFilter("pool")}
          className={`px-3 py-1 text-[11px] border border-[#6b7a8f] capitalize ${filter === "pool" ? "bg-[#1f4478] text-white" : "bg-white hover:bg-[#e8f0fe]"}`}
          data-testid="filter-pool"
        >
          Pool Queue ({poolQueue.length})
        </button>
      </div>

      {/* Loan table */}
      <div className="enc-sec">
        <h4>{filter === "my" ? "My Assigned Loans" : filter === "unassigned" ? "Unassigned Loans" : "All Loans"}</h4>
        <table className="w-full border-collapse text-[10px]">
          <thead>
            <tr className="bg-[#d4d0c8]">
              <th className="text-left px-2 py-[4px] border-b border-[#6b7a8f]">Loan #</th>
              <th className="text-left px-2 py-[4px] border-b border-[#6b7a8f]">Borrower</th>
              <th className="text-left px-2 py-[4px] border-b border-[#6b7a8f]">Program</th>
              <th className="text-left px-2 py-[4px] border-b border-[#6b7a8f]">Amount</th>
              <th className="text-left px-2 py-[4px] border-b border-[#6b7a8f]">Status</th>
              <th className="text-left px-2 py-[4px] border-b border-[#6b7a8f]">Priority</th>
              <th className="text-left px-2 py-[4px] border-b border-[#6b7a8f]">Decision / Recommendation</th>
              <th className="text-left px-2 py-[4px] border-b border-[#6b7a8f]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((loan, i) => {
              const a = loan.assignment;
              const sc = a ? STATUS_COLORS[a.status] ?? STATUS_COLORS.queued : null;
              return (
                <tr key={loan.id} className={i % 2 ? "bg-[#f5f3e8]" : ""}>
                  <td className="px-2 py-[3px] border-b border-[#c8c4b5]">
                    <Link href={`/loan/${loan.id}/transmittal`} className="text-[#0a52a0] underline">{loan.id}</Link>
                  </td>
                  <td className="px-2 py-[3px] border-b border-[#c8c4b5]">{loan.borrower.fullName}</td>
                  <td className="px-2 py-[3px] border-b border-[#c8c4b5]">{loan.nqmProgram}</td>
                  <td className="px-2 py-[3px] border-b border-[#c8c4b5]">{money(loan.transaction.loanAmount)}</td>
                  <td className="px-2 py-[3px] border-b border-[#c8c4b5]">
                    {a ? (
                      <span className={`px-1 py-[1px] text-[9px] font-bold ${sc?.bg} ${sc?.text}`}>
                        {a.status.replace("_", " ").toUpperCase()}
                      </span>
                    ) : (
                      <span className="text-[#6b7a8f]">Unassigned</span>
                    )}
                  </td>
                  <td className="px-2 py-[3px] border-b border-[#c8c4b5]">
                    {a ? <span className={PRIORITY_COLORS[a.priority] ?? ""}>{a.priority}</span> : "—"}
                  </td>
                  <td className="px-2 py-[3px] border-b border-[#c8c4b5]">
                    {loan.decision !== "pending" ? (
                      <span className={`px-1 py-[1px] text-[9px] font-bold ${
                        loan.decision === "approved" ? "bg-[#d7ecd0] text-[#1b5e20]" :
                        loan.decision === "denied" ? "bg-[#f8d7d7] text-[#8a0000]" :
                        "bg-[#ffe8c2] text-[#8a4b00]"
                      }`}>{loan.decision.toUpperCase()}</span>
                    ) : loan.pendingRecommendation ? (
                      <div className="flex items-center gap-1">
                        <span className="text-[#6b7a8f]">pending</span>
                        <span className={`px-1 py-[1px] text-[8px] font-bold border ${
                          loan.pendingRecommendation.recommendation === "approved" ? "border-[#1b5e20] text-[#1b5e20]" :
                          loan.pendingRecommendation.recommendation === "denied" ? "border-[#8a0000] text-[#8a0000]" :
                          "border-[#8a4b00] text-[#8a4b00]"
                        }`}>🤖 {loan.pendingRecommendation.recommendation.toUpperCase()}</span>
                      </div>
                    ) : (
                      <span className="text-[#6b7a8f]">pending</span>
                    )}
                  </td>
                  <td className="px-2 py-[3px] border-b border-[#c8c4b5]">
                    <div className="flex gap-1">
                      {filter === "pool" && (
                        <button
                          className="enc-btn"
                          disabled={pending}
                          onClick={() => {
                            setError(null);
                            startTransition(async () => {
                              const r = await actionClaimVA(loan.id);
                              if (!r.ok) {
                                setError(`Claim failed: ${r.error}`);
                                return;
                              }
                              if (!r.claimed) {
                                setError(`Claim failed: ${r.reason ?? "unknown"}`);
                                return;
                              }
                              router.push(`/loan/${loan.id}/va/review`);
                            });
                          }}
                          data-testid={`claim-review-${loan.id}`}
                        >
                          Claim & Review
                        </button>
                      )}
                      {!a && (
                        <button className="enc-btn text-[9px]" disabled={pending} onClick={() => assignToMe(loan.id)}>
                          Assign to me
                        </button>
                      )}
                      {a?.assignedTo === currentUser.email && a.status === "queued" && (
                        <button className="enc-btn enc-btn--primary text-[9px]" disabled={pending} onClick={() => runAgent(loan.id)}>
                          🤖 Start
                        </button>
                      )}
                      {a?.assignedTo === currentUser.email && a.status === "in_progress" && (
                        <button className="enc-btn text-[9px]" disabled={pending} onClick={() => updateStatus(loan.id, "report_ready")}>
                          Mark Ready
                        </button>
                      )}
                      {a?.assignedTo === currentUser.email && (
                        <button className="enc-btn text-[9px]" disabled={pending} onClick={() => unassign(loan.id)}>
                          ×
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {displayed.length === 0 && (
              <tr><td colSpan={8} className="text-center py-4 text-[#6b7a8f]">
                {filter === "my" ? "No loans assigned to you. Pick from unassigned." : "No loans."}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
