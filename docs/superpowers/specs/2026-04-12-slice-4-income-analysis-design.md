# Slice 4 — Income Analysis (NQM Method-Specific Worksheets)

**Date:** 2026-04-12
**Status:** Approved
**Depends on:** Slices 1–3 (complete)

---

## Purpose

The income analysis is the heart of NQM underwriting. Each qualifying method has its own worksheet with method-specific fields. This slice adds a dedicated Income Analysis screen where the UW (or agent) can view and recalculate qualifying income using the method-appropriate worksheet. The `RecalculateQualifyingIncome` action already exists in core — this slice adds the UI and wires it end-to-end.

## Scope

- New route: `/loan/[loanId]/income` — Income Analysis page
- Method-specific worksheet display (read + edit):
  - **Bank Statement** (12/24mo): avg deposits, expense factor, NSF count, months covered → derived income
  - **DSCR**: rental income, PITIA, DSCR ratio (computed)
  - **Asset Depletion**: total assets, depletion months → derived income
  - **1099-Only**: gross 1099, expense factor → derived income
  - **P&L (CPA)**: CPA-certified net income → derived income
  - **Traditional Docs** (FullDocNonQM): total monthly income (direct entry)
  - **Foreign National / ITIN**: delegates to the underlying method (DSCR or BankStatement)
- Recalculate button dispatches `RecalculateQualifyingIncome` via server action → api
- Resulting DTI/housing ratio updates visible immediately
- NavTree "Income Analysis" link (under Tools, or add a new entry)

## Architecture

**Core:** No changes — `RecalculateQualifyingIncome` action + `QualifyingIncomeWorksheet` type already exist.

**API:** No changes — `POST /loans/:id/qualifying-income` already exists.

**Web:**
- New server action `actionRecalcIncome` in actions.ts
- New route `/loan/[loanId]/income/page.tsx`
- New client component `IncomeWorksheet.tsx` — renders method-specific fields with inputs, computes derived income, dispatches recalculate
- NavTree update: add "Income Analysis" item under Tools with a link

## UI Spec

**Layout:** Same loan shell (title bar, menu, toolbar, loan header, nav tree). Main pane shows:

1. **Summary bar** — current qualifying method, derived monthly income, housing ratio, total DTI
2. **Method-specific worksheet** — editable fields in an Encompass-style form grid

### Bank Statement Worksheet (BankStatement12, BankStatement24)

| Field | Editable | Notes |
|---|---|---|
| Months Covered | yes | 12 or 24 |
| Avg Monthly Deposits | yes | Currency |
| Expense Factor | yes | 0–1, displayed as % |
| NSF Count | yes | Integer |
| Derived Monthly Income | computed | avgDeposits × (1 - expenseFactor) |

### DSCR Worksheet

| Field | Editable | Notes |
|---|---|---|
| Monthly Rental Income | yes | Currency |
| Monthly PITIA | read-only | From transaction |
| DSCR Ratio | computed | rental / PITIA |
| Derived Monthly Income | fixed 0 | DSCR doesn't derive personal income |

Note: For DSCR, `derivedMonthlyIncome` is set to `rentalIncome` as a convention so the action doesn't reject it (must be > 0). DTI shows 0/0 since DSCR qualifies on rent coverage, not personal income ratios.

### Asset Depletion Worksheet

| Field | Editable | Notes |
|---|---|---|
| Total Eligible Assets | yes | Currency |
| Depletion Period (months) | yes | 60 or 84 typical |
| Derived Monthly Income | computed | totalAssets / depletionMonths |

### 1099-Only Worksheet

| Field | Editable | Notes |
|---|---|---|
| Annual Gross 1099 | yes | Currency |
| Expense Factor | yes | 0–1, displayed as % |
| Derived Monthly Income | computed | (gross1099 / 12) × (1 - expenseFactor) |

### P&L (CPA) Worksheet

| Field | Editable | Notes |
|---|---|---|
| CPA-Certified Net Income | yes | Annual, currency |
| Derived Monthly Income | computed | cpaCertifiedNetIncome / 12... wait, it's already monthly in the type |

Actually looking at the type: `cpaCertifiedNetIncome` — treat as monthly. Derived = cpaCertifiedNetIncome.

### Traditional Docs (FullDocNonQM)

| Field | Editable | Notes |
|---|---|---|
| Total Monthly Income | yes | Direct entry |
| Derived Monthly Income | = totalMonthlyIncome | Same value |

### Foreign National / ITIN

These use the underlying method's worksheet (DSCR for ForeignNational, BankStatement for ITIN). The component checks `loan.qualifyingMethod` and renders the matching worksheet.

## Recalculate Flow

1. UW edits worksheet fields in the form
2. Client computes `derivedMonthlyIncome` live as fields change
3. UW clicks "Recalculate" button
4. Server action calls `POST /loans/:id/qualifying-income` with the full worksheet
5. Page revalidates — updated ratios visible in the summary bar and loan header

## Testing

- No new core/api tests (action + endpoint already tested)
- Next.js build must pass
- Smoke: edit income worksheet, click Recalculate, verify DTI updates
