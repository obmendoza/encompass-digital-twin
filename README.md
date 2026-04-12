# Encompass Digital Twin

A browser-based digital twin of **Encompass LOS underwriting screens**, purpose-built as an **AI automation sandbox** for Non-Qualified Mortgage (NQM) underwriting.

AI agents drive it via HTTP API. Human underwriters use the same UI. Both execute identical actions through a single deterministic state engine.

---

## Demo

### Docker (fastest)

```bash
docker compose up --build
```

Open **http://localhost:3000** — that's it.

### Local development

```bash
# 1. Install dependencies
pnpm install

# 2. Start the API server (port 4000) + Web UI (port 3000)
pnpm -F @twin/core build && pnpm -F @twin/fixtures build
pnpm dev
```

Then open **http://localhost:3000**

> **Pipeline** shows 20 NQM loan scenarios. Click any loan to open the full underwriting cockpit: Transmittal Summary, 1003 Pages 1-3, Income Analysis, eFolder, Credit Report, Appraisal, Compliance, Conversation Log, and Program Overlays.

### What you can do

- **Approve / Suspend / Deny** a loan with rationale
- **Add, Clear, Waive** conditions
- **Recalculate qualifying income** with method-specific worksheets (Bank Statement, DSCR, Asset Depletion, 1099, P&L)
- **Upload documents** and link them to conditions
- **Review credit** tradelines, liability breakdowns, and derogatory flags
- **Check compliance** (QM status, HPML, ATR, points & fees)
- **Evaluate program overlays** (guideline pass/fail/exception checks)
- **View the audit trail** of every action (human + agent) in the Conversation Log
- **Reset all loans** to original state with one click

### Agent API

```bash
# Load a scenario
curl -X POST http://localhost:4000/world/load-scenario \
  -H "content-type: application/json" \
  -d '{"scenarioId": "nqm-bankstmt-12mo-clean"}'

# Read the loan
curl http://localhost:4000/loans/2501000101

# Clear a condition
curl -X POST http://localhost:4000/loans/2501000101/conditions/c1/clear \
  -H "content-type: application/json" \
  -d '{"notes":"verified","actor":{"kind":"agent","id":"uw-bot"}}'

# Approve
curl -X POST http://localhost:4000/loans/2501000101/decision \
  -H "content-type: application/json" \
  -d '{"decision":"approved","rationale":"Clean file","actor":{"kind":"agent","id":"uw-bot"}}'
```

Full API contract: `GET http://localhost:4000/openapi.json`

---

## Architecture

```
encompass-digital-twin/
├── packages/
│   ├── core/       # Pure reducer, domain types, in-memory store (30 unit tests)
│   ├── fixtures/   # 20 NQM loan scenarios with starter conditions
│   ├── api/        # Fastify HTTP server — thin wrapper over core (23 tests)
│   └── web/        # Next.js 15 UI — classic Encompass look & feel (14 routes)
```

**State ownership:** The API server owns a single in-memory `WorldState`. Every mutation (human click or agent HTTP call) goes through the same pure `reduce(state, action) → newState` function. The replay invariant is tested: replaying an action log from scratch produces identical state.

**Dual-mode:** The web UI is a thin HTTP client of the API. Humans and agents traverse identical endpoints — they're indistinguishable in the audit log.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Domain logic | TypeScript, pure functions, Zod validation |
| API server | Fastify 4, OpenAPI 3.1 spec |
| Web UI | Next.js 15 (App Router), React 19, Tailwind CSS |
| Testing | Vitest (56 tests across 3 packages) |
| Monorepo | pnpm workspaces |

## NQM Loan Scenarios

### Standard scenarios (12)

