import { describe, it, expect, describe as describe2, it as it2, expect as expect2, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { readFileSync as readFile2 } from "node:fs";
import { dirname as dn2, resolve as rp2 } from "node:path";
import { fileURLToPath as ftu2 } from "node:url";
import { redactPayload, redactPayloadMiddleware } from "../src/ingestion/pii-middleware.js";

describe("redactPayload (path-restricted)", () => {
  it("masks SSN at known PII paths", () => {
    const input = { loanData: { borrower: { ssn: "123456789", fullName: "Test" } } };
    const out = redactPayload(input) as typeof input;
    expect(out.loanData.borrower.ssn).toBe("[REDACTED_SSN]");
    expect(out.loanData.borrower.fullName).toBe("Test");
  });

  it("masks dashed SSN (123-45-6789) as [REDACTED_SSN]", () => {
    const input = { loanData: { borrower: { ssn: "123-45-6789" } } };
    const out = redactPayload(input) as typeof input;
    expect(out.loanData.borrower.ssn).toBe("[REDACTED_SSN]");
  });

  it("masks SSN at nested-array PII path", () => {
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
    expect(out.analysisOutput.scenario_summary.borrowers[0]!.ssn).toBe("[REDACTED_SSN]");
    expect(out.analysisOutput.scenario_summary.borrowers[1]!.ssn).toBe("[REDACTED_SSN]");
    expect(out.analysisOutput.scenario_summary.borrowers[0]!.name).toBe("A");
  });

  it("preserves 9-digit values at NON-PII paths (the Codex P1 case)", () => {
    const input = {
      source: "npnqm-portal",
      externalId: "123456789",
      analysisOutput: {
        scenario_summary: {
          loan_number: "987654321",
          property: { address: "123 Main St" },
        },
      },
    };
    const out = redactPayload(input) as typeof input;
    expect(out.externalId).toBe("123456789");
    expect(out.analysisOutput.scenario_summary.loan_number).toBe("987654321");
    expect(out.analysisOutput.scenario_summary.property.address).toBe("123 Main St");
  });

  it("masks bare top-level ssn key", () => {
    const input = { ssn: "123456789" };
    const out = redactPayload(input) as typeof input;
    expect(out.ssn).toBe("[REDACTED_SSN]");
  });

  it("masks DOB at known PII paths", () => {
    const input = { loanData: { borrower: { dob: "1985-03-12" } } };
    const out = redactPayload(input) as typeof input;
    expect(out.loanData.borrower.dob).toBe("[REDACTED_DOB]");
  });

  it("preserves DOB-shaped values at non-PII paths", () => {
    const input = { metadata: { created_at: "1985-03-12" } };
    const out = redactPayload(input) as typeof input;
    expect(out.metadata.created_at).toBe("1985-03-12");
  });

  it("does not mutate the input object", () => {
    const input = { loanData: { borrower: { ssn: "123456789" } } };
    const _out = redactPayload(input);
    expect(input.loanData.borrower.ssn).toBe("123456789");
  });

  it("performance: <50ms for a 100KB payload with no PII paths", () => {
    const large = {
      analysisOutput: {
        scenario_summary: {
          borrowers: Array.from({ length: 100 }, (_, i) => ({
            ssn: `${String(i).padStart(9, "0")}`,
            name: `Borrower ${i}`,
            dob: "1985-01-01",
          })),
          notes: "x".repeat(50_000),
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
      body: { loanData: { borrower: { ssn: "123456789" } } },
    } as never;
    const reply = {} as never;
    await redactPayloadMiddleware(req, reply);
    expect((req as { body: { loanData: { borrower: { ssn: string } } } }).body.loanData.borrower.ssn).toBe("[REDACTED_SSN]");
  });

  it("skips non-/api/ingest paths", async () => {
    const req = {
      url: "/loans/X/predictions/run",
      body: { loanData: { borrower: { ssn: "123456789" } } },
    } as never;
    const reply = {} as never;
    await redactPayloadMiddleware(req, reply);
    expect((req as { body: { loanData: { borrower: { ssn: string } } } }).body.loanData.borrower.ssn).toBe("123456789");
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

if (!process.env.DATABASE_URL) {
  const here = dn2(ftu2(import.meta.url));
  try {
    for (const line of readFile2(rp2(here, "../.env"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* */ }
}

import { withDb, closePool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";
import { createHash } from "node:crypto";

const T_MID = "5d175193-6ee2-4d6a-b16e-ee00ee00ee08";
const KEY_MID = "piimid_abcdef0123456789abcdef0123456789";
const KEY_HASH_MID = createHash("sha256").update(KEY_MID).digest("hex");

let appMid: FastifyInstance;

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(`INSERT INTO tenants (id, name, slug, status, type) VALUES ($1, 'PII Test', 'pii-mid-test', 'active', 'demo') ON CONFLICT (id) DO NOTHING`, [T_MID]);
    await c.query(`INSERT INTO tenant_api_keys (tenant_id, key_hash, key_prefix, name, rate_limit_per_minute) VALUES ($1, $2, 'piimid_abcdef01', 'test', 1000) ON CONFLICT DO NOTHING`, [T_MID, KEY_HASH_MID]);
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id=$1`, [T_MID]);
    await c.query(
      `INSERT INTO ingestion_mappings (tenant_id, source_name, transformer_type, adapter_type, adapter_config, field_map, active)
       VALUES ($1, 'encompass-los', 'encompass-los', 'encompass-los', $2::jsonb, '{}'::jsonb, true)`,
      [T_MID, JSON.stringify({ identityPrefix: "PII-", allowedFetchHosts: [], maxFileBytes: 50_000_000 })],
    );
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id=$1`, [T_MID]);
  });
  appMid = buildServer({}).app;
  await appMid.ready();
});
afterAll(async () => {
  await appMid.close();
  await withDb(async (c) => {
    await c.query(`DELETE FROM ingested_loans WHERE tenant_id=$1`, [T_MID]);
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id=$1`, [T_MID]);
    await c.query(`DELETE FROM tenant_api_keys WHERE tenant_id=$1`, [T_MID]);
  });
  await closePool();
});

describe2("redactPayloadMiddleware applied to Spec 1's loan endpoint", () => {
  it2("strips SSN from /loans payload before adapter dispatch", async () => {
    const res = await appMid.inject({
      method: "POST",
      url: "/api/ingest/pii-mid-test/loans",
      headers: { authorization: `Bearer ${KEY_MID}` },
      payload: {
        source: "encompass-los",
        externalId: "PII-LOAN-1",
        loanData: {
          loanNumber: "PII-LOAN-1",
          borrower: { fullName: "Test", ssn: "987654321", dob: "1990-01-01", ssnMasked: "xxx-xx-0000", maritalStatus: "Unmarried" },
          transaction: { loanAmount: 100, salesPrice: 100, appraisedValue: 100, ltv: 50, noteRate: 7, term: 360, amortType: "Fixed", occupancy: "Primary", loanPurpose: "Purchase", piti: 1 },
        },
      },
    });
    expect2(res.statusCode).toBe(201);
    // Loan stored — fetch and verify raw SSN is nowhere.
    const loanRes = await appMid.inject({
      method: "GET",
      url: "/loans/PII-PII-LOAN-1",
      headers: { "x-user-id": "test", "x-tenant-id": T_MID, "x-user-role": "operator" },
    });
    expect2(loanRes.statusCode).toBe(200);
    expect2(loanRes.body).not.toContain("987654321");
  });
});
