# Encompass Digital Twin — Design Spec (Slice 1)

**Date:** 2026-04-11
**Status:** Approved design, pending implementation plan
**Scope of this document:** Full-parity North Star + detailed design for Slice 1 (Transmittal Summary + Conditions)

---

## 1. Purpose

Build a browser-based digital twin of Encompass LOS underwriting screens, reconstructed from public ICE Mortgage Technology documentation, so that:

1. **AI agents can perform underwriting tasks** against a deterministic, scriptable sandbox (primary purpose).
2. **Human underwriters can use the same UI** to perform the same underwriting tasks, indistinguishably from agents.

The twin is focused on **NQM (Non-Qualified Mortgage)** loans — bank statement, DSCR, asset depletion, 1099-only, P&L, foreign national, ITIN, and full-doc non-QM paths.

## 2. North Star & Slicing Strategy

**North Star:** full parity with all underwriting-related screens in Encompass LOS.

**Why slice:** full parity is a multi-subsystem effort (dozens of screens, multiple data models, distinct rule engines). A monolithic spec would collapse under its own weight. Instead, each slice is a shippable vertical: new core types + actions + UI routes + fixtures + tests.

**Slice 1 (this spec):** Transmittal Summary + Conditions — the underwriter's decision cockpit.

**Future slices (roadmap only — each gets its own spec when we reach it):**

1. Transmittal Summary + Conditions (Slice 1, this spec)
2. Pipeline view + Loan open/navigate
3. 1003 / URLA Pages 1–3
4. Income Analysis (NQM method-specific worksheets)
5. eFolder + document tracking
6. Credit + Liabilities
7. Appraisal / Property
8. Compliance snapshot (HPML/HOEPA/QM, TRID — NQM subset)
9. Conversation Log + audit surface
10. Investor/Program overlays (NQM product matrix)

Each slice only touches `core` (additive) plus new UI routes. The architecture is designed so slices compose without rework.

## 3. Non-Goals

- No connection to a live Encompass instance (read or write). All data is simulated.
- No database or persistent store in Slice 1. In-memory state only.
- No multi-user auth. Local sandbox; the `actor` field in actions is trusted.
- No attempt at pixel-perfect fidelity — the target is "visually indistinguishable to a trained UW at a glance," reconstructed from public ICE docs.
- No mobile / responsive design. Desktop-class screens only, matching Encompass form factor.

## 4. Users & Success Criteria

**Users:**

- **AI agents** driving the twin via HTTP API for sandbox/automation tasks.
- **Human underwriters** using the web UI for the same tasks.

**Success criteria for Slice 1:**

- A scripted agent can load any NQM fixture scenario, read the Transmittal Summary over HTTP, add/update/clear/waive conditions, and record a decision — without the UI being involved.
- A human UW, seeing the UI for the first time, recognizes it as Encompass-flavored and can perform the same workflow without training.
- The action log for any loan is sufficient to replay it from scratch and land at bitwise-identical state. This is a hard invariant.
- 100% branch coverage on `core.reduce`. Every error code path tested.

## 5. Architecture

### 5.1 Components

```
┌─────────────────────────────────────────────────┐
│                 packages/core                    │
│  ┌────────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ Domain     │  │ State    │  │ Action       │ │
│  │ types      │──│ store    │──│ handlers     │ │
│  │ (Loan,     │  │ (in-mem, │  │ (pure fns    │ │
│  │ Condition) │  │ reset)   │  │  reduce)     │ │
│  └────────────┘  └──────────┘  └──────────────┘ │
└─────────────────────┬───────────────────────────┘
                      │
         ┌────────────┴────────────┐
         │                         │
┌────────▼────────┐       ┌────────▼─────────┐
│  packages/api   │       │  packages/web    │
│  Fastify server │       │  Next.js 15 +    │
│                 │       │  shadcn + Tw     │
└────────┬────────┘       └────────┬─────────┘
         │                         │
    AI agents                  Human UW
```

**Monorepo layout:**

```
encompass-twin/
├─ packages/
│  ├─ core/        # Domain model, fixtures loader, state store, reduce
│  ├─ api/         # Fastify HTTP server — thin wrapper over core
│  ├─ web/         # Next.js UI — thin wrapper over core
│  └─ fixtures/    # NQM loan JSON scenarios + expected golden states
```

- `core` is the only place business logic lives. Both `api` and `web` depend on it and are thin.
- `web` imports `core` directly (Next.js server actions) rather than going through `api` over the wire. This guarantees human clicks and agent API calls execute the same reducer on the same in-process state.
- `fixtures` is a static package — JSON files loaded synchronously.

