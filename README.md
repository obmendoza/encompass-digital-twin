# Encompass Digital Twin

> Production-ready digital twin of Encompass LOS for NQM mortgage underwriting — powered by Agentic AI.

## Live Demo

- **Web UI:** https://web-production-f532b.up.railway.app
- **API:** https://api-production-8666.up.railway.app
- **OpenAPI Spec:** https://api-production-8666.up.railway.app/openapi.json

> 20 NQM loan scenarios are preloaded. Click any loan in the Pipeline to open the full underwriting cockpit. Use "Reset All Loans" to restore original state after testing.

---

## What This Is

The Encompass Digital Twin is a browser-based replica of Encompass LOS underwriting screens, purpose-built as an AI automation sandbox for Non-Qualified Mortgage (NQM) underwriting. It gives AI agents a deterministic, observable environment in which to practice and demonstrate every underwriting decision a human underwriter would make — without touching a production system.

AI agents and human underwriters share identical UI and API surface. Every mutation — whether triggered by a human click or an agent HTTP call — flows through the same pure `reduce(state, action) → newState` function, producing an immutable audit trail. Agents are indistinguishable from humans in the conversation log, which is the point: when the agent is ready, its action patterns transfer directly to production.

The project exists to accelerate the adoption of agentic AI in mortgage origination. NQM lending is document-intensive, judgment-heavy, and underserved by legacy automation. This twin provides a safe, reproducible, inspectable environment in which agent behavior can be developed, tested, and refined before any real loan is touched.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Railway (3 services)                      │
│                                                                  │
│   ┌──────────────┐      ┌──────────────┐      ┌─────────────┐   │
│   │   Next.js    │ HTTP │   Fastify    │  SQL │  Supabase   │   │
│   │   Web UI     │─────▶│   REST API   │─────▶│  Postgres   │   │
│   │  :3000       │      │  :4000       │      │ (persist.)  │   │
│   └──────────────┘      └──────────────┘      └─────────────┘   │
│          │                     │                                  │
│          └──────────┬──────────┘                                 │
│                     │                                            │
│            Shared @twin/core                                     │
│         (pure reducer + domain types)                            │
└─────────────────────────────────────────────────────────────────┘

External:
  AI Agent ──HTTP──▶ REST API (same endpoints as the Web UI)
```

**State ownership:** The API server owns a single `WorldState`. Every mutation goes through the pure `reduce(state, action) → newState` function in `@twin/core`. The replay invariant is enforced by tests: replaying an action log from scratch produces identical state.

**Persistence:** When `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set, world state is persisted to Postgres on every write. Without those variables the system runs fully in-memory — suitable for local development and CI.

**Dual-mode:** The web UI is a thin HTTP client of the API. Humans and agents traverse identical endpoints and are recorded identically in the audit log.

---

## Features

### Underwriting Screens (10 Encompass-style views)

| Route | Screen | Interactive |
|-------|--------|-------------|
| `/` | Pipeline — 20 loans, sortable, filterable | Sort, filter, reset sandbox |
| `/loan/:id/transmittal` | Transmittal Summary | Approve / Suspend / Counter / Deny, manage conditions |
| `/loan/:id/1003/page1` | 1003 Page 1 — Borrower & Employment | Read-only |
| `/loan/:id/1003/page2` | 1003 Page 2 — Assets & Liabilities | Read-only |
| `/loan/:id/1003/page3` | 1003 Page 3 — Transaction & Declarations | Read-only |
| `/loan/:id/income` | Income Analysis | Edit worksheet, recalculate qualifying income |
| `/loan/:id/efolder` | eFolder — Document Tracking | Upload, preview, IDP extraction, Stare & Compare |
| `/loan/:id/credit` | Credit Report | Sortable tradelines, liability breakdown |
| `/loan/:id/appraisal` | Appraisal / Property | Comparables table, value reconciliation |
| `/loan/:id/compliance` | Compliance Snapshot | QM / ATR / HPML flags, points & fees |
| `/loan/:id/log` | Conversation Log | Filterable action audit trail |
| `/loan/:id/overlays` | Program Overlays | Guideline pass / fail / exception checks |

### AI Agent Integration

The API is the primary interface for AI agents. Agents can:

- **Read** the full loan object including borrower, property, income worksheet, assets, credit tradelines, conditions, documents, appraisal, compliance snapshot, and program overlays
- **Manage conditions** — clear, waive (with rationale), or add new conditions
- **Recalculate qualifying income** using any NQM method: Bank Statement, DSCR, Asset Depletion, 1099-Only, or P&L
- **Upload and link documents** to conditions
- **Record a decision** — approve, suspend, counter, or deny — with a rationale that appears in the audit trail
- **Review the audit trail** — every action ever taken on the loan, with timestamps and actor IDs

All mutations require an `actor` field `{"kind": "agent", "id": "your-agent-name"}`, which is recorded in the conversation log. Human-in-the-Loop (HITL) workflows are supported: the agent can pause and surface a recommendation for a human reviewer before committing a decision.

See [docs/agent-guide.md](docs/agent-guide.md) for the complete integration guide with curl examples, error codes, and workflow walkthrough.

### Scenario Workshop

The Scenario Workshop (`/workshop`) provides a chat-driven interface for generating new loan scenarios. Select a preset or describe a borrower profile in plain English, and the system produces a fully populated loan object that can be injected directly into the underwriting pipeline for immediate testing.

### eFolder & Document Management

The eFolder screen provides a split-pane document viewer with:

- **Upload** via drag-and-drop or file picker
- **Preview** with page-level navigation
- **IDP extraction** — structured data pulled from uploaded PDFs
- **Stare & Compare** — side-by-side view of two document versions
- **Push to Loan** — extracted data fields propagate back into the loan record

