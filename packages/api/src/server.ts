import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { createStore, type Store, DEFAULT_TENANT_ID } from "@twin/core";
import { scenarios } from "@twin/fixtures";
import { registerErrorHandler } from "./errors.js";
import { registerTenantResolver } from "./middleware/tenant-resolver.js";
import { isDbEnabled, withDb } from "./db/pool.js";
import { runMigrations } from "./db/migrations.js";
import { connectRedis, isRedisEnabled, getRedisPub } from "./redis.js";
import { subscribeToRedisEvents, publishAction } from "./event-bus.js";
import { startSlaMonitor } from "./sla-monitor.js";
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
import { registerTenantRoutes } from "./routes/tenants.js";
import { registerGuidelineRoutes } from "./routes/guidelines.js";
import { registerIngestionRoutes } from "./routes/ingestion.js";
import { registerWsRoutes, getWsClientCount } from "./routes/ws.js";
import { buildOpenApiSpec } from "./openapi.js";
import * as persistence from "./persistence.js";
import { writeDecisionRecord } from "./learning/decision-writer.js";
import { registerLearningMetricsRoutes } from "./routes/learning-metrics.js";
import { registerPatternRoutes } from "./routes/patterns.js";
import { registerApiKeyRoutes } from "./routes/api-keys.js";
import { startLearningWorker } from "./learning-worker.js";

export interface BuildOpts {
  now?: () => string;
  preloadScenarioId?: string;
  enableWebSocket?: boolean;
}

export function buildServer(opts: BuildOpts = {}): { app: FastifyInstance; store: Store } {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });
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
  registerTenantResolver(app);
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
  registerTenantRoutes(app);
  registerGuidelineRoutes(app);
  registerIngestionRoutes(app, store);
  registerLearningMetricsRoutes(app);
  registerPatternRoutes(app);
  registerApiKeyRoutes(app);
  if (opts.enableWebSocket) registerWsRoutes(app);

  app.get("/health", async () => {
    const checks: Record<string, { status: string; latencyMs?: number }> = {};

    if (isDbEnabled()) {
      const start = Date.now();
      try {
        await withDb(async (client) => { await client.query("SELECT 1"); });
        checks.postgres = { status: "ok", latencyMs: Date.now() - start };
      } catch {
        checks.postgres = { status: "error", latencyMs: Date.now() - start };
      }
    }

    if (isRedisEnabled()) {
      const start = Date.now();
      try {
        await getRedisPub().ping();
        checks.redis = { status: "ok", latencyMs: Date.now() - start };
      } catch {
        checks.redis = { status: "error", latencyMs: Date.now() - start };
      }
    }

    const allOk = Object.values(checks).every((c) => c.status === "ok") || Object.keys(checks).length === 0;
    return {
      status: allOk ? "healthy" : "degraded",
      checks,
      wsClients: getWsClientCount(),
      uptime: Math.round(process.uptime()),
    };
  });

  const spec = buildOpenApiSpec();
  app.get("/openapi.json", async () => spec);

  return { app, store };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    if (isDbEnabled()) {
      await runMigrations();
    }
    await persistence.initTables();

    if (isRedisEnabled()) {
      await connectRedis();
      await subscribeToRedisEvents();
    }

    if (isDbEnabled()) startSlaMonitor();
    if (isDbEnabled()) startLearningWorker();

    const { app, store } = buildServer({ preloadScenarioId: "*", enableWebSocket: true });

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
          publishAction(DEFAULT_TENANT_ID, action).catch(() => {});

          if (action.type === "AcceptRecommendation" || action.type === "OverrideDecision" || action.type === "SetDecision") {
            const loan = result.loans[(action as { loanId: string }).loanId];
            if (loan) {
              const recordTenantId = loan.tenantId ?? DEFAULT_TENANT_ID;
              writeDecisionRecord({
                tenantId: recordTenantId,
                loanId: (action as { loanId: string }).loanId,
                loan,
                action,
              }).catch((e) => console.error("[decision-writer] Error:", e));
            }
          }
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
