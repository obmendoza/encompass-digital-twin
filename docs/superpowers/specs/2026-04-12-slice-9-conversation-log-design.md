# Slice 9 — Conversation Log + Audit Surface

**Date:** 2026-04-12
**Status:** Approved
**Depends on:** Slices 1–8

---

## Purpose

Expose the action audit trail as a human-readable Conversation Log — the twin's equivalent of Encompass's conversation log where every action (human or agent) is recorded with timestamp, actor, and description.

## Scope

### No new domain types

The `actionLog: LoggedAction[]` on `WorldState` already captures everything. The `GET /loans/:id/audit` endpoint already exists.

### Web only

- New route: `/loan/[loanId]/log/page.tsx`
- New component: `ConversationLog.tsx` — renders the action log as a timestamped event feed
- NavTree: "Conversation Log" becomes a link

## UI Spec

### Event Feed
Each action log entry rendered as a row:

| Column | Source |
|---|---|
| # | seq |
| Timestamp | at |
| Actor | action.actor.id (with kind badge: 🤖 agent / 👤 human) — or use text "agent"/"human" |
| Action | action.type formatted as readable label |
| Details | Context-specific summary (e.g., "Set decision to approved", "Added condition: Paystubs", "Cleared condition c1") |

Format action details by type:
- LoadScenario → "Loaded scenario: {scenarioId}"
- ResetWorld → "Reset world state"
- OpenLoan → "Opened loan {loanId}"
- SetDecision → "Decision: {decision} — {rationale}"
- AdvanceMilestone → "Milestone: {milestone}"
- RecalculateQualifyingIncome → "Recalculated income: ${derivedMonthlyIncome}"
- AddCondition → "Added condition: {description}"
- UpdateCondition → "Updated condition {conditionId}"
- ClearCondition → "Cleared condition {conditionId}"
- WaiveCondition → "Waived condition {conditionId}: {rationale}"
- RemoveCondition → "Removed condition {conditionId}"
- AddDocument → "Added document: {name}"
- LinkDocument → "Linked document {documentId} to condition {conditionId}"
- UpdateDocumentStatus → "Document {documentId} status → {status}"

### Filters
- By actor kind (All / Human / Agent)
- By action type (All / Conditions / Decisions / Documents / Other)

### Styling
Navy header, alternating rows, 10px type. Actor column uses color coding: agent entries in blue-tint background, human in default.

## Testing

- No new core/api tests
- Next.js build pass
