# Slice 7 — Appraisal / Property

**Date:** 2026-04-12
**Status:** Approved
**Depends on:** Slices 1–6 (complete)

---

## Purpose

The Appraisal/Property screen gives the UW a consolidated view of the subject property details, appraised value analysis, comparable sales, and property-related condition flags. In real Encompass this integrates with appraisal management companies — in the twin we model it as structured data on the loan.

## Scope

### New domain types

Add to `@twin/core` types:

```ts
export interface ComparableSale {
  address: string;
  salePrice: number;
  saleDate: string;
  sqft: number;
  distance: string;
  adjustedValue: number;
}

export interface AppraisalDetails {
  appraisalDate: string;
  appraiserName: string;
  appraisalType: "Full" | "Exterior-Only" | "Desktop" | "Hybrid";
  appraisedValue: number;
  marketCondition: "Stable" | "Increasing" | "Declining";
  neighborhoodRating: "Good" | "Average" | "Fair" | "Poor";
  siteArea: string;
  grossLivingArea: number;
  roomCount: number;
  bedroomCount: number;
  bathroomCount: number;
  garageSpaces: number;
  condition: "Good" | "Average" | "Fair" | "Poor";
  comparables: ComparableSale[];
  notes?: string;
}
```

Add `appraisal: AppraisalDetails` to the `Loan` interface (after `credit`).

### No new actions

Appraisal data is read-only reference. No new reducer actions.

### Fixtures

Add an `appraisal` object to each fixture with plausible property data and 3 comparable sales per loan. Vary by scenario (SFR vs condo comps, different market conditions, different appraisal types — desktop for DSCR investor, full for purchase primary).

### API

No new endpoints. Appraisal data travels with `GET /loans/:id`.

### Web

- New route: `/loan/[loanId]/appraisal/page.tsx`
- New component: `AppraisalReport.tsx` — displays property details, value reconciliation, comparables table, and condition flags
- NavTree: add "Appraisal" link under Services

## UI Spec

### Property Details Section (enc-grid-8)
Appraised Value, Appraisal Date, Appraiser, Type, Market Condition, Neighborhood, Site Area, GLA (sqft), Rooms, Bedrooms, Bathrooms, Garage, Condition, Notes

### Value Reconciliation Section
| Field | Value |
|---|---|
| Appraised Value | from appraisal |
| Sales Price | from transaction |
| Difference | computed |
| Value Flag | "At Value", "Above Sales Price", or "Below Sales Price" |

### Comparables Table
| Column | Notes |
|---|---|
| # | 1-3 |
| Address | |
| Sale Price | currency |
| Sale Date | |
| Sq Ft | |
| Distance | |
| Adj Value | currency |
| Adj Diff | computed vs appraised |

### Subject Property Section (from existing property data)
Street, City, State, Zip, Type, Units, Year Built, Occupancy

## Testing

- No new core tests (read-only)
- Update test loan helpers with `appraisal` field
- Next.js build pass
