import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const fixed = () => "2026-04-14T12:00:00.000Z";
const agent = { kind: "agent" as const, id: "bot" };
const human = { kind: "human" as const, id: "uw1" };

async function loaded() {
  const { app } = buildServer({ now: fixed });
  await app.inject({ method: "POST", url: "/world/load-scenario",
    payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
  return app;
}

describe("recommendation routes", () => {
  it("POST /loans/:id/agent-step records a step", async () => {
    const app = await loaded();
    const res = await app.inject({
      method: "POST", url: "/loans/2501000101/agent-step",
      payload: { step: { phase: "thinking", content: "reasoning...", at: fixed() }, actor: agent },
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /loans/:id/recommendation stages a pending rec", async () => {
    const app = await loaded();
    const res = await app.inject({
      method: "POST", url: "/loans/2501000101/recommendation",
      payload: { recommendation: { recommendation: "approved", rationale: "clean",
        confidence: 0.92, conditions: [], trace: [] }, actor: agent },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pendingRecommendation.recommendation).toBe("approved");
  });

  it("POST .../accept converts rec to decision", async () => {
    const app = await loaded();
    await app.inject({ method: "POST", url: "/loans/2501000101/recommendation",
      payload: { recommendation: { recommendation: "approved", rationale: "clean",
        confidence: 0.92, conditions: [], trace: [] }, actor: agent } });
    const res = await app.inject({
      method: "POST", url: "/loans/2501000101/recommendation/accept",
      payload: { actor: human },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("approved");
    expect(res.json().pendingRecommendation).toBeUndefined();
  });

  it("DELETE /recommendation clears pending rec", async () => {
    const app = await loaded();
    await app.inject({ method: "POST", url: "/loans/2501000101/recommendation",
      payload: { recommendation: { recommendation: "denied", rationale: "x",
        confidence: 0.8, conditions: [], trace: [] }, actor: agent } });
    const res = await app.inject({
      method: "DELETE", url: "/loans/2501000101/recommendation",
      payload: { actor: human },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().pendingRecommendation).toBeUndefined();
    expect(res.json().decision).toBe("pending");
  });
});
