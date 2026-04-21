# Contributing

Thank you for your interest in the Encompass Digital Twin.

## Development Setup

```bash
# Install dependencies
pnpm install

# Build core packages (required before running the app)
pnpm -F @twin/core build && pnpm -F @twin/fixtures build

# Start all services in development mode
pnpm dev
```

The API server starts on port 4000, the web UI on port 3000.

## Repository Structure

```
packages/
  core/      — Domain types, pure reducer, Zod schemas. No I/O.
  fixtures/  — NQM loan scenario data. No runtime code.
  api/       — Fastify server. Thin wrapper over @twin/core.
  web/       — Next.js 15 App Router UI.
```

## Guidelines

**Source code changes:**

- Keep `@twin/core` pure — no network calls, no file I/O, no side effects. Every function must be deterministic and unit-testable.
- All mutations must go through the reducer in `@twin/core`. The API and UI are consumers of core, not owners of state logic.
- New API endpoints must include an OpenAPI schema registered with Fastify's type provider.
- New UI screens follow the existing Encompass360 visual conventions (navy headers, beige chrome, dense grids).

**Testing:**

- Run `pnpm -r test` before submitting changes. All 75 existing tests must continue to pass.
- New domain logic in `@twin/core` requires unit tests.
- New API routes require route-level tests in `@twin/api`.

**Commits:**

- Use conventional commit prefixes: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- One logical change per commit.

**Pull requests:**

- Include a description of what changed and why.
- Reference any relevant spec documents in `docs/superpowers/specs/` if the change implements a design.

## Adding a New Loan Scenario

1. Add a new fixture in `packages/fixtures/src/scenarios/`.
2. Register it in the scenario index.
3. Rebuild fixtures: `pnpm -F @twin/fixtures build`.
4. Verify it loads: `curl -X POST http://localhost:4000/world/load-scenario -d '{"scenarioId":"your-new-id"}'`.

## Adding a New Screen

1. Create the route directory under `packages/web/app/loan/[loanId]/your-screen/`.
2. Follow the layout pattern used by existing screens (navy header, tab navigation, data grid).
3. Add the route to the loan layout navigation in `packages/web/app/loan/[loanId]/layout.tsx`.

## Questions

Open an issue or reach out to the maintainer.
