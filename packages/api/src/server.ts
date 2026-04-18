import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { createStore, type Store } from "@twin/core";
import { scenarios } from "@twin/fixtures";
import { registerErrorHandler } from "./errors.js";
import { registerWorldRoutes } from "./routes/world.js";
import { registerLoanRoutes } from "./routes/loans.js";
import { registerConditionRoutes } from "./routes/conditions.js";
import { registerDocumentRoutes } from "./routes/documents.js";
import { registerRecommendationRoutes } from "./routes/recommendation.js";
import { registerUploadRoutes } from "./routes/uploads.js";
import { buildOpenApiSpec } from "./openapi.js";

export interface BuildOpts {
  now?: () => string;
  preloadScenarioId?: string;
}

export function buildServer(opts: BuildOpts = {}): { app: FastifyInstance; store: Store } {
  const app = Fastify({ logger: false });
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB max
  const store = createStore({ scenarios, now: opts.now });

  if (opts.preloadScenarioId === "*") {
    for (const id of Object.keys(scenarios)) {
      store.dispatch({ type: "LoadScenario", scenarioId: id });
    }
  } else if (opts.preloadScenarioId) {
    store.dispatch({ type: "LoadScenario", scenarioId: opts.preloadScenarioId });
  }

  registerErrorHandler(app);
  registerWorldRoutes(app, store);
  registerLoanRoutes(app, store);
  registerConditionRoutes(app, store);
  registerDocumentRoutes(app, store);
  registerRecommendationRoutes(app, store);
  registerUploadRoutes(app, store);

  app.get("/health", async () => ({ ok: true }));

  const spec = buildOpenApiSpec();
  app.get("/openapi.json", async () => spec);

  return { app, store };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app } = buildServer({ preloadScenarioId: "*" });
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : "127.0.0.1";
  app.listen({ port, host })
    .then(() => console.log(`api listening on :${port}`))
    .catch((e) => { console.error(e); process.exit(1); });
}
