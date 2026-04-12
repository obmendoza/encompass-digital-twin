import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const fixed = () => "2026-04-11T12:00:00.000Z";

describe("world routes", () => {
  it("GET /scenarios lists all 20 scenarios", async () => {
    const { app } = buildServer({ now: fixed });
    const res = await app.inject({ method: "GET", url: "/scenarios" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(20);
  });

  it("POST /world/load-scenario hydrates the store", async () => {
    const { app } = buildServer({ now: fixed });
    const res = await app.inject({
      method: "POST", url: "/world/load-scenario",
      payload: { scenarioId: "nqm-bankstmt-12mo-clean" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().scenarioId).toBe("nqm-bankstmt-12mo-clean");
  });

  it("POST /world/load-scenario with unknown id returns 400", async () => {
    const { app } = buildServer({ now: fixed });
    const res = await app.inject({
      method: "POST", url: "/world/load-scenario", payload: { scenarioId: "nope" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("SCENARIO_NOT_FOUND");
  });

  it("POST /world/reset clears the loaded scenario", async () => {
    const { app } = buildServer({ now: fixed });
    await app.inject({ method: "POST", url: "/world/load-scenario",
      payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
    const res = await app.inject({ method: "POST", url: "/world/reset" });
    expect(res.statusCode).toBe(200);
    expect(res.json().scenarioId).toBeNull();
  });

  it("GET /openapi.json returns a valid spec", async () => {
    const { app } = buildServer({ now: fixed });
    const res = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toBe("3.1.0");
    expect(Object.keys(spec.paths).length).toBeGreaterThan(15);
  });
});
