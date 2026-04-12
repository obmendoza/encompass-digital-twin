# Agent Integration Guide — Encompass Digital Twin

## Overview

The Encompass Digital Twin is an HTTP-driven sandbox for NQM underwriting. AI agents interact with it through a REST API, performing the same actions a human underwriter would: reading loan data, managing conditions, reviewing documents, and recording decisions.

## Quick Start

```bash
# Start the API server
cd packages/api && corepack pnpm exec tsx src/server.ts
# API is now at http://localhost:4000

# Start the web UI (optional — for observing agent actions)
cd packages/web && corepack pnpm dev
# UI is at http://localhost:3000
```

## API Base URL

```
http://localhost:4000
```

All endpoints accept and return `application/json`. No authentication required (local sandbox).

## OpenAPI Spec

```
GET /openapi.json
```

Machine-readable API contract. Feed this to your agent framework.

## Core Workflow

An agent typically follows this workflow:

### 1. Load a scenario

```bash
curl -X POST http://localhost:4000/world/load-scenario \
  -H "content-type: application/json" \
  -d '{"scenarioId": "nqm-bankstmt-12mo-clean"}'
```

Available scenarios:
| ID | Program | Description |
|---|---|---|
| nqm-bankstmt-12mo-clean | BankStatement12 | Self-employed happy path |
| nqm-bankstmt-24mo-business | BankStatement24 | Business bank statements + NSF |
| nqm-dscr-investor-purchase | DSCR | Investor property, DSCR 1.18 |
| nqm-dscr-sub-1 | DSCR | Sub-1.0 DSCR, pricing decision |
| nqm-asset-depletion | AssetDepletion | High-asset borrower |
| nqm-1099-only | 1099Only | Freelancer |
| nqm-pnl-only-cpa | PnL | CPA-certified P&L |
| nqm-foreign-national | ForeignNational | No US credit, DSCR-qualified |
| nqm-itin-bankstmt | ITIN | ITIN + alt credit |
| nqm-full-doc-recent-bk | FullDocNonQM | BK seasoning overlay |
| nqm-suspend-candidate | BankStatement12 | Tight DTI + NSF — should suspend |
| nqm-deny-candidate | DSCR | DSCR 0.72 + late — should deny |

### 2. Read the loan

```bash
curl http://localhost:4000/loans/2501000101
```

Returns the full `Loan` object including: borrower, property, transaction, qualifying ratios, income worksheet, assets, credit (with tradelines), conditions, documents, appraisal, compliance, program overlay.

### 3. Review conditions

```bash
curl http://localhost:4000/loans/2501000101/conditions
```

### 4. Perform underwriting actions

Every mutation requires an `actor` object:
```json
{ "kind": "agent", "id": "my-agent-name" }
```

**Clear a condition:**
```bash
curl -X POST http://localhost:4000/loans/2501000101/conditions/c1/clear \
  -H "content-type: application/json" \
  -d '{"notes": "Verified bank statements", "actor": {"kind": "agent", "id": "uw-bot"}}'
```

**Add a condition:**
```bash
curl -X POST http://localhost:4000/loans/2501000101/conditions \
  -H "content-type: application/json" \
  -d '{"condition": {"category": "PTD", "source": "UW", "description": "Additional 3 months statements"}, "actor": {"kind": "agent", "id": "uw-bot"}}'
```

**Waive a condition (requires rationale):**
```bash
curl -X POST http://localhost:4000/loans/2501000101/conditions/c2/waive \
  -H "content-type: application/json" \
  -d '{"rationale": "Compensating factor: high reserves", "actor": {"kind": "agent", "id": "uw-bot"}}'
```

**Recalculate qualifying income:**
```bash
curl -X POST http://localhost:4000/loans/2501000101/qualifying-income \
  -H "content-type: application/json" \
  -d '{"worksheet": {"method": "BankStatementDeposits", "monthsCovered": 12, "avgDeposits": 18000, "expenseFactor": 0.5, "derivedMonthlyIncome": 9000}, "actor": {"kind": "agent", "id": "uw-bot"}}'
```

**Add a document:**
```bash
curl -X POST http://localhost:4000/loans/2501000101/documents \
  -H "content-type: application/json" \
  -d '{"doc": {"name": "Bank Statements Q1.pdf", "docType": "BankStatement"}, "actor": {"kind": "agent", "id": "uw-bot"}}'
```

### 5. Record decision

```bash
curl -X POST http://localhost:4000/loans/2501000101/decision \
  -H "content-type: application/json" \
  -d '{"decision": "approved", "rationale": "All conditions cleared, DTI within guidelines, FICO 742", "actor": {"kind": "agent", "id": "uw-bot"}}'
```

Decision values: `pending`, `approved`, `suspended`, `counter`, `denied`

### 6. Review audit trail

```bash
curl http://localhost:4000/loans/2501000101/audit
```

Returns the complete action log with timestamps, actor info, and action details.

## Error Handling

Errors return HTTP 400 with a structured body:
```json
{
  "code": "INVALID_TRANSITION",
  "message": "cannot clear a Waived condition",
  "details": { "from": "Waived" }
}
```

Error codes:
- `LOAN_NOT_FOUND` — invalid loan ID
- `CONDITION_NOT_FOUND` — invalid condition ID
- `DOCUMENT_NOT_FOUND` — invalid document ID
- `SCENARIO_NOT_FOUND` — invalid scenario ID
- `INVALID_TRANSITION` — illegal state change (e.g., clearing a waived condition)
- `REQUIRED_FIELD_MISSING` — missing rationale or other required field
- `ACTION_FORBIDDEN_IN_DECISION_STATE` — cannot modify conditions on a denied loan

## Actor Convention

Every mutation carries an `actor` field:
```json
{ "kind": "agent", "id": "your-agent-name" }
```

This is recorded in the audit log. Use a descriptive `id` so the conversation log shows who did what.

## Reset

```bash
# Reset world and reload all 12 scenarios
curl -X POST http://localhost:4000/world/reset
# Then reload:
curl -X POST http://localhost:4000/world/load-scenario -H "content-type: application/json" -d '{"scenarioId": "nqm-bankstmt-12mo-clean"}'
# ... repeat for each scenario, or restart the server (it preloads all at boot)
```

## Determinism

The entire system is deterministic. Same scenario + same action sequence = same final state. The replay invariant is tested: you can extract the action log and replay it from scratch to reproduce any state.
