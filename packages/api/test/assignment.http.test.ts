import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const fixed = () => "2026-04-22T12:00:00.000Z";
const actor = { kind: "human" as const, id: "admin" };

async function loaded() {
  const { app } = buildServer({ now: fixed });
  await app.inject({ method: "POST", url: "/world/load-scenario", payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
  return app;
}

describe("assignment routes", () => {
  it("POST /loans/:id/assign assigns the loan", async () => {
    const app = await loaded();
    const res = await app.inject({ method: "POST", url: "/loans/2501000101/assign",
      payload: { assignedTo: "va@test.com", priority: "high", actor } });
    expect(res.statusCode).toBe(200);
    expect(res.json().assignment.assignedTo).toBe("va@test.com");
    expect(res.json().assignment.status).toBe("queued");
  });

  it("POST /loans/:id/assignment-status updates status", async () => {
    const app = await loaded();
    await app.inject({ method: "POST", url: "/loans/2501000101/assign",
      payload: { assignedTo: "va@test.com", actor } });
    const res = await app.inject({ method: "POST", url: "/loans/2501000101/assignment-status",
      payload: { status: "in_progress", actor } });
    expect(res.statusCode).toBe(200);
    expect(res.json().assignment.status).toBe("in_progress");
  });

  it("GET /assignments/:userId returns assigned loans", async () => {
    const app = await loaded();
    await app.inject({ method: "POST", url: "/loans/2501000101/assign",
      payload: { assignedTo: "va@test.com", actor } });
    const res = await app.inject({ method: "GET", url: "/assignments/va@test.com" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe("2501000101");
  });

  it("DELETE /loans/:id/assign unassigns", async () => {
    const app = await loaded();
    await app.inject({ method: "POST", url: "/loans/2501000101/assign",
      payload: { assignedTo: "va@test.com", actor } });
    const res = await app.inject({ method: "DELETE", url: "/loans/2501000101/assign",
      payload: { actor } });
    expect(res.statusCode).toBe(200);
    expect(res.json().assignment).toBeUndefined();
  });
});
