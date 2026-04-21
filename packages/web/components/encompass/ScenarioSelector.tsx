"use client";

import { useState, useTransition } from "react";
import { actionResetAndReloadAll } from "@/app/actions";

interface LoanSummary {
  id: string;
  borrower: string;
  program: string;
  decision: string;
}

export function SandboxControls({ loans, userRole }: { loans: LoanSummary[]; userRole?: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const modified = loans.filter((l) => l.decision !== "pending").length;
  const total = loans.length;

  const handleReset = () => {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await actionResetAndReloadAll();
      if (result.ok) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(result.error ?? "Reset failed");
      }
    });
  };

  const canReset = !userRole || ["uw", "admin"].includes(userRole);

  return (
    <div className="border border-[#6b7a8f] bg-[#f6f8fb] p-2">
      <div className="flex items-center gap-3 text-[11px]">
        <span className="font-bold text-[#1f4478]">Sandbox</span>
        <span className="border-l border-[#b7c2d3] pl-3">
          {total} loans loaded
          {modified > 0 && (
            <span className="ml-1 text-[#8a4b00]">
              ({modified} modified)
            </span>
          )}
        </span>
        {canReset ? (
          <button
            className="enc-btn enc-btn--primary ml-auto"
            disabled={pending}
            onClick={handleReset}
          >
            {pending ? "Resetting…" : "Reset All Loans to Original State"}
          </button>
        ) : (
          <span className="ml-auto text-[10px] text-[#6b7a8f]">Reset requires Underwriter role</span>
        )}
      </div>
      {error && (
        <div className="text-[10px] text-[#c00] mt-1">Error: {error}</div>
      )}
      {success && (
        <div className="text-[10px] text-[#1b5e20] mt-1">All loans reset to original state.</div>
      )}
      {modified > 0 && !error && !success && (
        <div className="text-[10px] text-[#404040] mt-1">
          Loans with decisions or cleared conditions will be restored to their original fixture state.
        </div>
      )}
    </div>
  );
}