### 5.2 State ownership

- **Single in-memory `WorldState`** keyed by `loanId`, with a current loaded scenario id.
- `POST /world/load-scenario { scenarioId }` rehydrates the store from a fixture.
- `POST /world/reset` discards all mutations and reloads the current scenario.
- No per-session isolation in Slice 1. A later slice can add a session header + store keyed by session id without touching `reduce`.

### 5.3 Growth seam

Every future slice extends the system by:

1. Adding fields to domain types in `core/types.ts`.
2. Adding variants to the `Action` union in `core/actions.ts`.
3. Adding cases to `reduce`.
4. Adding HTTP endpoints that call those actions.
5. Adding UI routes that render the new data and dispatch the new actions.
6. Adding fixtures that exercise the new paths.

No architectural changes required per slice.

## 6. Domain Model (Slice 1)

```ts
type LoanId = string;       // e.g. "2501000123"
type ConditionId = string;

type NqmProgram =
  | 'BankStatement12' | 'BankStatement24'
  | 'DSCR'
  | 'AssetDepletion'
  | '1099Only' | 'PnL'
  | 'ForeignNational' | 'ITIN'
  | 'FullDocNonQM';

type QualifyingMethod =
  | 'BankStatementDeposits'
  | 'DSCRCoverage'
  | 'AssetDepletionMonths'
  | '1099Gross'
  | 'PnLCPACertified'
  | 'TraditionalDocs';

interface Loan {
  id: LoanId;
  nqmProgram: NqmProgram;
  qualifyingMethod: QualifyingMethod;
  borrower: BorrowerSummary;
  property: PropertySummary;
  transaction: TransactionDetails;
  qualifying: QualifyingRatios;
  qualifyingWorksheet: QualifyingIncomeWorksheet;
  income: IncomeSummary;          // summary totals only in Slice 1
  assets: AssetSummary;
  credit: CreditSummary;
  aus?: AusResult;                // optional — most NQM is manual UW
  conditions: Condition[];
  decision: UwDecision;           // 'pending'|'approved'|'suspended'|'counter'|'denied'
  milestones: Milestone[];
}

interface TransactionDetails {
  loanPurpose: 'Purchase' | 'Refi-RT' | 'Refi-CO';
  loanAmount: number;
  salesPrice?: number;
  appraisedValue: number;
  ltv: number; cltv: number; hcltv: number;
  noteRate: number; term: number;
  amortType: 'Fixed' | 'ARM';
  lienPosition: 1 | 2;
  occupancy: 'Primary' | 'Second' | 'Investment';
  isInvestmentProperty: boolean;
  rentalIncome?: number;          // DSCR path
  piti: number;
  pitia?: number;                 // used by DSCR
  dscrRatio?: number;
}

interface QualifyingIncomeWorksheet {
  method: QualifyingMethod;
  // BankStatement
  monthsCovered?: number;
  avgDeposits?: number;
  expenseFactor?: number;         // 0..1
  nsfCount?: number;
  // DSCR
  dscrNumerator?: number;         // rent
  dscrDenominator?: number;       // PITIA
  // AssetDepletion
  totalAssets?: number;
  depletionMonths?: number;       // e.g. 60 or 84
  // 1099
  gross1099?: number;
  // PnL
  cpaCertifiedNetIncome?: number;
  // Result
  derivedMonthlyIncome: number;
}

interface Condition {
  id: ConditionId;
  category: 'PTA' | 'PTD' | 'PTF' | 'PTP';
  source: 'UW' | 'AUS' | 'Compliance' | 'Investor';
  description: string;
  status: 'Open' | 'Requested' | 'Received' | 'Cleared' | 'Waived';
  addedBy: string;
  addedAt: string;        // ISO
  clearedBy?: string;
  clearedAt?: string;
  notes?: string;
}

type UwDecision = 'pending' | 'approved' | 'suspended' | 'counter' | 'denied';

interface Actor { kind: 'human' | 'agent'; id: string; }
```

Supporting structs (`BorrowerSummary`, `PropertySummary`, `QualifyingRatios`, `IncomeSummary`, `AssetSummary`, `CreditSummary`, `AusResult`, `Milestone`) follow Encompass field naming conventions; their exact shapes are finalized during implementation in `core/types.ts`.

## 7. Action Catalog (Slice 1)

Every mutation goes through `reduce(state, action) -> newState`. Humans and agents share the same action list.

