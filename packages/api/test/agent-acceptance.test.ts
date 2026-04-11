import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const fixed = () => "2026-04-11T12:00:00.000Z";
const actor = { kind: "agent" as const, id: "acceptance-bot" };

describe("agent acceptance — nqm-bankstmt-12mo-clean", () => {
  it("agent drives the loan end-to-end via HTTP", async () => {
    const { app } = buildServer({ now: fixed });

    let res = await app.inject({ method: "POST", url: "/world/load-scenario",
      payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
    expect(res.statusCode).toBe(200);

    res = await app.inject({ method: "GET", url: "/loans/2501000101" });
    const loan = res.json();
    expect(loan.qualifyingMethod).toBe("BankStatementDeposits");
    expect(loan.decision).toBe("pending");

    res = await app.inject({
      method: "POST", url: "/loans/2501000101/qualifying-income",
      payload: {
        worksheet: { method: "BankStatementDeposits", monthsCovered: 12,
          avgDeposits: 18000, expenseFactor: 0.5, nsfCount: 0, derivedMonthlyIncome: 9000 },
        actor,
      },
    });
    expect(res.statusCode).toBe(200);

    const conditionsRes = await app.inject({ method: "GET", url: "/loans/2501000101/conditions" });
    const conditions = conditionsRes.json();
    for (const c of conditions) {
      await app.inject({
        method: "POST", url: `/loans/2501000101/conditions/${c.id}/clear`,
        payload: { notes: "verified", actor },
      });
    }

    res = await app.inject({
      method: "POST", url: "/loans/2501000101/decision",
      payload: { decision: "approved", rationale: "All PTDs cleared, DTI in range", actor },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("approved");

    res = await app.inject({ method: "GET", url: "/loans/2501000101/audit" });
    const log = res.json();
    const types = log.map((e: { action: { type: string } }) => e.action.type);
    expect(types).toContain("LoadScenario");
    expect(types).toContain("RecalculateQualifyingIncome");
    expect(types.filter((t: string) => t === "ClearCondition").length).toBe(conditions.length);
    expect(types).toContain("SetDecision");
  });
});
