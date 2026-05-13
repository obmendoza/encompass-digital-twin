import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenantTx } from "../db/pool.js";
import { getTenantContext } from "../tenant-context.js";
import { requireLoanForTenant } from "./_helpers.js";
import type { Store } from "@twin/core";
import {
  run,
  accept,
  dismiss,
  reopenAndAccept,
  clearAlert,
  PredictionNotFoundError,
  PredictionNotPendingError,
  PredictionNotDismissedError,
  DismissalReasonTooShortError,
  AlertNotFoundError,
  PredictionConditionCollisionError,
} from "../services/predict-conditions/index.js";
import { buildLoanContextFromLoan as buildLoanContext } from "./predict-conditions-context-builder.js";

const DismissBody = z.object({ reason: z.string() });

export function registerPredictConditionsRoutes(app: FastifyInstance, store: Store): void {
  app.get<{ Params: { loanId: string } }>(
    "/loans/:loanId/predictions",
    async (req, reply) => {
      const { tenantId } = getTenantContext();
      const { loanId } = req.params;
      // Require the loan to exist for this tenant before issuing the DB read.
      // Without this, a cross-tenant or non-existent loanId returns an empty
      // {predictions:[], alerts:[]} which callers can't distinguish from a
      // legitimate empty result. requireLoanForTenant throws a 404 fastify
      // error response on mismatch. (Task 7 reviewer I-2.)
      requireLoanForTenant(store, loanId);
      return withTenantTx(tenantId, async (c) => {
        const predictions = await c.query(
          `SELECT id, tenant_id, loan_id, prediction_run_id, source_input_hash,
                  predicted_at, predicted_by, kb_version_id, resolved_income_type,
                  category, description, note, source_list, source_order, status,
                  acted_by, acted_at, acted_role, dismissal_reason, accepted_condition_id
             FROM predicted_conditions
            WHERE tenant_id = $1 AND loan_id = $2
            ORDER BY status, source_list, source_order`,
          [tenantId, loanId],
        );
        const alerts = await c.query(
          `SELECT id, tenant_id, loan_id, alerted_at, error_class, error_payload,
                  remediation_hint, cleared_by, cleared_at
             FROM prediction_alerts
            WHERE tenant_id = $1 AND loan_id = $2
            ORDER BY alerted_at DESC`,
          [tenantId, loanId],
        );
        return reply.send({ predictions: predictions.rows, alerts: alerts.rows });
      });
    },
  );

  app.post<{ Params: { loanId: string } }>(
    "/loans/:loanId/predictions/run",
    async (req, reply) => {
      const ctx = getTenantContext();
      const { loanId } = req.params;
      const loan = requireLoanForTenant(store, loanId);
      const context = buildLoanContext(loan);
      // Wrap run() in try/catch for symmetry with the other mutation routes.
      // run() catches its own resolver errors and writes prediction_alerts
      // rows, so this catch only fires on truly unexpected failures (DB
      // outage, lost store reference inside the helper, etc.). Mapping
      // through the shared error handler returns a clean 5xx instead of an
      // uncaught rejection. (Task 7 reviewer I-1.)
      try {
        const result = await run(ctx.tenantId, loanId, context, `system:manual-rerun:${ctx.userId}` as const);
        return reply.send(result);
      } catch (e) {
        return mapError(e, reply);
      }
    },
  );

  app.post<{ Params: { loanId: string; predictionId: string } }>(
    "/loans/:loanId/predictions/:predictionId/accept",
    async (req, reply) => {
      const ctx = getTenantContext();
      const role = inferRole(ctx);
      try {
        const result = await accept(ctx.tenantId, req.params.loanId, req.params.predictionId, ctx.userId, role);
        return reply.send(result);
      } catch (e) {
        return mapError(e, reply);
      }
    },
  );

  app.post<{ Params: { loanId: string; predictionId: string } }>(
    "/loans/:loanId/predictions/:predictionId/dismiss",
    async (req, reply) => {
      const ctx = getTenantContext();
      const role = inferRole(ctx);
      const parsed = DismissBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const result = await dismiss(ctx.tenantId, req.params.loanId, req.params.predictionId, ctx.userId, role, parsed.data.reason);
        return reply.send(result);
      } catch (e) {
        return mapError(e, reply);
      }
    },
  );

  app.post<{ Params: { loanId: string; predictionId: string } }>(
    "/loans/:loanId/predictions/:predictionId/reopen-and-accept",
    async (req, reply) => {
      const ctx = getTenantContext();
      const role = inferRole(ctx);
      if (role !== "va") return reply.code(403).send({ error: "reopen-and-accept is VA-only" });
      try {
        const result = await reopenAndAccept(ctx.tenantId, req.params.loanId, req.params.predictionId, ctx.userId, role);
        return reply.send(result);
      } catch (e) {
        return mapError(e, reply);
      }
    },
  );

  app.post<{ Params: { loanId: string; alertId: string } }>(
    "/loans/:loanId/predictions/alerts/:alertId/clear",
    async (req, reply) => {
      const ctx = getTenantContext();
      try {
        const result = await clearAlert(ctx.tenantId, req.params.loanId, req.params.alertId, ctx.userId);
        return reply.send(result);
      } catch (e) {
        return mapError(e, reply);
      }
    },
  );
}

function inferRole(ctx: ReturnType<typeof getTenantContext>): "operator" | "va" {
  // Role is read from the tenant context (server-derived from JWT
  // app_metadata.role on the verified-claims path; from the x-user-role
  // header only on the internal-service-call bypass — see
  // middleware/jwt-tenant-resolver.ts). Production JWT callers cannot
  // spoof this — Codex P1 fix.
  return ctx.role;
}

function mapError(e: unknown, reply: import("fastify").FastifyReply): unknown {
  if (e instanceof PredictionNotFoundError || e instanceof AlertNotFoundError) {
    return reply.code(404).send({ error: e.message });
  }
  if (
    e instanceof PredictionNotPendingError ||
    e instanceof PredictionNotDismissedError ||
    e instanceof PredictionConditionCollisionError
  ) {
    return reply.code(409).send({ error: e.message });
  }
  if (e instanceof DismissalReasonTooShortError) {
    return reply.code(422).send({ error: e.message });
  }
  throw e;
}
