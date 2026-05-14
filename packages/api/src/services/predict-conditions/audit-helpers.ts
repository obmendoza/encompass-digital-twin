import type pg from "pg";

/**
 * Insert a tenant_audit_log row that may be retried (advisory-lock-edge
 * races during auto-clear, replays after partial commits, etc.). Uses
 * INSERT...SELECT WHERE NOT EXISTS keyed on a specific metadata field —
 * migration 008's no_update_audit rule blocks ON CONFLICT DO UPDATE, so
 * the WHERE NOT EXISTS is the safe dedup pattern.
 *
 * Migration 018's tenant_audit_log_predict_dedup and
 * tenant_audit_log_predict_alert_dedup unique indexes provide the DB-layer
 * guard. This helper's predicate matches those indexes — same dedup key
 * tuple (target_tenant_id, action, metadata->>$dedupKey, actor_id) — so a
 * replay against an already-written row is a no-op rather than a
 * uniqueness violation.
 *
 * Single extraction point so the six predict_conditions.* audit sites
 * (alert, alert_clear, accept, dismiss, reopen_and_accept — alert_clear
 * appears in two places) stay consistent. Adding a new audit action that
 * dedups on a different metadata field just needs a new call site here
 * with the appropriate `dedupMetadataKey`.
 */
export async function insertAuditDedup(
  c: pg.PoolClient,
  args: {
    tenantId: string;
    actorId: string;
    action: string;
    reason: string;
    metadata: Record<string, unknown>;
    /** Metadata field used as the dedup discriminator (e.g. "prediction_id" or "alert_id"). */
    dedupMetadataKey: string;
    /** Value to match against `metadata->>$dedupMetadataKey` in the existence check. */
    dedupValue: string;
  },
): Promise<void> {
  await c.query(
    `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
     SELECT $1, $2, $3, $4, $5::jsonb
     WHERE NOT EXISTS (
       SELECT 1 FROM tenant_audit_log
        WHERE target_tenant_id = $1 AND actor_id = $2
          AND action = $3 AND (metadata->>$6) = $7
     )`,
    [
      args.tenantId,
      args.actorId,
      args.action,
      args.reason,
      JSON.stringify(args.metadata),
      args.dedupMetadataKey,
      args.dedupValue,
    ],
  );
}
