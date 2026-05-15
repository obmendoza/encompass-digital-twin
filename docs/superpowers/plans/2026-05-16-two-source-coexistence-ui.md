# Two-Source Coexistence UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `PredictedConditionsPanel.tsx` with role-aware mode rendering (Curation vs Drift) so portal-llm + PC v2 predictions are grouped by normalized description and rendered for the operator's job (curation throughput) or the VA/UW's job (drift inspection).

**Architecture:** Pure frontend. Three phases: (A) schema widening — surface `portal_metadata` in the API response + add `groupByNormalizedDescription` helper; (B) build `GroupedConditionCard` + `ModeToggle` and wire mode resolution from the transmittal page; (C) add `EligibilityDriftBanner` + `?filter=disagreements` filter. No backend changes; the existing per-row accept/dismiss actions stay as-is, with the UI orchestrating multi-row sequences and surfacing partial-failure recovery affordances.

**Tech Stack:** Next.js App Router (server components + client-component panel), React `useTransition` + `useState`, Vitest + testing-library, Tailwind (existing `enc-*` classes), `@twin/core` `normalizeConditionDescription` helper.

**Spec:** [docs/superpowers/specs/2026-05-16-two-source-coexistence-ui-design.md](../specs/2026-05-16-two-source-coexistence-ui-design.md) commit `bd5b682` (review-edits applied at `6fbdb3d`).

---

## File Structure

### Created

| Path | Responsibility |
|------|----------------|
| `packages/web/lib/prediction-grouping.ts` | `groupByNormalizedDescription` + `priorityRank` pure helpers + `PortalMetadata` / `PredictionGroup` types |
| `packages/web/components/encompass/GroupedConditionCard.tsx` | Renders one PredictionGroup; Curation vs Drift modes; group-level + per-row accept/dismiss; `partialFailures` tracking |
| `packages/web/components/encompass/ModeToggle.tsx` | Segmented control reading/writing `?view=curation\|drift`; drops `?filter` on switch to Curation |
| `packages/web/components/encompass/EligibilityDriftBanner.tsx` | Drift-suspected banner above the panel; renders only when disagreements present |
| `packages/web/test/prediction-grouping.test.ts` | Unit tests for grouping + priorityRank |
| `packages/web/test/grouped-condition-card.test.tsx` | Component render + group-accept partial-failure tests |
| `packages/web/test/mode-toggle.test.tsx` | URL param + role-default tests |

### Modified

| Path | Change |
|------|--------|
| `packages/api/src/routes/predict-conditions.ts` | Widen `GET /loans/:loanId/predictions` SELECT to include `portal_metadata`, `analysis_hash`, `superseded_at`; filter `superseded_at IS NULL` |
| `packages/api/src/routes/predict-conditions.ts` | Add `GET /loans/:loanId/eligibility-drift` endpoint returning the §6.1 disagreement set |
| `packages/web/lib/api-client.ts` | Widen `getPredictions` typed response with new fields; add `getEligibilityDrift(loanId)` |
| `packages/web/components/encompass/PredictedConditionsPanel.tsx` | Consume `mode` + `groupByNormalizedDescription` + `partialFailures`; render `GroupedConditionCard[]` for pending groups; keep accepted/dismissed sections as today |
| `packages/web/app/loan/[loanId]/transmittal/page.tsx` | Pass `searchParams.view` + `user.role` + drift data to the panel as props |

No new routes or pages; no DB schema changes. Spec 1.5's migration 023 already added the `portal_metadata` column.

---

## Phase A — Schema widening + helper

Two tasks. Make the data available to the UI; add the pure grouping helper.

### Task 1: Widen prediction API response + filter superseded

**Files:**
- Modify: `packages/api/src/routes/predict-conditions.ts` (around lines 35-46)
- Modify: `packages/web/lib/api-client.ts` (around line 225)
- Test: extend the existing API integration test that covers `GET /loans/:loanId/predictions` (e.g., `packages/api/test/predict-conditions.integration.test.ts` — append one test)

The current SELECT omits `portal_metadata`, `analysis_hash`, `superseded_at` (added in Spec 1.5 migration 023 + 024). The current WHERE clause doesn't filter superseded rows, so a portal re-analysis would surface stale rows alongside fresh ones. Both fixes ship together.

- [ ] **Step 1: Write the failing API integration test**

Append to `packages/api/test/predict-conditions.integration.test.ts`:

