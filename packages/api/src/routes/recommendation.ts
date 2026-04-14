import type { FastifyInstance } from "fastify";
import { ActionError, type Store } from "@twin/core";
import { RecordAgentStepSchema, StageRecommendationSchema, ActorOnlySchema } from "../schemas.js";

function requireLoan(store: Store, id: string) {
  const l = store.getLoan(id);
  if (!l) throw new ActionError("LOAN_NOT_FOUND", `loan '${id}' not found`, { loanId: id });
  return l;
}

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
    reply.send(requireLoan(store, req.params.loanId));
  });

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/recommendation/accept", async (req, reply) => {
    const body = ActorOnlySchema.parse(req.body);
    store.dispatch({ type: "AcceptRecommendation", loanId: req.params.loanId, actor: body.actor });
    reply.send(requireLoan(store, req.params.loanId));
  });

  app.delete<{ Params: { loanId: string } }>("/loans/:loanId/recommendation", async (req, reply) => {
    const body = ActorOnlySchema.parse(req.body);
    store.dispatch({ type: "ClearRecommendation", loanId: req.params.loanId, actor: body.actor });
    reply.send(requireLoan(store, req.params.loanId));
  });
}
