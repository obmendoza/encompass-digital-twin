import type { FastifyInstance } from "fastify";
import { ActionError, type Store } from "@twin/core";
import { scenarios } from "@twin/fixtures";
import { LoadScenarioSchema, InjectLoanSchema } from "../schemas.js";
import { z } from "zod";
import { getTenantId } from "../tenant-context.js";
import { getDemoTenantId } from "../tenant-cache.js";
import { isDbEnabled } from "../db/pool.js";

const LoadByLoanSchema = z.object({ loanId: z.string().min(1) });

/**
 * Check if current tenant is allowed to use demo/world operations.
 * In dev/test (no DB), all tenants are allowed.
 * In production, only the demo tenant can use LoadScenario/ResetWorld.
 */
async function requireDemoTenant(): Promise<boolean> {
  if (!isDbEnabled()) return true;
  try {
    const demoId = await getDemoTenantId();
    return getTenantId() === demoId;
  } catch {
    return true; // Fresh install, no demo tenant yet
  }
}

export function registerWorldRoutes(app: FastifyInstance, store: Store) {
  app.get("/scenarios", async () => store.listScenarios());

  app.post("/world/load-scenario", async (req, reply) => {
    if (!(await requireDemoTenant())) {
      return reply.status(403).send({ error: "Only demo tenant may load scenarios" });
    }
    const body = LoadScenarioSchema.parse(req.body);
    store.dispatch({ type: "LoadScenario", scenarioId: body.scenarioId });
    reply.send({ scenarioId: store.getState().scenarioId });
  });

  app.post("/world/load-by-loan", async (req, reply) => {
    if (!(await requireDemoTenant())) {
      return reply.status(403).send({ error: "Only demo tenant may load scenarios" });
    }
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
    if (!(await requireDemoTenant())) {
      return reply.status(403).send({ error: "Only demo tenant may reset world" });
    }
    store.dispatch({ type: "ResetWorld" });
    reply.send({ scenarioId: store.getState().scenarioId });
  });

  app.post("/world/inject-loan", async (req, reply) => {
    const body = InjectLoanSchema.parse(req.body);
    store.dispatch({ type: "InjectLoan", loan: body.loan });
    reply.send({ ok: true, loanId: body.loan.id });
  });
}
