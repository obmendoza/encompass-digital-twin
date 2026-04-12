# Slice 3 — 1003/URLA Pages 1–3

**Date:** 2026-04-12
**Status:** Approved
**Depends on:** Slice 1 + Slice 2 (complete)

---

## Purpose

Display the 1003 Uniform Residential Loan Application data across three tabbed pages matching the classic Encompass form layout. Read-only in this slice — the UW references these during underwriting but doesn't typically edit them. Editing is deferred to a future slice if needed.

## Scope

**Page 1 — Borrower & Employment:**
- Borrower information (name, SSN, DOB, marital status)
- Current address (from property summary for owner-occupied; placeholder for mailing)
- Employment (placeholder — full employment model deferred to Slice 4 income analysis)

**Page 2 — Assets & Liabilities:**
- Asset summary (liquid, retirement, reserves)
- Credit summary (rep score, tradelines, last late)
- Liability summary (placeholder for detailed tradeline data — Slice 6)

**Page 3 — Transaction & Declarations:**
- Transaction details (purpose, amounts, LTV/CLTV, rate, term, amort)
- NQM program details (qualifying method, worksheet summary)
- Declaration placeholders (occupancy intent, outstanding judgments — not modeled in core yet, display "N/A")

## Architecture

**No changes to `@twin/core` or `@twin/api`.** All data is already on the `Loan` type and returned by `GET /loans/:id`. This is purely a `@twin/web` routing + UI slice.

**New routes:**
- `/loan/[loanId]/1003/page1` — Borrower & Employment
- `/loan/[loanId]/1003/page2` — Assets & Liabilities  
- `/loan/[loanId]/1003/page3` — Transaction & Declarations

**Modified:**
- `NavTree.tsx` — nav items become links; "1003 Page 1/2/3" entries navigate to the new routes
- Loan layout tabs — add a tab bar showing which 1003 page is active

## UI Spec

Each page uses the same Encompass styling: `enc-sec` sections with navy headers, `enc-grid-8` dense fields, `enc-field` label/value pairs. Same 10px Tahoma type, same 1px borders.

### Page 1 — Borrower & Employment

| Section | Fields (8-col grid) |
|---|---|
| Borrower Information | Full Name, SSN, DOB, Marital Status, Dependents (—), Yrs School (—), Citizenship (—), Email (—) |
| Current Address | Street, City, State, Zip, Own/Rent (—), Years at Address (—), Former Address (—), — |
| Employment | Employer (—), Position (—), Yrs on Job (—), Phone (—), Monthly Income, Self-Employed (Yes for BankStmt/1099/PnL), Yrs in Line (—), — |

Fields marked (—) are not in the current domain model — display "—" as placeholder. They exist in the visual layout for Encompass fidelity.

### Page 2 — Assets & Liabilities

| Section | Fields |
|---|---|
| Assets | Total Liquid, Total Retirement, Reserves (months), Total (computed), Gift Funds (—), Checking (—), Savings (—), Other (—) |
| Credit | Rep Score, Tradelines Open, Tradelines Total, Last Late 30d, Inquiries (—), Collections (—), Public Records (—), Alt Credit (—) |
| Liabilities | Total Monthly Obligations (—), Revolving (—), Installment (—), Mortgage (—), Other (—), Alimony (—), Child Support (—), — |

### Page 3 — Transaction & Declarations

| Section | Fields |
|---|---|
| Transaction Details | Purpose, Loan Amount, Sales Price, Appraised Value, LTV, CLTV, HCLTV, Down Payment (computed), Note Rate, Term, Amort Type, Lien Position, Product, Channel (Retail), Investor (Non-QM), Occupancy |
| NQM Program | Program, Qualifying Method, Derived Monthly Income, Expense Factor, NSF Count, DSCR Ratio, Months Covered, Avg Deposits, Total Assets, Depletion Months, Gross 1099, CPA Net Income |
| Declarations | Occupancy Intent (from occupancy), Outstanding Judgments (—), Bankruptcy (—), Foreclosure (—), Lawsuit (—), Obligations (—), Delinquent (—), US Citizen (—) |

Only show NQM fields relevant to the loan's `qualifyingMethod` — others display "—".

## Testing

- No new unit tests (read-only display)
- Next.js build must pass
- All 3 page routes return 200 for any loan id
