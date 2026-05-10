// va-toggle.ts
// Applies a tenant.settings.va.required flip across in-flight loans.
//
// Toggle semantics (spec v2.1 §"Toggle Semantics"):
//   false → true: bulk-update every loan currently at va_state='agent_review_pending'
//                 to va_state='va_review_pending' with assigned_pool_id=$fallbackPoolId.
//                 Loans already past that point (uw_review_pending, decided) are unaffected.
//   true → false: bulk-update every loan at va_state IN ('va_review_pending','va_in_review')
//                 to va_state='uw_review_pending', clearing va_id and claimed_at.
//                 Loans at va_state='va_doc_request_pending' are PRESERVED as-is — the
//                 doc request is in flight; aborting it would create a worse UX.
//   no-op:        when fromRequired === toRequired.
//
// `decided` is terminal — never touched.
//
// FOUNDATION NOTE: the plan claimed `tenant_audit_log` does not exist (Tenant Isolation v2
// foundation drift). Primary-source check disproves this — the table was created by
// migration 001 and is actively used by routes/tenants.ts and routes/onboarding.ts. Schema
// is (id, actor_id, target_tenant_id, action, reason, metadata, created_at). The audit
// INSERT below uses that real schema and writes within the same transaction as the
// UPDATE, so the audit row is consistent with the state change.

import { withTenantTx } from "../db/pool.js";

export interface ToggleFlipResult {
  direction: "false_to_true" | "true_to_false" | "noop";
  /** false→true: loans moved from agent_review_pending to va_review_pending. */
  transitioned: number;
  /** true→false: loans moved from va_review_pending or va_in_review to uw_review_pending. */
  released: number;
  /** true→false: loans left in va_doc_request_pending (in-flight doc loop preserved). */
  preservedDocRequest: number;
}

export async function applyToggleFlip(
  tenantId: string,
  fromRequired: boolean,
  toRequired: boolean,
  fallbackPoolId: string,
): Promise<ToggleFlipResult> {
  if (fromRequired === toRequired) {
    return {
      direction: "noop",
      transitioned: 0,
      released: 0,
      preservedDocRequest: 0,
    };
  }

  return withTenantTx(tenantId, async (client) => {
    if (!fromRequired && toRequired) {
      // false → true backfill.
      // Backfill simplification: every loan at agent_review_pending goes to fallback pool.
      // Per-loan rule evaluation against routing rules is intentionally NOT done here —
      // backfilling historical loans against rules they may not match cleanly is operationally
      // hostile. The fallback pool is always a valid destination per migration 014's seed.
      const t = await client.query(
        `UPDATE va_loan_state
            SET va_state = 'va_review_pending', assigned_pool_id = $1, updated_at = now()
          WHERE tenant_id = $2 AND va_state = 'agent_review_pending'`,
        [fallbackPoolId, tenantId],
      );
      const transitioned = t.rowCount ?? 0;

      await client.query(
        `INSERT INTO tenant_audit_log (actor_id, target_tenant_id, action, reason, metadata)
         VALUES ($1, $2, 'va_toggle_flip', $3, $4::jsonb)`,
        [
          "system:va-toggle",
          tenantId,
          `va.required false→true: backfilled ${transitioned} loan(s) to fallback pool`,
          JSON.stringify({
            direction: "false_to_true",
            transitioned,
            fallbackPoolId,
          }),
        ],
      );

      return {
        direction: "false_to_true",
        transitioned,
        released: 0,
        preservedDocRequest: 0,
      };
    }

    // true → false: release pending-VA states, preserve in-flight doc-request loops.
    const r = await client.query(
      `UPDATE va_loan_state
          SET va_state = 'uw_review_pending', va_id = NULL, claimed_at = NULL, updated_at = now()
        WHERE tenant_id = $1 AND va_state IN ('va_review_pending', 'va_in_review')`,
      [tenantId],
    );
    const released = r.rowCount ?? 0;

    const preserved = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM va_loan_state
        WHERE tenant_id = $1 AND va_state = 'va_doc_request_pending'`,
      [tenantId],
    );
    const preservedDocRequest = parseInt(preserved.rows[0]?.count ?? "0", 10);

    await client.query(
      `INSERT INTO tenant_audit_log (actor_id, target_tenant_id, action, reason, metadata)
       VALUES ($1, $2, 'va_toggle_flip', $3, $4::jsonb)`,
      [
        "system:va-toggle",
        tenantId,
        `va.required true→false: released ${released} loan(s); preserved ${preservedDocRequest} in doc-request loop`,
        JSON.stringify({
          direction: "true_to_false",
          released,
          preservedDocRequest,
        }),
      ],
    );

    return {
      direction: "true_to_false",
      transitioned: 0,
      released,
      preservedDocRequest,
    };
  });
}
