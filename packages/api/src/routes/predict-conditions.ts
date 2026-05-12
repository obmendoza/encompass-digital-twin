import type { FastifyInstance, FastifyRequest } from "fastify";
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
import type { LoanContext } from "../services/doc-requirements.js";

const DismissBody = z.object({ reason: z.string() });

function buildLoanContext(loan: ReturnType<Store["getState"]>["loans"][string]): LoanContext {
  // Map a Loan to the resolver's LoanContext. Fields are derived from the
  // existing Loan shape; the resolver's tuple is (incomeDocType, borrowerType,
  // citizenship, isItin) so we'll route on the most common combos for now.
  // Future work can broaden this mapping as new income types appear.
  const borrowerType = loan.qualifyingMethod === "TraditionalDocs" ? "W2" : "Self-Employed";
  const citizenship = "US Citizen"; // default; ITIN/Foreign National branches set differently
  const incomeDocType =
    loan.qualifyingMethod === "TraditionalDocs"
      ? "Full Doc"
      : loan.qualifyingMethod === "BankStatementDeposits"
        ? "Bank Stmts: 12 Mo. Personal"
        : loan.qualifyingMethod === "DSCRCoverage"
          ? "DSCR / No Ratio DSCR"
          : "Full Doc";
  const occupancy: "primary" | "second_home" | "investment" =
    loan.transaction.occupancy === "Primary"
      ? "primary"
      : loan.transaction.occupancy === "Second"
        ? "second_home"
        : "investment";
  return {
    incomeDocType,
    borrowerType,
    citizenship,
    isItin: false,
    llcOrLegalEntity: false,
    occupancy,
    state: loan.property.state,
    county: loan.property.city, // No county field on Loan; using city as a proxy for now
    usCredit: true,
    program: loan.nqmProgram,
  };
}

export function registerPredictConditionsRoutes(app: FastifyInstance, store: Store): void {
  app.get<{ Params: { loanId: string } }>(
    "/loans/:loanId/predictions",
    async (req, reply) => {
      const { tenantId } = getTenantContext();
      const { loanId } = req.params;
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
      const result = await run(ctx.tenantId, loanId, context, `system:manual-rerun:${ctx.userId}` as const);
      return reply.send(result);
    },
  );

  app.post<{ Params: { loanId: string; predictionId: string } }>(
    "/loans/:loanId/predictions/:predictionId/accept",
    async (req, reply) => {
      const ctx = getTenantContext();
      const role = inferRole(req);
      try {
        const result = await accept(ctx.tenantId, req.params.predictionId, ctx.userId, role);
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
      const role = inferRole(req);
      const parsed = DismissBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
      try {
        const result = await dismiss(ctx.tenantId, req.params.predictionId, ctx.userId, role, parsed.data.reason);
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
      const role = inferRole(req);
      if (role !== "va") return reply.code(403).send({ error: "reopen-and-accept is VA-only" });
      try {
        const result = await reopenAndAccept(ctx.tenantId, req.params.predictionId, ctx.userId, role);
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
        const result = await clearAlert(ctx.tenantId, req.params.alertId, ctx.userId);
        return reply.send(result);
      } catch (e) {
        return mapError(e, reply);
      }
    },
  );
}

function inferRole(req: FastifyRequest): "operator" | "va" {
  // v1 role inference: optional x-user-role header. The VA workspace client
  // sets x-user-role: va explicitly to satisfy reopen-and-accept's gate.
  // (Future work: thread a structured role through the tenant context middleware.)
  const h = req.headers["x-user-role"];
  if (Array.isArray(h)) return h[0] === "va" ? "va" : "operator";
  return h === "va" ? "va" : "operator";
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
