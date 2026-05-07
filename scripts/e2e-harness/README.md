# E2E Validation Harness

One-shot CLI harness that runs 20 NQM fixtures × 8 named workflows against a live local stack and emits two reports: an audit-validation verdict and a severity-graded punch list.

## Quickstart

1. Start the stack: `./scripts/dev-up.sh` (API :4000, Web :3000, Agent :8000)
2. Full run: `pnpm tsx scripts/e2e-harness/run.ts`              # default --repeat 2 for flake detection
3. Read results: `reports/<run-id>/punch-list.md` + `audit-validation.md`

## Single-cell run

```
pnpm tsx scripts/e2e-harness/run.ts --workflow W1_uw_accept --fixture nqm-bankstmt-12mo-clean
```

## Output

```
reports/<run-id>/
├── matrix.json            # Zod-validated machine-readable result
├── summary.md             # top-level stats, by-workflow table, spec coverage, total LLM cost
├── punch-list.md          # P0s first; failures grouped by error fingerprint; team tags; new vs regression
├── audit-validation.md    # CONFIRMED/CONTRADICTED/INCONCLUSIVE per audit claim
├── regression.md          # only present if a previous run was found in reports/
└── cells/<workflow>/<fixture>.json
```

Severity rubric: see spec `docs/superpowers/specs/2026-05-08-e2e-validation-harness-design.md` §6.

## Cleanup of persistent records

Every record this harness writes to persistent stores carries `harness_run_id`. `--purge-test-data <run_id>` cleanup is documented in spec §7 (purge.ts not built in v1; clean ephemeral tenants manually if needed).

## Wave 2.5 success checklist (per spec §9)

When reviewing each Wave 2 agent's output, the coordinator confirms each workflow file:

1. Passes `pnpm tsc --noEmit` against the project's tsconfig.
2. Exports a `WorkflowDef`-shaped object with non-empty `id`, `name`, `specRefs`, `appliesTo`, `run`.
3. Runs successfully against the canary fixture and produces a `CellResult` that passes `CellResultSchema.parse()`.
4. The cell's `assertions` array is non-empty.

## Relationship to other test surfaces

This harness is one *layer* of the project's quality strategy (spec §13).

- `pnpm --filter @twin/core test` — 84 reducer/store unit tests.
- `pnpm --filter @twin/api test` — 98 API integration tests.
- `GET /system/integrity` — 220 invariant checks across all 20 loans.
- `POST /system/behavioral-test` — 10 reducer-level workflow tests against one fixture (~5s).
- This harness — broad fixture × workflow matrix, ~15 min per run.
- (Separate efforts) Adversarial tests; AI eval framework.

## Environment

- `API_URL` (default `http://localhost:4000`)
- `AGENT_SERVICE_URL` (default `http://localhost:8000`)
- `GUIDELINES_PDF`, `MATRICES_PDF` — for W6, default to `~/Downloads/...`
