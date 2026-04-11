import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const fixed = () => "2026-04-11T12:00:00.000Z";
const actor = { kind: "human" as const, id: "uw1" };

async function loaded() {
  const { app, store } = buildServer({ now: fixed });
  await app.inject({ method: "POST", url: "/world/load-scenario",
    payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
  return { app, store };
}

describe("condition routes", () => {
  it("GET /loans/:id/conditions returns the condition list", async () => {
    const { app } = await loaded();
    const res = await app.inject({ method: "GET", url: "/loans/2501000101/conditions" });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThan(0);
  });

  it("POST /loans/:id/conditions adds a condition", async () => {
    const { app } = await loaded();
    const res = await app.inject({
      method: "POST", url: "/loans/2501000101/conditions",
      payload: { condition: { category: "PTD", source: "UW", description: "New test" }, actor },
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /loans/:id/conditions/:cid/clear transitions to Cleared", async () => {
    const { app } = await loaded();
    const added = await app.inject({
      method: "POST", url: "/loans/2501000101/conditions",
      payload: { condition: { category: "PTD", source: "UW", description: "Doc", status: "Received" }, actor },
    });
    const cid = added.json().conditions.at(-1).id;
    const res = await app.inject({
      method: "POST", url: `/loans/2501000101/conditions/${cid}/clear`,
      payload: { notes: "ok", actor },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().conditions.find((c: { id: string }) => c.id === cid).status).toBe("Cleared");
  });

  it("POST .../waive transitions to Waived", async () => {
    const { app } = await loaded();
    const added = await app.inject({
      method: "POST", url: "/loans/2501000101/conditions",
      payload: { condition: { category: "PTD", source: "UW", description: "W" }, actor },
    });
    const cid = added.json().conditions.at(-1).id;
    const res = await app.inject({
      method: "POST", url: `/loans/2501000101/conditions/${cid}/waive`,
      payload: { rationale: "exec override", actor },
    });
    expect(res.statusCode).toBe(200);
  });

  it("DELETE removes a condition", async () => {
    const { app } = await loaded();
    const added = await app.inject({
      method: "POST", url: "/loans/2501000101/conditions",
      payload: { condition: { category: "PTD", source: "UW", description: "D" }, actor },
    });
    const cid = added.json().conditions.at(-1).id;
    const res = await app.inject({
      method: "DELETE", url: `/loans/2501000101/conditions/${cid}`, payload: { actor },
    });
    expect(res.statusCode).toBe(200);
  });

  it("PATCH updates a condition", async () => {
    const { app } = await loaded();
    const added = await app.inject({
      method: "POST", url: "/loans/2501000101/conditions",
      payload: { condition: { category: "PTD", source: "UW", description: "P1" }, actor },
    });
    const cid = added.json().conditions.at(-1).id;
    const res = await app.inject({
      method: "PATCH", url: `/loans/2501000101/conditions/${cid}`,
      payload: { patch: { description: "P2" }, actor },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().conditions.find((c: { id: string }) => c.id === cid).description).toBe("P2");
  });
});
