# HOI Validator v1.1 Hotfix — Codex Review Follow-ups

**Date:** 2026-05-18
**Source:** Codex review on PR #8 (submitted 2026-05-17T16:55:33Z, pre-merge)
**Scope:** 3 high-impact findings — 1 P1 + 2 P2. P1 RLS (defense-in-depth) and P2 extractorMode (config currently does nothing) deferred to v1.2.
**Target:** PR against `main`, branch `feature/hoi-validator-v1.1-hotfix`, merge + deploy to npnqm-twin same flow as PR #8.

---

## 1. Overview

The HOI/Flood Validator (PR #8, deployed 2026-05-17, commit `7a86aff`) shipped with three real bugs that codex caught pre-merge but we merged without addressing. The validator is operational but won't actually produce findings on existing-pending-batch loans (P1) and will produce wrong evidence on loans with both HOI + Flood policies (P2 flood extractionId). H12 also misfires on capitalized occupancy values from the NPNQM extras path (P2 occupancy case).

Each fix is small (1-line to 10-line code change) plus targeted tests. No new database migrations, no architectural changes, no UI changes.

**Quality bar:** existing 101 HOI api tests + 38 web tests + 137 core tests must continue to pass. ~10-15 new test cases added. Total effort: 2-3 days.

---

## 2. Finding A (P1): Reuse-batch early-return skips HOI

**Location:** `packages/api/src/services/predict-conditions/service.ts:257` (approx; the existing-pending-batch check guarding the resolver invocation block).

**Issue:** PC v2's `run()` has a fast-path that reuses an existing pending batch when the LoanContext hash matches a prior run. The HOI resolver is invoked AFTER this check, so any loan that already has pending v3 predictions short-circuits past the HOI resolver entirely. A new HOI extraction landing on such a loan never triggers `hoi-validator` predictions until something else invalidates the hash.

**Impact:** This is the primary failure mode for the validator in production. Most npnqm-twin loans will have pending predictions from prior PC v2 runs before HOI extractions land. The PC_SCHEMA_VERSION bump 2→3 forced a one-time re-fire on deploy, but ongoing extractions (the entire steady-state operation) are silently skipped.

**Fix:** Run the HOI resolver **always**, regardless of the reuse-batch path. The resolver has its own short-circuits (`hoiEnabled === false` returns `[]`; no extractions returns `[]`) so the marginal cost is one DB read per `run()` call. HOI findings have ON CONFLICT idempotency (migration 026's partial unique index keyed on `portal_metadata->>'extractionId'`) so re-running on the same extraction is a no-op insert.

**Implementation:**

Restructure `run()` so the resolver invocation block looks like:

```ts
// Existing-pending-batch reuse path: returns early for matrix/geographic/etc. resolvers,
// but HOI is always evaluated since extractions can arrive asynchronously after the batch
// was originally computed.
async function run(...) {
  // ...existing setup, hash computation, etc...

  const reusedBatch = await maybeReuseExistingBatch(c, tenantId, loanId, inputHash);

  // HOI resolver always runs — independent of reuse-batch decision.
  // Cheap when tenant is disabled or no extractions exist; idempotent inserts via migration 026.
  const hoiEnabled = await readHoiEnabled(c, tenantId);
  const hoiFindings = await resolveHoiValidatorFindings(c, tenantId, kbCtx, loan, {
    hoiEnabled,
    loanExternalId: loanId,
    loanNumber: <existing-source-of-truth>,
  });

  if (reusedBatch) {
    // Insert any new HOI findings on top of the reused batch (idempotent ON CONFLICT).
    await insertHoiValidatorFindings(c, tenantId, loanId, hoiFindings);
    return reusedBatch;
  }

  // Normal path: full resolver run + DELETE-pending exclusion list already excludes
  // 'hoi-validator' rows from the wipe, so HOI findings persist across re-runs.
  const otherFindings = await runPreUnderwriter(...);
  await insertAllFindings(c, [...otherFindings, ...hoiFindings]);
  return finalBatch;
}
```

The HOI-specific INSERT path (with `ON CONFLICT ON CONSTRAINT predicted_conditions_hoi_validator_active DO NOTHING`) already exists from Task 19; extract it into a helper function so both code paths can call it.

**Tests:**

- New Layer 3 integration test: seed a loan with cached pending v3 predictions (no HOI source) + a fresh HOI extraction with H1 failure. Run `run()`. Assert 1 new `hoi-validator` row inserted; reused-batch's other rows remain intact.
- New Layer 3 test: same setup but re-run `run()` a second time without any new extraction. Assert exactly 1 `hoi-validator` row exists (idempotent — no duplicate insertion).

---

## 3. Finding B (P2): Flood findings keyed to HOI extractionId

**Location:** `packages/api/src/services/predict-conditions/resolvers/hoi-validator-resolver.ts:89` — the `ctx.extractionId` assignment:

```ts
extractionId: hoiRow?.id ?? floodRow?.id ?? "",
```

**Issue:** When a loan has both an HOI policy AND a flood certificate, the resolver constructs a single `RuleContext` with `extractionId = hoiRow.id` (HOI wins the `??` chain). F1/F2 flood rules then emit `evidence.extractionId = ctx.extractionId` which is HOI's id, not flood's. Two downstream consequences:

1. The flood Finding's `portal_metadata.extractionId` (used as ON CONFLICT key per migration 026) becomes HOI's extractionId. When HOI gets re-extracted, its new extractionId would let a fresh HOI prediction in, but the existing flood prediction (keyed on the old HOI extractionId) becomes stale and won't be deduplicated against itself on re-run.
2. The evidence chain in `portal_metadata.validationFindings[].evidence.extractionId` points to the wrong document — a UW debugging an F1 finding gets HOI's extraction row, not flood's.

**Impact:** No findings emit incorrectly today because the flood rules also gate on `ctx.documents.floodCert !== null` (skip when missing), and there are zero loans with both HOI and flood extractions live in `npnqm-twin` yet. But the bug ships unfixed in the code; first real flood-cert loan with HOI will exhibit it.

**Fix:** Split `RuleContext.extractionId` into per-extraction IDs:

```ts
// Before:
export interface RuleContext {
  hoi: HoiPolicyFields | null;
  flood: FloodCertFields | null;
  loan: LoanContext;
  documents: { hoi: DocumentRef | null; floodCert: DocumentRef | null };
  extractionId: string;
  loanNumber: string;
}

// After:
export interface RuleContext {
  hoi: HoiPolicyFields | null;
  flood: FloodCertFields | null;
  loan: LoanContext;
  documents: { hoi: DocumentRef | null; floodCert: DocumentRef | null };
  hoiExtractionId: string | null;
  floodExtractionId: string | null;
  loanNumber: string;
}
```

Each rule reads the appropriate side:
- H1-H12: `evidence.extractionId = ctx.hoiExtractionId!` (non-null assertion safe because the rule already gated on `ctx.hoi` truthy)
- F1, F2: `evidence.extractionId = ctx.floodExtractionId!`

Resolver code change:
- Build context with separate IDs from each row.
- When emitting a Finding from rule output, `metadata.extractionId = r.finding.evidence.extractionId` (which now correctly reflects which document the rule consulted).

**Tests:**

- New Layer 1 test: H1 (HOI rule) on a context with both `hoiExtractionId` and `floodExtractionId` set — verify finding evidence carries `hoiExtractionId`.
- New Layer 1 test: F1 (flood rule) on the same context — verify finding evidence carries `floodExtractionId`.
- New Layer 3 integration test: seed a loan with both HOI + flood extractions producing both H1 + F1 failures. Assert two `hoi-validator` predictions inserted, each with the correct extractionId in `portal_metadata.extractionId` AND in `portal_metadata.validationFindings[0].evidence.extractionId`.

**Migration impact:** None. The partial unique index from migration 026 is unaffected — it just keys on whatever string is in `portal_metadata->>'extractionId'`. Existing rows in production have HOI extractions only (no flood data yet), so they aren't affected by the shape change.

---

## 4. Finding C (P2): Occupancy case mismatch

**Location:** `packages/api/src/services/validators/hoi/rules/conditional.ts:111` — H12's non-DSCR branch:

```ts
if (ctx.loan.occupancy === "primary" && !policyOcc.includes("primary") && !policyOcc.includes("owner")) {
```

**Issue:** `LoanContext.occupancy` is typed as `"primary" | "second_home" | "investment"` (lowercase) per `doc-requirements.ts`. The NPNQM portal adapter (`npnqm-portal.ts`) extracts occupancy from the portal payload as `"Primary"`/`"Secondary"`/`"Investment"` (capitalized — Encompass's canonical case per the assessment screenshots). When `LoanContextExtras` is overlaid onto `LoanContext`, the capitalized value can land in `ctx.loan.occupancy`. The H12 strict-equality check then fails silently — primary-residence loans with policies marked anything other than "primary" don't get flagged.

**Impact:** H12 produces false-negatives on non-DSCR primary-residence loans with mismatched policy occupancy. UWs miss the warning. DSCR branch is unaffected (case-insensitive `.toLowerCase()` already applied).

**Fix:** Normalize both sides of the H12 comparison to lowercase. Surgical edit to a single line:

```ts
// Before:
if (ctx.loan.occupancy === "primary" && !policyOcc.includes("primary") && !policyOcc.includes("owner")) {

// After:
if (ctx.loan.occupancy?.toLowerCase() === "primary" && !policyOcc.includes("primary") && !policyOcc.includes("owner")) {
```

**Broader concern (out of scope for v1.1):** The boundary between `LoanContextExtras` (loose string types) and `LoanContext` (narrow enum) is the real culprit. The fix belongs in the adapter / extras-overlay step. Tracked as a v1.2 cleanup: ensure `npnqm-portal.ts` canonicalizes `occupancy` to the lowercase enum before writing to `LoanContextExtras`. For v1.1, the surgical H12 fix prevents the symptom; the same normalization should be applied to other consumers of `loan.occupancy` in a v1.2 sweep.

**Tests:**

- New Layer 1 test: H12 on non-DSCR loan with `ctx.loan.occupancy = "Primary"` (capitalized) and `occupancyOnPolicy = "Investment"` → expect fail finding.
- New Layer 1 test: H12 on non-DSCR loan with `ctx.loan.occupancy = "PRIMARY"` (all caps) → still expects fail finding (case-insensitive across the casing spectrum).
- Existing H12 tests with lowercase "primary" continue to pass (no regression).

---

## 5. Out of Scope (deferred to v1.2)

These two codex findings are real but not v1.1-urgent:

### 5.1 P1: Worker bypasses tenant context (defense-in-depth)

`packages/api/src/hoi-extractor-dispatcher.ts:57` uses `withDb` (no `app.current_tenant` set) for INSERT/UPDATE on `document_extractions`. Migration 025 set `FORCE ROW LEVEL SECURITY` on the table. Works today because the Supabase pooler runs as a role that bypasses RLS (established project pattern per memory: `Supabase pooler bypasses RLS`). If/when we switch to a non-bypassing role or move off the pooler, this breaks.

**Why deferred:** No production impact today. The fix requires restructuring the worker to `withDb` for the candidate-selection query (cross-tenant) and `withTenantTx(doc.tenant_id, ...)` for per-document inserts. Non-trivial but cleanly scoped. Better as its own focused PR.

### 5.2 P2: `extractorMode` tenant config ignored

`defaultExtractor()` in `hoi-extractor-dispatcher.ts:46` always returns `CompositeHoiExtractor(mode="auto")`. The `validators.hoi.extractorMode` setting from `tenant_schemas.ts` is parsed and stored but never consulted by the worker.

**Why deferred:** The npnqm-twin tenant is configured `extractorMode = "auto"` so the actual behavior matches what code does. No tenant is using `portal-only` or `llm-only` yet. The fix requires reading `tenants.settings.validators.hoi.extractorMode` in the dispatch loop and passing to `CompositeHoiExtractor`. Small but adds another DB read per worker poll cycle — wants careful design.

Both v1.2 follow-ups can ship together once a real driver appears (e.g., NPNQM asking for `portal-only` to validate their extraction quality, or a roll-out to a different tenant role that doesn't have RLS bypass).

---

## 6. Sequencing

Suggested order for the implementation plan (writing-plans skill will break into bite-sized tasks):

1. **Finding C (occupancy case)** — surgical 1-line fix + 2 new Layer 1 tests. ~1 hour. Lowest risk; warms up the branch.
2. **Finding B (flood extractionId)** — `RuleContext` shape change → ripples into all 14 rules' evidence emission → resolver context construction. ~1 day including Layer 1 + Layer 3 tests.
3. **Finding A (reuse-batch)** — extract shared `insertHoiValidatorFindings` helper from existing Task 19 code → call from both reuse-batch and full-run paths in `service.ts` → 2 new Layer 3 integration tests. ~1 day.
4. **Smoke test** — deploy + verify a real npnqm-twin loan with existing pending v3 predictions actually picks up a fresh HOI extraction. (Currently no real HOI policies are landed, so this test path may need to be simulated via test DB seed.)
5. **Memory + PR** — update `project_hoi_validator_operational.md` to note v1.1 fixes; open PR; codex review; merge + deploy.

---

## 7. Test Plan

Pre-merge required:
- All existing tests pass: 137 core + 101 HOI api + 38 web
- New Layer 1 cases: ≥4 (Finding B: 2; Finding C: 2)
- New Layer 3 cases: ≥4 (Finding A: 2; Finding B: 1; Finding A reuse-idempotency: 1)
- `pnpm --filter @twin/api build` clean
- `pnpm --filter @twin/core build` clean
- `pnpm --filter @twin/web build` clean (Next.js production)

Post-deploy verification:
- API boot log still shows `[hoi-extractor] starting dispatcher (lock 46, poll 5000ms)`
- `/health` returns 200
- Run a synthetic HOI extraction insert against a real npnqm-twin loan that has existing pending v3 predictions; trigger PC v2 run via internal API; observe a new `hoi-validator` prediction row.

---

## 8. NPNQM-side asks

None new. The deferred v1.2 items don't require NPNQM input. The HOI Validator NPNQM-side asks from PR #8 (`docs/npnqm-source/2026-05-16-job-aid-followup.md` §4.1) remain unanswered but don't block this hotfix.

---

*This hotfix closes the highest-impact codex findings. Validator's steady-state operation (HOI extractions on loans with pre-existing predictions) becomes correct, flood + HOI coexistence becomes correct, and H12 occupancy case-handling stops false-negatively skipping on NPNQM-style capitalized values. Effort: 2-3 days end-to-end.*
