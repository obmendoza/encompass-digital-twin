"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { Loan } from "@twin/core";
import type { AuthUser } from "@/lib/auth";
import { actionOverrideDecision, actionSendBackToVA } from "@/app/loan/[loanId]/actions";
import { money, pct } from "@/lib/format";
import { OverrideReasonSelect } from "./OverrideReasonSelect";

const SpecialistFindings = dynamic(() => import("./SpecialistFindings"), { ssr: false });

const DECISION_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  approved:   { bg: "bg-[#d7ecd0]", text: "text-[#1b5e20]", border: "border-[#1b5e20]" },
  denied:     { bg: "bg-[#f8d7d7]", text: "text-[#8a0000]", border: "border-[#8a0000]" },
  suspended:  { bg: "bg-[#ffe8c2]", text: "text-[#8a4b00]", border: "border-[#8a4b00]" },
  counter:    { bg: "bg-[#e8e0ff]", text: "text-[#4a148c]", border: "border-[#4a148c]" },
  pending:    { bg: "bg-[#e0dfdb]", text: "text-[#404040]", border: "border-[#6b7a8f]" },
};

const UW_DECISIONS = ["approved", "suspended", "denied", "counter"] as const;

interface OverrideModalProps {
  loan: Loan;
  onClose: () => void;
  onSubmit: (loanId: string, original: string, override: string, overrideReason: string, rationale: string) => void;
  pending: boolean;
}

