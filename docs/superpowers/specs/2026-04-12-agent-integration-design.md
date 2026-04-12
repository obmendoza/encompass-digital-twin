# Agent Integration — OpenAPI + Scenario Selector + Guide

**Date:** 2026-04-12
**Status:** Approved

---

## Purpose

Make the digital twin immediately drivable by AI agents. Three deliverables: a machine-readable API contract (OpenAPI), a UI mechanism to switch/reset scenarios, and a concise integration guide showing how an agent connects.

## Scope

### 1. OpenAPI Spec Generation

Generate `openapi.json` from the existing Zod schemas at startup. Serve it at `GET /openapi.json`. Use `zod-to-json-schema` to convert Zod schemas → JSON Schema, then assemble into an OpenAPI 3.1 document programmatically.

Endpoints to document (all existing):
- GET /health
- GET /scenarios
- POST /world/load-scenario
- POST /world/load-by-loan
- POST /world/reset
- GET /loans
- GET /loans/:loanId
- GET /loans/:loanId/audit
- GET /loans/:loanId/conditions
- GET /loans/:loanId/documents
- POST /loans/:loanId/decision
- POST /loans/:loanId/milestone
- POST /loans/:loanId/qualifying-income
- POST /loans/:loanId/conditions
- PATCH /loans/:loanId/conditions/:conditionId
- POST /loans/:loanId/conditions/:conditionId/clear
- POST /loans/:loanId/conditions/:conditionId/waive
- DELETE /loans/:loanId/conditions/:conditionId
- POST /loans/:loanId/documents
- PATCH /loans/:loanId/documents/:docId
- POST /loans/:loanId/documents/:docId/link

### 2. Scenario Selector in UI

Add a scenario dropdown to the Pipeline page and the loan shell toolbar:
- Dropdown lists all 12 scenarios (from GET /scenarios)
- Selecting one calls POST /world/load-scenario → revalidates pipeline
- "Reset All" button calls POST /world/reset then reloads all scenarios
- Current scenario indicator in toolbar

### 3. Agent Integration Guide

A markdown file at `docs/agent-guide.md` covering:
- API base URL and conventions
- Authentication (none — local sandbox)
- Workflow: load scenario → read loan → perform UW actions → set decision
- Complete curl example walking through the happy path
- OpenAPI spec location
- All available actions with request/response shapes
- Error handling (ActionError codes)
- Tips for Claude / MCP-capable agents

## Architecture

- New dependency: `zod-to-json-schema` in `@twin/api`
- New file: `packages/api/src/openapi.ts` — builds the spec
- New route: `GET /openapi.json`
- Modified: Pipeline page + Toolbar get scenario controls
- New: `docs/agent-guide.md`

## Testing

- HTTP test: GET /openapi.json returns valid JSON with paths
- Existing 55 tests still pass
