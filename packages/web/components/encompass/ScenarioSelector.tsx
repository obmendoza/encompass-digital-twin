"use client";

import { useTransition } from "react";
import { actionResetAndReloadAll } from "@/app/actions";

interface LoanSummary {
  id: string;
  borrower: string;
  program: string;
  decision: string;
}

export function SandboxControls({ loans }: { loans: LoanSummary[] }) {
  const [pending, startTransition] = useTransition();

  const modified = loans.filter((l) => l.decision !== "pending").length;
  const total = loans.length;

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
        <button
          className="enc-btn enc-btn--primary ml-auto"
          disabled={pending}
          onClick={() => startTransition(async () => { await actionResetAndReloadAll(); })}
        >
          {pending ? "Resetting…" : "Reset All Loans to Original State"}
        </button>
      </div>
      {modified > 0 && (
        <div className="text-[10px] text-[#404040] mt-1">
          Loans with decisions or cleared conditions will be restored to their original fixture state.
        </div>
      )}
    </div>
  );
}
