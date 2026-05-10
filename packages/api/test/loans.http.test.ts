import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const fixed = () => "2026-04-11T12:00:00.000Z";

async function loaded() {
  const { app, store } = buildServer({ now: fixed });
  await app.inject({ method: "POST", url: "/world/load-scenario",
    payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
  return { app, store };
}

describe("loan routes", () => {
  it("GET /loans returns pipeline summary rows", async () => {
    const { app } = await loaded();
    const res = await app.inject({ method: "GET", url: "/loans" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe("2501000101");
  });

  it("GET /loans/:id returns full loan", async () => {
    const { app } = await loaded();
    const res = await app.inject({ method: "GET", url: "/loans/2501000101" });
    expect(res.statusCode).toBe(200);
    expect(res.json().nqmProgram).toBe("Flex Select");
  });

  it("GET /loans/:id returns 400 for unknown id", async () => {
    const { app } = await loaded();
    const res = await app.inject({ method: "GET", url: "/loans/999" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("LOAN_NOT_FOUND");
  });

  it("POST /loans/:id/decision sets the decision", async () => {
    const { app } = await loaded();
    const res = await app.inject({
      method: "POST", url: "/loans/2501000101/decision",
      payload: { decision: "approved", rationale: "clean", actor: { kind: "agent", id: "t" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("approved");
  });

  it("POST /loans/:id/milestone advances milestone", async () => {
    const { app } = await loaded();
    const res = await app.inject({
      method: "POST", url: "/loans/2501000101/milestone",
      payload: { milestone: "UW Review", actor: { kind: "human", id: "uw1" } },
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /loans/:id/qualifying-income recalculates", async () => {
    const { app } = await loaded();
    const res = await app.inject({
      method: "POST", url: "/loans/2501000101/qualifying-income",
      payload: {
        worksheet: { method: "BankStatementDeposits", derivedMonthlyIncome: 10000 },
        actor: { kind: "agent", id: "income-bot" },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().income.totalMonthlyIncome).toBe(10000);
  });

  it("GET /loans/:id/audit returns the action log", async () => {
    const { app } = await loaded();
    const res = await app.inject({ method: "GET", url: "/loans/2501000101/audit" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(res.json().length).toBeGreaterThan(0);
  });
});
