"use client";

import ChatPanel from "./ChatPanel";

interface LoanChatPanelProps {
  tenantId: string;
  loanId: string;
  program?: string;
  fico?: number | null;
  ltv?: number;
  occupancy?: string;
}

/**
 * Client component that renders ChatPanel with loan context pre-filled.
 * Used inside the loan layout so chatbot answers are loan-specific.
 */
export default function LoanChatPanel({
  tenantId,
  loanId,
  program,
  fico,
  ltv,
  occupancy,
}: LoanChatPanelProps) {
  const loanContext = {
    program: program || undefined,
    fico: fico ?? undefined,
    ltv: ltv || undefined,
    occupancy: occupancy || undefined,
  };

  return (
    <ChatPanel
      tenantId={tenantId}
      loanId={loanId}
      loanContext={loanContext}
    />
  );
}