function OverrideModal({ loan, onClose, onSubmit, pending }: OverrideModalProps) {
  const originalRec = loan.pendingRecommendation?.recommendation ?? loan.decision;
  const [overrideDecision, setOverrideDecision] = useState<string>(
    originalRec === "approved" ? "denied" : "approved"
  );
  const [overrideReason, setOverrideReason] = useState<string>("");
  const [rationale, setRationale] = useState("");

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white border border-[#6b7a8f] shadow-lg w-[460px] max-w-full">
        <div className="bg-[#1f4478] text-white px-3 py-2 text-[12px] font-bold flex justify-between items-center">
          <span>Override Decision — {loan.id}</span>
          <button onClick={onClose} className="text-white hover:text-[#ccc]">×</button>
        </div>
        <div className="p-4 text-[11px]">
          <div className="mb-3">
            <div className="text-[#6b7a8f] mb-1">Borrower</div>
            <div className="font-bold">{loan.borrower.fullName}</div>
          </div>
          <div className="mb-3">
            <div className="text-[#6b7a8f] mb-1">Original Recommendation</div>
            <span className={`px-2 py-[2px] font-bold text-[10px] ${DECISION_COLORS[originalRec]?.bg} ${DECISION_COLORS[originalRec]?.text}`}>
              {originalRec.toUpperCase()}
              {loan.pendingRecommendation && ` (${Math.round(loan.pendingRecommendation.confidence * 100)}% conf.)`}
            </span>
          </div>
          <div className="mb-3">
            <label className="block text-[#6b7a8f] mb-1">Override to</label>
            <select
              className="w-full border border-[#6b7a8f] px-2 py-1 text-[11px]"
              value={overrideDecision}
              onChange={(e) => setOverrideDecision(e.target.value)}
            >
              {UW_DECISIONS.filter((d) => d !== originalRec).map((d) => (
                <option key={d} value={d}>{d.toUpperCase()}</option>
              ))}
            </select>
          </div>
          <div className="mb-3">
            <OverrideReasonSelect
              value={overrideReason as "" | import("@twin/core").OverrideReasonCategory}
              onChange={(reason) => setOverrideReason(reason)}
            />
          </div>
          <div className="mb-4">
            <label className="block text-[#6b7a8f] mb-1">Rationale <span className="text-[#c00]">*</span></label>
            <textarea
              className="w-full border border-[#6b7a8f] px-2 py-1 text-[11px] h-[80px] resize-none"
              placeholder="Explain the reason for overriding the agent recommendation..."
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button className="enc-btn" onClick={onClose} disabled={pending}>Cancel</button>
            <button
              className="enc-btn enc-btn--primary"
              disabled={pending || !rationale.trim() || !overrideReason}
              onClick={() => onSubmit(loan.id, originalRec, overrideDecision, overrideReason, rationale)}
            >
              {pending ? "Saving..." : "Override & Record"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SendBackModalProps {
  loan: Loan;
  onClose: () => void;
  onSubmit: (loanId: string, notes: string) => void;
  pending: boolean;
}

function SendBackModal({ loan, onClose, onSubmit, pending }: SendBackModalProps) {
  const [notes, setNotes] = useState("");

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white border border-[#6b7a8f] shadow-lg w-[420px] max-w-full">
        <div className="bg-[#8a4b00] text-white px-3 py-2 text-[12px] font-bold flex justify-between items-center">
          <span>Send Back to VA — {loan.id}</span>
          <button onClick={onClose} className="text-white hover:text-[#ccc]">×</button>
        </div>
        <div className="p-4 text-[11px]">
          <div className="mb-3">
            <div className="text-[#6b7a8f] mb-1">Borrower</div>
            <div className="font-bold">{loan.borrower.fullName}</div>
          </div>
          <div className="mb-4">
            <label className="block text-[#6b7a8f] mb-1">Notes for VA <span className="text-[#c00]">*</span></label>
            <textarea
              className="w-full border border-[#6b7a8f] px-2 py-1 text-[11px] h-[90px] resize-none"
              placeholder="Explain what needs to be re-examined or corrected before re-submission..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button className="enc-btn" onClick={onClose} disabled={pending}>Cancel</button>
            <button
              className="enc-btn"
              style={{ background: "#8a4b00", color: "white" }}
              disabled={pending || !notes.trim()}
              onClick={() => onSubmit(loan.id, notes)}
            >
              {pending ? "Sending..." : "Send Back to VA"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function extractFindings(loan: Loan): Record<string, unknown> | null {
  const rec = loan.pendingRecommendation;
  if (!rec?.trace) return null;

  const findings: Record<string, unknown> = {};
  const agentKeys = ['doc_review', 'income_analysis', 'credit_assessment', 'compliance', 'risk_synthesis', '_pipeline_usage'];

  for (const step of rec.trace) {
    if (step.phase === 'tool_result' && step.content) {
      try {
        const parsed = JSON.parse(step.content);
        if (parsed.agent && agentKeys.includes(parsed.agent)) {
          const key = parsed.agent;
          if (key === '_pipeline_usage') {
            // Store usage data under _pipeline_usage (strip 'agent' key)
            const { agent: _, ...usage } = parsed;
            findings['_pipeline_usage'] = usage;
          } else {
            findings[key] = parsed;
          }
        }
      } catch {}
    }
  }

  // Also check if findings were stored directly on the response
  // (the multi-agent endpoint returns findings in the response body)

  return Object.keys(findings).length > 0 ? findings : null;
}

interface LoanCardProps {
  loan: Loan;
  onOverride: (loan: Loan) => void;
  onSendBack: (loan: Loan) => void;
  onAccept: (loanId: string) => void;
  pending: boolean;
}

function LoanCard({ loan, onOverride, onSendBack, onAccept, pending }: LoanCardProps) {
  const rec = loan.pendingRecommendation;
  const decColors = DECISION_COLORS[loan.decision] ?? DECISION_COLORS["pending"] ?? { bg: "bg-[#e0dfdb]", text: "text-[#404040]", border: "border-[#6b7a8f]" };
  const recColors = rec ? (DECISION_COLORS[rec.recommendation] ?? DECISION_COLORS.pending) : null;
  const flags = rec?.conditions ?? [];
  const [showFindings, setShowFindings] = useState(false);
  const findings = extractFindings(loan);

  return (
    <div className="border border-[#c8c4b5] bg-white mb-3 hover:border-[#1f4478] transition-colors">
      {/* Card header */}
      <div className="flex items-center gap-3 px-3 py-2 bg-[#f5f3e8] border-b border-[#c8c4b5]">
        <div className="font-bold text-[11px] text-[#1f4478]">
          <Link href={`/loan/${loan.id}/transmittal`} className="underline hover:text-[#0a52a0]">
            {loan.id}
          </Link>
        </div>
        <div className="text-[11px] font-bold">{loan.borrower.fullName}</div>
        <div className="text-[10px] text-[#6b7a8f]">{loan.nqmProgram}</div>
        {loan.assignment && (
          <div className="ml-auto text-[9px] px-1 py-[1px] bg-[#ffe8c2] text-[#8a4b00] font-bold">
            {loan.assignment.status.replace(/_/g, " ").toUpperCase()}
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="px-3 py-2 flex gap-6 flex-wrap">
        {/* Loan metrics */}
        <div className="text-[10px] space-y-[3px]">
          <div><span className="text-[#6b7a8f]">Amount:</span> <span className="font-bold">{money(loan.transaction.loanAmount)}</span></div>
          <div><span className="text-[#6b7a8f]">LTV:</span> <span className="font-bold">{pct(loan.transaction.ltv)}</span></div>
          <div><span className="text-[#6b7a8f]">DTI:</span> <span className="font-bold">{pct(loan.qualifying.totalDti)}</span></div>
          <div><span className="text-[#6b7a8f]">FICO:</span> <span className="font-bold">{loan.credit.repScore ?? "N/A"}</span></div>
        </div>

        {/* Agent recommendation */}
        {rec && recColors && (
          <div className="text-[10px]">
            <div className="text-[#6b7a8f] mb-1">Agent Recommendation</div>
            <div className={`inline-flex items-center gap-1 px-2 py-[2px] font-bold border ${recColors.bg} ${recColors.text} ${recColors.border}`}>
              <span>AI</span>
              <span>{rec.recommendation.toUpperCase()}</span>
              <span className="text-[9px] opacity-80">{Math.round(rec.confidence * 100)}%</span>
            </div>
            {flags.length > 0 && (
              <div className="mt-1 space-y-[2px]">
                {flags.slice(0, 3).map((f, i) => (
                  <div key={i} className="text-[9px] text-[#8a4b00] truncate max-w-[200px]">• {f}</div>
                ))}
                {flags.length > 3 && (
                  <div className="text-[9px] text-[#6b7a8f]">+{flags.length - 3} more</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Current decision */}
        {loan.decision !== "pending" && (
          <div className="text-[10px]">
            <div className="text-[#6b7a8f] mb-1">Decision</div>
            <span className={`px-2 py-[2px] font-bold ${decColors.bg} ${decColors.text}`}>
              {loan.decision.toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* Multi-agent findings toggle */}
      {findings && (
        <div className="border-t border-[#c8c4b5]">
          <button
            onClick={() => setShowFindings(!showFindings)}
            className="w-full px-3 py-1.5 text-[10px] font-medium text-[#1f4478] hover:bg-[#f0efe8] flex items-center gap-1 transition-colors"
          >
            <span>{showFindings ? "▾" : "▸"}</span>
            <span>Agent Analysis ({Object.keys(findings).length} specialists)</span>
          </button>
          {showFindings && (
            <div className="px-3 pb-3">
              <SpecialistFindings findings={findings} />
            </div>
          )}
        </div>
      )}

      {/* Card actions */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-[#c8c4b5] bg-[#fafaf5]">
        <Link
          href={`/loan/${loan.id}/transmittal`}
          className="enc-btn text-[9px]"
        >
          Review
        </Link>
        {rec && (
          <button
            className="enc-btn enc-btn--primary text-[9px]"
            disabled={pending}
            onClick={() => onAccept(loan.id)}
          >
            Accept
          </button>
        )}
        <button
          className="enc-btn text-[9px]"
          disabled={pending}
          onClick={() => onOverride(loan)}
        >
          Override
        </button>
        <button
          className="enc-btn text-[9px]"
          disabled={pending}
          onClick={() => onSendBack(loan)}
        >
          Send Back
        </button>
      </div>
    </div>
  );
}

type Tab = "pending" | "in_progress" | "decided";

interface Props {
  loans: (Loan | null)[];
  currentUser: AuthUser;
  tenantId?: string;
}

export function UWDashboard({ loans, currentUser, tenantId }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("pending");
  const [overrideLoan, setOverrideLoan] = useState<Loan | null>(null);
  const [sendBackLoan, setSendBackLoan] = useState<Loan | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const validLoans = loans.filter(Boolean) as Loan[];

  const pendingLoans = validLoans.filter(
    (l) =>
      l.assignment?.status === "report_ready" ||
      l.assignment?.status === "under_review" ||
      (l.pendingRecommendation && l.decision === "pending")
  );

  const inProgressLoans = validLoans.filter(
    (l) => l.assignment?.status === "under_review"
  );

  const decidedLoans = validLoans.filter(
    (l) => l.decision !== "pending"
  );

  const decidedToday = decidedLoans.filter((l) => {
    const ms = l.milestones.filter((m) => (m.name ?? m.label ?? "").startsWith("Decision:"));
    if (!ms.length) return false;
    const last = ms[ms.length - 1]!;
    return last.at.startsWith(new Date().toISOString().slice(0, 10));
  });

  const overrideCount = validLoans.reduce((n, l) => {
    return n + l.milestones.filter((m) => (m.name ?? m.label ?? "").includes("override from")).length;
  }, 0);

  const tabLoans: Record<Tab, Loan[]> = {
    pending: pendingLoans,
    in_progress: inProgressLoans,
    decided: decidedLoans,
  };

  const handleAccept = (loanId: string) => {
    setError(null);
    startTransition(async () => {
      const { actionAcceptRecommendation } = await import("@/app/loan/[loanId]/actions");
      const result = await actionAcceptRecommendation(loanId, tenantId);
      if (!result.ok) setError(`Accept failed: ${result.error?.message}`);
      else router.refresh();
    });
  };

  const handleOverride = (loanId: string, original: string, override: string, overrideReason: string, rationale: string) => {
    setError(null);
    startTransition(async () => {
      const result = await actionOverrideDecision(loanId, original, override, overrideReason, rationale, tenantId);
      if (!result.ok) setError(`Override failed: ${result.error?.message}`);
      else {
        setOverrideLoan(null);
        router.refresh();
      }
    });
  };

  const handleSendBack = (loanId: string, notes: string) => {
    setError(null);
    startTransition(async () => {
      const result = await actionSendBackToVA(loanId, notes, tenantId);
      if (!result.ok) setError(`Send back failed: ${result.error?.message}`);
      else {
        setSendBackLoan(null);
        router.refresh();
      }
    });
  };

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "pending", label: "Pending Review", count: pendingLoans.length },
    { id: "in_progress", label: "In Progress", count: inProgressLoans.length },
    { id: "decided", label: "Decided", count: decidedLoans.length },
  ];

  return (
    <div>
      {/* UW Header */}
      <div className="flex items-center gap-4 mb-3 p-3 bg-gradient-to-r from-[#1f4478] to-[#0a3060] text-white rounded">
        <div className="text-[30px]">UW</div>
        <div>
          <div className="text-[14px] font-bold">{currentUser.displayName ?? currentUser.email}</div>
          <div className="text-[11px] opacity-80">Underwriter · UW Review Queue</div>
        </div>
        <div className="ml-auto flex gap-6 text-[11px]">
          <div className="text-center">
            <div className="text-[18px] font-bold">{pendingLoans.length}</div>
            <div className="opacity-70">Pending Review</div>
          </div>
          <div className="text-center">
            <div className="text-[18px] font-bold">{decidedToday.length}</div>
            <div className="opacity-70">Decided Today</div>
          </div>
          <div className="text-center">
            <div className="text-[18px] font-bold">{overrideCount}</div>
            <div className="opacity-70">Overrides</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-2 p-2 text-[10px] text-[#c00] bg-[#fef0f0] border border-[#c00]">{error}</div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 mb-3 border-b border-[#6b7a8f]">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-[6px] text-[11px] border-t border-l border-r border-[#6b7a8f] -mb-px ${
              activeTab === t.id
                ? "bg-white font-bold text-[#1f4478]"
                : "bg-[#e0dfdb] text-[#404040] hover:bg-[#d4d0c8]"
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* Loan cards */}
      <div>
        {tabLoans[activeTab].length === 0 ? (
          <div className="text-center py-8 text-[11px] text-[#6b7a8f]">
            No loans in this category.
          </div>
        ) : (
          tabLoans[activeTab].map((loan) => (
            <LoanCard
              key={loan.id}
              loan={loan}
              onOverride={setOverrideLoan}
              onSendBack={setSendBackLoan}
              onAccept={handleAccept}
              pending={isPending}
            />
          ))
        )}
      </div>

      {/* Modals */}
      {overrideLoan && (
        <OverrideModal
          loan={overrideLoan}
          onClose={() => setOverrideLoan(null)}
          onSubmit={handleOverride}
          pending={isPending}
        />
      )}
      {sendBackLoan && (
        <SendBackModal
          loan={sendBackLoan}
          onClose={() => setSendBackLoan(null)}
          onSubmit={handleSendBack}
          pending={isPending}
        />
      )}
    </div>
  );
}
