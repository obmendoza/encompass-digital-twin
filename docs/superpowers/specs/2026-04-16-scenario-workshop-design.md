# Scenario Workshop — Chat-Driven Loan Generation + Ingestion Pipeline

**Date:** 2026-04-16
**Status:** Approved

---

## Overview

A user-facing "Scenario Workshop" where underwriters or QA teams can:
1. **Chat with Claude** to describe and generate new NQM loan scenarios in natural language
2. **Smart-generate** edge cases with one click
3. **Upload documents** (1003 PDF) or paste raw JSON to ingest new loans
4. **Preview** the generated loan in Encompass format before injecting into the live pipeline
5. **Inject** into the twin with one click — appears in the Pipeline immediately

## Architecture

### Agent Service (new endpoints)

`POST /api/generate-scenario` — Claude generates a complete Loan JSON from a natural language prompt.
- Input: `{ prompt: string, baseScenarioId?: string }` (optional: clone + modify existing)
- Claude is given the full Loan TypeScript schema as context
- Returns: `{ loan: Loan, description: string, edgeCaseNotes?: string }`

`POST /api/generate-batch` — Generate multiple scenarios at once.
- Input: `{ prompt: string, count: number }`
- Returns: `{ scenarios: Array<{ loan: Loan, description: string }> }`

`POST /api/refine-scenario` — Conversational refinement of a previously generated loan.
- Input: `{ loan: Loan, instruction: string }` (e.g., "lower the DSCR to 0.85")
- Returns: `{ loan: Loan, changes: string[] }`

### Twin API (new endpoint)

`POST /world/inject-loan` — Add a custom loan to the current world state.
- Input: `{ loan: Loan }` (full Loan object)
- Validates the shape, assigns scenario metadata, adds to store
- New reducer action: `InjectLoan { loan: Loan }`

### Twin Web (new page)

`/workshop` — Full-page layout with:
- Left panel: Chat interface (messages + input)
- Right panel: Live Loan preview (same Encompass field rendering as transmittal)
- Bottom bar: "Inject into Pipeline" button + status

### Generation Modes (preset prompts)

| Mode | Prompt to Claude |
|---|---|
| Random NQM | "Generate a realistic NQM loan scenario with a random program" |
| Edge Case: [program] | "Generate a challenging edge case for [program] that requires experienced UW judgment" |
| Stress Test | "Generate a scenario that would be borderline for approval — multiple risk factors that nearly offset compensating factors" |
| Clone + Modify | "Here is an existing loan: [JSON]. Modify it so that [instruction]" |
| Batch: UW Training Set | "Generate N diverse NQM scenarios covering all programs with a mix of clean/edge/deny" |

## Schema Context for Claude

The generation endpoint passes the full TypeScript Loan type definition to Claude's system prompt so it generates valid JSON that matches our type system exactly. Includes all sub-types: Borrower, Property, Transaction, Qualifying, Worksheet, Credit (with Tradelines + Liabilities), Conditions, Documents, Appraisal, Compliance, Overlay.
