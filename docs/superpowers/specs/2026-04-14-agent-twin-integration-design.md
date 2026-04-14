# Agent + Twin Integration

**Date:** 2026-04-14
**Approach:** Option B + streaming — agent stages recommendations, human accepts/rejects, reasoning streams into Conversation Log.

---

## Flow

1. UW opens a loan in the twin, clicks **🤖 Run AI Agent**
2. Twin Web calls Agent Service `POST /api/twin/underwrite/:loanId`
3. Agent pulls loan from Twin API, runs Claude loop with tools (matrix_lookup, retrieve_guideline, etc.)
4. As each tool-call event fires, Agent posts `RecordAgentStep` to Twin API (lands in Conversation Log)
5. Agent posts final `StageRecommendation` to Twin API
6. Twin UI shows recommendation panel: **[Accept] [Reject]**
7. UW accepts → converts to `SetDecision` with agent's rationale + human actor kind

## Core Changes

### New types

```ts
export type AgentStepPhase = "thinking" | "tool_call" | "tool_result" | "message" | "decision";

export interface AgentStep {
  phase: AgentStepPhase;
  content: string;
  metadata?: Record<string, unknown>;
  at: string;
}

export interface PendingRecommendation {
  recommendation: UwDecision;
  rationale: string;
  confidence: number;        // 0..1
  conditions: string[];      // suggested conditions
  trace: AgentStep[];        // full agent reasoning trace
  stagedAt: string;
  stagedBy: string;          // agent id
}
```

Add `pendingRecommendation?: PendingRecommendation` to `Loan`.

### New actions

```ts
| { type: "RecordAgentStep"; loanId: LoanId; step: AgentStep; actor: Actor }
| { type: "StageRecommendation"; loanId: LoanId; recommendation: Omit<PendingRecommendation, "stagedAt" | "stagedBy">; actor: Actor }
| { type: "AcceptRecommendation"; loanId: LoanId; actor: Actor }
| { type: "ClearRecommendation"; loanId: LoanId; actor: Actor }
```

`RecordAgentStep` — pure action-log entry, doesn't mutate loan state beyond the log
`StageRecommendation` — sets `loan.pendingRecommendation`
`AcceptRecommendation` — dispatches internal SetDecision using the pending rec, clears rec
`ClearRecommendation` — clears pending rec without applying

## API Routes

```
POST   /loans/:loanId/agent-step                      # RecordAgentStep
POST   /loans/:loanId/recommendation                  # StageRecommendation  
POST   /loans/:loanId/recommendation/accept           # AcceptRecommendation
DELETE /loans/:loanId/recommendation                  # ClearRecommendation
```

## Agent Service Changes

New `backend/twin_connector.py`:
- `get_loan_from_twin(loan_id) → LoanScenario` (maps NqmProgram → Program + doc_type)
- `post_agent_step(loan_id, phase, content, metadata)` 
- `post_recommendation(loan_id, rec)`

New endpoint `POST /api/twin/underwrite/{loanId}` that orchestrates the full flow.

## Program Mapping

| Twin NqmProgram | Agent Program | doc_type |
|---|---|---|
| BankStatement12 | ALT_FULL | Alt Doc - Personal Bank Stmts |
| BankStatement24 | ALT_FULL | Alt Doc - Business Bank Stmts |
| DSCR | DSCR | DSCR - Long Term Rental |
| AssetDepletion | ALT_FULL | Alt Doc - Asset Utilization |
| 1099Only | ALT_FULL | Alt Doc - 1099 |
| PnL | ALT_FULL | Full Doc |
| FullDocNonQM | ALT_FULL | Full Doc |
| ITIN | ITIN | Full Doc |
| ForeignNational | DSCR | DSCR - Long Term Rental |

## Web UI

- **Run Agent button** on Transmittal page (next to decision bar)
- **Recommendation panel** when `loan.pendingRecommendation` exists — shows rec, confidence, rationale, Accept/Reject buttons
- **Conversation Log** renders `RecordAgentStep` entries with a 🤖 indicator and phase-specific formatting

## Railway Deploy

Third service: `agent` (FastAPI on port 8000 → Railway-assigned PORT). Env vars:
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL=claude-opus-4-6`
- `TWIN_API_URL=https://api-production-8666.up.railway.app`
