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
import { registerAssignmentRoutes } from "./routes/assignment.js";
import { registerUwFlowRoutes } from "./routes/uw-flow.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerSystemCheckRoutes } from "./routes/system-check.js";
import { buildOpenApiSpec } from "./openapi.js";
import * as persistence from "./persistence.js";

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
  registerAssignmentRoutes(app, store);
  registerUwFlowRoutes(app, store);
  registerMetricsRoutes(app, store);
  registerSystemCheckRoutes(app, store);

  app.get("/health", async () => ({ ok: true }));

  const spec = buildOpenApiSpec();
  app.get("/openapi.json", async () => spec);

  return { app, store };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    await persistence.initTables();
    const { app, store } = buildServer({ preloadScenarioId: "*" });

    // Load persisted state on boot (if Supabase is configured)
    if (persistence.isEnabled()) {
      const saved = await persistence.loadState();
      if (saved && Object.keys(saved.loans).length > 0) {
        console.log(`[persistence] Restoring ${Object.keys(saved.loans).length} loans from Supabase`);
        for (const loan of Object.values(saved.loans)) {
          store.dispatch({ type: "InjectLoan", loan });
        }
        console.log("[persistence] State restored from Supabase");
      }

      // Wrap dispatch with save hook
      const _dispatch = store.dispatch.bind(store);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (store as any).dispatch = (action: Parameters<typeof _dispatch>[0]) => {
        const result = _dispatch(action);
        if (action.type === "ResetWorld") {
          persistence.clearState().catch(() => {});
        } else {
          persistence.saveState(result).catch(() => {});
        }
        return result;
      };
    }

    const host = process.env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : "127.0.0.1";
    const port = Number(process.env.PORT ?? 4000);
    app.listen({ port, host })
      .then(() => console.log(`api listening on :${port}`))
      .catch((e) => { console.error(e); process.exit(1); });
  })();
}
