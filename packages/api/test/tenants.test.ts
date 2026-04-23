import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

let app: FastifyInstance;

beforeAll(async () => {
  const server = buildServer({ preloadScenarioId: "*" });
  app = server.app;
  await app.ready();
});

afterAll(async () => { await app.close(); });

describe("POST /tenants", () => {
  it("rejects reserved slugs", async () => {
    const res = await app.inject({
      method: "POST", url: "/tenants",
      headers: { "x-super-admin": "true", "x-user-id": "admin-1", "content-type": "application/json" },
      payload: { name: "Admin Tenant", slug: "admin" },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    // Zod validation catches reserved slugs via refine — error is in fieldErrors.slug
    expect(JSON.stringify(body.error)).toContain("reserved");
  });

  it("rejects non-super_admin", async () => {
    const res = await app.inject({
      method: "POST", url: "/tenants",
      headers: { "x-user-id": "user-1", "content-type": "application/json" },
      payload: { name: "Blocked", slug: "blocked" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects invalid slug format", async () => {
    const res = await app.inject({
      method: "POST", url: "/tenants",
      headers: { "x-super-admin": "true", "x-user-id": "admin-1", "content-type": "application/json" },
      payload: { name: "Bad", slug: "-bad-slug" },
    });
    expect(res.statusCode).toBe(400);
  });
});
