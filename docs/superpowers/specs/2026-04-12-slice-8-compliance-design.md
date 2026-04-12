# Slice 8 — Compliance Snapshot

**Date:** 2026-04-12
**Status:** Approved
**Depends on:** Slices 1–7 (complete)

---

## Purpose

Display compliance flags relevant to NQM underwriting: ATR/QM status, HPML/HOEPA indicators, TRID tolerance checks, state-level high-cost test results, and ability-to-repay considerations. Read-only reference — compliance engines run at intake, the UW reviews the results.

## Scope

### New domain types

```ts
export interface ComplianceSnapshot {
  qmStatus: "QM-Safe Harbor" | "QM-Rebuttable" | "Non-QM" | "Exempt";
  atrCompliant: boolean;
  hpml: boolean;
  hoepa: boolean;
  higherPricedCoveredTransaction: boolean;
  stateLicenseRequired: boolean;
  stateHighCostTest: "Pass" | "Fail" | "N/A";
  tridToleranceCure: "None" | "10%" | "Unlimited";
  totalPointsAndFees: number;
  pointsAndFeesThreshold: number;
  pointsAndFeesPass: boolean;
  flags: ComplianceFlag[];
}

export interface ComplianceFlag {
  code: string;
  severity: "Info" | "Warning" | "Violation";
  description: string;
  regulation: string;
}
```

Add `compliance: ComplianceSnapshot` to `Loan`.

### No new actions — read-only

### Fixtures

Add `compliance` to all 12 scenarios. NQM loans are Non-QM by definition. Vary flags:
- Most: Non-QM, ATR compliant, not HPML, not HOEPA, state test pass, 1-2 Info flags
- Deny candidate: ATR non-compliant flag, HPML true, Warning flags
- Foreign national: additional state license flag
- High LTV scenarios: more flags

### Web

- New route: `/loan/[loanId]/compliance/page.tsx`
- New component: `ComplianceReport.tsx`
- NavTree: add "Compliance" link

## UI Spec

### Status Summary (enc-grid-8)
QM Status (pill colored by type), ATR Compliant (Yes/No pill), HPML, HOEPA, State High-Cost, TRID Tolerance, Points & Fees (amount vs threshold with pass/fail)

### Compliance Flags Table
| Column | Notes |
|---|---|
| Code | e.g. "ATR-001" |
| Severity | Color pill: Info (blue), Warning (gold), Violation (red) |
| Description | |
| Regulation | e.g. "12 CFR 1026.43" |

### NQM-Specific Section
Notes about why this loan is Non-QM (derived from nqmProgram), ATR safe harbor considerations for non-QM.

## Testing

- No new core tests
- Update test helpers with compliance field
- Next.js build pass
