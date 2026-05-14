import { describe, it, expect } from "vitest";
import { redactPayload, redactPayloadMiddleware } from "../src/ingestion/pii-middleware.js";

describe("redactPayload", () => {
  it("masks 9-digit SSN values keeping last 4 digits", () => {
    const input = { borrower: { ssn: "605827691", name: "Test User" } };
    const out = redactPayload(input) as typeof input;
    expect(out.borrower.ssn).toBe("xxx-xx-7691");
    expect(out.borrower.name).toBe("Test User");
  });

  it("masks dashed SSN (123-45-6789)", () => {
    const input = { borrower: { ssn: "123-45-6789" } };
    const out = redactPayload(input) as typeof input;
    expect(out.borrower.ssn).toBe("xxx-xx-6789");
  });

  it("recurses into nested arrays", () => {
    const input = {
      analysisOutput: {
        scenario_summary: {
          borrowers: [
            { ssn: "123456789", name: "A" },
            { ssn: "987654321", name: "B" },
          ],
        },
      },
    };
    const out = redactPayload(input) as typeof input;
    expect(out.analysisOutput.scenario_summary.borrowers[0]!.ssn).toBe("xxx-xx-6789");
    expect(out.analysisOutput.scenario_summary.borrowers[1]!.ssn).toBe("xxx-xx-4321");
  });

  it("preserves non-SSN strings unchanged", () => {
    const input = { property: { county: "King County", zip: "98004" } };
    const out = redactPayload(input) as typeof input;
    expect(out.property.county).toBe("King County");
    expect(out.property.zip).toBe("98004");
  });

  it("doesn't mutate the input object", () => {
    const input = { borrower: { ssn: "605827691" } };
    const _out = redactPayload(input);
    expect(input.borrower.ssn).toBe("605827691");
  });

  it("performance: <50ms for a 100KB payload", () => {
    const large = {
      analysisOutput: {
        scenario_summary: {
          borrowers: Array.from({ length: 100 }, (_, i) => ({
            ssn: `${String(i).padStart(9, "0")}`,
            name: `Borrower ${i}`,
            address: `${i} Main St`,
          })),
          extra: "x".repeat(50_000),
        },
      },
    };
    const json = JSON.stringify(large);
    expect(json.length).toBeGreaterThan(50_000);
    const t0 = performance.now();
    redactPayload(large);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });
});

describe("redactPayloadMiddleware", () => {
  it("calls redactPayload on req.body for /api/ingest/* requests", async () => {
    const req = {
      url: "/api/ingest/test-tenant/analysis-output",
      body: { borrower: { ssn: "123456789" } },
    } as never;
    const reply = {} as never;
    await redactPayloadMiddleware(req, reply);
    expect((req as { body: { borrower: { ssn: string } } }).body.borrower.ssn).toBe("xxx-xx-6789");
  });

  it("skips non-/api/ingest paths", async () => {
    const req = {
      url: "/loans/X/predictions/run",
      body: { borrower: { ssn: "123456789" } },
    } as never;
    const reply = {} as never;
    await redactPayloadMiddleware(req, reply);
    expect((req as { body: { borrower: { ssn: string } } }).body.borrower.ssn).toBe("123456789");
  });

  it("no-op when body is absent or non-object", async () => {
    const req1 = { url: "/api/ingest/x/loans", body: undefined } as never;
    await redactPayloadMiddleware(req1, {} as never);
    expect((req1 as { body: unknown }).body).toBeUndefined();

    const req2 = { url: "/api/ingest/x/loans", body: "raw" } as never;
    await redactPayloadMiddleware(req2, {} as never);
    expect((req2 as { body: unknown }).body).toBe("raw");
  });
});
