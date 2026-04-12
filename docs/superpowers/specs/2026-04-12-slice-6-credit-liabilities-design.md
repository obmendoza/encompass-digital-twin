# Slice 6 — Credit + Liabilities

**Date:** 2026-04-12
**Status:** Approved
**Depends on:** Slices 1–5 (complete)

---

## Purpose

Provide a dedicated Credit & Liabilities screen showing the borrower's credit profile in detail: tradeline table, liability breakdown, credit scores, and dispute/derogatory flags. In real Encompass this data comes from a credit pull — in the twin we model it as structured data on the loan.

## Scope

### New domain types

Add to `@twin/core` types:

```ts
export interface Tradeline {
  creditorName: string;
  accountType: "Revolving" | "Installment" | "Mortgage" | "Collection" | "Other";
  balance: number;
  monthlyPayment: number;
  limit?: number;
  monthsOpen: number;
  late30: number;
  late60: number;
  late90: number;
  isDisputed: boolean;
}

export interface LiabilitySummary {
  totalMonthlyPayments: number;
  revolvingBalance: number;
  installmentBalance: number;
  mortgageBalance: number;
  collectionsBalance: number;
  totalBalance: number;
}
```

Add to `CreditSummary`:
```ts
tradelines: Tradeline[];
liabilities: LiabilitySummary;
```

### No new actions

Credit data is read-only reference in the UW workflow — pulled at intake, not edited during underwriting. No new reducer actions needed.

### Fixtures

Add 4–6 tradelines and a computed `LiabilitySummary` to each fixture's `credit` field. Vary across scenarios to exercise different credit profiles (clean, thin, derogatory).

### API

No new endpoints. Credit data is already part of `GET /loans/:id` via the `credit` field on `Loan`.

### Web

- New route: `/loan/[loanId]/credit/page.tsx`
- New component: `CreditReport.tsx` — client component with:
  - Score summary section (rep score, score model, credit pulled date placeholder)
  - Tradeline table (creditor, type, balance, payment, limit, utilization, lates, disputed)
  - Liability summary section (totals by type)
  - Derogatory flags section (collections count, disputes, public records)
- NavTree: "Credit" item becomes a link to `/loan/:id/credit`

## UI Spec

### Score Summary Section
| Field | Source |
|---|---|
| Rep Score | credit.repScore (or "n/a" for ForeignNational) |
| Tradelines Open/Total | credit.tradelinesOpen / tradelinesTotal |
| Last Late 30d | credit.lastLate30d |
| Total Monthly Obligations | liabilities.totalMonthlyPayments |
| Total Balance | liabilities.totalBalance |
| Collections | liabilities.collectionsBalance |
| Disputes | count of tradelines where isDisputed |
| Alt Credit Required | "Yes" for ITIN/ForeignNational programs |

### Tradeline Table
| Column | Sortable |
|---|---|
| Creditor | yes |
| Type | yes |
| Balance | yes |
| Monthly Pmt | yes |
| Limit | — |
| Utilization | computed (balance/limit for revolving) |
| 30/60/90 Late | — |
| Disputed | flag |

### Liability Summary
Totals row by account type: revolving, installment, mortgage, collections, other.

## Testing

- No new core action tests (read-only)
- Update fixture manifest test if needed (it checks conditions but not credit shape)
- Next.js build must pass
