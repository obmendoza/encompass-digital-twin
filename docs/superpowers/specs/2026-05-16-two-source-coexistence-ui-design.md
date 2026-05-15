# Two-Source Coexistence UI — Design

**Date:** 2026-05-16
**Status:** Draft
**Predecessors:**
- [Portal Analysis Output Ingestion (Spec 1.5)](2026-05-15-portal-analysis-output-ingestion.md) — backend persists portal-llm + PC v2 rows side-by-side
- [PC v2 Pre-Underwriter Design](2026-05-14-pc-v2-pre-underwriter-design.md) — PC v2 emission semantics
- [NPNQM Ingestion Framework](2026-05-14-ingestion-framework-design.md) — overall architecture

**Platform precondition:** `x-user-role` request header is set by `packages/web/middleware.ts` from the Supabase `user_roles` table (see `packages/web/lib/auth.ts`). This UI consumes the header as-is.

---

## 1. Goal

Close the UI gap from Spec 1.5 §7.1. Portal-LLM and PC v2 predictions coexist in `predicted_conditions` with distinct `source_list` values, but the existing `PredictedConditionsPanel.tsx` renders rows flat with no concept of source-aware grouping. Operators today see 17 portal-llm rows AND 5-10 PC v2 rows AND the duplicates between them, all as undifferentiated cards — high noise, slow curation, no signal for drift.

This spec extends the existing panel with **role-aware mode rendering** so:

- **Operators** see a Curation view: one card per normalized-description group, portal-llm row as the primary content (priority/severity badges, specifications, reasons), PC v2 rows collapsed as a `+1 source` chip. Fast accept/dismiss throughput.
- **VAs/UWs** see a Drift view: same groups, but portal and PC v2 rows expand side-by-side, disagreement highlights, per-row controls available. Diagnostic depth.

Same data, same component, two render paths via a URL query param.

### 1.1 Non-goals

- **No backend change.** Spec 1.5 shipped the data model; the API endpoints (`actionAcceptPrediction`, `actionDismissPrediction`) are per-row and stay that way. The UI orchestrates multi-row sequences client-side.
- **No new prediction sources.** Same `source_list` values: `portal-llm`, `matrix`, `geographic`, `requirements`, `minimum`, `income`.
- **No drift-detection improvements.** The inline drift indicator inherits Spec 1.5's known limitation (`description.includes(program)` heuristic under-reports matrix-resolver failures). A future spec will land a structured `program` column on matrix findings; this UI re-uses the existing signal as-is.
- **No new admin pages.** Pure modifications to the loan-detail predictions panel and its container page.

---

## 2. Architecture

```
packages/web/components/encompass/PredictedConditionsPanel.tsx  (modify)
│
├── ModeToggle (segmented control)                          ← NEW
│   └── reads/writes ?view=curation|drift URL param
│
├── EligibilityDriftBanner                                  ← NEW
│   └── data: page-loader query against portal_eligibility_verdicts + predicted_conditions
│
├── groupByNormalizedDescription(predictions)               ← NEW pure helper
│   └── uses @twin/core normalizeConditionDescription (shared with PC v2 reducer)
│
└── GroupedConditionCard[]                                  ← NEW component
    ├── header: description + source badges + priority/severity (from portal_metadata)
    ├── Curation mode: portal-llm content expanded; PC v2 collapsed to chip
    ├── Drift mode: both expanded side-by-side; per-row Accept/Dismiss
    └── group-level Accept/Dismiss (orchestrates per-row API calls)
```

`GroupedConditionCard` preserves the keyboard-nav patterns of the existing `PredictedConditionsPanel` cards (focus management, j/k navigation, a/d shortcuts) IF they exist. Verify against the current component at implementation time; do not regress.

Page route stays unchanged: `packages/web/app/loan/[loanId]/predictions/page.tsx` (server component) feeds the panel as today. The server component reads `searchParams.view` + `x-user-role` header to pick the default mode and passes it down.

The `Prediction` interface in the panel needs ONE new field — `portal_metadata?: PortalMetadata | null` — to access portal-llm rich data. The backend already populates this (Spec 1.5 migration 023); just need to widen the TS shape and update the API response that `predictions/actions.ts` (or wherever the panel loads from) returns.

---

## 3. Grouping

A pure client-side helper grouping `Prediction[]` by normalized description:

