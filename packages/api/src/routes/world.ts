import type { FastifyInstance } from "fastify";
import type { Store } from "@twin/core";
import { LoadScenarioSchema } from "../schemas.js";

export function registerWorldRoutes(app: FastifyInstance, store: Store) {
  app.get("/scenarios", async () => store.listScenarios());

  app.post("/world/load-scenario", async (req, reply) => {
    const body = LoadScenarioSchema.parse(req.body);
    store.dispatch({ type: "LoadScenario", scenarioId: body.scenarioId });
    reply.send({ scenarioId: store.getState().scenarioId });
  });

  app.post("/world/reset", async (_req, reply) => {
    store.dispatch({ type: "ResetWorld" });
    reply.send({ scenarioId: store.getState().scenarioId });
  });
}
