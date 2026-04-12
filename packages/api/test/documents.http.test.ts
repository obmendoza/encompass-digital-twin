import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const fixed = () => "2026-04-11T12:00:00.000Z";
const actor = { kind: "human" as const, id: "uw1" };

async function loaded() {
  const { app } = buildServer({ now: fixed });
  await app.inject({ method: "POST", url: "/world/load-scenario",
    payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
  return app;
}

describe("document routes", () => {
  it("GET /loans/:id/documents returns document list", async () => {
    const app = await loaded();
    const res = await app.inject({ method: "GET", url: "/loans/2501000101/documents" });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThanOrEqual(0);
  });

  it("POST /loans/:id/documents adds a document", async () => {
    const app = await loaded();
    const res = await app.inject({
      method: "POST", url: "/loans/2501000101/documents",
      payload: { doc: { name: "W2.pdf", docType: "PayStub" }, actor },
    });
    expect(res.statusCode).toBe(200);
    const docs = res.json().documents;
    expect(docs.at(-1).name).toBe("W2.pdf");
    expect(docs.at(-1).status).toBe("Pending");
  });

  it("PATCH updates document status", async () => {
    const app = await loaded();
    await app.inject({ method: "POST", url: "/loans/2501000101/documents",
      payload: { doc: { name: "Test.pdf", docType: "Other" }, actor } });
    const loan = (await app.inject({ method: "GET", url: "/loans/2501000101" })).json();
    const docId = loan.documents.at(-1).id;
    const res = await app.inject({
      method: "PATCH", url: `/loans/2501000101/documents/${docId}`,
      payload: { status: "Received", actor },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().documents.find((d: { id: string }) => d.id === docId).status).toBe("Received");
  });

  it("POST .../link links document to condition", async () => {
    const app = await loaded();
    await app.inject({ method: "POST", url: "/loans/2501000101/documents",
      payload: { doc: { name: "Link.pdf", docType: "Other" }, actor } });
    const loan = (await app.inject({ method: "GET", url: "/loans/2501000101" })).json();
    const docId = loan.documents.at(-1).id;
    const condId = loan.conditions[0].id;
    const res = await app.inject({
      method: "POST", url: `/loans/2501000101/documents/${docId}/link`,
      payload: { conditionId: condId, actor },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().documents.find((d: { id: string }) => d.id === docId).linkedConditionId).toBe(condId);
  });
});
