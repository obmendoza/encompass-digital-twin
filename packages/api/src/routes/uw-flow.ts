import type { FastifyInstance } from "fastify";
import { OverrideReasonSchema, type Store } from "@twin/core";
import { z } from "zod";
import { requireLoanForTenant } from "./_helpers.js";

const UwDecisionEnum = z.enum(["pending", "approved", "suspended", "counter", "denied"]);

const ActorSchema = z.object({
  kind: z.enum(["human", "agent"]),
  id: z.string().min(1),
});

const OverrideSchema = z.object({
  originalRecommendation: UwDecisionEnum,
  overrideDecision: UwDecisionEnum,
  overrideReason: OverrideReasonSchema,
  rationale: z.string().min(1),
  actor: ActorSchema,
});

const SendBackSchema = z.object({
  notes: z.string().min(1),
  actor: ActorSchema,
});

export function registerUwFlowRoutes(app: FastifyInstance, store: Store) {
  app.post<{ Params: { loanId: string } }>("/loans/:loanId/override", async (req, reply) => {
    const body = OverrideSchema.parse(req.body);
    store.dispatch({
      type: "OverrideDecision",
      loanId: req.params.loanId,
      originalRecommendation: body.originalRecommendation,
      overrideDecision: body.overrideDecision,
      overrideReason: body.overrideReason,
      rationale: body.rationale,
      actor: body.actor,
    });
    reply.send(requireLoanForTenant(store, req.params.loanId));
  });

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/send-back", async (req, reply) => {
    const body = SendBackSchema.parse(req.body);
    store.dispatch({
      type: "SendBackToVA",
      loanId: req.params.loanId,
      notes: body.notes,
      actor: body.actor,
    });
    reply.send(requireLoanForTenant(store, req.params.loanId));
  });
}
