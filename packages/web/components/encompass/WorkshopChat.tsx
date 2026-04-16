"use client";

import { useState, useTransition } from "react";
import { actionGenerateScenario, actionRefineScenario, actionInjectLoan } from "@/app/workshop/actions";
import { money, pct } from "@/lib/format";

interface Message {
  role: "user" | "system";
  content: string;
  loan?: Record<string, unknown>;
}

const PRESETS = [
  { label: "Random NQM", prompt: "Generate a realistic random NQM loan scenario with a random program. Make it interesting — varied borrower profile, realistic property in a US city." },
  { label: "DSCR Edge Case", prompt: "Generate a DSCR investor loan edge case that requires experienced underwriter judgment. Include a tricky element like a short-term lease expiring soon, sub-1.0 DSCR with compensating factors, or a property flip." },
  { label: "Bank Statement Edge", prompt: "Generate a bank statement NQM loan with a challenging income calculation — maybe large deposits that skew averages, declining trend, or co-mingled business/personal funds." },
  { label: "ITIN Loan", prompt: "Generate an ITIN borrower loan with full documentation. Include alternative credit tradelines and realistic ITIN-specific conditions." },
  { label: "Deny Candidate", prompt: "Generate a loan scenario that should be denied — multiple overlapping risk factors like low FICO, high LTV, tight DTI, recent lates, and insufficient reserves." },
  { label: "Stress Test", prompt: "Generate a borderline loan where the decision could go either way — strong compensating factors almost offset serious risk factors. The kind of loan that would split a room of underwriters." },
];