```ts
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
  return Array.from(groups.entries()).map(([key, rows]) => {
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
  }).sort((a, b) => priorityRank(a) - priorityRank(b));
}

function priorityRank(g: PredictionGroup): number {
  const meta = g.portalRow?.portal_metadata as PortalMetadata | undefined;
  if (meta?.severity === "HARD-STOP") return 0;
  if (meta?.priority === "P0") return 1;
  if (meta?.priority === "P1") return 2;
  if (meta?.priority === "P2") return 3;
  return 4;
}
```

Pure function. No DB calls, no side effects. Pending rows only — accepted/dismissed rows bypass the grouper and render in their existing sections at the bottom of the panel.

**Single-source groups** (PC v2-only or portal-only) flow through the same code path. `hasMultipleSources=false`. Curation and Drift render identically for these — the mode toggle only diverges when multiple sources are present. This is the graceful-degradation property that lets demo tenants (no portal data) keep working with zero UI change.

---

## 4. Mode toggle + role default

**URL param:** `?view=curation|drift`. Server-component reads `searchParams.view` and `x-user-role` header:

```ts
// `x-user-role` is set upstream by packages/web/middleware.ts:38, which
// reads the role from the Supabase user_roles table via packages/web/lib/auth.ts.
// If a request reaches this server component without the header (auth misconfiguration,
// new route forgetting middleware coverage), default to "operator" — the Curation
// mode is the safer fallback because it doesn't expose the diagnostic Drift surface
// to users whose role hasn't been resolved.
const explicitView = searchParams.view;
const role = headers["x-user-role"] ?? "operator";
const mode: "curation" | "drift" =
  explicitView === "drift" || explicitView === "curation"
    ? explicitView
    : (role === "operator" ? "curation" : "drift");
```

Operator hits page bare → Curation. VA/UW hits page bare → Drift. Anyone with explicit `?view=...` overrides.

**Toggle UI** at the top of the panel (below alerts row):

```
View:  [ Curation ]  [ Drift ]
```

Segmented control. Clicking flips the URL via Next's `<Link>` with the new query — no client-state-only behavior. Deep-linkable.

### 4.1 Curation mode rendering

```
┌─ Credit Report                          [P0]  [SOFT-STOP]  [Credit] ┐
│  Portal-LLM · +1 source (PC v2 matrix)                                │
│                                                                       │
│  ▸ Specifications (9)                                                 │
│  ▸ Reasons (5)                                                        │
│  ▸ Source: NQMF Guidelines - Credit Report Requirements               │
│                                                                       │
│  [ Accept ]   [ Dismiss ]                                             │
└───────────────────────────────────────────────────────────────────────┘
```

Portal-llm content dominates. PC v2 rows live behind a small disclosure chip — operator can click to see them but doesn't have to. Specifications and reasons render as collapsed disclosures (operator expands the ones they want to verify).

Single-source group from PC v2-only (e.g., demo tenant): same card shape, no priority/severity badges (PC v2 has no `portal_metadata`), no specifications disclosure (PC v2 has no `specifications` array). The card is leaner but the layout is the same.

### 4.2 Drift mode rendering

```
┌─ Credit Report                          [P0]  [SOFT-STOP]  [Credit] ┐
│  Portal-LLM      │   PC v2 matrix                                    │
│                  │                                                   │
│  ▸ Specs (9)     │   "Investor DSCR FICO 800 — verify against"       │
│  ▸ Reasons (5)   │     [ Accept ]  [ Dismiss ]                        │
│  ▸ Source        │                                                   │
│  [ Accept ]      │                                                   │
│  [ Dismiss ]     │                                                   │
└───────────────────────────────────────────────────────────────────────┘
```

Two-column. Per-row accept/dismiss visible on each side. Group-level Accept still available at the bottom (orchestrates the recommended portal-accept-PC-dismiss flow per §5). Disagreement highlight: if the group is tied to a program in the eligibility-drift set (§6.2), the card gets a yellow left border + `Drift: Investor DSCR (Portal PASS, PC v2 FAIL)` chip in the header.

---

## 5. Accept / dismiss flow

**No backend change.** The existing `actions.ts` exports per-row `actionAcceptPrediction(loanId, predictionId)` and `actionDismissPrediction(loanId, predictionId, reason)`. The panel orchestrates multi-row sequences:

