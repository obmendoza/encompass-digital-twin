import { describe, expect, it, beforeAll } from "vitest";
import { buildServer } from "../src/server.js";
import type { FastifyInstance } from "fastify";

const fixed = () => "2026-04-23T12:00:00.000Z";
const actor = { kind: "human" as const, id: "behavioral-test" };
const agentActor = { kind: "agent" as const, id: "test-agent" };

describe("Behavioral Flow Tests", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const server = buildServer({ now: fixed });
    app = server.app;
    await app.inject({ method: "POST", url: "/world/load-scenario",
      payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
  });

  describe("Assignment Lifecycle", () => {
    it("assigns a loan to VA", async () => {
      const res = await app.inject({ method: "POST", url: "/loans/2501000101/assign",
        payload: { assignedTo: "va@test.com", priority: "high", actor } });
      expect(res.statusCode).toBe(200);
      expect(res.json().assignment.status).toBe("queued");
      expect(res.json().assignment.assignedTo).toBe("va@test.com");
    });

    it("updates assignment status", async () => {
      const res = await app.inject({ method: "POST", url: "/loans/2501000101/assignment-status",
        payload: { status: "in_progress", actor } });
      expect(res.statusCode).toBe(200);
      expect(res.json().assignment.status).toBe("in_progress");
    });

    it("unassigns the loan", async () => {
      const res = await app.inject({ method: "DELETE", url: "/loans/2501000101/assign",
        payload: { actor } });
      expect(res.statusCode).toBe(200);
      expect(res.json().assignment).toBeUndefined();
    });
  });

  describe("Condition Lifecycle", () => {
    it("adds a condition", async () => {
      const res = await app.inject({ method: "POST", url: "/loans/2501000101/conditions",
        payload: { condition: { category: "PTD", source: "UW", description: "Test cond" }, actor } });
      expect(res.statusCode).toBe(200);
      expect(res.json().conditions.length).toBeGreaterThan(4);
    });

    it("deduplicates conditions", async () => {
      const before = (await app.inject({ method: "GET", url: "/loans/2501000101" })).json().conditions.length;
      await app.inject({ method: "POST", url: "/loans/2501000101/conditions",
        payload: { condition: { category: "PTD", source: "UW", description: "Test cond" }, actor } });
      const after = (await app.inject({ method: "GET", url: "/loans/2501000101" })).json().conditions.length;
      expect(after).toBe(before); // silently skipped
    });

    it("clears a condition", async () => {
      const res = await app.inject({ method: "POST", url: "/loans/2501000101/conditions/c1/clear",
        payload: { notes: "verified", actor } });
      expect(res.statusCode).toBe(200);
      expect(res.json().conditions.find((c: any) => c.id === "c1").status).toBe("Cleared");
    });

    it("waives a condition with rationale", async () => {
      const res = await app.inject({ method: "POST", url: "/loans/2501000101/conditions/c2/waive",
        payload: { rationale: "compensating factors", actor } });
      expect(res.statusCode).toBe(200);
      expect(res.json().conditions.find((c: any) => c.id === "c2").status).toBe("Waived");
    });

    it("blocks conditions after denial", async () => {
      await app.inject({ method: "POST", url: "/loans/2501000101/decision",
        payload: { decision: "denied", rationale: "test", actor } });
      const res = await app.inject({ method: "POST", url: "/loans/2501000101/conditions",
        payload: { condition: { category: "PTD", source: "UW", description: "should fail" }, actor } });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("Recommendation Lifecycle", () => {
    beforeAll(async () => {
      // Reset and reload for clean state
      await app.inject({ method: "POST", url: "/world/reset", payload: {} });
      await app.inject({ method: "POST", url: "/world/load-scenario",
        payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
    });

    it("stages a recommendation", async () => {
      const res = await app.inject({ method: "POST", url: "/loans/2501000101/recommendation",
        payload: { recommendation: { recommendation: "approved", rationale: "clean file",
          confidence: 0.9, conditions: ["verify docs"], trace: [] }, actor: agentActor } });
      expect(res.statusCode).toBe(200);
      expect(res.json().pendingRecommendation.recommendation).toBe("approved");
    });

    it("accepts recommendation → sets decision", async () => {
      const res = await app.inject({ method: "POST", url: "/loans/2501000101/recommendation/accept",
        payload: { actor } });
      expect(res.statusCode).toBe(200);
      expect(res.json().decision).toBe("approved");
      expect(res.json().pendingRecommendation).toBeUndefined();
    });
  });

  describe("Override + Send-back", () => {
    beforeAll(async () => {
      await app.inject({ method: "POST", url: "/world/reset", payload: {} });
      await app.inject({ method: "POST", url: "/world/load-scenario",
        payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
      await app.inject({ method: "POST", url: "/loans/2501000101/recommendation",
        payload: { recommendation: { recommendation: "approved", rationale: "test",
          confidence: 0.9, conditions: [], trace: [] }, actor: agentActor } });
    });

    it("overrides a recommendation", async () => {
      const res = await app.inject({ method: "POST", url: "/loans/2501000101/override",
        payload: { originalRecommendation: "approved", overrideDecision: "suspended",
          overrideReason: "doc_sufficiency", rationale: "need more docs", actor } });
      expect(res.statusCode).toBe(200);
      expect(res.json().decision).toBe("suspended");
      expect(res.json().pendingRecommendation).toBeUndefined();
      const milestone = res.json().milestones.at(-1);
      expect(milestone.name).toContain("override");
    });

    it("sends back to VA", async () => {
      // Re-setup: reset, load, assign, stage rec
      await app.inject({ method: "POST", url: "/world/reset", payload: {} });
      await app.inject({ method: "POST", url: "/world/load-scenario",
        payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
      await app.inject({ method: "POST", url: "/loans/2501000101/assign",
        payload: { assignedTo: "va@test.com", priority: "normal", actor } });
      await app.inject({ method: "POST", url: "/loans/2501000101/assignment-status",
        payload: { status: "report_ready", actor } });
      await app.inject({ method: "POST", url: "/loans/2501000101/recommendation",
        payload: { recommendation: { recommendation: "approved", rationale: "test",
          confidence: 0.8, conditions: [], trace: [] }, actor: agentActor } });

      const res = await app.inject({ method: "POST", url: "/loans/2501000101/send-back",
        payload: { notes: "re-check income", actor } });
      expect(res.statusCode).toBe(200);
      expect(res.json().pendingRecommendation).toBeUndefined();
      expect(res.json().assignment.status).toBe("in_progress");
    });
  });

  describe("Income Recalculation", () => {
    beforeAll(async () => {
      await app.inject({ method: "POST", url: "/world/reset", payload: {} });
      await app.inject({ method: "POST", url: "/world/load-scenario",
        payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
    });

    it("recalculates qualifying income + DTI", async () => {
      const res = await app.inject({ method: "POST", url: "/loans/2501000101/qualifying-income",
        payload: { worksheet: { method: "BankStatementDeposits", monthsCovered: 12,
          avgDeposits: 20000, expenseFactor: 0.5, derivedMonthlyIncome: 10000 }, actor } });
      expect(res.statusCode).toBe(200);
      expect(res.json().income.totalMonthlyIncome).toBe(10000);
      expect(res.json().qualifying.totalDti).toBeCloseTo(33.2, 0);
    });
  });

  describe("Documents", () => {
    beforeAll(async () => {
      await app.inject({ method: "POST", url: "/world/reset", payload: {} });
      await app.inject({ method: "POST", url: "/world/load-scenario",
        payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
    });

    it("adds a document", async () => {
      const res = await app.inject({ method: "POST", url: "/loans/2501000101/documents",
        payload: { doc: { name: "Test.pdf", docType: "Other" }, actor } });
      expect(res.statusCode).toBe(200);
      expect(res.json().documents.length).toBeGreaterThan(3);
    });

    it("uploads a file to a document", async () => {
      const loan = (await app.inject({ method: "GET", url: "/loans/2501000101" })).json();
      const docId = loan.documents.at(-1).id;
      const boundary = "----TestBoundary";
      const body = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4 test\r\n--${boundary}--\r\n`
      );
      const res = await app.inject({
        method: "POST", url: `/loans/2501000101/documents/${docId}/upload`,
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload: body,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().fileKey).toBeDefined();
      expect(res.json().document.status).toBe("Received");
    });
  });

  describe("Metrics Endpoint", () => {
    it("returns platform metrics", async () => {
      const res = await app.inject({ method: "GET", url: "/metrics" });
      expect(res.statusCode).toBe(200);
      const m = res.json();
      expect(m.totalLoans).toBeGreaterThan(0);
      expect(m.decisions).toBeDefined();
      expect(m.programs).toBeDefined();
    });
  });
});