function LoanPreview({ loan }: { loan: Record<string, unknown> }) {
  const b = loan.borrower as Record<string, unknown> ?? {};
  const p = loan.property as Record<string, unknown> ?? {};
  const t = loan.transaction as Record<string, unknown> ?? {};
  const q = loan.qualifying as Record<string, unknown> ?? {};
  const c = loan.credit as Record<string, unknown> ?? {};
  const inc = loan.income as Record<string, unknown> ?? {};
  const conditions = (loan.conditions as unknown[]) ?? [];
  const overlay = loan.overlay as Record<string, unknown> ?? {};

  return (
    <div className="border border-[#6b7a8f] bg-[#f6f8fb] mt-2 text-[10px]">
      <div className="bg-gradient-to-b from-[#0a52a0] to-[#08407d] text-white px-2 py-1 font-bold">
        Preview: {String(loan.id)} — {String(loan.nqmProgram)}
      </div>
      <div className="p-2 grid grid-cols-4 gap-x-4 gap-y-1">
        <div><b>Borrower:</b> {String(b.fullName ?? "—")}</div>
        <div><b>Program:</b> {String(loan.nqmProgram)}</div>
        <div><b>Loan Amt:</b> {money(Number(t.loanAmount) || 0)}</div>
        <div><b>Appraised:</b> {money(Number(t.appraisedValue) || 0)}</div>
        <div><b>Property:</b> {String(p.street ?? "")}, {String(p.city ?? "")} {String(p.state ?? "")}</div>
        <div><b>Type:</b> {String(p.propertyType ?? "—")}</div>
        <div><b>LTV:</b> {pct(Number(t.ltv) || 0)}</div>
        <div><b>Occupancy:</b> {String(t.occupancy ?? "—")}</div>
        <div><b>FICO:</b> {c.repScore != null ? String(c.repScore) : "n/a"}</div>
        <div><b>DTI:</b> {pct(Number(q.totalDti) || 0)}</div>
        <div><b>Rate:</b> {pct(Number(t.noteRate) || 0, 3)}</div>
        <div><b>Reserves:</b> {String((loan.assets as Record<string, unknown>)?.reservesMonths ?? "—")} mo</div>
        <div><b>Income:</b> {money(Number(inc.totalMonthlyIncome) || 0)}/mo</div>
        <div><b>DSCR:</b> {t.dscrRatio != null ? String(Number(t.dscrRatio).toFixed(2)) : "—"}</div>
        <div><b>Conditions:</b> {conditions.length}</div>
        <div><b>Decision:</b> {String(loan.decision)}</div>
      </div>
      {inc.notes != null && (
        <div className="px-2 pb-2 text-[9px] text-[#404040]">
          <b>Income Notes:</b> {String(inc.notes)}
        </div>
      )}
      {Array.isArray(overlay.checks) && overlay.checks.length > 0 && (
        <div className="px-2 pb-2 text-[9px]">
          <b>Overlay Checks:</b>{" "}
          {(overlay.checks as Array<Record<string, unknown>>).map((ch, i) => (
            <span key={i} className={`mr-2 ${ch.result === "Pass" ? "text-[#1b5e20]" : ch.result === "Fail" ? "text-[#c00]" : "text-[#8a4b00]"}`}>
              {String(ch.category)}: {String(ch.result)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkshopChat() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "system", content: "Welcome to the Scenario Workshop. Describe a loan scenario, pick a preset, or paste JSON to inject. Claude will generate a complete NQM loan fixture matching the Encompass type system." },
  ]);
  const [input, setInput] = useState("");
  const [currentLoan, setCurrentLoan] = useState<Record<string, unknown> | null>(null);
  const [pending, startTransition] = useTransition();
  const [injected, setInjected] = useState<string | null>(null);

  const generate = (prompt: string) => {
    setMessages((m) => [...m, { role: "user", content: prompt }]);
    setInjected(null);
    startTransition(async () => {
      const result = currentLoan
        ? await actionRefineScenario(currentLoan, prompt)
        : await actionGenerateScenario(prompt);
      if (result.ok && result.loan) {
        setCurrentLoan(result.loan);
        setMessages((m) => [...m, {
          role: "system",
          content: `Generated: ${String(result.loan!.id)} — ${String(result.loan!.nqmProgram)} (${String((result.loan!.borrower as Record<string, unknown>)?.fullName ?? "Unknown")})`,
          loan: result.loan,
        }]);
      } else {
        setMessages((m) => [...m, { role: "system", content: `Error: ${result.error}` }]);
      }
    });
  };

  const inject = () => {
    if (!currentLoan) return;
    startTransition(async () => {
      const result = await actionInjectLoan(currentLoan);
      if (result.ok) {
        setInjected(result.loanId!);
        setMessages((m) => [...m, { role: "system", content: `Injected as ${result.loanId} — visible in Pipeline now.` }]);
      } else {
        setMessages((m) => [...m, { role: "system", content: `Inject failed: ${result.error}` }]);
      }
    });
  };

  const reset = () => {
    setCurrentLoan(null);
    setInjected(null);
    setMessages([
      { role: "system", content: "Workspace cleared. Describe a new scenario or pick a preset." },
    ]);
  };

  return (
    <div>
      {/* Preset buttons */}
      <div className="flex flex-wrap gap-2 mb-3">
        {PRESETS.map((p) => (
          <button key={p.label} className="enc-btn text-[10px]" disabled={pending} onClick={() => generate(p.prompt)}>
            {p.label}
          </button>
        ))}
        <button className="enc-btn text-[10px] ml-auto" onClick={reset}>Clear</button>
      </div>

      {/* Chat messages */}
      <div className="border border-[#6b7a8f] bg-white max-h-[350px] overflow-auto mb-3">
        {messages.map((m, i) => (
          <div key={i} className={`p-2 border-b border-[#e0dfdb] text-[11px] ${m.role === "user" ? "bg-[#e8f0fe]" : ""}`}>
            <span className="font-bold text-[10px]">
              {m.role === "user" ? "You" : "Workshop"}:
            </span>{" "}
            {m.content}
            {m.loan && <LoanPreview loan={m.loan} />}
          </div>
        ))}
        {pending && (
          <div className="p-2 text-[11px] text-[#404040] animate-pulse">
            Claude is generating... (10-30 seconds)
          </div>
        )}
      </div>

      {/* Input */}
      <div className="flex gap-2 mb-3">
        <input
          className="border border-[#7f9db9] text-[11px] px-2 py-1 flex-1"
          placeholder={currentLoan ? "Refine: e.g. 'Lower DSCR to 0.85' or 'Add a late payment'" : "Describe a scenario: e.g. 'DSCR investor with a property flip in Miami'"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) { generate(input.trim()); setInput(""); } }}
          disabled={pending}
        />
        <button className="enc-btn enc-btn--primary" disabled={pending || !input.trim()} onClick={() => { generate(input.trim()); setInput(""); }}>
          {currentLoan ? "Refine" : "Generate"}
        </button>
      </div>

      {/* Preview + inject */}
      {currentLoan && (
        <div className="flex items-center gap-3 p-2 bg-[#f6f8fb] border border-[#6b7a8f]">
          {injected ? (
            <span className="text-[11px] text-[#1b5e20] font-bold">
              Injected as {injected} — <a href={`/loan/${injected}/transmittal`} className="underline text-[#0a52a0]">Open in Transmittal</a>
            </span>
          ) : (
            <button className="enc-btn enc-btn--primary" disabled={pending} onClick={inject}>
              Inject into Pipeline
            </button>
          )}
          <span className="text-[10px] text-[#404040] ml-auto">
            Preview: {String(currentLoan.id)} — {String(currentLoan.nqmProgram)}
          </span>
        </div>
      )}
    </div>
  );
}