| ID | Program | Borrower | Decision Target |
|----|---------|----------|----------------|
| `nqm-bankstmt-12mo-clean` | Bank Statement 12mo | Sanchez, Maria | Approve |
| `nqm-bankstmt-24mo-business` | Bank Statement 24mo | Okafor, Samuel | Approve |
| `nqm-dscr-investor-purchase` | DSCR (1.18) | Nguyen, Linh | Approve |
| `nqm-dscr-sub-1` | DSCR (0.85) | Kohli, Priya | Counter |
| `nqm-asset-depletion` | Asset Utilization | Weber, Hans | Approve |
| `nqm-1099-only` | 1099-Only | Ramirez, Jose | Approve |
| `nqm-pnl-only-cpa` | P&L + CPA | Patel, Anjali | Approve |
| `nqm-foreign-national` | Foreign National DSCR | Silva, Lucas | Approve |
| `nqm-itin-bankstmt` | ITIN + Bank Stmt | Morales, Rosa | Approve |
| `nqm-full-doc-recent-bk` | Full Doc (BK < 4yr) | Johnson, Lamar | Approve |
| `nqm-suspend-candidate` | Bank Stmt 12mo | Brooks, Tammy | Suspend |
| `nqm-deny-candidate` | DSCR (0.72) | Carter, Devin | Deny |

### Edge cases requiring experienced UW judgment (8)

| ID | Edge Case | The Judgment Call |
|----|-----------|-------------------|
| `nqm-edge-large-deposit` | $85K inheritance in bank statements | DTI swings 45% → 82% depending on inclusion |
| `nqm-edge-declining-income` | 38.6% income drop over 12 months | Use full average or weight recent months? |
| `nqm-edge-comingled-funds` | Business account has personal expenses | Expense factor: 35% or 65%? |
| `nqm-edge-short-lease-dscr` | Lease expires in 60 days | Current rent DSCR 1.10 vs market rent 0.95 |
| `nqm-edge-restricted-assets` | $2.8M reported, $1.86M eligible | 401(k) penalty haircut + RSU vesting schedule |
| `nqm-edge-nsf-compensating` | 7 NSFs (max 3) but FICO 748, 12mo reserves | Do compensating factors overcome the guideline violation? |
| `nqm-edge-property-flip` | 56% appreciation in 67 days | Legitimate rehab or artificial inflation? |
| `nqm-edge-gift-funds-nqm` | 44% of down payment is gift | LTV jumps 80% → 90% if gift disallowed |

## Screens

| Route | Screen | Interactive |
|-------|--------|------------|
| `/` | Pipeline — 20 loans, sortable, filterable | Sort, filter, reset sandbox |
| `/loan/:id/transmittal` | Transmittal Summary | Approve/Suspend/Counter/Deny, manage conditions |
| `/loan/:id/1003/page1` | 1003 Page 1 — Borrower & Employment | Read-only |
| `/loan/:id/1003/page2` | 1003 Page 2 — Assets & Liabilities | Read-only |
| `/loan/:id/1003/page3` | 1003 Page 3 — Transaction & Declarations | Read-only |
| `/loan/:id/income` | Income Analysis | Edit worksheet, recalculate qualifying income |
| `/loan/:id/efolder` | eFolder — Document Tracking | Add docs, update status, link to conditions |
| `/loan/:id/credit` | Credit Report | Sortable tradelines, liability breakdown |
| `/loan/:id/appraisal` | Appraisal / Property | Comparables table, value reconciliation |
| `/loan/:id/compliance` | Compliance Snapshot | QM/ATR/HPML flags, points & fees |
| `/loan/:id/log` | Conversation Log | Filterable action audit trail |
| `/loan/:id/overlays` | Program Overlays | Guideline pass/fail/exception checks |

## API Reference

Full OpenAPI 3.1 spec served at runtime: `GET /openapi.json`

See [docs/agent-guide.md](docs/agent-guide.md) for the complete agent integration guide with curl examples, error codes, and workflow walkthrough.

## Development

```bash
# Install
pnpm install

# Build core packages
pnpm -F @twin/core build && pnpm -F @twin/fixtures build

# Run both servers (API :4000 + Web :3000)
pnpm dev

# Run all tests (56 across 3 packages)
pnpm -r test

# Run just core tests
pnpm -F @twin/core test
```

## Visual Design

The UI reconstructs the classic **Encompass360** look and feel from public ICE Mortgage Technology documentation:

- Navy gradient section headers (`#0a52a0` → `#08407d`)
- Dense 8-column data grids with 1px borders
- Classic Windows-style menu bar, toolbar, and dialog modals
- Gold-highlighted active navigation and primary action buttons
- Beige outer chrome (`#ece9d8`), white form surfaces
- 10–11px Tahoma/Segoe UI type

## License

Private — internal use only.