### 5.1 Group-level Accept (recommended-accept-portal-dismiss-pc)

```ts
const [partialFailures, setPartialFailures] = useState<
  Map<string, { groupKey: string; failedPcRowIds: string[] }>
>(new Map());

async function handleGroupAccept(group: PredictionGroup): Promise<void> {
  setError(null);
  startTransition(async () => {
    if (group.portalRow) {
      const r = await actionAcceptPrediction(loanId, group.portalRow.id);
      if (!r.ok) { setError(`Accept failed: ${r.error}`); return; }
    } else {
      const r = await actionAcceptPrediction(loanId, group.rows[0]!.id);
      if (!r.ok) { setError(`Accept failed: ${r.error}`); return; }
    }
    const failed: string[] = [];
    for (const pcRow of group.pcV2Rows) {
      if (!group.portalRow) continue;
      const r = await actionDismissPrediction(loanId, pcRow.id, "duplicate_of_portal");
      if (!r.ok) failed.push(pcRow.id);
    }
    if (failed.length > 0) {
      setPartialFailures((prev) => {
        const next = new Map(prev);
        next.set(group.normalizedKey, { groupKey: group.normalizedKey, failedPcRowIds: failed });
        return next;
      });
    }
    router.refresh();
  });
}
```

Accept the portal row (richer metadata becomes the canonical condition for downstream Spec 2 writeback). Then dismiss every parallel PC v2 row with `reason='duplicate_of_portal'`. Dismissal failures are tracked in the `partialFailures` Map (keyed by `normalizedKey`) rather than silently logged — the portal accept already succeeded and is the load-bearing action, but leftover PC v2 rows would render as phantom single-source cards on next render without the cleanup-failure banner in §5.1.1.

**Loading state during the transition.** The group card renders with `aria-busy={isPending}` and `className={isPending ? "opacity-60 pointer-events-none" : ""}` while the accept-then-dismiss sequence is in flight (~150ms × N rows). Without this, operator clicks Accept and sees no UI change for the ~450ms median sequence — risk of double-click and confusion. The existing `useTransition()` hook surfaces `isPending` cleanly; no new state needed.

### 5.1.1 Cleanup retry affordance

When `handleGroupAccept` produces partial failures, the panel renders a banner above the predictions list:

```
⚠ Accept succeeded but cleanup incomplete.
   1 duplicate row failed to dismiss for "Credit Report".
   [ Retry cleanup ]  [ Dismiss as-is ]
```

The banner is sourced from the `partialFailures` Map. One banner per failed group; banners stack if multiple groups have unresolved cleanup.

**Retry cleanup** re-issues `actionDismissPrediction` for each `failedPcRowIds` entry. Same `reason='duplicate_of_portal'`. On success, the entry is removed from `partialFailures` and `router.refresh()` runs. On second failure, the banner stays — operator can retry again or click "Dismiss as-is".

**Dismiss as-is** clears the `partialFailures` entry without re-issuing the API call. The phantom PC v2 cards stay as `status='pending'` until the operator manually dismisses them via the per-card controls (Drift mode) or accepts/dismisses them as standalone predictions. The audit-log entry trail makes this visible to ops.

The banner persists across navigation if `partialFailures` is lifted to a session-storage hook (`use-local-storage` or similar). For v1, in-memory `useState` is acceptable; navigating away loses the warning. Document this trade-off explicitly so operators don't expect cross-page persistence.

If the panel reloads (e.g., browser refresh) and PC v2 rows still match the `failedPcRowIds`, the banner doesn't re-render automatically. Operator's recourse is to use the per-card controls in Drift mode. This is the "if retry also fails" recovery path — not silent, just manual.

### 5.2 Group-level Dismiss

Mirror logic. Operator picks a reason via the existing modal; portal row dismisses with that reason; PC v2 rows dismiss with `reason='duplicate_of_portal_dismiss'`. Audit trail shows both: operator's intentional portal dismiss + the system's auto-cleanup.

### 5.3 Per-row controls (Drift mode only)

