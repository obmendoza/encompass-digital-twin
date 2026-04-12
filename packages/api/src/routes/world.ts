import type { FastifyInstance } from "fastify";
import { ActionError, type Store } from "@twin/core";
import { scenarios } from "@twin/fixtures";
import { LoadScenarioSchema } from "../schemas.js";
import { z } from "zod";

const LoadByLoanSchema = z.object({ loanId: z.string().min(1) });

export function registerWorldRoutes(app: FastifyInstance, store: Store) {
  app.get("/scenarios", async () => store.listScenarios());

  app.post("/world/load-scenario", async (req, reply) => {
    const body = LoadScenarioSchema.parse(req.body);
    store.dispatch({ type: "LoadScenario", scenarioId: body.scenarioId });
    reply.send({ scenarioId: store.getState().scenarioId });
  });

  app.post("/world/load-by-loan", async (req, reply) => {
    const { loanId } = LoadByLoanSchema.parse(req.body);
    const match = Object.values(scenarios).find((s) => s.loan.id === loanId);
    if (!match) {
      throw new ActionError("LOAN_NOT_FOUND",
        `no scenario contains loan '${loanId}'`, { loanId });
    }
    store.dispatch({ type: "LoadScenario", scenarioId: match.id });
    reply.send({ scenarioId: match.id, loanId });
  });

  app.post("/world/reset", async (_req, reply) => {
    store.dispatch({ type: "ResetWorld" });
    reply.send({ scenarioId: store.getState().scenarioId });
  });
}
