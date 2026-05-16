// extraction-audit.ts — Cross-source supersede helper for document_extractions.
//
// When a new extraction from one source (e.g., 'llm-extractor') supersedes an
// existing active row from a different source (e.g., 'portal'), emit a
// tenant_audit_log row (C2). Same-source re-extractions (e.g., LLM re-running
// after schema bump) do NOT emit audit rows.
//
// Both analysis-output-ingest and hoi-extractor-dispatcher call this before
// their document_extractions INSERT.

import type pg from "pg";

interface SupersedeCheckOpts {
  /** DB client (already in a tenant transaction with RLS set). */
  c: pg.PoolClient;
  tenantId: string;
  loanId: string;
  documentUuid: string;
  extractorKind: "hoi-policy" | "flood-cert";
  schemaVersion: number;
  /** Source of the new row ('portal' | 'llm-extractor' | 'manual'). */
  newSource: string;
  /** Actor id to record in audit log (e.g., 'api-ingest', 'worker:hoi-extractor'). */
  actorId: string;
}

/**
 * Check whether an active extraction row exists for this document/kind/schema.
 * If one exists with a DIFFERENT source, mark it superseded and emit an audit row.
 * If one exists with the SAME source, do nothing (caller's ON CONFLICT DO NOTHING handles it).
 *
 * Returns true if the caller should proceed with their INSERT (either no conflict,
 * or the prior row was superseded). Returns false if the prior row had the same source
 * and the caller's ON CONFLICT DO NOTHING will silently skip.
 */
export async function handleExtractionCrossSourceSupersede(
  opts: SupersedeCheckOpts,
): Promise<{ shouldInsert: boolean; superseded: boolean }> {
  const { c, tenantId, loanId, documentUuid, extractorKind, schemaVersion, newSource, actorId } = opts;

  const { rows } = await c.query<{ id: string; source: string }>(
    `SELECT id, source FROM document_extractions
      WHERE tenant_id = $1 AND document_id = $2 AND extractor_kind = $3 AND schema_version = $4
        AND superseded_at IS NULL
      LIMIT 1`,
    [tenantId, documentUuid, extractorKind, schemaVersion],
  );

  const existing = rows[0] ?? null;
  if (!existing) {
    // No conflict — caller can INSERT freely.
    return { shouldInsert: true, superseded: false };
  }

  if (existing.source === newSource) {
    // Same source — ON CONFLICT DO NOTHING handles idempotency; no audit needed.
    return { shouldInsert: true, superseded: false };
  }

  // Different source — supersede the existing row and emit a cross-source audit row.
  await c.query(
    `UPDATE document_extractions SET superseded_at = NOW() WHERE id = $1`,
    [existing.id],
  );

  await c.query(
    `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
     VALUES ($1, $2, 'document_extraction.superseded', $3, $4::jsonb)`,
    [
      tenantId,
      actorId,
      `extraction ${existing.id} superseded by new ${newSource} extraction (was ${existing.source})`,
      JSON.stringify({
        document_id: documentUuid,
        loan_id: loanId,
        extractor_kind: extractorKind,
        schema_version: schemaVersion,
        from_source: existing.source,
        to_source: newSource,
        prior_extraction_id: existing.id,
      }),
    ],
  );

  return { shouldInsert: true, superseded: true };
}
