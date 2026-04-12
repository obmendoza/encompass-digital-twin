# Slice 2 — Pipeline View + Loan Navigation

**Date:** 2026-04-12
**Status:** Approved
**Depends on:** Slice 1 (complete)

---

## Purpose

Give the digital twin an entry point: a Pipeline screen listing all loaded loans so a UW or agent can pick one. Currently the UI hardcodes a redirect to loan `2501000101` — this replaces that with a proper pipeline table.

## Scope

- Pipeline table at `/` showing all loans in the store
- Click a row → navigate to `/loan/:id/transmittal`
- Column sorting (client-side, all data in-memory)
- Filter by decision status and NQM program
- Toolbar "Pipeline" button links back to `/`
- Classic Encompass grid styling (navy headers, 1px borders, alternating rows)

## Non-Goals

- No pagination (12 fixtures; in-memory store)
- No server-side sort/filter (all client-side)
- No new core actions or api endpoints (GET /loans already exists)

## Architecture

No changes to `@twin/core` or `@twin/api`. This is purely a `@twin/web` slice:

- Replace `app/page.tsx` (redirect) → pipeline server component fetching `api.listLoans()`
- New client component `PipelineTable` with sort + filter
- Toolbar "Pipeline" button becomes `<Link href="/">`
- Pipeline shell wraps the page with TitleBar + MenuBar + Toolbar (no loan header or nav tree — those belong to the loan shell)

## UI Spec

**Pipeline table columns:**

| Column | Field | Sortable | Notes |
|---|---|---|---|
| Loan # | id | yes | Link to /loan/:id/transmittal |
| Borrower | borrower | yes | |
| Program | program | yes | NqmProgram display name |
| Loan Amount | loanAmount | yes | Currency formatted |
| LTV | ltv | yes | % formatted |
| Decision | decision | yes | Color-coded pill (same as conditions) |
| Open Conds | openConditions | yes | Numeric |

**Filters (above table):**
- Decision: All / Pending / Approved / Suspended / Counter / Denied
- Program: All / each NqmProgram value

**Styling:**
- Same Encompass theme: navy gradient header row, 1px borders, 10px type, alternating row colors
- Clickable rows with hover highlight
- Sort indicator: ▲/▼ next to active column header

## Testing

- No new unit tests (no new core/api logic)
- Next.js build must pass
- Smoke: all 12 loans visible in pipeline, clicking navigates to correct loan