### 20 NQM Loan Scenarios

#### Standard scenarios (12)

| ID | Program | Borrower | Decision Target |
|----|---------|----------|-----------------|
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

#### Edge cases requiring experienced UW judgment (8)

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

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Domain logic | TypeScript, pure functions, Zod validation |
| API server | Fastify 4, OpenAPI 3.1 spec |
| Web UI | Next.js 15 (App Router), React 19, Tailwind CSS |
| Testing | Vitest (75 tests across 4 packages) |
| Monorepo | pnpm workspaces |
| Deployment | Railway (3 services) |
| Persistence | Supabase (Postgres) |
| Containerization | Docker, Docker Compose |

### Visual Design

The UI reconstructs the classic **Encompass360** look and feel from public ICE Mortgage Technology documentation:

- Navy gradient section headers (`#0a52a0` → `#08407d`)
- Dense 8-column data grids with 1px borders
- Classic Windows-style menu bar, toolbar, and dialog modals
- Gold-highlighted active navigation and primary action buttons
- Beige outer chrome (`#ece9d8`), white form surfaces
- 10–11px Tahoma/Segoe UI type

---

## Quick Start

### Docker (recommended)

```bash
docker compose up --build
```

Open **http://localhost:3000** — that's it. No additional configuration required for local development.

### Local Development

```bash
# 1. Install dependencies
pnpm install

# 2. Build core packages
pnpm -F @twin/core build && pnpm -F @twin/fixtures build

# 3. Start API server (:4000) and Web UI (:3000) in parallel
pnpm dev
```

Open **http://localhost:3000**.

### Railway Deployment

The project deploys as three Railway services from a single repository:

1. **api** — built from `Dockerfile.api`, exposes port 4000
2. **web** — built from `Dockerfile.web`, exposes port 3000
3. **Supabase** — external Postgres for state persistence

Set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` on the `api` service. Set `TWIN_API_URL` on the `web` service to point at the internal Railway URL of the `api` service.

---

## API Reference

Full OpenAPI 3.1 spec served at runtime:

```
GET /openapi.json
```

### Key endpoints

```bash
# Load a scenario
POST /world/load-scenario
{ "scenarioId": "nqm-bankstmt-12mo-clean" }

# Reset all loans
POST /world/reset

# Read a loan
GET /loans/:loanId

# List conditions
GET /loans/:loanId/conditions

# Clear a condition
POST /loans/:loanId/conditions/:conditionId/clear
{ "notes": "Verified bank statements", "actor": { "kind": "agent", "id": "uw-bot" } }

# Waive a condition
POST /loans/:loanId/conditions/:conditionId/waive
{ "rationale": "Compensating factor: high reserves", "actor": { "kind": "agent", "id": "uw-bot" } }

# Add a condition
POST /loans/:loanId/conditions
{ "condition": { "category": "PTD", "source": "UW", "description": "..." }, "actor": { "kind": "agent", "id": "uw-bot" } }

# Recalculate qualifying income
POST /loans/:loanId/qualifying-income
{ "worksheet": { "method": "BankStatementDeposits", "monthsCovered": 12, "avgDeposits": 18000, "expenseFactor": 0.5, "derivedMonthlyIncome": 9000 }, "actor": { "kind": "agent", "id": "uw-bot" } }

# Record a decision
POST /loans/:loanId/decision
{ "decision": "approved", "rationale": "All conditions cleared, DTI within guidelines", "actor": { "kind": "agent", "id": "uw-bot" } }

# Audit trail
GET /loans/:loanId/audit
```

Decision values: `pending` | `approved` | `suspended` | `counter` | `denied`

See [docs/agent-guide.md](docs/agent-guide.md) for the complete agent integration guide.

---

## Project Structure

```
encompass-digital-twin/
├── packages/
│   ├── core/           # Pure reducer, domain types, Zod schemas, in-memory store
│   ├── fixtures/       # 20 NQM loan scenarios with starter conditions
│   ├── api/            # Fastify HTTP server — thin wrapper over @twin/core
│   └── web/            # Next.js 15 App Router UI
│       └── app/
│           ├── loan/[loanId]/   # 10 underwriting screens
│           ├── workshop/        # Scenario Workshop
│           └── hitl/            # Human-in-the-Loop review
├── docs/
│   ├── agent-guide.md           # Complete agent integration guide
│   └── superpowers/
│       ├── specs/               # Design specs per screen/feature
│       └── plans/               # Implementation plans
├── docker-compose.yml
├── Dockerfile.api
├── Dockerfile.web
└── pnpm-workspace.yaml
```

---

## Testing

```bash
# Run all tests across all packages
pnpm -r test

# Run tests for a single package
pnpm -F @twin/core test
pnpm -F @twin/api test
pnpm -F @twin/web test
```

Tests cover: domain reducer correctness, condition state machine transitions, replay invariant (action log → identical state), API route contracts, and React component rendering.

---

## Environment Variables

| Variable | Service | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | api | No | API server port (default: `4000`) |
| `SUPABASE_URL` | api | No* | Supabase project URL for state persistence |
| `SUPABASE_SERVICE_KEY` | api | No* | Supabase service role key |
| `TWIN_API_URL` | web | No | Base URL of the API service (default: `http://127.0.0.1:4000`) |
| `RAILWAY_ENVIRONMENT` | api | No | Set automatically by Railway; causes server to bind `0.0.0.0` |

\* Required for production persistence. Without Supabase env vars the system runs fully in-memory.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

MIT — see [LICENSE](LICENSE).
