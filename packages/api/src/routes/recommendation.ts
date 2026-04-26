import type { FastifyInstance } from "fastify";
import type { Store } from "@twin/core";
import { RecordAgentStepSchema, StageRecommendationSchema, ActorOnlySchema } from "../schemas.js";
import { requireLoanForTenant } from "./_helpers.js";

export function registerRecommendationRoutes(app: FastifyInstance, store: Store) {
  app.post<{ Params: { loanId: string } }>("/loans/:loanId/agent-step", async (req, reply) => {
    const body = RecordAgentStepSchema.parse(req.body);
    store.dispatch({ type: "RecordAgentStep", loanId: req.params.loanId, step: body.step, actor: body.actor });
    reply.send({ ok: true });
  });

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/recommendation", async (req, reply) => {
    const body = StageRecommendationSchema.parse(req.body);
    store.dispatch({ type: "StageRecommendation", loanId: req.params.loanId,
      recommendation: body.recommendation, actor: body.actor });
    reply.send(requireLoanForTenant(store, req.params.loanId));
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