```ts
type Action =
  // Scenario / lifecycle
  | { type: 'LoadScenario';   scenarioId: string }
  | { type: 'ResetWorld' }

  // Transmittal-level
  | { type: 'OpenLoan';           loanId: LoanId; actor: Actor }
  | { type: 'SetDecision';        loanId: LoanId; decision: UwDecision; rationale: string; actor: Actor }
  | { type: 'AdvanceMilestone';   loanId: LoanId; milestone: string; actor: Actor }
  | { type: 'RecalculateQualifyingIncome';
      loanId: LoanId; worksheet: QualifyingIncomeWorksheet; actor: Actor }

  // Conditions
  | { type: 'AddCondition';       loanId: LoanId; condition: NewCondition; actor: Actor }
  | { type: 'UpdateCondition';    loanId: LoanId; conditionId: ConditionId; patch: Partial<Condition>; actor: Actor }
  | { type: 'ClearCondition';     loanId: LoanId; conditionId: ConditionId; notes?: string; actor: Actor }
  | { type: 'WaiveCondition';     loanId: LoanId; conditionId: ConditionId; rationale: string; actor: Actor }
  | { type: 'RemoveCondition';    loanId: LoanId; conditionId: ConditionId; actor: Actor };
```

**Rules:**

- `reduce` is pure and synchronous. No network, timers, randomness, or I/O inside it.
- Every action carries an `Actor`. The milestones/audit log is derived from the action sequence.
- Validation lives inside `reduce`. Invalid actions throw a typed `ActionError`.
- Extending for future slices = adding action variants. The `Action` union is the primary growth seam.

## 8. HTTP API Surface

Thin Fastify server. Every endpoint is a 1:1 wrapper around a `core` action or query.

**Queries (read-only):**

```
GET    /health
GET    /scenarios                     → [{ id, name, description }]
GET    /loans                         → pipeline summary rows
GET    /loans/:loanId                 → full Loan
GET    /loans/:loanId/conditions      → Condition[]
GET    /loans/:loanId/audit           → action log
```

**Commands (mutations):**

```
POST   /world/load-scenario                     { scenarioId }
POST   /world/reset
POST   /loans/:loanId/decision                  { decision, rationale, actor }
POST   /loans/:loanId/milestone                 { milestone, actor }
POST   /loans/:loanId/qualifying-income         { worksheet, actor }
POST   /loans/:loanId/conditions                { condition, actor }
PATCH  /loans/:loanId/conditions/:cid           { patch, actor }
POST   /loans/:loanId/conditions/:cid/clear     { notes?, actor }
POST   /loans/:loanId/conditions/:cid/waive     { rationale, actor }
DELETE /loans/:loanId/conditions/:cid           { actor }
```

**Conventions:**

- JSON everywhere. Zod schemas validate all payloads at the edge.
- Errors are structured: `400 { code, message, details }`, derived directly from thrown `ActionError`s. `500` with a request id for unknown failures.
- No auth in Slice 1. The `actor.id` field is trusted from the request body.
- OpenAPI spec is generated from the Zod schemas so agents get a machine-readable contract.
- Every command response returns the new state hash so agents can detect drift.

## 9. UI (Slice 1)

**Stack:** Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui primitives, styled to match Classic Encompass look-and-feel.

**Fidelity target:** "visually indistinguishable to a trained UW at a glance." Reference mockup locked during brainstorming (see `.superpowers/brainstorm/…/content/slice1-transmittal-v2.html`).

**Visual conventions:**

- Navy gradient section headers (`#0a52a0` → `#08407d`).
- 8-column dense data grids with 1px borders (`#6b7a8f`) and 10–11px Tahoma/Segoe UI type.
- Classic Windows-style menu bar, toolbar, and dialog modals.
- Gold-highlighted active nav item (`#ffd77a` with `#c79b2d` border).
- Beige outer chrome (`#ece9d8`), white form surfaces.
- Gold primary-action buttons (`#ffe28a` → `#d79a1f`).

**Screens in Slice 1:**

