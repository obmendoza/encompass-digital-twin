import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { createStore, DEFAULT_TENANT_ID, type Store } from "@twin/core";
import { scenarios } from "@twin/fixtures";
import { registerErrorHandler } from "./errors.js";
import { registerJwtTenantResolver } from "./middleware/jwt-tenant-resolver.js";
import cookie from "@fastify/cookie";
import { isDbEnabled, withDb, withTenantTx } from "./db/pool.js";
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
import { registerOnboardingRoutes } from "./routes/onboarding.js";
import { registerVARoutes } from "./routes/va.js";
import { registerVAAdminRoutes } from "./routes/va-admin.js";
import { registerBpoRoutes } from "./routes/bpo.js";
import { startLearningWorker } from "./learning-worker.js";
import { getDemoTenantId, getTenantType } from "./tenant-cache.js";

export interface BuildOpts {
  now?: () => string;
  preloadScenarioId?: string;
  /** Tenant id to stamp on preloaded scenario loans. Defaults to DEFAULT_TENANT_ID
   *  (the all-zeros UUID), which matches the middleware's default-tenant path. */
  preloadTenantId?: string;
  enableWebSocket?: boolean;
}

export function buildServer(opts: BuildOpts = {}): { app: FastifyInstance; store: Store } {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    bodyLimit: 50 * 1024 * 1024, // 50MB — needed for base64 document extraction
  });
  app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB max
  const store = createStore({ scenarios, now: opts.now });

  // Preload tenantId: production callers pass through; tests default to
  // DEFAULT_TENANT_ID so the middleware's default-tenant path matches what's stamped.
  const preloadTenantId = opts.preloadTenantId ?? DEFAULT_TENANT_ID;
  if (opts.preloadScenarioId === "*") {
    for (const id of Object.keys(scenarios)) {
      store.dispatch({ type: "LoadScenario", scenarioId: id, tenantId: preloadTenantId });
    }
  } else if (opts.preloadScenarioId) {
    store.dispatch({ type: "LoadScenario", scenarioId: opts.preloadScenarioId, tenantId: preloadTenantId });
  }

  registerErrorHandler(app);
  app.register(cookie);
  registerJwtTenantResolver(app);
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
  registerOnboardingRoutes(app);
  registerVARoutes(app);
  registerVAAdminRoutes(app);
  registerBpoRoutes(app, store);
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

    // Resolve demo tenant ID (for fixture loading + dispatch routing)
    let DEMO_TENANT_ID: string | undefined;
    if (isDbEnabled()) {
      try { DEMO_TENANT_ID = await getDemoTenantId(); } catch { /* fresh install */ }
    }

    const { app, store } = buildServer({ enableWebSocket: true });

    // Load demo fixture loans with real demo tenant UUID
    if (DEMO_TENANT_ID) {
      for (const id of Object.keys(scenarios)) {
        store.dispatch({
          type: "InjectLoan",
          loan: { ...scenarios[id].loan, tenantId: DEMO_TENANT_ID },
        });
      }
      console.log(`[boot] Loaded ${Object.keys(scenarios).length} fixture loans into demo tenant`);
    }

    // Load persisted production loans from Supabase
    if (persistence.isEnabled()) {
      const saved = await persistence.loadState();
      if (saved && Object.keys(saved.loans).length > 0) {
        console.log(`[persistence] Restoring ${Object.keys(saved.loans).length} loans from Supabase`);
        for (const loan of Object.values(saved.loans)) {
          if (loan.tenantId && loan.tenantId !== DEMO_TENANT_ID) {
            store.dispatch({ type: "InjectLoan", loan });
          }
        }
      }
    }

    // Tenant-aware dispatch wrapper
    const _dispatch = store.dispatch.bind(store);
    const tenantTypeCache = new Map<string, string>();
    if (DEMO_TENANT_ID) tenantTypeCache.set(DEMO_TENANT_ID, "demo");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (store as any).dispatch = (action: Parameters<typeof _dispatch>[0]) => {
      const result = _dispatch(action);

      let tenantId: string | undefined;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let loan: any;

      if ("loanId" in action && (action as { loanId: string }).loanId) {
        loan = result.loans[(action as { loanId: string }).loanId];
        tenantId = loan?.tenantId;
      } else if (action.type === "InjectLoan") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tenantId = (action as any).loan?.tenantId;
      } else if (action.type === "LoadScenario") {
        tenantId = DEMO_TENANT_ID;
      } else if (action.type === "ResetWorld") {
        return result;
      }

      if (!tenantId) return result;

      const tenantType = tenantTypeCache.get(tenantId) ?? "production";

      // Persist production tenants only
      if (tenantType === "production" && persistence.isEnabled()) {
        persistence.saveState(result, tenantId).catch((e) => {
          console.error(`[persistence] FAILED tenant=${tenantId}:`, e);
        });
      }

      // Publish event
      publishAction(tenantId, action).catch((e) => {
        console.error(`[event-bus] FAILED tenant=${tenantId}:`, e);
      });

      // Decision records (both demo and production)
      if (action.type === "AcceptRecommendation" || action.type === "OverrideDecision" || action.type === "SetDecision") {
        if (loan) {
          // Fetch active KB version at decision time (non-blocking)
          const kbVersionPromise = withTenantTx(tenantId, async (client: import("pg").PoolClient) => {
            const { rows } = await client.query(
              "SELECT version FROM kb_versions WHERE tenant_id = $1 AND status = 'active' LIMIT 1",
              [tenantId]
            );
            return rows[0]?.version ?? null;
          }).catch(() => null);

          kbVersionPromise.then((kbVersion: number | null) => {
            writeDecisionRecord({
              tenantId,
              loanId: (action as { loanId: string }).loanId,
              loan,
              action,
              kbVersion,
            }).catch((e) => console.error("[decision-writer] FAILED:", e));
          });
        }
      }

      return result;
    };

    const host = process.env.RAILWAY_ENVIRONMENT ? "0.0.0.0" : "127.0.0.1";
    const port = Number(process.env.PORT ?? 4000);
    app.listen({ port, host })
      .then(() => console.log(`api listening on :${port}`))
      .catch((e) => { console.error(e); process.exit(1); });
  })();
}
