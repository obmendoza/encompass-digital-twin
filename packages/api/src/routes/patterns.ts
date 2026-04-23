import type { FastifyInstance } from "fastify";
import { withTenantTx } from "../db/pool.js";
import { getTenantId, getTenantContext } from "../tenant-context.js";
import { DismissPatternSchema } from "@twin/core";
import { previewPatch } from "../learning/guideline-patcher.js";

// ── Admin Approval TTL ───────────────────────────────────────────
const ADMIN_APPROVAL_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

export function registerPatternRoutes(app: FastifyInstance): void {
  // ── Dismiss pattern ─────────────────────────────────────────────
  app.post<{ Params: { tenantId: string; patternId: string } }>(
    "/metrics/:tenantId/patterns/:patternId/dismiss",
    async (req, reply) => {
      const tenantId = getTenantId();
      const ctx = getTenantContext();
      const { patternId } = req.params;

      const parsed = DismissPatternSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const { reason, cooldownDays } = parsed.data;

      let suppressedUntil: string;
      if (cooldownDays === "permanent") {
        suppressedUntil = "2099-12-31T00:00:00Z";
      } else {
        const d = new Date();
        d.setDate(d.getDate() + cooldownDays);
        suppressedUntil = d.toISOString();
      }

      return withTenantTx(tenantId, async (client) => {
        // Verify pattern exists and belongs to tenant
        const { rows: existing } = await client.query(
          `SELECT id, status, status_history FROM detected_patterns WHERE id = $1 AND tenant_id = $2`,
          [patternId, tenantId],
        );
        if (existing.length === 0) return reply.code(404).send({ error: "Pattern not found" });

        const pattern = existing[0];
        const statusHistory = (pattern.status_history as Array<Record<string, unknown>>) ?? [];
        statusHistory.push({
          status: "dismissed",
          at: new Date().toISOString(),
          by: ctx.userId,
          reason,
        });

        await client.query(
          `UPDATE detected_patterns
           SET status = 'dismissed',
               suppressed_until = $1,
               status_history = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [suppressedUntil, JSON.stringify(statusHistory), patternId],
        );

        // Find pending suggestion for learning outcome
        const { rows: suggestionRows } = await client.query(
          `SELECT id FROM pattern_suggestions
           WHERE pattern_id = $1 AND status = 'pending'
           ORDER BY created_at DESC LIMIT 1`,
          [patternId],
        );

        // Reject any pending suggestions for this pattern
        await client.query(
          `UPDATE pattern_suggestions
           SET status = 'rejected', reviewed_by = $1
           WHERE pattern_id = $2 AND status = 'pending'`,
          [ctx.userId, patternId],
        );

        // Write learning outcome for rejection
        if (suggestionRows.length > 0) {
          const suggestion = suggestionRows[0];
          await client.query(
            `INSERT INTO learning_outcomes (tenant_id, pattern_id, suggestion_id, label, reviewer_role, rejection_reason, time_to_decision_hours)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              tenantId,
              patternId,
              suggestion.id,
              "rejected",
              "admin",
              reason,
              null,
            ],
          );
        }

        return { ok: true, patternId, status: "dismissed", suppressedUntil };
      });
    },
  );

  // ── Regenerate pattern ──────────────────────────────────────────
  app.post<{ Params: { tenantId: string; patternId: string } }>(
    "/metrics/:tenantId/patterns/:patternId/regenerate",
    async (req, reply) => {
      const tenantId = getTenantId();
      const ctx = getTenantContext();
      const { patternId } = req.params;

      return withTenantTx(tenantId, async (client) => {
        const { rows: existing } = await client.query(
          `SELECT id, status, status_history FROM detected_patterns WHERE id = $1 AND tenant_id = $2`,
          [patternId, tenantId],
        );
        if (existing.length === 0) return reply.code(404).send({ error: "Pattern not found" });

        const pattern = existing[0];
        if (!["analysis_failed", "suggestion_ready"].includes(pattern.status)) {
          return reply.code(400).send({
            error: `Cannot regenerate pattern in status '${pattern.status}'. Must be 'analysis_failed' or 'suggestion_ready'.`,
          });
        }

        const statusHistory = (pattern.status_history as Array<Record<string, unknown>>) ?? [];
        statusHistory.push({
          status: "new",
          at: new Date().toISOString(),
          by: ctx.userId,
          reason: "regenerated",
        });

        await client.query(
          `UPDATE detected_patterns
           SET status = 'new',
               status_history = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(statusHistory), patternId],
        );

        return { ok: true, patternId, status: "new" };
      });
    },
  );

  // ── Preview patch ──────────────────────────────────────────────
  app.post<{ Params: { tenantId: string; patternId: string } }>(
    "/metrics/:tenantId/patterns/:patternId/preview",
    async (req, reply) => {
      const tenantId = getTenantId();
      const { patternId } = req.params;

      return withTenantTx(tenantId, async (client) => {
        // Load the pending suggestion
        const { rows: suggestionRows } = await client.query(
          `SELECT id, specific_change
           FROM pattern_suggestions
           WHERE pattern_id = $1 AND status = 'pending'
           ORDER BY created_at DESC LIMIT 1`,
          [patternId],
        );
        if (suggestionRows.length === 0) {
          return reply.code(400).send({ error: "No pending suggestion for this pattern" });
        }

        const suggestion = suggestionRows[0];
        const change = typeof suggestion.specific_change === "string"
          ? JSON.parse(suggestion.specific_change)
          : suggestion.specific_change;

        // Load pattern to determine the program
        const { rows: patternRows } = await client.query(
          `SELECT program FROM detected_patterns WHERE id = $1 AND tenant_id = $2`,
          [patternId, tenantId],
        );
        if (patternRows.length === 0) {
          return reply.code(404).send({ error: "Pattern not found" });
        }

        const program = patternRows[0].program || change.scope || "default";

        // Load active guideline
        const { rows: guidelineRows } = await client.query(
          `SELECT id, rules FROM tenant_guidelines
           WHERE tenant_id = $1 AND program = $2 AND active = true
           ORDER BY version DESC LIMIT 1`,
          [tenantId, program],
        );
        if (guidelineRows.length === 0) {
          return reply.code(404).send({ error: `No active guideline for program '${program}'` });
        }

        const guideline = guidelineRows[0];
        const rules = typeof guideline.rules === "string"
          ? JSON.parse(guideline.rules)
          : guideline.rules;

        const result = previewPatch(rules, change);

        return {
          guidelineVersionId: guideline.id,
          before: result.before,
          after: result.after,
          diff: change,
          success: result.success,
          error: result.error,
        };
      });
    },
  );

  // ── Apply pattern suggestion ────────────────────────────────────
  app.post<{ Params: { tenantId: string; patternId: string } }>(
    "/metrics/:tenantId/patterns/:patternId/apply",
    async (req, reply) => {
      const tenantId = getTenantId();
      const ctx = getTenantContext();
      const { patternId } = req.params;

      return withTenantTx(tenantId, async (client) => {
        // Find pattern
        const { rows: patternRows } = await client.query(
          `SELECT id, status, status_history, detected_at FROM detected_patterns WHERE id = $1 AND tenant_id = $2`,
          [patternId, tenantId],
        );
        if (patternRows.length === 0) return reply.code(404).send({ error: "Pattern not found" });

        const pattern = patternRows[0];

        // Find pending suggestion
        const { rows: suggestionRows } = await client.query(
          `SELECT id, suggestion_type, reviewed_by, compliance_reviewed_by, admin_approved_at, created_at
           FROM pattern_suggestions
           WHERE pattern_id = $1 AND status = 'pending'
           ORDER BY created_at DESC LIMIT 1`,
          [patternId],
        );
        if (suggestionRows.length === 0) {
          return reply.code(400).send({ error: "No pending suggestion for this pattern" });
        }

        const suggestion = suggestionRows[0];
        const requiresTwoKey = ["guideline_update", "threshold_change"].includes(suggestion.suggestion_type);

        // ── Admin approval TTL check ─────────────────────────────
        if (suggestion.admin_approved_at) {
          const approvedAt = new Date(suggestion.admin_approved_at).getTime();
          const now = Date.now();
          if (now - approvedAt > ADMIN_APPROVAL_TTL_MS) {
            // Approval expired — clear approvals
            await client.query(
              `UPDATE pattern_suggestions
               SET reviewed_by = NULL, admin_approved_at = NULL
               WHERE id = $1`,
              [suggestion.id],
            );

            return reply.code(410).send({ error: "Admin approval expired" });
          }
        }

        if (requiresTwoKey) {
          // ── Separation of duties check ─────────────────────────
          if (suggestion.reviewed_by && ctx.userId === suggestion.reviewed_by) {
            // Same user trying to provide compliance confirmation
            return reply.code(409).send({
              error: "Same user cannot provide both admin and compliance approval",
            });
          }

          // Check if compliance review is present
          if (!suggestion.compliance_reviewed_by) {
            // Mark admin-approved, awaiting compliance
            await client.query(
              `UPDATE pattern_suggestions
               SET reviewed_by = $1, admin_approved_at = NOW()
               WHERE id = $2`,
              [ctx.userId, suggestion.id],
            );

            const statusHistory = (pattern.status_history as Array<Record<string, unknown>>) ?? [];
            statusHistory.push({
              status: "suggestion_ready",
              at: new Date().toISOString(),
              by: ctx.userId,
              reason: "admin_approved_awaiting_compliance",
            });
            await client.query(
              `UPDATE detected_patterns SET status_history = $1, updated_at = NOW() WHERE id = $2`,
              [JSON.stringify(statusHistory), patternId],
            );

            return {
              ok: true,
              patternId,
              suggestionId: suggestion.id,
              status: "awaiting_compliance",
              message: "Admin approval recorded. Compliance review required before applying.",
            };
          }

          // Both reviews present — if admin hasn't reviewed yet, record it
          if (!suggestion.reviewed_by) {
            await client.query(
              `UPDATE pattern_suggestions SET reviewed_by = $1, admin_approved_at = NOW() WHERE id = $2`,
              [ctx.userId, suggestion.id],
            );
          }
        }

        // Apply the suggestion
        await client.query(
          `UPDATE pattern_suggestions SET status = 'applied', reviewed_by = COALESCE(reviewed_by, $1) WHERE id = $2`,
          [ctx.userId, suggestion.id],
        );

        const statusHistory = (pattern.status_history as Array<Record<string, unknown>>) ?? [];
        statusHistory.push({
          status: "applied",
          at: new Date().toISOString(),
          by: ctx.userId,
        });

        await client.query(
          `UPDATE detected_patterns
           SET status = 'applied',
               status_history = $1,
               updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(statusHistory), patternId],
        );

        // ── Learning outcome ─────────────────────────────────────
        const detectedAt = new Date(pattern.detected_at).getTime();
        const timeToDecisionHours = Math.round((Date.now() - detectedAt) / (1000 * 60 * 60) * 100) / 100;

        await client.query(
          `INSERT INTO learning_outcomes (tenant_id, pattern_id, suggestion_id, label, reviewer_role, rejection_reason, time_to_decision_hours)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            tenantId,
            patternId,
            suggestion.id,
            "applied",
            "admin",
            null,
            timeToDecisionHours,
          ],
        );

        return { ok: true, patternId, suggestionId: suggestion.id, status: "applied" };
      });
    },
  );
}
