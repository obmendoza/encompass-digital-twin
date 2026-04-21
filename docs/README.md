# Documentation

## Architecture

- [Original Design Spec](superpowers/specs/2026-04-11-encompass-digital-twin-design.md) — overall system design, domain model, state machine
- [Agent Integration Design](superpowers/specs/2026-04-14-agent-twin-integration-design.md) — how the agent service connects to the twin
- [Earlier Agent Integration Notes](superpowers/specs/2026-04-12-agent-integration-design.md)

## API

- [Agent Integration Guide](agent-guide.md) — complete guide for building an AI agent against the API: endpoints, curl examples, error codes, workflow walkthrough
- [OpenAPI Spec](https://api-production-8666.up.railway.app/openapi.json) — live machine-readable contract (also available at `GET /openapi.json` locally)

## Screen Specs

Design specs for each underwriting screen:

| Spec | Screen |
|------|--------|
| [Slice 1](superpowers/specs/2026-04-11-encompass-digital-twin-slice1.md) | Pipeline + Transmittal (initial build) |
| [Slice 2 — Pipeline](superpowers/specs/2026-04-12-slice-2-pipeline-design.md) | Pipeline view |
| [Slice 3 — 1003 URLA](superpowers/specs/2026-04-12-slice-3-1003-urla-design.md) | 1003 Pages 1–3 |
| [Slice 4 — Income Analysis](superpowers/specs/2026-04-12-slice-4-income-analysis-design.md) | Income Analysis worksheet |
| [Slice 5 — eFolder](superpowers/specs/2026-04-12-slice-5-efolder-design.md) | eFolder document tracking |
| [Slice 6 — Credit & Liabilities](superpowers/specs/2026-04-12-slice-6-credit-liabilities-design.md) | Credit report + tradelines |
| [Slice 7 — Appraisal](superpowers/specs/2026-04-12-slice-7-appraisal-property-design.md) | Appraisal / property review |
| [Slice 8 — Compliance](superpowers/specs/2026-04-12-slice-8-compliance-design.md) | Compliance snapshot |
| [Slice 9 — Conversation Log](superpowers/specs/2026-04-12-slice-9-conversation-log-design.md) | Audit trail |
| [Slice 10 — Investor Overlays](superpowers/specs/2026-04-12-slice-10-investor-overlays-design.md) | Program overlay checks |
| [Scenario Workshop](superpowers/specs/2026-04-16-scenario-workshop-design.md) | Chat-driven scenario generation |
| [eFolder Documents (enhanced)](superpowers/specs/2026-04-19-efolder-documents-design.md) | IDP extraction, Stare & Compare, Push to Loan |

## Plans

Implementation plans used during development:

- [Slice 1 Plan](superpowers/plans/2026-04-11-encompass-digital-twin-slice1.md)
- [Slice 2 Plan](superpowers/plans/2026-04-12-slice-2-pipeline.md)
