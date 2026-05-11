# NPNQM Source Artifacts

This directory contains operator-facing artifacts handed to us by NPNQM (the pilot tenant in the multi-tenant platform). They are the inputs to KB ingest pipelines.

## Files

- `Document_Requirements_All_Income_Types.md` — engine-generated doc-requirements snapshot from NPNQM's `eligibility_check_v2.py` (`sync_doc_requirements_from_engine.py`). Ingested via `pnpm tsx scripts/ingest-doc-checklist.ts`. See `docs/superpowers/specs/2026-05-12-doc-checklist-ingest-design.md`.

## Refresh protocol

When NPNQM publishes a new version, replace the file here and bump the `--version` integer in the ingest CLI invocation. The ingest's parity check + optional `--max-age` flag will surface drift.
