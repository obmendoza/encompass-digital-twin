import Fastify, { type FastifyInstance } from "fastify";
import { createStore, type Store } from "@twin/core";
import { scenarios } from "@twin/fixtures";
import { registerErrorHandler } from "./errors.js";
import { registerWorldRoutes } from "./routes/world.js";
import { registerLoanRoutes } from "./routes/loans.js";
import { registerConditionRoutes } from "./routes/conditions.js";

export interface BuildOpts {
  now?: () => string;
}

export function buildServer(opts: BuildOpts = {}): { app: FastifyInstance; store: Store } {
  const app = Fastify({ logger: false });
  const store = createStore({ scenarios, now: opts.now });

  registerErrorHandler(app);
  registerWorldRoutes(app, store);
  registerLoanRoutes(app, store);
  registerConditionRoutes(app, store);

  app.get("/health", async () => ({ ok: true }));
  return { app, store };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app } = buildServer();
  const port = Number(process.env.PORT ?? 4000);
  app.listen({ port, host: "127.0.0.1" })
    .then(() => console.log(`api listening on :${port}`))
    .catch((e) => { console.error(e); process.exit(1); });
}
