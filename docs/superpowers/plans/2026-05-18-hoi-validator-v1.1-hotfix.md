# HOI Validator v1.1 Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address the 3 high-impact codex review findings from PR #8 (P1 reuse-batch, P2 flood extractionId, P2 occupancy case) so the HOI/Flood Validator's steady-state operation is correct.

**Architecture:** No new tables, no new architectural patterns. Three surgical fixes: (a) restructure `service.ts` so HOI resolver runs outside the reuse-batch early-return; (b) split `RuleContext.extractionId` into per-side `hoiExtractionId`/`floodExtractionId` and update all 14 rules' evidence emission; (c) lowercase `LoanContext.occupancy` before H12's strict-equality compare. All existing test suites continue to pass; ~10-15 new test cases added.

**Tech Stack:** TypeScript strict, Vitest, pnpm workspace. No migrations, no UI changes, no external dependencies.

**Spec source:** `docs/superpowers/specs/2026-05-18-hoi-validator-v1.1-hotfix.md` (commit `fcc10d4`).

**Base commit:** `7a86aff` (merged PR #8) on `main`. Branch: `feature/hoi-validator-v1.1-hotfix`.

---

## File Structure

**Files modified (no new files):**

- `packages/api/src/services/validators/hoi/rules/types.ts` — widen `RuleContext` interface (replace `extractionId: string` with `hoiExtractionId: string | null` + `floodExtractionId: string | null`)
- `packages/api/src/services/validators/hoi/rules/identity.ts` — H1/H2/H3 use `ctx.hoiExtractionId`
- `packages/api/src/services/validators/hoi/rules/dates.ts` — H4/H5 use `ctx.hoiExtractionId`
- `packages/api/src/services/validators/hoi/rules/coverage.ts` — H6/H7/H8/H9 use `ctx.hoiExtractionId`
- `packages/api/src/services/validators/hoi/rules/conditional.ts` — H10/H11/H12 use `ctx.hoiExtractionId`; H12 lowercases `loan.occupancy`
- `packages/api/src/services/validators/hoi/rules/flood.ts` — F1/F2 use `ctx.floodExtractionId`
- `packages/api/src/services/predict-conditions/resolvers/hoi-validator-resolver.ts` — construct context with per-side IDs; Finding's metadata uses rule's finding evidence extractionId
- `packages/api/src/services/predict-conditions/service.ts` — extract `insertHoiValidatorFindings` helper; invoke HOI resolver in both reuse-batch and full-run paths
- `packages/api/test/hoi-validator-rules.test.ts` — update fixtures to pass `hoiExtractionId` + `floodExtractionId` instead of single `extractionId`; add 2 new H12 case-sensitivity cases; add 2 new flood-extractionId-distinction cases
- `packages/api/test/hoi-validator-resolver.test.ts` — update fixtures; add 1 new combined HOI+Flood test
- `packages/api/test/hoi-validator-resolver.integration.test.ts` — add 2 new Layer 3 tests (reuse-batch pickup + idempotency on re-run)
- Memory file `~/.claude/.../memory/project_hoi_validator_operational.md` — note v1.1 fixes

---

# Phase 1 — Finding C (Warm-up)

## Task 1: H12 occupancy case-insensitive compare + 2 tests

**Files:**
- Modify: `packages/api/src/services/validators/hoi/rules/conditional.ts`
- Modify: `packages/api/test/hoi-validator-rules.test.ts`

- [ ] **Step 1: Create branch**

```bash
git checkout main && git pull --ff-only
git checkout -b feature/hoi-validator-v1.1-hotfix
```

- [ ] **Step 2: Add failing test cases**

Append to the existing H12 `describe` block in `packages/api/test/hoi-validator-rules.test.ts`:

```ts
test("H12 non-DSCR with capitalized 'Primary' occupancy + Investment policy → fail (case-insensitive)", () => {
  const ctx: RuleContext = {
    hoi: { ...baseExtraction, occupancyOnPolicy: "Investment" },
    flood: null,
    loan: { ...baseLoan, occupancy: "Primary" as never },  // simulating NPNQM extras-overlaid capitalized value
    documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
    extractionId: "00000000-0000-0000-0000-000000000040",
    loanNumber: "X",
  };
  const r = H12_occupancyMatch(ctx);
  expect(r.fired).toBe(true);
  expect(r.finding?.severity).toBe("fail");
});

test("H12 non-DSCR with all-caps 'PRIMARY' occupancy + Investment policy → fail", () => {
  const ctx: RuleContext = {
    hoi: { ...baseExtraction, occupancyOnPolicy: "Investment" },
    flood: null,
    loan: { ...baseLoan, occupancy: "PRIMARY" as never },
    documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
    extractionId: "00000000-0000-0000-0000-000000000041",
    loanNumber: "X",
  };
  const r = H12_occupancyMatch(ctx);
  expect(r.fired).toBe(true);
});
```

- [ ] **Step 3: Run tests; verify failure**

```bash
pnpm --filter @twin/api test hoi-validator-rules
```

Expected: 2 new failing cases (H12 doesn't lowercase, so `"Primary" === "primary"` is false → rule doesn't fire → expect(fired).toBe(true) fails).

- [ ] **Step 4: Fix H12**

In `packages/api/src/services/validators/hoi/rules/conditional.ts`, change the non-DSCR branch of `H12_occupancyMatch`:

```ts
// Before:
if (ctx.loan.occupancy === "primary" && !policyOcc.includes("primary") && !policyOcc.includes("owner")) {

// After:
if (ctx.loan.occupancy?.toLowerCase() === "primary" && !policyOcc.includes("primary") && !policyOcc.includes("owner")) {
```

That's the only line change. The DSCR branch already uses `.toLowerCase()` on the policy side; the `ctx.loan.occupancy` lookup is the gap.

- [ ] **Step 5: Run tests; verify pass**

```bash
pnpm --filter @twin/api test hoi-validator-rules
```

Expected: PASS (existing H12 cases unchanged, 2 new cases pass).

- [ ] **Step 6: Run full HOI suite for no-regression**

```bash
pnpm --filter @twin/api test "hoi-"
pnpm --filter @twin/api build
```

All tests pass; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/validators/hoi/rules/conditional.ts packages/api/test/hoi-validator-rules.test.ts
git commit -m "fix(hoi): H12 lowercase ctx.loan.occupancy before compare (codex v1.1 P2 Finding C)"
```

---

# Phase 2 — Finding B (Per-side extractionId)

## Task 2: Widen RuleContext + update all 14 rules + update resolver

**Files:**
- Modify: `packages/api/src/services/validators/hoi/rules/types.ts`
- Modify: `packages/api/src/services/validators/hoi/rules/identity.ts`
- Modify: `packages/api/src/services/validators/hoi/rules/dates.ts`
- Modify: `packages/api/src/services/validators/hoi/rules/coverage.ts`
- Modify: `packages/api/src/services/validators/hoi/rules/conditional.ts`
- Modify: `packages/api/src/services/validators/hoi/rules/flood.ts`
- Modify: `packages/api/src/services/predict-conditions/resolvers/hoi-validator-resolver.ts`
- Modify: `packages/api/test/hoi-validator-rules.test.ts` (update existing test fixtures)
- Modify: `packages/api/test/hoi-validator-resolver.test.ts` (update existing test fixtures)

This is one atomic task because the type change ripples across files; partial commits would leave tsc broken.

- [ ] **Step 1: Widen `RuleContext` interface**

Edit `packages/api/src/services/validators/hoi/rules/types.ts`:

```ts
// Before:
export interface RuleContext {
  hoi: HoiPolicyFields | null;
  flood: FloodCertFields | null;
  loan: LoanContext;
  documents: { hoi: DocumentRef | null; floodCert: DocumentRef | null };
  /** The active extraction's UUID — embedded in finding evidence + portal_metadata. */
  extractionId: string;
  /** Loan's external number (NQMF / Lender) for H1 channel-specific matching. */
  loanNumber: string;
}

// After:
export interface RuleContext {
  hoi: HoiPolicyFields | null;
  flood: FloodCertFields | null;
  loan: LoanContext;
  documents: { hoi: DocumentRef | null; floodCert: DocumentRef | null };
  /** HOI extraction UUID — embedded in H1-H12 finding evidence + portal_metadata. */
  hoiExtractionId: string | null;
  /** Flood-cert extraction UUID — embedded in F1/F2 finding evidence + portal_metadata. */
  floodExtractionId: string | null;
  /** Loan's external number (NQMF / Lender) for H1 channel-specific matching. */
  loanNumber: string;
}
```

- [ ] **Step 2: Update H1-H12 rules to use `hoiExtractionId`**

In `identity.ts`, `dates.ts`, `coverage.ts`, `conditional.ts` — find every `extractionId: ctx.extractionId,` line and replace with `extractionId: ctx.hoiExtractionId!,` (non-null assertion is safe: each HOI rule already gates on `ctx.hoi` truthy, which implies `hoiRow` existed in the resolver, which implies `hoiExtractionId` is non-null).

There are 12 HOI rules. Each emits one finding with one `evidence.extractionId`. So 12 single-line edits.

- [ ] **Step 3: Update F1/F2 rules to use `floodExtractionId`**

In `flood.ts` — both F1 and F2 use `extractionId: ctx.extractionId`. Replace with `extractionId: ctx.floodExtractionId!`. Same non-null-assertion-safe reasoning (rules gate on `ctx.flood` and `ctx.documents.floodCert`).

- [ ] **Step 4: Update resolver to construct context with per-side IDs**

Edit `packages/api/src/services/predict-conditions/resolvers/hoi-validator-resolver.ts`. Find the `ctx` construction and replace:

```ts
// Before:
const ctx = {
  hoi: hoiRow ? (hoiRow.fields as HoiPolicyFields) : null,
  flood: floodRow ? (floodRow.fields as FloodCertFields) : null,
  loan,
  documents,
  extractionId: hoiRow?.id ?? floodRow?.id ?? "",
  loanNumber: args.loanNumber,
};

// After:
const ctx = {
  hoi: hoiRow ? (hoiRow.fields as HoiPolicyFields) : null,
  flood: floodRow ? (floodRow.fields as FloodCertFields) : null,
  loan,
  documents,
  hoiExtractionId: hoiRow?.id ?? null,
  floodExtractionId: floodRow?.id ?? null,
  loanNumber: args.loanNumber,
};
```

Also update the `buildReviewFinding` call site (or wherever the resolver emits the Misc HOI Policy Review finding via `extractionId`) to use `hoiRow.id` directly since that hatch only fires on HOI extraction confidence.

Finally, the `metadata.extractionId` field set on each emitted Finding should now derive from the rule's finding's `evidence.extractionId` (which correctly reflects HOI vs Flood per rule type):

```ts
metadata: {
  validationFindings: [r.finding],
  extractionId: r.finding.evidence.extractionId,  // ← from the rule, not from ctx
} as never,
```

- [ ] **Step 5: Update test fixtures**

`packages/api/test/hoi-validator-rules.test.ts` — every test case constructs a `RuleContext` with `extractionId: "..."`. Replace with `hoiExtractionId: "..." , floodExtractionId: null` for HOI tests and `hoiExtractionId: null, floodExtractionId: "..."` for F1/F2 tests.

Do this across all describes (H1-H12, F1-F2). A single search-and-replace works for the common HOI cases:
- `extractionId: "00000000-0000-0000-0000-000000000` → `hoiExtractionId: "00000000-0000-0000-0000-000000000` then add `, floodExtractionId: null` after each occurrence

For F1/F2 tests, invert: `hoiExtractionId: null, floodExtractionId: "..."`.

`packages/api/test/hoi-validator-resolver.test.ts` — same fix; the mock client returns canned `document_extractions` rows, so the resolver builds ctx itself, but any direct `RuleContext` constructions in test setup need the rename.

- [ ] **Step 6: Run tests + build; expect green**

```bash
pnpm --filter @twin/api test hoi-validator-rules
pnpm --filter @twin/api test hoi-validator-resolver
pnpm --filter @twin/api build
```

All must pass + tsc clean. If any test fails because of the rename, the fix is mechanical — convert single `extractionId` to the appropriate per-side ID.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/services/validators/hoi/rules/ packages/api/src/services/predict-conditions/resolvers/hoi-validator-resolver.ts packages/api/test/hoi-validator-rules.test.ts packages/api/test/hoi-validator-resolver.test.ts
git commit -m "fix(hoi): split RuleContext.extractionId into per-side IDs (codex v1.1 P2 Finding B)"
```

---

## Task 3: New tests for Finding B (HOI + Flood coexistence)

**Files:**
- Modify: `packages/api/test/hoi-validator-rules.test.ts`
- Modify: `packages/api/test/hoi-validator-resolver.integration.test.ts`

- [ ] **Step 1: Add Layer 1 test — H1 picks up `hoiExtractionId`**

Append to the H1 describe block:

```ts
test("H1 uses hoiExtractionId in finding evidence when both HOI + Flood IDs present", () => {
  const ctx: RuleContext = {
    hoi: { ...baseExtraction, lossPayeeClause: "Wrong Entity LLC", loanNumberOnPolicy: "X" },
    flood: null,
    loan: baseLoan,
    documents: { hoi: { tenantId: "t", loanId: "l", documentId: "d-h", category: "hoi-policy", storageUrl: "x" }, floodCert: null },
    hoiExtractionId: "00000000-0000-0000-0000-0000000000aa",
    floodExtractionId: "00000000-0000-0000-0000-0000000000bb",
    loanNumber: "X",
  };
  const r = H1_lossPayeeMatch(ctx);
  expect(r.fired).toBe(true);
  expect(r.finding?.evidence.extractionId).toBe("00000000-0000-0000-0000-0000000000aa");  // HOI's, not flood's
});
```

- [ ] **Step 2: Add Layer 1 test — F1 picks up `floodExtractionId`**

Append to the F1 describe block:

```ts
test("F1 uses floodExtractionId in finding evidence when both HOI + Flood IDs present", () => {
  const ctx: RuleContext = {
    hoi: null,
    flood: { ...baseFloodExtraction, floodDeductible: 12000 },
    loan: baseLoan,
    documents: { hoi: null, floodCert: baseFloodDoc },
    hoiExtractionId: "00000000-0000-0000-0000-0000000000aa",
    floodExtractionId: "00000000-0000-0000-0000-0000000000bb",
    loanNumber: "X",
  };
  const r = F1_floodDeductibleCap(ctx);
  expect(r.fired).toBe(true);
  expect(r.finding?.evidence.extractionId).toBe("00000000-0000-0000-0000-0000000000bb");  // Flood's, not HOI's
});
```

- [ ] **Step 3: Add Layer 3 integration test — HOI + Flood coexistence**

Append to `packages/api/test/hoi-validator-resolver.integration.test.ts`:

```ts
test("loan with both HOI + flood extractions emits findings keyed to correct extractionId per source", async () => {
  // Seed: insert an ingested_documents row + document_extractions for HOI policy with wrong loss-payee
  //       insert an ingested_documents row + document_extractions for flood cert with deductible too high
  // Run PC v2 run() on the loan
  // Assert:
  //   - 2 predicted_conditions rows with source_list = 'hoi-validator'
  //   - One has source_rule_id = 'hoi.loss-payee.match' with portal_metadata->>'extractionId' = HOI's id
  //   - One has source_rule_id = 'flood.deductible.cap' with portal_metadata->>'extractionId' = Flood's id
});
```

Concrete implementation pattern follows the existing scenarios in this file (Scenario 1/2/3 from Task 19).

- [ ] **Step 4: Run tests + build**

```bash
pnpm --filter @twin/api test hoi-validator-rules
pnpm --filter @twin/api test hoi-validator-resolver
pnpm --filter @twin/api build
```

All must pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/test/hoi-validator-rules.test.ts packages/api/test/hoi-validator-resolver.integration.test.ts
git commit -m "test(hoi): per-side extractionId — H1 + F1 unit + Layer 3 coexistence (codex v1.1 P2 Finding B)"
```

---

# Phase 3 — Finding A (Reuse-batch)

## Task 4: Extract `insertHoiValidatorFindings` helper (refactor only)

**Files:**
- Modify: `packages/api/src/services/predict-conditions/service.ts`

Refactor-only commit. Behavior identical; pulls the existing HOI-validator-specific INSERT loop into a named helper so Task 5 can reuse it from the reuse-batch path.

- [ ] **Step 1: Identify the existing HOI-validator INSERT loop in service.ts**

Search for `source_list = 'hoi-validator'` or the `ON CONFLICT ON CONSTRAINT predicted_conditions_hoi_validator_active` snippet. There should be one INSERT loop (introduced in Task 19, commit `4312fcc`).

- [ ] **Step 2: Extract into a helper**

Add a new exported function at module level (above `run()`):

```ts
async function insertHoiValidatorFindings(
  c: pg.PoolClient,
  tenantId: string,
  loanId: string,
  hoiFindings: Finding[],
): Promise<void> {
  for (const f of hoiFindings) {
    const meta = (f.metadata ?? {}) as { extractionId?: string; validationFindings?: unknown[] };
    const extractionId = meta.extractionId ?? "";
    await c.query(
      `INSERT INTO predicted_conditions
        (id, tenant_id, loan_id, status, description, note, category, source_list,
         source_rule_table, source_rule_id, prediction_run_id, source_input_hash,
         predicted_at, predicted_by, kb_version_id, resolved_income_type,
         portal_metadata)
       VALUES (
         gen_random_uuid(), $1, $2, 'pending', $3, $4, $5, 'hoi-validator',
         $6, $7, $8, $9,
         NOW(), $10, $11, $12,
         $13::jsonb
       )
       ON CONFLICT ON CONSTRAINT predicted_conditions_hoi_validator_active DO NOTHING`,
      [tenantId, loanId, f.description, f.note, f.category,
       f.sourceRuleTable, f.sourceRuleId, /* prediction_run_id */, /* source_input_hash */,
       /* predicted_by */, /* kb_version_id */, /* resolved_income_type */,
       JSON.stringify(meta)],
    );
  }
}
```

Adjust placeholder values to match the actual columns/values from the existing INSERT (read the existing code carefully — `prediction_run_id`, `kb_version_id`, etc. have specific sources in the run context).

- [ ] **Step 3: Replace the existing INSERT loop with a call to the helper**

In `run()`, the existing per-Finding INSERT for HOI becomes:

```ts
await insertHoiValidatorFindings(c, tenantId, loanId, hoiFindings);
```

- [ ] **Step 4: Run tests + build; no regression**

```bash
pnpm --filter @twin/api test hoi-validator-resolver
pnpm --filter @twin/api test predict-conditions
pnpm --filter @twin/api build
```

All existing tests should still pass; this is refactor only.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/predict-conditions/service.ts
git commit -m "refactor(hoi): extract insertHoiValidatorFindings helper (prep for Finding A)"
```

---

## Task 5: Always-invoke HOI resolver + 2 Layer 3 tests for Finding A

**Files:**
- Modify: `packages/api/src/services/predict-conditions/service.ts`
- Modify: `packages/api/test/hoi-validator-resolver.integration.test.ts`

- [ ] **Step 1: Write failing Layer 3 tests**

Append to `packages/api/test/hoi-validator-resolver.integration.test.ts`:

```ts
test("loan with existing pending v3 batch + new HOI extraction → hoi-validator finding inserted on reuse path", async () => {
  // Seed:
  //   - Insert pending predicted_conditions rows for the loan at PC_SCHEMA_VERSION (so reuse-batch hits)
  //   - Insert an ingested_documents row + document_extractions for HOI with wrong loss-payee
  //   - Set the loan's tenant validators.hoi.enabled = true
  // Trigger run() on the loan
  // Assert:
  //   - Pre-existing pending rows are still present (reuse-batch preserved)
  //   - One new hoi-validator row with source_rule_id = 'hoi.loss-payee.match'
});

test("running PC v2 twice on same loan with same HOI extraction → idempotent (exactly 1 hoi-validator row)", async () => {
  // Seed same as above; run twice
  // Assert exactly 1 hoi-validator row exists (ON CONFLICT DO NOTHING via migration 026)
});
```

- [ ] **Step 2: Run tests; verify failure**

The new tests will fail because the current code path doesn't invoke HOI on the reuse-batch path.

- [ ] **Step 3: Restructure `run()` to always invoke HOI**

The current shape (approximate, per `service.ts:109`):

```ts
async function run(...) {
  // ...setup...
  const inputHash = computeInputHash(...);
  if (existingPendingBatchMatches(inputHash, kbVersionId)) {
    return reusedResult;  // ← early return; HOI never runs
  }
  // ...DELETE-pending exclusion list...
  // ...run all resolvers including HOI...
  await insertAllFindings(...);
}
```

New shape:

```ts
async function run(...) {
  // ...setup...
  const inputHash = computeInputHash(...);

  // HOI extraction events arrive asynchronously after the prior batch was computed.
  // Always evaluate HOI; resolver's own gates short-circuit when tenant is disabled
  // or no extractions exist. Idempotent inserts via migration 026 ON CONFLICT.
  const hoiEnabled = await readHoiEnabled(c, tenantId);
  const hoiFindings = await resolveHoiValidatorFindings(c, tenantId, kbCtx, loan, {
    hoiEnabled,
    loanExternalId: loanId,
    loanNumber: <existing-source-of-truth>,
  });

  if (existingPendingBatchMatches(inputHash, kbVersionId)) {
    // Insert any new HOI findings on top of the reused batch
    if (hoiFindings.length > 0) {
      await insertHoiValidatorFindings(c, tenantId, loanId, hoiFindings);
    }
    return reusedResultWithFreshHoi;  // re-query batch after the HOI insert
  }

  // ...DELETE-pending exclusion list (already excludes hoi-validator)...
  const otherFindings = await runPreUnderwriter(c, tenantId, kbCtx, loan, ...);
  await insertOtherFindings(c, tenantId, loanId, otherFindings);
  if (hoiFindings.length > 0) {
    await insertHoiValidatorFindings(c, tenantId, loanId, hoiFindings);
  }
  return finalBatch;
}
```

The `readHoiEnabled` function already exists as inline code from Task 19; extract it into a small helper for readability:

```ts
async function readHoiEnabled(c: pg.PoolClient, tenantId: string): Promise<boolean> {
  const { rows } = await c.query<{ settings: { validators?: { hoi?: { enabled?: boolean } } } }>(
    `SELECT settings FROM tenants WHERE id = $1`,
    [tenantId],
  );
  return rows[0]?.settings?.validators?.hoi?.enabled === true;
}
```

- [ ] **Step 4: Run tests + build**

```bash
pnpm --filter @twin/api test hoi-validator-resolver
pnpm --filter @twin/api test predict-conditions
pnpm --filter @twin/api build
```

The 2 new Layer 3 tests pass; existing tests continue to pass.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/predict-conditions/service.ts packages/api/test/hoi-validator-resolver.integration.test.ts
git commit -m "fix(hoi): always invoke HOI resolver regardless of reuse-batch (codex v1.1 P1 Finding A)"
```

---

# Phase 4 — Wrap-up

## Task 6: Memory update + smoke + PR

**Files:**
- Modify: `~/.claude/projects/-Users-omarmendoza-Projects-encompass-digital-twin/memory/project_hoi_validator_operational.md`

- [ ] **Step 1: Full test sweep**

```bash
pnpm --filter @twin/core test
pnpm --filter @twin/core build
pnpm --filter @twin/api test "hoi-"
pnpm --filter @twin/api build
pnpm --filter @twin/web test
pnpm --filter @twin/web build
```

All must pass + builds clean. Confirm test count for `pnpm --filter @twin/api test "hoi-"` has grown by ~10-15 (Tasks 1, 3, 5 added ~14 new tests total).

- [ ] **Step 2: Update memory file**

Append a v1.1 section to `~/.claude/projects/-Users-omarmendoza-Projects-encompass-digital-twin/memory/project_hoi_validator_operational.md`:

```markdown
**v1.1 hotfix (2026-05-18):**

- Finding A (P1): HOI resolver always invoked; reuse-batch early-return no longer skips it. `insertHoiValidatorFindings` helper extracted so reuse-batch and full-run paths share idempotent INSERT logic.
- Finding B (P2): `RuleContext.extractionId` split into per-side `hoiExtractionId` + `floodExtractionId`. Each rule's evidence carries the correct extraction's UUID. Idempotency key in `portal_metadata.extractionId` matches the finding's evidence.
- Finding C (P2): H12 lowercases `ctx.loan.occupancy` before strict-equality compare; resilient to capitalized NPNQM extras values.
- Deferred to v1.2: P1 RLS tenant context in worker (no production impact via pooler bypass), P2 `extractorMode` config wiring (npnqm-twin uses `auto` which matches code behavior).
```

Append to `MEMORY.md` after the existing HOI line:

```markdown
- [HOI/Flood Validator v1.1 hotfix](project_hoi_validator_operational.md#v11-hotfix-2026-05-18) — 2026-05-18: codex review fixes for P1 reuse-batch + P2 flood extractionId + P2 occupancy case.
```

Actually since both v1 and v1.1 live in the same file, just adding the new section header is enough — no need for a second MEMORY.md index entry. Update the existing index line to reflect "v1.1 shipped" instead of a new entry.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin feature/hoi-validator-v1.1-hotfix
gh pr create --title "fix(hoi): v1.1 hotfix — 3 codex review findings (reuse-batch, flood extractionId, occupancy case)" --body "$(cat <<'BODY'
## Summary

Addresses 3 high-impact codex review findings from PR #8 that were merged unaddressed. Validator's steady-state operation is now correct on loans with existing pending v3 predictions (Finding A) and loans with both HOI + Flood policies (Finding B). H12 stops false-negatively skipping on NPNQM's capitalized 'Primary' occupancy values (Finding C).

- **Spec:** `docs/superpowers/specs/2026-05-18-hoi-validator-v1.1-hotfix.md`
- **Plan:** `docs/superpowers/plans/2026-05-18-hoi-validator-v1.1-hotfix.md`

## Findings addressed

- **Finding A (P1):** Reuse-batch early-return skipped HOI resolver. Fix: invoke HOI resolver always; insert findings idempotently via migration 026's partial unique index.
- **Finding B (P2):** Flood findings were keyed to HOI extractionId on dual-extraction loans. Fix: `RuleContext.extractionId` split into `hoiExtractionId` + `floodExtractionId`.
- **Finding C (P2):** H12 strict-equality "primary" failed on NPNQM's capitalized "Primary" values. Fix: lowercase before compare.

## Deferred (v1.2)

- P1 RLS tenant context in worker (works via pooler bypass)
- P2 `extractorMode` config wiring (npnqm-twin uses `auto`)

## Test Plan

- [x] `pnpm --filter @twin/api test "hoi-"` passes (~115 tests; +14 from baseline)
- [x] Existing 137 core + 38 web tests untouched
- [x] All builds clean
- [ ] Deploy api+web; smoke test on a real npnqm-twin loan with pending v3 predictions
BODY
)"
gh pr comment <PR-number> --body "@codex review"
```

- [ ] **Step 4: Wait for codex review; iterate if needed**

- [ ] **Step 5: Merge + deploy**

```bash
gh pr merge <PR-number> --merge
git checkout main && git pull --ff-only
railway up --service api --detach
railway up --service web --detach
```

- [ ] **Step 6: Smoke test**

After both deploys SUCCESS:
```bash
curl -s https://api-production-8666.up.railway.app/health
railway logs --service api | grep -E "\[hoi-extractor\]|started"
```

Verify `[hoi-extractor] starting dispatcher (lock 46, poll 5000ms)` on the new deploy.

- [ ] **Step 7: Update memory with deploy confirmation**

Edit the v1.1 section in `project_hoi_validator_operational.md` to add the deploy IDs (api + web deployment UUIDs) and commit SHA of the merged PR.

- [ ] **Step 8: Clean up local branch**

```bash
git branch -d feature/hoi-validator-v1.1-hotfix
```

---

## Self-review checklist (run after writing all task code)

- [ ] Finding C: H12 fires on `"Primary"`, `"PRIMARY"`, and lowercase `"primary"` — all produce fail
- [ ] Finding B: Layer 1 tests verify H1 uses `hoiExtractionId`, F1 uses `floodExtractionId`
- [ ] Finding B: Layer 3 test shows HOI + Flood coexisting on one loan, each emitting their own extractionId
- [ ] Finding A: Layer 3 test confirms reuse-batch path now also produces hoi-validator finding when a new extraction lands
- [ ] Finding A: idempotency test confirms ON CONFLICT keeps single row across repeated runs
- [ ] All existing 101 HOI api tests still pass
- [ ] No new migrations needed (verified)
- [ ] No UI changes needed (verified)
- [ ] tsc strict clean on @twin/api + @twin/core
- [ ] Memory file updated with v1.1 section + deploy IDs
- [ ] Branch cleanup after merge

---

## Estimated effort

Per spec §1: **2-3 days** total.

- Phase 1 (Task 1): ~1 hour — Finding C surgical fix
- Phase 2 (Tasks 2-3): ~1 day — RuleContext refactor + new tests
- Phase 3 (Tasks 4-5): ~1 day — service.ts refactor + new tests
- Phase 4 (Task 6): ~0.5 day — memory + PR + smoke

---

*This hotfix closes the highest-impact codex findings against the HOI Validator's correctness. The deferred v1.2 items (RLS, extractorMode) can ship together once a real driver appears.*
