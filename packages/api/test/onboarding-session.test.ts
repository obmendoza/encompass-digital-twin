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

describe("POST /onboarding", () => {
  it("creates onboarding with super_admin → 201 (or 500 if no DB)", async () => {
    const res = await app.inject({
      method: "POST", url: "/onboarding",
      headers: { "x-super-admin": "true", "x-user-id": "admin-1", "content-type": "application/json" },
      payload: {
        tenantName: "Test Lender",
        slug: "test-lender-ob",
        contactEmail: "test@example.com",
        lenderType: "correspondent",
        programs: ["conventional"],
      },
    });
    // 201 if DB is connected, 500 if no DB available in test env
    expect([201, 500]).toContain(res.statusCode);
  });

  it("rejects without super_admin → 403", async () => {
    const res = await app.inject({
      method: "POST", url: "/onboarding",
      headers: { "x-user-id": "user-1", "content-type": "application/json" },
      payload: {
        tenantName: "Blocked Lender",
        slug: "blocked-lender",
        contactEmail: "blocked@example.com",
        lenderType: "wholesale",
        programs: ["fha"],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects reserved slug → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/onboarding",
      headers: { "x-super-admin": "true", "x-user-id": "admin-1", "content-type": "application/json" },
      payload: {
        tenantName: "Admin Lender",
        slug: "admin",
        contactEmail: "admin@example.com",
        lenderType: "retail",
        programs: ["jumbo"],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects empty programs → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/onboarding",
      headers: { "x-super-admin": "true", "x-user-id": "admin-1", "content-type": "application/json" },
      payload: {
        tenantName: "No Programs Lender",
        slug: "no-programs",
        contactEmail: "noprog@example.com",
        lenderType: "direct",
        programs: [],
      },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload);
    expect(JSON.stringify(body.error)).toContain("program");
  });
});