- **Loan Shell** — outer chrome: title bar, menu bar, toolbar, loan header strip (borrower, loan #, amount, LTV, DTI, milestone), left nav tree (Loan / Forms / Tools / Services), main pane.
- **Transmittal Summary (Page 1)** — three sections: Borrower & Property, Mortgage Information, Qualifying Ratios & AUS. Decision bar (Approve / Suspend / Counter / Deny) with current decision indicator.
- **Conditions panel** — table with # / Category / Source / Description / Status / Added / By columns. Status pills (Open, Received, Cleared, Waived). Add-condition modal.

**State flow:**

- Server components fetch from `core` directly (no round-trip through `api`).
- Mutations use Next.js Server Actions that import `core.reduce`.
- Optimistic updates not needed in Slice 1 — everything is in-process.

**Error display:** Classic Encompass-style modal dialog (gray, navy title bar) for any `ActionError` — not toasts.

## 10. Fixture Scenarios (Slice 1)

Deterministic NQM loans, each with a starting condition set emitted by AUS/Compliance at intake.

| id | program | LTV | FICO | qualifying method | notes |
|---|---|---|---|---|---|
| `nqm-bankstmt-12mo-clean` | 12-mo Personal Bank Stmt | 80 | 720 | avg deposits × use factor | self-employed happy path |
| `nqm-bankstmt-24mo-business` | 24-mo Business Bank Stmt | 75 | 700 | NSF count, expense factor | expense ratio + NSF tolerance |
| `nqm-dscr-investor-purchase` | DSCR Investor | 75 | 740 | rent / PITIA | investor property, no personal income |
| `nqm-dscr-sub-1.0` | DSCR Investor (sub-1.0) | 70 | 760 | DSCR 0.85 | forces pricing overlay decision |
| `nqm-asset-depletion` | Asset Utilization | 65 | 730 | assets ÷ 60 mo | no employment income |
| `nqm-1099-only` | 1099-Only (2yr) | 80 | 710 | gross 1099 × expense factor | freelancer |
| `nqm-pnl-only-cpa` | P&L Only w/ CPA Letter | 75 | 720 | CPA-prepared P&L | CPA license verification condition |
| `nqm-foreign-national` | Foreign National DSCR | 65 | n/a | DSCR + reserves | no US credit |
| `nqm-itin-bankstmt` | ITIN Bank Statement | 80 | 690 | ITIN ID path | alt credit + ITIN letter conditions |
| `nqm-full-doc-recent-bk` | Full Doc Non-QM (BK < 4yr) | 70 | 680 | trad income | BK seasoning + LOX conditions |
| `nqm-suspend-candidate` | 12-mo Bank Stmt | 85 | 680 | tight DTI + NSF flags | should be suspended |
| `nqm-deny-candidate` | DSCR Investor | 80 | 660 | DSCR 0.72 + recent late | should be denied |

Each fixture file: `packages/fixtures/<id>.json` (loan snapshot + starting conditions). Optional golden end-state: `packages/fixtures/<id>.expected.json` for agent run verification.

## 11. Error Handling

- `ActionError { code, message, details }` is the only error type thrown by `reduce`.
- Error codes (Slice 1): `LOAN_NOT_FOUND`, `CONDITION_NOT_FOUND`, `INVALID_TRANSITION`, `SCENARIO_NOT_FOUND`, `REQUIRED_FIELD_MISSING`, `ACTION_FORBIDDEN_IN_DECISION_STATE`.
- HTTP layer maps `ActionError` → `400` with identical code/message. Unknown errors → `500` with a request id.
- UI renders errors in a modal dialog styled to match Encompass.
- No silent failures: bad agent actions return structured errors, never no-ops.
- **Replay invariant:** driving a loan through its action log from a fresh fixture load produces bitwise-identical state.

## 12. Testing Strategy

- **Unit tests on `reduce`**: every action × every error code. 100% branch coverage target in `core`.
- **Fixture golden tests**: each fixture + a scripted agent run → asserted against golden end-state file. Drift = regression.
- **HTTP contract tests**: live Fastify server, every endpoint with valid and invalid payloads, assert status codes and response shapes against Zod schemas.
- **UI component tests** (Vitest + Testing Library): Transmittal sections render expected values; condition table renders each status pill variant; decision bar dispatches correct actions.
- **Agent acceptance test** (Slice 1 exit criterion): a mock HTTP agent drives `nqm-bankstmt-12mo-clean` end-to-end — `LoadScenario` → read Transmittal → add standard PTD conditions → `SetDecision: approved` — and the final state matches the golden file.
- **No Encompass integration tests.** There is no live Encompass.

## 13. Open Questions

None blocking Slice 1 implementation. Deferred to their respective future slice specs:

- Pipeline filter/sort semantics (Slice 2).
- Full income/asset/credit analysis data model (Slices 4 and 6).
- Document storage for eFolder (Slice 5).
- Multi-session isolation + auth (post-roadmap if needed).

## 14. Related Artifacts

- `~/Desktop/safeboxiq-nqm-underwriting-dashboard.html` — possible prior-art reference (not yet reviewed).
- `~/Downloads/smart1003-underwriter-main.zip` — possible prior-art reference (not yet reviewed).
- `.superpowers/brainstorm/52681-1775909153/content/slice1-transmittal-v2.html` — locked fidelity reference mockup.
- `.superpowers/brainstorm/52681-1775909153/content/palette-options.html` — palette comparison (Classic Encompass navy selected).
