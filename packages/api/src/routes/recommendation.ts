import type { FastifyInstance } from "fastify";
import type { Store } from "@twin/core";
import { RecordAgentStepSchema, StageRecommendationSchema, ActorOnlySchema } from "../schemas.js";
import { requireLoanForTenant } from "./_helpers.js";
import { getTenantId } from "../tenant-context.js";
import { isDbEnabled, withTenantTx } from "../db/pool.js";
import { routeLoan } from "../services/va-routing.js";
import { withStoreSnapshot } from "../store-db-consistency.js";

export function registerRecommendationRoutes(app: FastifyInstance, store: Store) {
  app.post<{ Params: { loanId: string } }>("/loans/:loanId/agent-step", async (req, reply) => {
    const body = RecordAgentStepSchema.parse(req.body);
    store.dispatch({ type: "RecordAgentStep", loanId: req.params.loanId, step: body.step, actor: body.actor });
    reply.send({ ok: true });
  });

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/recommendation", async (req, reply) => {
    const body = StageRecommendationSchema.parse(req.body);
    const loanId = req.params.loanId;

    await withStoreSnapshot(store, loanId, async () => {
      store.dispatch({ type: "StageRecommendation", loanId,
        recommendation: body.recommendation, actor: body.actor });

      // Persist VA loan state so the loan lands in the correct review queue.
      // - tenant.settings.va.required === true: route via va_routing_rules and
      //   stage as va_review_pending with the resolved pool.
      // - tenant.settings.va.required === false (or unset): promote directly to
      //   uw_review_pending so the existing UW decision flow continues to work.
      // Skipped entirely when DB is disabled (legacy in-memory test mode) so
      // tests that run without DATABASE_URL keep working.
      if (isDbEnabled()) {
        const tenantId = getTenantId();

        const settings = await withTenantTx(tenantId, async (c) => {
          const { rows } = await c.query<{ settings: { va?: { required?: boolean; fallbackPoolId?: string } } | null }>(
            "SELECT settings FROM tenants WHERE id = $1",
            [tenantId],
          );
          return rows[0]?.settings ?? {};
        });
        const vaRequired = settings?.va?.required === true;
        const fallbackPoolId = settings?.va?.fallbackPoolId;

        let nextState: "va_review_pending" | "uw_review_pending";
        let assignedPoolId: string | null = null;

        if (vaRequired && fallbackPoolId) {
          const loan = requireLoanForTenant(store, loanId);
          const route = await routeLoan(tenantId, loan, { fallbackPoolId });
          nextState = "va_review_pending";
          assignedPoolId = route.poolId;
        } else {
          // VA disabled (or misconfigured): existing UW flow.
          nextState = "uw_review_pending";
        }

        await withTenantTx(tenantId, async (c) => {
          await c.query(
            `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id, updated_at)
             VALUES ($1, $2, $3, $4, now())
             ON CONFLICT (tenant_id, loan_id) DO UPDATE
               SET va_state = EXCLUDED.va_state,
                   assigned_pool_id = EXCLUDED.assigned_pool_id,
                   updated_at = now()`,
            [tenantId, loanId, nextState, assignedPoolId],
          );
        });
      }
    });

    reply.send(requireLoanForTenant(store, loanId));
  });

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/recommendation/accept", async (req, reply) => {
    const body = ActorOnlySchema.parse(req.body);
    store.dispatch({ type: "AcceptRecommendation", loanId: req.params.loanId, actor: body.actor });
    reply.send(requireLoanForTenant(store, req.params.loanId));
  });

  app.delete<{ Params: { loanId: string } }>("/loans/:loanId/recommendation", async (req, reply) => {
    const body = ActorOnlySchema.parse(req.body);
    store.dispatch({ type: "ClearRecommendation", loanId: req.params.loanId, actor: body.actor });
    reply.send(requireLoanForTenant(store, req.params.loanId));
  });
}