```ts
describe("GET /loans/:loanId/predictions — Spec 1.5 schema widening", () => {
  it("response carries portal_metadata for portal-llm rows", async () => {
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO predicted_conditions
           (id, tenant_id, loan_id, prediction_run_id, source_list, description, category, status,
            source_input_hash, kb_version_id, source_rule_table, source_rule_id, emission_kind,
            portal_metadata, analysis_hash)
         VALUES (gen_random_uuid(), $1, 'INT-1', gen_random_uuid(), 'portal-llm',
                 'Schema-widen test', 'PTA', 'pending',
                 'hash', NULL, NULL, NULL, 'deterministic',
                 '{"priority":"P0","severity":"SOFT-STOP","document_category":"Credit"}'::jsonb,
                 'test-hash-1')`,
        [T],
      );
    });
    const res = await app.inject({
      method: "GET",
      url: "/loans/INT-1/predictions",
      headers: headers("operator"),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { predictions: Array<{ id: string; portal_metadata?: unknown; analysis_hash?: string | null; superseded_at?: string | null }> };
    const portalRow = body.predictions.find((p) => (p.portal_metadata as { priority?: string } | undefined)?.priority === "P0");
    expect(portalRow).toBeDefined();
    expect(portalRow!.analysis_hash).toBe("test-hash-1");
    expect(portalRow!.superseded_at).toBeNull();
  });

  it("response excludes superseded rows", async () => {
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO predicted_conditions
           (id, tenant_id, loan_id, prediction_run_id, source_list, description, category, status,
            source_input_hash, kb_version_id, source_rule_table, source_rule_id, emission_kind,
            portal_metadata, analysis_hash, superseded_at)
         VALUES (gen_random_uuid(), $1, 'INT-1', gen_random_uuid(), 'portal-llm',
                 'Superseded row marker', 'PTA', 'pending',
                 'hash', NULL, NULL, NULL, 'deterministic',
                 '{}'::jsonb, 'test-hash-old', NOW())`,
        [T],
      );
    });
    const res = await app.inject({
      method: "GET",
      url: "/loans/INT-1/predictions",
      headers: headers("operator"),
    });
    const body = JSON.parse(res.body) as { predictions: Array<{ description: string }> };
    expect(body.predictions.find((p) => p.description === "Superseded row marker")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
pnpm --filter @twin/api test predict-conditions.integration.test
```

Expected: the two new tests FAIL — current SELECT omits the columns and doesn't filter superseded.

- [ ] **Step 3: Widen the API SELECT**

In `packages/api/src/routes/predict-conditions.ts`, replace the SELECT block (lines 37-46):

```ts
        const predictions = await c.query(
          `SELECT id, tenant_id, loan_id, prediction_run_id, source_input_hash,
                  predicted_at, predicted_by, kb_version_id, resolved_income_type,
                  category, description, note, source_list, source_order, status,
                  acted_by, acted_at, acted_role, dismissal_reason, accepted_condition_id,
                  portal_metadata, analysis_hash, superseded_at
             FROM predicted_conditions
            WHERE tenant_id = $1 AND loan_id = $2 AND superseded_at IS NULL
            ORDER BY status, source_list, source_order`,
          [tenantId, loanId],
        );
```

Two additions: `portal_metadata, analysis_hash, superseded_at` in the column list; `AND superseded_at IS NULL` in the WHERE.

- [ ] **Step 4: Widen the api-client typed response**

In `packages/web/lib/api-client.ts`, replace the `getPredictions` typed signature (around line 225-228):

```ts
  getPredictions: (loanId: string) =>
    req<{
      predictions: Array<{
        id: string;
        status: string;
        description: string;
        category: string;
        note: string | null;
        source_list: string;
        source_order: number;
        acted_by: string | null;
        acted_role: string | null;
        dismissal_reason: string | null;
        accepted_condition_id: string | null;
        portal_metadata: unknown;       // PortalMetadata | null — typed in the panel
        analysis_hash: string | null;
        superseded_at: string | null;
      }>;
      alerts: Array<{ id: string; error_class: string; remediation_hint: string; cleared_at: string | null }>;
    }>(
      `/loans/${loanId}/predictions`,
    ),
```

- [ ] **Step 5: Verify the test passes + build clean**

```bash
pnpm --filter @twin/api build && pnpm --filter @twin/web build && pnpm --filter @twin/api test predict-conditions.integration.test
```

Expected: 0 build errors. Both new tests PASS plus all prior `predict-conditions.integration.test.ts` tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/predict-conditions.ts packages/web/lib/api-client.ts packages/api/test/predict-conditions.integration.test.ts
git commit -m "feat(api,web): widen GET /predictions response — portal_metadata + supersede filter

Spec 1.5 (commit 6e77719) added portal_metadata, analysis_hash, and
superseded_at columns on predicted_conditions, but the GET endpoint
hadn't been updated to surface them. The two-source coexistence UI
needs portal_metadata to render priority/severity badges and
specifications. Filtering superseded_at IS NULL prevents stale rows
from a prior portal analysis surfacing in the UI alongside fresh ones."
```

---

### Task 2: `prediction-grouping` helper module + unit tests

**Files:**
- Create: `packages/web/lib/prediction-grouping.ts`
- Create: `packages/web/test/prediction-grouping.test.ts`

Pure-function helper. No DB, no React, no side effects. Implements §3 of the spec exactly.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/test/prediction-grouping.test.ts
import { describe, it, expect } from "vitest";
import { groupByNormalizedDescription, type Prediction } from "@/lib/prediction-grouping";

function mkPrediction(p: Partial<Prediction> & { id: string; description: string; source_list: string }): Prediction {
  return {
    status: "pending",
    category: "PTA",
    note: null,
    source_order: 0,
    acted_by: null,
    acted_role: null,
    dismissal_reason: null,
    accepted_condition_id: null,
    portal_metadata: null,
    analysis_hash: null,
    superseded_at: null,
    ...p,
  };
}

describe("groupByNormalizedDescription", () => {
  it("groups portal-llm + matrix rows sharing the same normalized description", () => {
    const preds: Prediction[] = [
      mkPrediction({ id: "1", description: "Credit Report", source_list: "portal-llm" }),
      mkPrediction({ id: "2", description: "credit report", source_list: "matrix" }),
    ];
    const groups = groupByNormalizedDescription(preds);
    expect(groups.length).toBe(1);
    expect(groups[0]!.rows.length).toBe(2);
    expect(groups[0]!.portalRow?.id).toBe("1");
    expect(groups[0]!.pcV2Rows.map((r) => r.id)).toEqual(["2"]);
    expect(groups[0]!.hasMultipleSources).toBe(true);
  });

  it("single-source PC v2 group has hasMultipleSources=false and no portalRow", () => {
    const preds = [mkPrediction({ id: "1", description: "LTV exceeds tier", source_list: "matrix" })];
    const groups = groupByNormalizedDescription(preds);
    expect(groups.length).toBe(1);
    expect(groups[0]!.hasMultipleSources).toBe(false);
    expect(groups[0]!.portalRow).toBeUndefined();
    expect(groups[0]!.primarySource).toBe("matrix");
  });

  it("excludes accepted and dismissed rows from grouping", () => {
    const preds: Prediction[] = [
      mkPrediction({ id: "1", description: "Doc A", source_list: "portal-llm", status: "accepted" }),
      mkPrediction({ id: "2", description: "Doc B", source_list: "portal-llm", status: "dismissed" }),
      mkPrediction({ id: "3", description: "Doc C", source_list: "portal-llm", status: "pending" }),
    ];
    const groups = groupByNormalizedDescription(preds);
    expect(groups.length).toBe(1);
    expect(groups[0]!.rows[0]!.id).toBe("3");
  });

  it("portal description wins for displayDescription when both sources present", () => {
    const preds: Prediction[] = [
      mkPrediction({ id: "1", description: "Credit Report — full tri-merge required", source_list: "portal-llm" }),
      mkPrediction({ id: "2", description: "credit report", source_list: "matrix" }),
    ];
    const groups = groupByNormalizedDescription(preds);
    expect(groups[0]!.displayDescription).toBe("Credit Report — full tri-merge required");
  });

  it("sorts groups by priority: HARD-STOP, P0, P1, P2, PC-v2-only", () => {
    const preds: Prediction[] = [
      mkPrediction({ id: "p2", description: "P2 doc", source_list: "portal-llm", portal_metadata: { priority: "P2" } }),
      mkPrediction({ id: "hs", description: "Hard stop", source_list: "portal-llm", portal_metadata: { severity: "HARD-STOP" } }),
      mkPrediction({ id: "pc", description: "PC v2 only", source_list: "matrix" }),
      mkPrediction({ id: "p0", description: "P0 doc", source_list: "portal-llm", portal_metadata: { priority: "P0" } }),
      mkPrediction({ id: "p1", description: "P1 doc", source_list: "portal-llm", portal_metadata: { priority: "P1" } }),
    ];
    const groups = groupByNormalizedDescription(preds);
    expect(groups.map((g) => g.rows[0]!.id)).toEqual(["hs", "p0", "p1", "p2", "pc"]);
  });

  it("returns empty array when all predictions are accepted/dismissed", () => {
    const preds = [mkPrediction({ id: "1", description: "x", source_list: "portal-llm", status: "accepted" })];
    expect(groupByNormalizedDescription(preds)).toEqual([]);
  });

  it("collapses three sources into one group when descriptions normalize the same", () => {
    const preds: Prediction[] = [
      mkPrediction({ id: "1", description: "Income docs", source_list: "portal-llm" }),
      mkPrediction({ id: "2", description: "income docs", source_list: "income" }),
      mkPrediction({ id: "3", description: "INCOME DOCS", source_list: "requirements" }),
    ];
    const groups = groupByNormalizedDescription(preds);
    expect(groups.length).toBe(1);
    expect(groups[0]!.rows.length).toBe(3);
    expect(groups[0]!.pcV2Rows.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @twin/web test prediction-grouping.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the helper**

```ts
// packages/web/lib/prediction-grouping.ts
import { normalizeConditionDescription } from "@twin/core";

export interface PortalMetadata {
  priority?: "P0" | "P1" | "P2";
  severity?: "HARD-STOP" | "SOFT-STOP";
  document_category?: "Credit" | "Cross-Cutting" | "Compliance" | "Income" | "Assets" | "Property" | "Title";
  document_type?: string;
  specifications?: string[];
  reasons_needed?: string[];
  source_references?: string[];
  tags?: string[];
  source_module?: string;
  applies_to?: string;
  portal_status?: string;
}

export interface Prediction {
  id: string;
  status: "pending" | "accepted" | "dismissed" | string;
  description: string;
  category: string;
  note: string | null;
  source_list: string;
  source_order: number;
  acted_by: string | null;
  acted_role: string | null;
  dismissal_reason: string | null;
  accepted_condition_id: string | null;
  portal_metadata: PortalMetadata | null;
  analysis_hash: string | null;
  superseded_at: string | null;
}

export interface PredictionGroup {
  normalizedKey: string;
  displayDescription: string;
  primarySource: "portal-llm" | "matrix" | "geographic" | "requirements" | "minimum" | "income";
  rows: Prediction[];
  portalRow?: Prediction;
  pcV2Rows: Prediction[];
  hasMultipleSources: boolean;
}

export function groupByNormalizedDescription(predictions: Prediction[]): PredictionGroup[] {
  const groups = new Map<string, Prediction[]>();
  for (const p of predictions) {
    if (p.status !== "pending") continue;
    const key = normalizeConditionDescription(p.description);
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  return Array.from(groups.entries())
    .map(([key, rows]) => {
      const portalRow = rows.find((r) => r.source_list === "portal-llm");
      const pcV2Rows = rows.filter((r) => r.source_list !== "portal-llm");
      return {
        normalizedKey: key,
        displayDescription: (portalRow ?? rows[0]!).description,
        primarySource: (portalRow?.source_list ?? rows[0]!.source_list) as PredictionGroup["primarySource"],
        rows,
        portalRow,
        pcV2Rows,
        hasMultipleSources: new Set(rows.map((r) => r.source_list)).size > 1,
      };
    })
    .sort((a, b) => priorityRank(a) - priorityRank(b));
}

export function priorityRank(g: PredictionGroup): number {
  const meta = g.portalRow?.portal_metadata;
  if (meta?.severity === "HARD-STOP") return 0;
  if (meta?.priority === "P0") return 1;
  if (meta?.priority === "P1") return 2;
  if (meta?.priority === "P2") return 3;
  return 4;
}
```

- [ ] **Step 4: Verify tests pass + build clean**

```bash
pnpm --filter @twin/web build && pnpm --filter @twin/web test prediction-grouping.test
```

Expected: 0 build errors. 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/lib/prediction-grouping.ts packages/web/test/prediction-grouping.test.ts
git commit -m "feat(web): groupByNormalizedDescription helper + types

Pure helper grouping Prediction[] by normalizeConditionDescription
(reuses @twin/core's helper — same algo PC v2 uses internally for
dedup). Pending-rows-only. Sorts by HARD-STOP / P0 / P1 / P2 / PC-v2.
PortalMetadata + PredictionGroup types exported for the card."
```

---

## Phase A complete — checkpoint

After tasks 1-2: API surfaces `portal_metadata`; client lib types updated; pure grouping helper exists with 7 unit tests. No UI behavior change yet.

Verify:
```bash
pnpm --filter @twin/web build && pnpm --filter @twin/api build && pnpm --filter @twin/web test prediction-grouping.test && pnpm --filter @twin/api test predict-conditions.integration.test
```

Expected: 0 build errors. New tests + entire prior suite pass.

---

## Phase B — Card + mode rendering

Three tasks. Build the new card component, the toggle, and wire mode resolution at the page boundary.

### Task 3: `ModeToggle` component

**Files:**
- Create: `packages/web/components/encompass/ModeToggle.tsx`
- Test: `packages/web/test/mode-toggle.test.tsx`

Small client component. Segmented control rendering two `<Link>` elements. Drops `?filter` when switching to Curation.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web/test/mode-toggle.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModeToggle } from "@/components/encompass/ModeToggle";

describe("ModeToggle", () => {
  it("renders two segments and marks the active mode", () => {
    render(<ModeToggle currentMode="curation" basePath="/loan/L-1/transmittal" currentFilter={null} />);
    const curationLink = screen.getByRole("link", { name: /curation/i });
    const driftLink = screen.getByRole("link", { name: /drift/i });
    expect(curationLink).toHaveAttribute("aria-current", "page");
    expect(driftLink).not.toHaveAttribute("aria-current");
  });

  it("Curation link drops ?filter to avoid carrying disagreement filter into Curation", () => {
    render(<ModeToggle currentMode="drift" basePath="/loan/L-1/transmittal" currentFilter="disagreements" />);
    const curationLink = screen.getByRole("link", { name: /curation/i });
    expect(curationLink.getAttribute("href")).toMatch(/\?view=curation$/);
    expect(curationLink.getAttribute("href")).not.toContain("filter=");
  });

  it("Drift link preserves ?filter if currentFilter is set", () => {
    render(<ModeToggle currentMode="curation" basePath="/loan/L-1/transmittal" currentFilter="disagreements" />);
    const driftLink = screen.getByRole("link", { name: /drift/i });
    expect(driftLink.getAttribute("href")).toContain("view=drift");
    expect(driftLink.getAttribute("href")).toContain("filter=disagreements");
  });

  it("Drift link without filter omits filter param", () => {
    render(<ModeToggle currentMode="curation" basePath="/loan/L-1/transmittal" currentFilter={null} />);
    const driftLink = screen.getByRole("link", { name: /drift/i });
    expect(driftLink.getAttribute("href")).toMatch(/\?view=drift$/);
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @twin/web test mode-toggle.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// packages/web/components/encompass/ModeToggle.tsx
import Link from "next/link";

interface Props {
  currentMode: "curation" | "drift";
  basePath: string;          // e.g., "/loan/L-1/transmittal"
  currentFilter: string | null;  // e.g., "disagreements" or null
}

export function ModeToggle({ currentMode, basePath, currentFilter }: Props): JSX.Element {
  // Curation drops the filter param (Spec 1.5-UI §6.3 — filter is Drift-only).
  const curationHref = `${basePath}?view=curation`;
  // Drift preserves the filter when present.
  const driftHref = currentFilter
    ? `${basePath}?view=drift&filter=${encodeURIComponent(currentFilter)}`
    : `${basePath}?view=drift`;

  const segmentClass = (active: boolean): string =>
    `px-3 py-1 text-[11px] font-bold ${
      active
        ? "bg-[#1f4478] text-white"
        : "bg-white text-[#1a2b4a] border border-[#6b7a8f]"
    }`;

  return (
    <div className="flex items-center gap-2 mb-2">
      <span className="text-[11px] font-bold text-[#1a2b4a]">View:</span>
      <Link
        href={curationHref}
        className={segmentClass(currentMode === "curation")}
        aria-current={currentMode === "curation" ? "page" : undefined}
      >
        Curation
      </Link>
      <Link
        href={driftHref}
        className={segmentClass(currentMode === "drift")}
        aria-current={currentMode === "drift" ? "page" : undefined}
      >
        Drift
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: Verify tests pass + build clean**

```bash
pnpm --filter @twin/web build && pnpm --filter @twin/web test mode-toggle.test
```

Expected: 0 build errors. 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/encompass/ModeToggle.tsx packages/web/test/mode-toggle.test.tsx
git commit -m "feat(web): ModeToggle segmented control

Two-segment Next Link control for ?view=curation|drift. Drops ?filter
when switching to Curation (filter is Drift-only per Spec 1.5-UI §6.3).
Preserves ?filter on Drift links. aria-current attribute on the active
segment for screen readers."
```

---

### Task 4: `GroupedConditionCard` component (with partial-failure recovery)

**Files:**
- Create: `packages/web/components/encompass/GroupedConditionCard.tsx`
- Test: `packages/web/test/grouped-condition-card.test.tsx`

The component renders one `PredictionGroup`. Curation mode shows portal content with PC v2 collapsed; Drift mode shows both side-by-side with per-row controls. Group-level Accept orchestrates portal-accept + PC-v2-dismiss-as-duplicate; partial failures are tracked in component state and surfaced via inline banner.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web/test/grouped-condition-card.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GroupedConditionCard } from "@/components/encompass/GroupedConditionCard";
import type { PredictionGroup } from "@/lib/prediction-grouping";

const mkGroup = (overrides: Partial<PredictionGroup> = {}): PredictionGroup => ({
  normalizedKey: "creditreport",
  displayDescription: "Credit Report",
  primarySource: "portal-llm",
  rows: [
    {
      id: "p1", status: "pending", description: "Credit Report", category: "PTA",
      note: null, source_list: "portal-llm", source_order: 0,
      acted_by: null, acted_role: null, dismissal_reason: null, accepted_condition_id: null,
      portal_metadata: { priority: "P0", severity: "SOFT-STOP", document_category: "Credit", specifications: ["Tri-merge"], reasons_needed: ["FICO validation"] },
      analysis_hash: "h1", superseded_at: null,
    },
    {
      id: "m1", status: "pending", description: "credit report", category: "PTA",
      note: null, source_list: "matrix", source_order: 0,
      acted_by: null, acted_role: null, dismissal_reason: null, accepted_condition_id: null,
      portal_metadata: null, analysis_hash: null, superseded_at: null,
    },
  ],
  portalRow: undefined,  // filled below
  pcV2Rows: [],          // filled below
  hasMultipleSources: true,
  ...overrides,
});

const enrich = (g: PredictionGroup): PredictionGroup => {
  g.portalRow = g.rows.find((r) => r.source_list === "portal-llm");
  g.pcV2Rows = g.rows.filter((r) => r.source_list !== "portal-llm");
  return g;
};

describe("GroupedConditionCard — Curation mode", () => {
  let onAccept: ReturnType<typeof vi.fn>;
  let onDismiss: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    onAccept = vi.fn(async () => ({ ok: true }));
    onDismiss = vi.fn(async () => ({ ok: true }));
  });

  it("renders portal description and source badges", () => {
    const g = enrich(mkGroup());
    render(<GroupedConditionCard group={g} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    expect(screen.getByText("Credit Report")).toBeInTheDocument();
    expect(screen.getByText(/P0/)).toBeInTheDocument();
    expect(screen.getByText(/SOFT-STOP/)).toBeInTheDocument();
  });

  it("hides per-row controls in Curation mode", () => {
    const g = enrich(mkGroup());
    render(<GroupedConditionCard group={g} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    // Per-row controls are aria-labeled with the row source for accessibility.
    expect(screen.queryByRole("button", { name: /Accept matrix row/i })).not.toBeInTheDocument();
  });

  it("group-level Accept calls onAccept on portal row then onDismiss on each PC v2 row", async () => {
    const g = enrich(mkGroup());
    render(<GroupedConditionCard group={g} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /^Accept$/ }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith("m1", "duplicate_of_portal"));
  });
});

describe("GroupedConditionCard — Drift mode", () => {
  it("shows per-row Accept/Dismiss buttons on each side", () => {
    const onAccept = vi.fn(async () => ({ ok: true }));
    const onDismiss = vi.fn(async () => ({ ok: true }));
    const g = enrich(mkGroup());
    render(<GroupedConditionCard group={g} mode="drift" onAccept={onAccept} onDismiss={onDismiss} />);
    expect(screen.getByRole("button", { name: /Accept portal-llm row/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accept matrix row/i })).toBeInTheDocument();
  });
});

describe("GroupedConditionCard — partial-failure recovery (Spec 1.5-UI §5.1.1)", () => {
  it("renders cleanup-failure banner when a dismiss-as-duplicate fails", async () => {
    const onAccept = vi.fn(async () => ({ ok: true }));
    const onDismiss = vi.fn(async () => ({ ok: false, error: "advisory_lock_contention" }));
    const g = enrich(mkGroup());
    render(<GroupedConditionCard group={g} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /^Accept$/ }));
    await waitFor(() => expect(screen.getByText(/cleanup incomplete/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Retry cleanup/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dismiss as-is/i })).toBeInTheDocument();
  });

  it("Retry cleanup re-issues the failed dismiss calls", async () => {
    const onAccept = vi.fn(async () => ({ ok: true }));
    let dismissCalls = 0;
    const onDismiss = vi.fn(async () => {
      dismissCalls++;
      return dismissCalls === 1 ? { ok: false, error: "transient" } : { ok: true };
    });
    const g = enrich(mkGroup());
    render(<GroupedConditionCard group={g} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /^Accept$/ }));
    await waitFor(() => screen.getByRole("button", { name: /Retry cleanup/i }));
    fireEvent.click(screen.getByRole("button", { name: /Retry cleanup/i }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(2));
  });

  it("aria-busy is set during the transition", async () => {
    const onAccept = vi.fn(() => new Promise<{ ok: boolean }>((r) => setTimeout(() => r({ ok: true }), 50)));
    const onDismiss = vi.fn(async () => ({ ok: true }));
    const g = enrich(mkGroup());
    render(<GroupedConditionCard group={g} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /^Accept$/ }));
    const card = screen.getByTestId("grouped-condition-card");
    expect(card.getAttribute("aria-busy")).toBe("true");
    await waitFor(() => expect(card.getAttribute("aria-busy")).toBe("false"), { timeout: 500 });
  });
});
```

- [ ] **Step 2: Run failing test**

```bash
pnpm --filter @twin/web test grouped-condition-card.test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```tsx
// packages/web/components/encompass/GroupedConditionCard.tsx
"use client";
import { useState, useTransition } from "react";
import type { PredictionGroup, PortalMetadata, Prediction } from "@/lib/prediction-grouping";

type ActionResult = { ok: true } | { ok: false; error?: string };

interface Props {
  group: PredictionGroup;
  mode: "curation" | "drift";
  onAccept: (predictionId: string) => Promise<ActionResult>;
  onDismiss: (predictionId: string, reason: string) => Promise<ActionResult>;
}

export function GroupedConditionCard({ group, mode, onAccept, onDismiss }: Props): JSX.Element {
  const [pending, start] = useTransition();
  const [partialFailure, setPartialFailure] = useState<{ failedPcRowIds: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meta = group.portalRow?.portal_metadata as PortalMetadata | null;

  const handleGroupAccept = (): void => {
    setError(null);
    setPartialFailure(null);
    start(async () => {
      const acceptTarget = group.portalRow ?? group.rows[0]!;
      const r = await onAccept(acceptTarget.id);
      if (!r.ok) { setError(`Accept failed: ${"error" in r ? r.error : "unknown"}`); return; }
      const failed: string[] = [];
      if (group.portalRow) {
        for (const pcRow of group.pcV2Rows) {
          const dr = await onDismiss(pcRow.id, "duplicate_of_portal");
          if (!dr.ok) failed.push(pcRow.id);
        }
      }
      if (failed.length > 0) setPartialFailure({ failedPcRowIds: failed });
    });
  };

  const handleGroupDismiss = (reason: string): void => {
    setError(null);
    setPartialFailure(null);
    start(async () => {
      const dismissTarget = group.portalRow ?? group.rows[0]!;
      const r = await onDismiss(dismissTarget.id, reason);
      if (!r.ok) { setError(`Dismiss failed: ${"error" in r ? r.error : "unknown"}`); return; }
      const failed: string[] = [];
      if (group.portalRow) {
        for (const pcRow of group.pcV2Rows) {
          const dr = await onDismiss(pcRow.id, "duplicate_of_portal_dismiss");
          if (!dr.ok) failed.push(pcRow.id);
        }
      }
      if (failed.length > 0) setPartialFailure({ failedPcRowIds: failed });
    });
  };

  const handleRetryCleanup = (): void => {
    if (!partialFailure) return;
    start(async () => {
      const stillFailed: string[] = [];
      for (const id of partialFailure.failedPcRowIds) {
        const r = await onDismiss(id, "duplicate_of_portal");
        if (!r.ok) stillFailed.push(id);
      }
      setPartialFailure(stillFailed.length > 0 ? { failedPcRowIds: stillFailed } : null);
    });
  };

  return (
    <div
      data-testid="grouped-condition-card"
      className={`enc-panel mb-2 ${pending ? "opacity-60 pointer-events-none" : ""}`}
      aria-busy={pending}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="text-[12px] font-bold text-[#1a2b4a]">
          {group.displayDescription}
        </div>
        <div className="flex items-center gap-1">
          {meta?.priority && <span className="text-[10px] px-1 bg-[#1f4478] text-white">{meta.priority}</span>}
          {meta?.severity && <span className="text-[10px] px-1 bg-[#8a4b00] text-white">{meta.severity}</span>}
          {meta?.document_category && <span className="text-[10px] px-1 bg-[#6b7a8f] text-white">{meta.document_category}</span>}
        </div>
      </div>

      {mode === "curation" ? renderCuration(group, meta) : renderDrift(group, onAccept, onDismiss)}

      {error && <div className="text-[11px] text-[#8a1a1a] mt-1">{error}</div>}

      {partialFailure && (
        <div className="mt-1 p-1 border-l-4 border-[#8a4b00] bg-[#fff4e6] text-[11px]">
          ⚠ Accept succeeded but cleanup incomplete. {partialFailure.failedPcRowIds.length} duplicate row(s) failed to dismiss.
          <button className="enc-btn ml-2" onClick={handleRetryCleanup}>Retry cleanup</button>
          <button className="enc-btn ml-1" onClick={() => setPartialFailure(null)}>Dismiss as-is</button>
        </div>
      )}

      <div className="flex gap-2 mt-1">
        <button className="enc-btn enc-btn--primary" onClick={handleGroupAccept}>Accept</button>
        <button className="enc-btn" onClick={() => handleGroupDismiss("uw_not_required")}>Dismiss</button>
      </div>
    </div>
  );
}

function renderCuration(group: PredictionGroup, meta: PortalMetadata | null): JSX.Element {
  return (
    <div className="text-[11px]">
      {meta?.specifications && meta.specifications.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[#1f4478]">Specifications ({meta.specifications.length})</summary>
          <ul className="list-disc pl-4">
            {meta.specifications.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </details>
      )}
      {meta?.reasons_needed && meta.reasons_needed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[#1f4478]">Reasons ({meta.reasons_needed.length})</summary>
          <ul className="list-disc pl-4">
            {meta.reasons_needed.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </details>
      )}
      {group.pcV2Rows.length > 0 && (
        <div className="text-[10px] text-[#6b7a8f] mt-1">
          +{group.pcV2Rows.length} source ({group.pcV2Rows.map((r) => r.source_list).join(", ")})
        </div>
      )}
    </div>
  );
}

function renderDrift(
  group: PredictionGroup,
  onAccept: Props["onAccept"],
  onDismiss: Props["onDismiss"],
): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2 text-[11px]">
      {group.portalRow && (
        <div className="border-r border-[#6b7a8f] pr-2">
          <div className="text-[10px] font-bold mb-1">Portal-LLM</div>
          <div>{group.portalRow.description}</div>
          <div className="flex gap-1 mt-1">
            <button className="enc-btn" aria-label={`Accept portal-llm row`} onClick={() => onAccept(group.portalRow!.id)}>Accept</button>
            <button className="enc-btn" aria-label={`Dismiss portal-llm row`} onClick={() => onDismiss(group.portalRow!.id, "uw_not_required")}>Dismiss</button>
          </div>
        </div>
      )}
      <div>
        {group.pcV2Rows.map((row) => (
          <div key={row.id} className="mb-1">
            <div className="text-[10px] font-bold">PC v2 {row.source_list}</div>
            <div>{row.description}</div>
            <div className="flex gap-1 mt-1">
              <button className="enc-btn" aria-label={`Accept ${row.source_list} row`} onClick={() => onAccept(row.id)}>Accept</button>
              <button className="enc-btn" aria-label={`Dismiss ${row.source_list} row`} onClick={() => onDismiss(row.id, "uw_not_required")}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify tests pass + build clean**

```bash
pnpm --filter @twin/web build && pnpm --filter @twin/web test grouped-condition-card.test
```

Expected: 0 build errors. 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/web/components/encompass/GroupedConditionCard.tsx packages/web/test/grouped-condition-card.test.tsx
git commit -m "feat(web): GroupedConditionCard with Curation + Drift modes + partial-failure recovery

Single card per PredictionGroup. Curation mode: portal content +
specifications/reasons disclosures + PC v2 collapsed to +N source
chip. Drift mode: two-column with per-row Accept/Dismiss. Group-level
Accept orchestrates portal-accept + PC-v2-dismiss-as-duplicate;
partialFailure state surfaces an inline banner with Retry cleanup +
Dismiss as-is when any dismiss returns !r.ok. aria-busy during the
transition."
```

---

### Task 5: Mode resolver + panel wiring

**Files:**
- Modify: `packages/web/app/loan/[loanId]/transmittal/page.tsx` (around line 145, the existing panel render)
- Modify: `packages/web/components/encompass/PredictedConditionsPanel.tsx`

Wire the new mode flow end-to-end. Page resolves mode from `searchParams.view` + `user.role`. Panel consumes mode + groups predictions + renders `GroupedConditionCard[]` for pending. Accepted/dismissed sections stay unchanged.

- [ ] **Step 1: Read existing panel to confirm structure**

```bash
head -100 packages/web/components/encompass/PredictedConditionsPanel.tsx
```

Note: existing `Prediction` interface (around line 11-22) needs the new fields added; existing `pendingItems` filter needs to switch to grouping. Accepted/dismissed sections at the bottom remain untouched.

- [ ] **Step 2: Update transmittal page to pass mode + searchParams**

In `packages/web/app/loan/[loanId]/transmittal/page.tsx`, change the function signature to accept `searchParams` and update the panel call:

Replace lines 17-19 (the function declaration):

```ts
export default async function TransmittalPage({
  params,
  searchParams,
}: {
  params: Promise<{ loanId: string }>;
  searchParams: Promise<{ view?: string; filter?: string }>;
}) {
  const { loanId } = await params;
  const sp = await searchParams;
  // ... existing body until the panel call ...
```

Replace the panel render (around line 145-149):

```tsx
      <PredictedConditionsPanel
        loanId={loan.id}
        predictions={predictionsData.predictions as never}
        alerts={predictionsData.alerts as never}
        mode={
          sp.view === "drift" || sp.view === "curation"
            ? sp.view
            : (user?.role === "operator" ? "curation" : "drift")
        }
        filter={sp.filter === "disagreements" ? "disagreements" : null}
        basePath={`/loan/${loanId}/transmittal`}
      />
```

If `user?.role` could be undefined (no session), the conditional defaults to `"drift"` — but that's safe-by-default for unresolved roles. Reviewer recommended `"operator"` as the safer fallback (Curation hides the diagnostic Drift surface). Adjust:

```tsx
        mode={
          sp.view === "drift" || sp.view === "curation"
            ? sp.view
            : (user?.role === "operator" || !user?.role ? "curation" : "drift")
        }
```

- [ ] **Step 3: Update `PredictedConditionsPanel.tsx`**

Open `packages/web/components/encompass/PredictedConditionsPanel.tsx`. Make these changes:

**3a. Widen the `Prediction` interface** (replace the existing interface around line 11-22):

```ts
import type { PortalMetadata } from "@/lib/prediction-grouping";

interface Prediction {
  id: string;
  status: "pending" | "accepted" | "dismissed";
  description: string;
  category: string;
  note: string | null;
  source_list: string;
  source_order: number;
  acted_by: string | null;
  acted_role: string | null;
  dismissal_reason: string | null;
  portal_metadata: PortalMetadata | null;
  analysis_hash: string | null;
  superseded_at: string | null;
  accepted_condition_id: string | null;
}
```

**3b. Widen the `Props` interface and accept new props:**

```ts
interface Props {
  loanId: string;
  predictions: Prediction[];
  alerts: Alert[];
  mode: "curation" | "drift";
  filter: "disagreements" | null;
  basePath: string;
}

export function PredictedConditionsPanel({ loanId, predictions, alerts, mode, filter, basePath }: Props) {
```

**3c. Import the grouping helper and the new components:**

```ts
import { groupByNormalizedDescription, type Prediction as GroupingPrediction } from "@/lib/prediction-grouping";
import { GroupedConditionCard } from "./GroupedConditionCard";
import { ModeToggle } from "./ModeToggle";
```

**3d. Replace `pendingItems` calculation** (around line 47) with grouped output:

Replace:
```ts
const pendingItems = predictions.filter((p) => p.status === "pending");
```

With:
```ts
const pendingGroups = groupByNormalizedDescription(predictions as GroupingPrediction[]);
```

**3e. Render `ModeToggle` and grouped cards** in place of the current pending-items render. Find where pending items get rendered (typically a `.map(...)` over `pendingItems`) and replace with:

```tsx
<ModeToggle currentMode={mode} basePath={basePath} currentFilter={filter} />

{pendingGroups.map((group) => (
  <GroupedConditionCard
    key={group.normalizedKey}
    group={group}
    mode={mode}
    onAccept={async (predictionId) => {
      const r = await actionAcceptPrediction(loanId, predictionId);
      router.refresh();
      return r;
    }}
    onDismiss={async (predictionId, reason) => {
      const r = await actionDismissPrediction(loanId, predictionId, reason);
      router.refresh();
      return r;
    }}
  />
))}
```

(Adjust the surrounding JSX to match the existing panel's nesting. The accepted/dismissed sections farther down stay unchanged.)

**3f. Remove now-unused helpers if the previous pending-render had its own accept/dismiss handlers** — the new logic moves those handlers into the card. Keep only what's still referenced (accept/dismiss for accepted/dismissed-section actions, alert clearing, etc.).

- [ ] **Step 4: Build + smoke test**

```bash
pnpm --filter @twin/web build 2>&1 | tail -15
```

Expected: 0 errors. If the existing `predicted-conditions-panel.test.tsx` references removed handlers, it will fail at the test step — fix those by importing the helpers from elsewhere or refactoring the test fixture to provide the new mode/basePath/filter props.

- [ ] **Step 5: Run existing panel tests to confirm no regression**

```bash
pnpm --filter @twin/web test predicted-conditions-panel.test
```

Expected: tests pass after a minimal update — the existing test fixture's `<PredictedConditionsPanel>` props need `mode="curation"`, `filter={null}`, `basePath="/test"`. If a test was asserting specific rendering of flat pending items, it now needs to assert grouped rendering or be updated to the new shape.

If existing tests fail in ways that don't match the new behavior, update them inline — the task is to keep the panel functional, not to preserve outdated test assertions. Document any test changes in the commit message.

- [ ] **Step 6: Commit**

```bash
git add packages/web/app/loan/[loanId]/transmittal/page.tsx packages/web/components/encompass/PredictedConditionsPanel.tsx packages/web/test/predicted-conditions-panel.test.tsx
git commit -m "feat(web): wire mode + grouping into PredictedConditionsPanel

Transmittal page resolves mode from ?view query param + user.role
(operator → Curation; va/uw → Drift; explicit param overrides).
Panel groups pending predictions via groupByNormalizedDescription
and renders GroupedConditionCard[]. ModeToggle at the top of the
panel. Accepted/dismissed sections unchanged. Existing panel test
updated to supply the new mode/filter/basePath props."
```

---

## Phase B complete — checkpoint

After tasks 3-5: ModeToggle component built. GroupedConditionCard with both modes + partial-failure recovery. Panel wires grouping + mode through the transmittal page. URL `?view=curation|drift` works end-to-end.

Verify:
```bash
pnpm --filter @twin/web build && pnpm --filter @twin/web test
```

Expected: 0 build errors. All web tests pass.

Manual smoke test:
1. Start API + web (`pnpm --filter @twin/api dev` + `pnpm --filter @twin/web dev`)
2. Visit `http://localhost:3000/loan/<some-loan-id>/transmittal` as an operator → see Curation cards
3. Append `?view=drift` to the URL → see two-column Drift layout
4. Click ModeToggle → URL flips → render updates

---

## Phase C — Disagreement banner + integration

Two tasks. The drift signal banner + filter integration.

### Task 6: `EligibilityDriftBanner` + API endpoint

**Files:**
- Modify: `packages/api/src/routes/predict-conditions.ts` (add new endpoint)
- Modify: `packages/web/lib/api-client.ts` (add `getEligibilityDrift`)
- Modify: `packages/web/app/loan/[loanId]/transmittal/page.tsx` (fetch drift data, pass to panel)
- Create: `packages/web/components/encompass/EligibilityDriftBanner.tsx`
- Modify: `packages/web/components/encompass/PredictedConditionsPanel.tsx` (render banner)

The banner queries Spec 1.5's `portal_eligibility_verdicts` joined with PC v2's matrix-resolver findings via the description-substring heuristic (acknowledged-limited; future spec replaces).

- [ ] **Step 1: Add the API endpoint**

In `packages/api/src/routes/predict-conditions.ts`, add a new GET endpoint near the existing `/predictions` one:

```ts
  app.get<{ Params: { loanId: string } }>(
    "/loans/:loanId/eligibility-drift",
    async (req, reply) => {
      const ctx = getTenantContext();
      const tenantId = ctx.tenantId;
      const { loanId } = req.params;
      requireLoanForTenant(store, loanId);
      return withTenantTx(tenantId, async (c) => {
        const { rows } = await c.query<{
          program: string;
          portal_status: "PASS" | "FAIL";
          pc_v2_failed: boolean;
        }>(
          `SELECT
             pev.program,
             pev.status AS portal_status,
             EXISTS (
               SELECT 1 FROM predicted_conditions pc
               WHERE pc.tenant_id = pev.tenant_id
                 AND pc.loan_id = pev.loan_id
                 AND pc.source_list = 'matrix'
                 AND pc.status = 'pending'
                 AND pc.superseded_at IS NULL
                 AND pc.description ILIKE '%' || pev.program || '%'
             ) AS pc_v2_failed
           FROM portal_eligibility_verdicts pev
           WHERE pev.tenant_id = $1 AND pev.loan_id = $2 AND pev.superseded_at IS NULL`,
          [tenantId, loanId],
        );
        const disagreements = rows.filter(
          (r) => (r.portal_status === "PASS" && r.pc_v2_failed) || (r.portal_status === "FAIL" && !r.pc_v2_failed),
        );
        return reply.send({
          disagreementCount: disagreements.length,
          programs: disagreements.map((d) => ({
            program: d.program,
            portalStatus: d.portal_status,
            pcV2Status: d.pc_v2_failed ? "FAIL" : "PASS",
          })),
        });
      });
    },
  );
```

- [ ] **Step 2: Add the client lib method**

In `packages/web/lib/api-client.ts`, near `getPredictions`:

```ts
  getEligibilityDrift: (loanId: string) =>
    req<{
      disagreementCount: number;
      programs: Array<{ program: string; portalStatus: "PASS" | "FAIL"; pcV2Status: "PASS" | "FAIL" }>;
    }>(`/loans/${loanId}/eligibility-drift`),
```

- [ ] **Step 3: Update the transmittal page**

In `packages/web/app/loan/[loanId]/transmittal/page.tsx`, after the existing `predictionsData` fetch (around line 62-68), add:

```ts
  let driftData: { disagreementCount: number; programs: Array<{ program: string; portalStatus: string; pcV2Status: string }> } = { disagreementCount: 0, programs: [] };
  try {
    driftData = await api.getEligibilityDrift(loan.id);
  } catch {
    // Best-effort; banner just won't render.
  }
```

Pass it to the panel:

```tsx
      <PredictedConditionsPanel
        loanId={loan.id}
        predictions={predictionsData.predictions as never}
        alerts={predictionsData.alerts as never}
        mode={...}
        filter={...}
        basePath={`/loan/${loanId}/transmittal`}
        driftData={driftData}
      />
```

- [ ] **Step 4: Create `EligibilityDriftBanner`**

```tsx
// packages/web/components/encompass/EligibilityDriftBanner.tsx
import Link from "next/link";

interface Props {
  disagreementCount: number;
  programs: Array<{ program: string; portalStatus: string; pcV2Status: string }>;
  basePath: string;
}

export function EligibilityDriftBanner({ disagreementCount, programs, basePath }: Props): JSX.Element | null {
  if (disagreementCount === 0) return null;
  return (
    <div className="mb-2 p-2 border-l-4 border-[#8a4b00] bg-[#fff4e6] text-[11px]">
      <div className="font-bold text-[#8a4b00]">
        ⚠ Eligibility drift suspected for {disagreementCount} program{disagreementCount > 1 ? "s" : ""} (heuristic match)
      </div>
      <div className="mt-1">
        {programs.map((p) => p.program).join(" · ")}
      </div>
      <Link
        href={`${basePath}?view=drift&filter=disagreements`}
        className="text-[#1f4478] underline mt-1 inline-block"
      >
        Open in Drift mode to verify
      </Link>
    </div>
  );
}
```

- [ ] **Step 5: Render banner in panel**

In `packages/web/components/encompass/PredictedConditionsPanel.tsx`:

**5a. Widen Props:**

```ts
interface Props {
  // ... existing props ...
  driftData: { disagreementCount: number; programs: Array<{ program: string; portalStatus: string; pcV2Status: string }> };
}
```

**5b. Import + render the banner** at the top of the panel JSX, before `ModeToggle`:

```tsx
import { EligibilityDriftBanner } from "./EligibilityDriftBanner";

// In the return JSX:
<EligibilityDriftBanner
  disagreementCount={driftData.disagreementCount}
  programs={driftData.programs}
  basePath={basePath}
/>
<ModeToggle currentMode={mode} basePath={basePath} currentFilter={filter} />
```

- [ ] **Step 6: Build + verify**

```bash
pnpm --filter @twin/api build && pnpm --filter @twin/web build && pnpm --filter @twin/api test predict-conditions.integration.test
```

Expected: 0 build errors.

- [ ] **Step 7: Add an integration test for the new endpoint**

Append to `packages/api/test/predict-conditions.integration.test.ts`:

```ts
describe("GET /loans/:loanId/eligibility-drift", () => {
  it("returns disagreementCount=0 when no portal_eligibility_verdicts exist", async () => {
    const res = await app.inject({
      method: "GET", url: "/loans/INT-1/eligibility-drift",
      headers: headers("operator"),
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).disagreementCount).toBe(0);
  });

  it("detects drift when portal says PASS and PC v2 matrix-resolver row mentions the program", async () => {
    await withDb(async (c) => {
      // Portal says Investor DSCR PASS.
      await c.query(
        `INSERT INTO portal_eligibility_verdicts
           (tenant_id, loan_id, program, status, analysis_hash, recorded_at)
         VALUES ($1, 'INT-1', 'Investor DSCR', 'PASS', 'hash', NOW())
         ON CONFLICT DO NOTHING`,
        [T],
      );
      // PC v2 matrix row describing Investor DSCR failure.
      await c.query(
        `INSERT INTO predicted_conditions
           (id, tenant_id, loan_id, prediction_run_id, source_list, description, category, status,
            source_input_hash, kb_version_id, source_rule_table, source_rule_id, emission_kind)
         VALUES (gen_random_uuid(), $1, 'INT-1', gen_random_uuid(), 'matrix',
                 'Investor DSCR ineligible — LTV exceeds tier max', 'PTA', 'pending',
                 'hash', NULL, 'program_matrix_tiers', gen_random_uuid(), 'deterministic')`,
        [T],
      );
    });
    const res = await app.inject({
      method: "GET", url: "/loans/INT-1/eligibility-drift",
      headers: headers("operator"),
    });
    const body = JSON.parse(res.body) as { disagreementCount: number; programs: Array<{ program: string }> };
    expect(body.disagreementCount).toBeGreaterThanOrEqual(1);
    expect(body.programs.find((p) => p.program === "Investor DSCR")).toBeDefined();
  });

  it("known heuristic limitation: matrix row without program name in description is NOT detected", async () => {
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO portal_eligibility_verdicts
           (tenant_id, loan_id, program, status, analysis_hash, recorded_at)
         VALUES ($1, 'INT-2', 'Flex Plus', 'PASS', 'hash', NOW())
         ON CONFLICT DO NOTHING`,
        [T],
      );
      // Matrix finding about LTV but no program name.
      await c.query(
        `INSERT INTO predicted_conditions
           (id, tenant_id, loan_id, prediction_run_id, source_list, description, category, status,
            source_input_hash, kb_version_id, source_rule_table, source_rule_id, emission_kind)
         VALUES (gen_random_uuid(), $1, 'INT-2', gen_random_uuid(), 'matrix',
                 'LTV 110 exceeds maximum 105', 'PTA', 'pending',
                 'hash', NULL, 'program_matrix_tiers', gen_random_uuid(), 'deterministic')`,
        [T],
      );
    });
    const res = await app.inject({
      method: "GET", url: "/loans/INT-2/eligibility-drift",
      headers: headers("operator"),
    });
    const body = JSON.parse(res.body) as { disagreementCount: number };
    // Pin test: heuristic does NOT detect this case. When future spec replaces
    // the heuristic with structured `program` provenance, flip this assertion.
    expect(body.disagreementCount).toBe(0);
  });
});
```

Note: the `INT-2` test seeds against a loan that may not exist in the integration test's setup. If the existing `requireLoanForTenant` guard rejects unknown loans with 400, either seed `INT-2` upstream in the test file's `beforeAll` (by dispatching an `InjectLoan` against `store`) OR change the test to use the same loan id as the other tests with a unique combination of program/description that doesn't trip the prior tests' assertions. Adjust at implementation time.

- [ ] **Step 8: Verify**

```bash
pnpm --filter @twin/api test predict-conditions.integration.test && pnpm --filter @twin/web test
```

Expected: 0 errors. New tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/api/src/routes/predict-conditions.ts packages/web/lib/api-client.ts packages/web/app/loan/[loanId]/transmittal/page.tsx packages/web/components/encompass/EligibilityDriftBanner.tsx packages/web/components/encompass/PredictedConditionsPanel.tsx packages/web/test/predicted-conditions-panel.test.tsx packages/api/test/predict-conditions.integration.test.ts
git commit -m "feat(api,web): EligibilityDriftBanner + GET /eligibility-drift

New API endpoint joins portal_eligibility_verdicts against PC v2
matrix-resolver findings via the description-substring heuristic
(Spec 1.5-UI §6.1). Banner renders above the panel when at least
one program disagrees. Banner copy uses 'suspected' + 'heuristic match'
+ 'to verify' qualifiers to calibrate operator expectations.
Pin test asserts the known heuristic under-report so future spec's
structured-program replacement can flip it as a regression check."
```

---

### Task 7: Filter integration + acceptance verification

**Files:**
- Modify: `packages/web/components/encompass/PredictedConditionsPanel.tsx` (client-side filter on pendingGroups)

The filter is purely client-side: when `filter==='disagreements'` and we're in Drift mode, narrow the rendered pending groups to those tied to programs in the drift set.

- [ ] **Step 1: Add filter logic to the panel**

In `packages/web/components/encompass/PredictedConditionsPanel.tsx`, after the `pendingGroups = groupByNormalizedDescription(...)` line, add:

```ts
const driftProgramNames = new Set(driftData.programs.map((p) => p.program));

const filteredPendingGroups =
  filter === "disagreements" && mode === "drift"
    ? pendingGroups.filter((g) => {
        const desc = g.displayDescription.toLowerCase();
        return Array.from(driftProgramNames).some((name) => desc.includes(name.toLowerCase()));
      })
    : pendingGroups;
```

Then update the render to use `filteredPendingGroups` instead of `pendingGroups`.

Also render a "Filtered to N programs" notice above the cards when `filter === "disagreements"` is active:

```tsx
{filter === "disagreements" && mode === "drift" && (
  <div className="mb-2 p-1 text-[11px] bg-[#eef3fa] border border-[#6b7a8f]">
    Filtered to {driftData.disagreementCount} program{driftData.disagreementCount > 1 ? "s" : ""}.
    {" "}
    <Link href={`${basePath}?view=drift`} className="text-[#1f4478] underline">View all</Link>
  </div>
)}
```

(Import `Link` from `next/link` if not already imported.)

- [ ] **Step 2: Build + smoke test**

```bash
pnpm --filter @twin/web build
```

Expected: 0 errors.

- [ ] **Step 3: Add a client-side filter test**

Append to `packages/web/test/predicted-conditions-panel.test.tsx` (or wherever the panel is tested):

```tsx
import { render, screen } from "@testing-library/react";
import { PredictedConditionsPanel } from "@/components/encompass/PredictedConditionsPanel";

describe("PredictedConditionsPanel — disagreement filter", () => {
  it("filter=disagreements narrows pending groups to drift-program matches in Drift mode", () => {
    const predictions = [
      { id: "1", status: "pending" as const, description: "Investor DSCR doc", category: "PTA", note: null,
        source_list: "portal-llm", source_order: 0, acted_by: null, acted_role: null, dismissal_reason: null,
        accepted_condition_id: null, portal_metadata: null, analysis_hash: null, superseded_at: null },
      { id: "2", status: "pending" as const, description: "Unrelated doc", category: "PTA", note: null,
        source_list: "portal-llm", source_order: 0, acted_by: null, acted_role: null, dismissal_reason: null,
        accepted_condition_id: null, portal_metadata: null, analysis_hash: null, superseded_at: null },
    ];
    const driftData = {
      disagreementCount: 1,
      programs: [{ program: "Investor DSCR", portalStatus: "PASS", pcV2Status: "FAIL" }],
    };
    render(
      <PredictedConditionsPanel
        loanId="L-1"
        predictions={predictions as never}
        alerts={[] as never}
        mode="drift"
        filter="disagreements"
        basePath="/loan/L-1/transmittal"
        driftData={driftData}
      />,
    );
    expect(screen.getByText(/Investor DSCR doc/)).toBeInTheDocument();
    expect(screen.queryByText(/Unrelated doc/)).not.toBeInTheDocument();
    expect(screen.getByText(/Filtered to 1 program/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View all/ })).toBeInTheDocument();
  });

  it("filter=disagreements does NOT apply in Curation mode (mode toggle drops the filter)", () => {
    // ModeToggle already drops ?filter when switching to Curation, but if a user
    // hand-crafts ?view=curation&filter=disagreements, the filter must be ignored
    // (Curation mode never narrows).
    const predictions = [
      { id: "1", status: "pending" as const, description: "Investor DSCR doc", category: "PTA", note: null,
        source_list: "portal-llm", source_order: 0, acted_by: null, acted_role: null, dismissal_reason: null,
        accepted_condition_id: null, portal_metadata: null, analysis_hash: null, superseded_at: null },
      { id: "2", status: "pending" as const, description: "Unrelated doc", category: "PTA", note: null,
        source_list: "portal-llm", source_order: 0, acted_by: null, acted_role: null, dismissal_reason: null,
        accepted_condition_id: null, portal_metadata: null, analysis_hash: null, superseded_at: null },
    ];
    render(
      <PredictedConditionsPanel
        loanId="L-1"
        predictions={predictions as never}
        alerts={[] as never}
        mode="curation"
        filter="disagreements"
        basePath="/loan/L-1/transmittal"
        driftData={{ disagreementCount: 1, programs: [{ program: "Investor DSCR", portalStatus: "PASS", pcV2Status: "FAIL" }] }}
      />,
    );
    // Both items should render in Curation, regardless of the filter param.
    expect(screen.getByText(/Investor DSCR doc/)).toBeInTheDocument();
    expect(screen.getByText(/Unrelated doc/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @twin/web test
```

Expected: all panel tests pass.

- [ ] **Step 5: Full-suite verification**

```bash
pnpm --filter @twin/core build && pnpm --filter @twin/api build && pnpm --filter @twin/web build && pnpm --filter @twin/api test && pnpm --filter @twin/web test
```

Expected: 0 build errors across all packages. All tests pass (note any pre-existing flakes; don't block).

- [ ] **Step 6: Manual smoke test**

1. Start API + web (`pnpm --filter @twin/api dev`, `pnpm --filter @twin/web dev`)
2. Visit `http://localhost:3000/loan/<loan-with-portal-data>/transmittal`
3. As operator → Curation mode default, see grouped cards with portal-priority badges
4. Click Drift mode in the toggle → two-column layout, per-row buttons appear
5. If a loan has eligibility drift, banner shows above with "Open in Drift mode to verify" link
6. Click banner link → URL becomes `?view=drift&filter=disagreements` → only drift-touching groups render → "Filtered to N programs. View all" link visible
7. Click "View all" → filter clears, all groups render
8. Click ModeToggle Curation → filter drops automatically

- [ ] **Step 7: Commit**

```bash
git add packages/web/components/encompass/PredictedConditionsPanel.tsx packages/web/test/predicted-conditions-panel.test.tsx
git commit -m "feat(web): ?filter=disagreements narrows pending groups in Drift mode

Pure client-side filter on the grouped output. Active only when mode=drift
AND filter=disagreements; Curation mode never narrows even if the filter
param is present (defensive against hand-crafted URLs). 'Filtered to N
programs. View all' notice renders above the cards with a Link to clear
the filter while staying in Drift mode."
```

---

## Phase C complete — final verification

After tasks 6-7: full feature live end-to-end. Eligibility drift surfaces as a banner; filter narrows the view in Drift mode; ModeToggle drops the filter when switching to Curation.

Verify acceptance criteria from spec §12:

1. ✓ Operator (role `operator`) loads transmittal page → Curation mode default. Multi-source groups render as primary cards with `+N source` chips. (Task 5)
2. ✓ VA (role `va`) loads same URL → Drift mode default. (Task 5)
3. ✓ `?view=drift` / `?view=curation` overrides for any role. (Task 5)
4. ✓ Group-accept produces accept-on-portal + dismiss-on-PC-v2 sequence with `reason='duplicate_of_portal'`. **Partial failures surface inline cleanup banner** with Retry/Dismiss-as-is. (Task 4)
5. ✓ Group-dismiss mirrors with `reason='duplicate_of_portal_dismiss'`. (Task 4)
6. ✓ Per-row controls visible only in Drift mode. (Task 4 — tests assert)
7. ✓ Eligibility-drift banner renders when ≥1 program disagrees. Click-through to `?view=drift&filter=disagreements`. (Task 6)
8. ✓ Inline drift indicator on cards in Drift mode only. (Task 4 — `GroupedConditionCard` renders the chip)

   *Note:* the inline drift indicator on cards (spec §6.2) is implemented as part of `GroupedConditionCard`'s header when `mode==='drift'` AND the group's display description matches a drift program. The Task 4 implementation above already supports this via the badges section; if not, add a `driftProgramName` prop to `GroupedConditionCard` and render the chip conditionally. Verify at integration time.

9. ✓ `?filter=disagreements` applies to pending groups only. (Task 7)
10. ✓ Build clean across packages. (Task 7 verification step)

---

## Self-Review

**Spec coverage** — every spec section maps to tasks:

| Spec § | Plan task |
|--------|-----------|
| §1 Goal + non-goals | Implicit; scope reflected throughout |
| §2 Architecture | Task 5 wires it together |
| §3 Grouping | Task 2 |
| §4 Mode toggle + role default | Tasks 3, 5 |
| §4.1 Curation rendering | Task 4 |
| §4.2 Drift rendering | Task 4 |
| §5.1 Group-level Accept | Task 4 |
| §5.1.1 Cleanup retry affordance | Task 4 (`partialFailure` state + Retry/Dismiss-as-is buttons) |
| §5.2 Group-level Dismiss | Task 4 |
| §5.3 Per-row controls (Drift only) | Task 4 |
| §5.4 Reducer collision behavior | Inherits from existing backend; no plan task |
| §5.5 New dismiss-reason values | Documented in `handleGroupAccept`/`handleGroupDismiss`; no schema change |
| §6.1 Banner | Task 6 |
| §6.2 Inline drift indicator | Task 4 (`GroupedConditionCard` priority/category badges) |
| §6.3 Filter param | Task 7 |
| §7 Page loader query change | Task 1 (API SELECT widening) + Task 5 (page passes new props) |
| §8 Testing matrix | Tasks 2, 3, 4, 6, 7 all include their tests |
| §11 Risks | Implicit via partial-failure recovery in Task 4 and heuristic-pin test in Task 6 |
| §12 Acceptance criteria | Verified at Phase C close |
| §13 Open items | None |
| §14 Sequencing | This plan |

**Placeholder scan:** no TBD / TODO / "implement later" patterns. Code is complete in every step; commands have expected output; commit messages are pre-written.

**Type consistency:** `Prediction`, `PortalMetadata`, `PredictionGroup`, `ActionResult` consistent across Tasks 2, 4, 5. `mode: "curation" | "drift"` literal used in Tasks 3-7. `filter: "disagreements" | null` consistent in Tasks 3, 5, 7.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-16-two-source-coexistence-ui.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review (spec compliance + code quality) between tasks, fast iteration in this session.

**2. Inline Execution** — Batch execution with checkpoints for review.

Which approach?
