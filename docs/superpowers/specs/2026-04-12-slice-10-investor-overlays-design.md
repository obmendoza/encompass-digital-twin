# Slice 10 — Investor/Program Overlays

**Date:** 2026-04-12
**Status:** Approved
**Depends on:** Slices 1–9

---

## Purpose

Display NQM investor/program guidelines and overlay checks — the rules that determine eligibility for each NQM program. Shows which guidelines the loan passes/fails, giving the UW a quick eligibility summary and highlighting exceptions that need conditions or waivers.

## Scope

### New domain types

```ts
export interface GuidelineCheck {
  category: "LTV" | "FICO" | "DTI" | "Reserves" | "DSCR" | "Seasoning" | "Property" | "Income" | "Occupancy" | "Other";
  rule: string;
  threshold: string;
  actual: string;
  result: "Pass" | "Fail" | "Exception" | "N/A";
  notes?: string;
}

export interface ProgramOverlay {
  programName: string;
  investorName: string;
  maxLTV: number;
  minFICO: number | null;
  maxDTI: number | null;
  minDSCR: number | null;
  minReserves: number;
  checks: GuidelineCheck[];
}
```

Add `overlay: ProgramOverlay` to `Loan`.

### No new actions — read-only

### Fixtures

Add `overlay` to all 12 scenarios with program-specific guidelines:
- Bank Statement: LTV ≤ 90, FICO ≥ 660, DTI ≤ 50, reserves ≥ 6mo
- DSCR: LTV ≤ 80, FICO ≥ 620, DSCR ≥ 0.75 (sub-1.0 pricing hit), reserves ≥ 6mo
- Asset Depletion: LTV ≤ 70, FICO ≥ 700, reserves ≥ 12mo
- 1099: LTV ≤ 85, FICO ≥ 680, DTI ≤ 50
- P&L: LTV ≤ 80, FICO ≥ 700, DTI ≤ 45
- Foreign National: LTV ≤ 70, no FICO requirement, DSCR ≥ 1.0
- ITIN: LTV ≤ 80, FICO ≥ 660
- Full Doc Non-QM: LTV ≤ 75 (BK seasoning), FICO ≥ 660

Each fixture's checks compare actual loan values against the thresholds, pre-computed as Pass/Fail/Exception.

### Web

- New route: `/loan/[loanId]/overlays/page.tsx`
- New component: `ProgramOverlayReport.tsx` — program summary + guideline check table
- NavTree: add "Program Overlays" under Services or Tools

## UI Spec

### Program Summary Section (enc-grid-8)
Program Name, Investor, Max LTV, Min FICO, Max DTI, Min DSCR, Min Reserves, Overall (Pass/Fail count)

### Guideline Checks Table
| Column | Notes |
|---|---|
| Category | LTV, FICO, DTI, etc. |
| Rule | e.g. "Max LTV 90%" |
| Threshold | "≤ 90%" |
| Actual | "80.00%" |
| Result | Pass (green), Fail (red), Exception (gold), N/A (gray) |
| Notes | Exception rationale if any |

### Eligibility Summary
"X of Y guidelines pass. Z exceptions require conditions/waivers."

## Testing

- No new core tests
- Update test helpers
- Next.js build pass