Expanded card in Drift mode shows individual `Accept` / `Dismiss` buttons next to each row. Operator can accept ONLY the PC v2 row (rejecting the portal's prediction) — useful for "PC v2 flagged something the portal missed" cases. In Curation mode the per-row controls are hidden; only the group-level button is visible.

### 5.4 Reducer collision behavior

The backend's `AddCondition` collision detector still works as-is. If accepting the PC v2 row would create a duplicate condition (same normalized description as the already-created portal-row condition), the reducer rejects. Safety net for the rare manual-override case. UI surfaces the reducer error inline near the failing per-row button.

### 5.5 New dismiss-reason values

Add to whatever dropdown the existing dismiss modal renders:
- `duplicate_of_portal`
- `duplicate_of_portal_dismiss`

These rarely appear as operator-selected reasons — they're system-generated from the group-level flow. Including them in the dropdown means: if the audit log shows them, operators searching for "what does this reason mean?" can match against the dropdown's label.

---

## 6. Eligibility disagreement indicator

### 6.1 Banner

```
⚠  Eligibility drift suspected for 2 programs (heuristic match)
   [Investor DSCR · Flex Plus]
   View → [Open in Drift mode to verify]
```

Renders at the top of the panel (above the mode toggle) when at least one disagreement exists. Server-component query during page load:

```sql
SELECT
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
WHERE pev.tenant_id = $1 AND pev.loan_id = $2 AND pev.superseded_at IS NULL
```

Disagreement = (`portal_status='PASS' AND pc_v2_failed=true`) OR (`portal_status='FAIL' AND pc_v2_failed=false`). Same heuristic as the Spec 1.5 backend audit; inherits the same known limitation (under-reports because matrix-resolver findings for LTV/loan-amount don't mention the program name). When a future spec lands structured `program` provenance on matrix findings, both the banner and the backend signal pick up the richer source automatically.

Banner link: `?view=drift&filter=disagreements` — filters the panel to groups touching the disagreeing programs.

**Heuristic confidence note.** The `description ILIKE` match catches the "no matching tier" matrix finding cleanly (it mentions the program name). It can over-report when a matrix finding about a different aspect (e.g., property collateral restriction) happens to mention a program name. The banner copy includes "heuristic match" + "verify in Drift mode" so operators calibrate expectations. When a future spec lands structured `program` provenance on matrix findings, the heuristic is replaced and the banner becomes authoritative.

**Localization.** Banner copy uses literal strings in v1 (English only). If the platform exposes i18n primitives in the future, the literal copy moves to a localization key.

### 6.2 Inline drift indicator (Drift mode only)

Each `GroupedConditionCard` carries a `Drift` chip in the header when its document is tied to a disagreeing program:
- Group's normalized description mentions a program in the disagreement set, OR
- Group's `portal_metadata.tags` includes a program identifier from the set

Card gets a yellow left border. Chip text: `Drift: Investor DSCR (Portal PASS, PC v2 FAIL)`.

**Curation mode hides the inline indicator** — operator's job is curation throughput; drift signals would slow them down. The banner stays visible in both modes so the operator at least knows drift exists.

### 6.3 Filter param

`?filter=disagreements` (Drift mode only) narrows the rendered **pending** groups to those tied to programs in the disagreement set. Implemented as a client-side `predictionGroups.filter(...)` after grouping — no new server query.

**Accepted/dismissed sections** below the pending groups are NOT filtered by the disagreement set. Operator filters intent is "show me what to look at next"; accepted/dismissed history is reference context that helps the operator remember what they've already cleared in this loan.

When the filter is active, render a banner above the pending groups: `Filtered to 2 programs. [View all]`. The "View all" link clears the filter via `?view=drift` (no filter param).

---

## 7. Page loader query change

The server component at `packages/web/app/loan/[loanId]/predictions/page.tsx` (or wherever loads via `actions.ts`) gains two queries:

1. **`portal_metadata`** in the existing predictions SELECT — add the column to the field list. Already in DB (Spec 1.5 migration 023). One-line server change.

2. **Disagreement banner data** — the §6.1 query, called per page load. Sub-millisecond against the session pooler. No caching for v1.

If the existing API surface that `actions.ts` calls returns predictions as a flat array, `portal_metadata` flows through naturally with the schema widening. If it goes through a typed response, the type also widens.

---

## 8. Testing strategy

| Layer | What | How |
|-------|------|-----|
| Helper unit | `groupByNormalizedDescription` | Pure-function test with synthetic `Prediction[]` covering: portal+PC v2 same description, portal-only, PC v2-only, three sources for one description, mix of pending+accepted+dismissed (accepted/dismissed excluded), priority sort. |
| Helper unit | `priorityRank` | Six cases (HARD-STOP, P0, P1, P2, no portal, no portal_metadata at all). Asserts sort order. |
| Component render | `GroupedConditionCard` in Curation mode | Vitest + testing-library — render with multi-source group, assert portal content visible, PC v2 chip visible, per-row buttons HIDDEN. |
| Component render | `GroupedConditionCard` in Drift mode | Render same group, assert both sides visible, per-row buttons VISIBLE. |
| Component render | Single-source PC v2 group | Render in both modes; assert no priority badges, no specifications disclosure, no PC v2 chip (nothing to collapse). |
| Accept flow | `handleGroupAccept` multi-source | Mock `actionAcceptPrediction` + `actionDismissPrediction`; assert portal row accepted FIRST, then each PC v2 row dismissed with `reason='duplicate_of_portal'`. |
| Accept flow | `handleGroupAccept` single-source | Mock actions; assert only `actionAcceptPrediction` called once, no dismiss calls. |
| Accept flow | Dismiss failure — cleanup banner renders | Mock `actionAcceptPrediction` ok + `actionDismissPrediction` fail; assert `router.refresh()` still called, `partialFailures` Map has the failed row IDs, cleanup-failure banner renders with Retry cleanup + Dismiss as-is affordances (§5.1.1). |
| Mode default | Server-component logic | Pure-function test of the mode resolver: `(undefined, "operator") → curation`, `("drift", "operator") → drift`, `(undefined, "va") → drift`. |
| Banner | Disagreement query | DB-integration test: seed portal_eligibility_verdicts + predicted_conditions, run the query, assert disagreement rows match expected. |
| Banner | Empty state | Banner not rendered when zero disagreements. |
| Banner heuristic limitation | Pin test asserting the known under-report | Seed `portal_eligibility_verdicts` with `Investor DSCR: PASS` AND a matrix-resolver finding describing LTV failure (no program name in description). Assert the banner does NOT render. When future spec replaces the heuristic with structured `program` provenance, flip this assertion. |
| Existing tests | `predicted-conditions-panel.test.tsx` | Must still pass — no regressions to single-source rendering for demo tenants. |

---

## 9. Out of scope (deferred)

- **Drift-detection improvement.** The under-reporting heuristic stays the same as Spec 1.5. A future spec adds structured `program` provenance on matrix findings; both UI and backend audit pick up the richer signal automatically when it lands.
- **Per-user mode preference.** URL param is enough for v1. If product wants "remember my mode choice across sessions" later, add a user-prefs surface.
- **Mode persistence across navigation.** URL query param is deep-linkable but doesn't survive cross-page navigation (operator clicks to `/loan/X/conditions`, then back → no `?view=drift`, mode resets to role default). Acceptable v1 trade-off; if operators report friction, persist in session storage in a future iteration.
- **Drift-banner across multiple loans.** This UI is loan-scoped. A "loans with eligibility drift" dashboard is a separate spec.
- **Real-time updates.** Page is server-rendered; refresh on action. No WebSocket push for live drift updates.
- **Curation history view.** Accepted/dismissed predictions render in their existing sections; no new "audit trail per condition" UI.

## 10. Out of scope (true non-goals)

- Backend dedup at insert time. Spec 1.5 §7.1 explicitly chose no cross-source dedup; this UI consumes the parallel rows.
- A "third source" — design assumes portal-llm OR PC v2; doesn't reserve UI affordance for a hypothetical future LLM-3.
- Mobile-responsive Drift mode. Desktop-first. Drift's two-column layout collapses below ~900px (acceptable v1 trade-off; UWs work on laptops).

---

## 11. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Banner under-reports drift (same heuristic limitation as backend) | Documented in §6.1; future spec replaces the heuristic with structured `program` provenance — picks up automatically here. |
| Banner over-reports drift when matrix findings mention program names incidentally | Banner copy includes "heuristic match" qualifier and "verify in Drift mode" callout. Drift mode itself uses the same heuristic for inline indicators but allows operator to inspect specific cards. False-positive cost is operator-confidence erosion; mitigation is honest banner copy. Future spec replaces the heuristic with structured `program` provenance from matrix-resolver. |
| Group-accept partial failure produces phantom single-source cards on next render | The `partialFailures` Map (§5.1) tracks failed dismiss calls per group. An inline banner above the predictions list surfaces the failure with `Retry cleanup` and `Dismiss as-is` affordances (§5.1.1). Operator gets an immediate visual signal; manual fallback via Drift mode per-card controls if retry exhausts. Cross-page persistence deferred to a future iteration. |
| Mode toggle URL pollution breaks deep links | URL param is opt-in (default resolved server-side). Existing `/loan/[loanId]/predictions` deep links keep working — they just resolve to role-default mode. |
| `router.refresh()` after group accept resets scroll position + expanded disclosures | Acceptable for v1; operator's flow is "click Accept → page refreshes → scroll to next pending group." Future iteration could use Next's granular cache invalidation via `revalidateTag` to refresh only the predictions panel data, preserving non-form UI state. |
| Performance: grouping on a large predictions array (>100 rows) | `Map`-backed grouping is O(N); 100 predictions = sub-millisecond. Not a concern at expected scale (17-35 rows per loan). |
| Existing panel tests break on the schema widening | `portal_metadata?: PortalMetadata \| null` is additive; existing tests with predictions lacking the field continue to type-check and render. New tests cover the field's presence. |
| Operator confusion when same condition appears in BOTH a grouped card AND an already-accepted condition (race during multi-row sequence) | The reducer's collision detector prevents the double-write; UI surfaces the resulting error inline. Race window is ~50ms (network RTT × 2). |

---

## 12. Acceptance criteria

1. Operator (role `operator`) loads `/loan/[loanId]/predictions` for a loan with both portal-llm and PC v2 rows. The panel defaults to Curation mode. Multi-source groups render as single primary cards with `+N source` chips. Single-source PC v2 groups (demo tenant) render unchanged.
2. VA (role `va`) loads the same URL. Panel defaults to Drift mode. Multi-source groups render two-column.
3. `?view=drift` overrides for any role. `?view=curation` overrides for any role.
4. Accepting a multi-source group's card produces: one `actionAcceptPrediction` call on the portal row + one `actionDismissPrediction` call per PC v2 row with `reason='duplicate_of_portal'`. Audit log shows the matching rows. **When any dismiss returns `!r.ok`, an inline cleanup-failure banner renders with Retry cleanup + Dismiss as-is affordances** (§5.1.1). Retry re-issues the failed dismisses; Dismiss as-is clears the warning without retrying.
5. Dismissing a multi-source group mirrors the above with `reason='duplicate_of_portal_dismiss'` on the PC v2 dismissals.
6. Per-row Accept/Dismiss buttons VISIBLE only in Drift mode; Curation mode hides them.
7. Eligibility-drift banner renders when at least one `portal_eligibility_verdicts` row disagrees with PC v2 matrix-resolver findings (per the §6.1 heuristic). Banner clicks through to `?view=drift&filter=disagreements`.
8. Inline drift indicator on cards renders in Drift mode only. `?filter=disagreements` (Drift mode) narrows pending groups to disagreement-touching ones; accepted/dismissed sections remain unfiltered; "Filtered to N programs" banner with "View all" link renders above the pending groups.
9. Existing `predicted-conditions-panel.test.tsx` passes unchanged.
10. Build clean across `@twin/core`, `@twin/api`, `@twin/web`.

---

## 13. Open items

None this round — all clarifying questions resolved during brainstorm.

---

## 14. Sequencing for the plan

Three phases, small scope:

- **Phase A — Schema widening + helper** (2 tasks): widen `Prediction` interface to include `portal_metadata`; update `actions.ts` / page loader to select the column. Add `groupByNormalizedDescription` + `priorityRank` helper + unit tests.
- **Phase B — Card + mode rendering** (3 tasks): `GroupedConditionCard` component. ModeToggle component. Server-component mode resolver. Component tests.
- **Phase C — Disagreement banner + integration** (2 tasks): server-side disagreement query + `EligibilityDriftBanner` component. Wire `?filter=disagreements` client-side filter. Acceptance test pass.

Estimate: **7 plan tasks across 3 phases, ~1 week of work**. Single component file + a banner + a helper module; no DB changes, no API changes, no new routes.

---

*End of design.*
