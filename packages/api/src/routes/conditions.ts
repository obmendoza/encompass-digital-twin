import type { FastifyInstance } from "fastify";
import type { Store } from "@twin/core";
import {
  NewConditionSchema, UpdateConditionSchema,
  ClearConditionSchema, WaiveConditionSchema, ActorOnlySchema,
} from "../schemas.js";
import { requireLoanForTenant } from "./_helpers.js";

export function registerConditionRoutes(app: FastifyInstance, store: Store) {
  app.get<{ Params: { loanId: string } }>("/loans/:loanId/conditions", async (req) =>
    requireLoanForTenant(store, req.params.loanId).conditions);

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/conditions", async (req, reply) => {
    const body = NewConditionSchema.parse(req.body);
    store.dispatch({ type: "AddCondition", loanId: req.params.loanId,
      condition: body.condition, actor: body.actor });
    reply.send(requireLoanForTenant(store, req.params.loanId));
  });

  app.patch<{ Params: { loanId: string; conditionId: string } }>(
    "/loans/:loanId/conditions/:conditionId",
    async (req, reply) => {
      const body = UpdateConditionSchema.parse(req.body);
      store.dispatch({ type: "UpdateCondition", loanId: req.params.loanId,
        conditionId: req.params.conditionId, patch: body.patch, actor: body.actor });
      reply.send(requireLoanForTenant(store, req.params.loanId));
    });

  app.post<{ Params: { loanId: string; conditionId: string } }>(
    "/loans/:loanId/conditions/:conditionId/clear",
    async (req, reply) => {
      const body = ClearConditionSchema.parse(req.body);
      store.dispatch({ type: "ClearCondition", loanId: req.params.loanId,
        conditionId: req.params.conditionId, notes: body.notes, actor: body.actor });
      reply.send(requireLoanForTenant(store, req.params.loanId));
    });

  app.post<{ Params: { loanId: string; conditionId: string } }>(
    "/loans/:loanId/conditions/:conditionId/waive",
    async (req, reply) => {
      const body = WaiveConditionSchema.parse(req.body);
      store.dispatch({ type: "WaiveCondition", loanId: req.params.loanId,
        conditionId: req.params.conditionId, rationale: body.rationale, actor: body.actor });
      reply.send(requireLoanForTenant(store, req.params.loanId));
    });

  app.delete<{ Params: { loanId: string; conditionId: string } }>(
    "/loans/:loanId/conditions/:conditionId",
    async (req, reply) => {
      const body = ActorOnlySchema.parse(req.body);
      store.dispatch({ type: "RemoveCondition", loanId: req.params.loanId,
        conditionId: req.params.conditionId, actor: body.actor });
      reply.send(requireLoanForTenant(store, req.params.loanId));
    });
}
