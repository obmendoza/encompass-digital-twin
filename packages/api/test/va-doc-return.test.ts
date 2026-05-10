import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load .env (for DATABASE_URL) before any module that reads it.
if (!process.env.DATABASE_URL) {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, "../.env");
  try {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env not present — tests will surface a clearer DATABASE_URL error.
  }
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { closePool, withDb, withTenantTx } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";
import { receiveVADocResponse } from "../src/services/va-doc-return.js";

// ── Demo tenant (same one used by va-routes.test.ts and bpo-routes.test.ts) ─
const T = "5d175193-6ee2-4d6a-b16e-f1777f7e18ad";

// Loan id stamped onto the preloaded fixture (nqm-bankstmt-12mo-clean) — same
// loan id that uploads.http.test.ts exercises.
const FIXTURE_LOAN_ID = "2501000101";

// ── BPO identity fixtures (independent UUIDs to avoid collisions with
// other test suites' fixtures). ─────────────────────────────────────────────
const PARTNER_ID = "00000000-0000-0000-0000-0000000ddf01";
const SME_ID = "00000000-0000-0000-0000-0000000ddf02";
const SME_NAME = "VA Doc Return Test SME";
const KEY_ID = "00000000-0000-0000-0000-0000000ddf03";
const TOKEN = randomBytes(32).toString("hex");
const TOKEN_HASH = createHash("sha256").update(TOKEN).digest();

// BPO pool with the SME as a member.
const POOL_ID = "00000000-0000-0000-0000-0000000ddf10";

const DOCS = [
  { name: "Updated Bank Statement.pdf", docType: "BankStatement" },
  { name: "Pay Stub Q1.pdf", docType: "PayStub" },
];

async function cleanupVAState(loanIds: string[]) {
  await withTenantTx(T, async (c) => {
    await c.query(
      `DELETE FROM va_loan_state WHERE tenant_id = $1 AND loan_id = ANY($2::text[])`,
      [T, loanIds],
    );
  });
}

async function cleanupAll() {
  await cleanupVAState([FIXTURE_LOAN_ID]);
  await withDb(async (c) => {
    await c.query(`DELETE FROM bpo_api_keys WHERE id = $1`, [KEY_ID]);
  });
  await withTenantTx(T, async (c) => {
    await c.query(`DELETE FROM va_pool_memberships WHERE pool_id = $1`, [POOL_ID]);
    await c.query(`DELETE FROM va_pools WHERE tenant_id = $1 AND id = $2`, [T, POOL_ID]);
  });
  await withDb(async (c) => {
    await c.query(`DELETE FROM bpo_smes WHERE id = $1`, [SME_ID]);
    await c.query(`DELETE FROM bpo_partners WHERE id = $1`, [PARTNER_ID]);
  });
}

beforeAll(async () => {
  await cleanupAll();
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO bpo_partners (id, name, contact_email, active, dpa_on_file, dpa_reference)
       VALUES ($1, 'VA Doc Return Test Partner', 'va-doc-return@test.example', true, true, 'DPA-TEST-DOCRETURN')`,
      [PARTNER_ID],
    );
    await c.query(
      `INSERT INTO bpo_smes (id, bpo_partner_id, name, email, active)
       VALUES ($1, $2, $3, 'va-doc-return-sme@test.example', true)`,
      [SME_ID, PARTNER_ID, SME_NAME],
    );
    await c.query(
      `INSERT INTO bpo_api_keys (id, sme_id, tenant_id, key_hash)
       VALUES ($1, $2, $3, $4)`,
      [KEY_ID, SME_ID, T, TOKEN_HASH],
    );
  });
  await withTenantTx(T, async (c) => {
    await c.query(
      `INSERT INTO va_pools (id, tenant_id, name, kind, bpo_partner_id, active)
       VALUES ($1, $2, 'VA Doc Return Test BPO Pool', 'bpo', $3, true)`,
      [POOL_ID, T, PARTNER_ID],
    );
    await c.query(
      `INSERT INTO va_pool_memberships (pool_id, member_id, member_kind)
       VALUES ($1, $2, 'bpo')`,
      [POOL_ID, SME_ID],
    );
  });
});

beforeEach(async () => {
  await cleanupVAState([FIXTURE_LOAN_ID]);
});

afterAll(async () => {
  await cleanupAll();
  await closePool();
});

// ── Fetch mock plumbing ─────────────────────────────────────────────────────
const origFetch = globalThis.fetch;
function setFetch(impl: typeof globalThis.fetch | undefined) {
  if (impl === undefined) {
    globalThis.fetch = origFetch;
  } else {
    globalThis.fetch = impl;
  }
}
afterAll(() => {
  globalThis.fetch = origFetch;
});

function bearer(): Record<string, string> {
  return { authorization: `Bearer ${TOKEN}` };
}

function buildHeaders(opts: { userId?: string } = {}): Record<string, string> {
  return {
    "x-tenant-id": T,
    "x-user-id": opts.userId ?? "u1",
    "x-user-email": `${opts.userId ?? "u1"}@test`,
  };
}

describe("receiveVADocResponse (service)", () => {
  it("throws LOAN_NOT_AWAITING_DOCS when state is not va_doc_request_pending", async () => {
    const { app, store } = buildServer({
      preloadScenarioId: "nqm-bankstmt-12mo-clean",
      preloadTenantId: T,
    });
    await app.ready();
    try {
      // Insert va_loan_state in a non-awaiting-docs state.
      await withTenantTx(T, async (c) => {
        await c.query(
          `INSERT INTO va_loan_state (tenant_id, loan_id, va_state)
           VALUES ($1, $2, 'agent_review_pending')`,
          [T, FIXTURE_LOAN_ID],
        );
      });

      let threw = false;
      try {
        await receiveVADocResponse(
          store,
          { tenantId: T, loanId: FIXTURE_LOAN_ID, documents: DOCS },
          { kind: "internal", id: "u1" },
        );
      } catch (e) {
        threw = true;
        expect((e as Error).message).toMatch(/LOAN_NOT_AWAITING_DOCS/);
      }
      expect(threw).toBe(true);

      // State must remain unchanged.
      const row = await withTenantTx(T, async (c) => {
        const { rows } = await c.query<{ va_state: string }>(
          `SELECT va_state FROM va_loan_state WHERE tenant_id = $1 AND loan_id = $2`,
          [T, FIXTURE_LOAN_ID],
        );
        return rows[0];
      });
      expect(row?.va_state).toBe("agent_review_pending");
    } finally {
      await app.close();
    }
  });

  it("happy path: inserts docs, transitions state, agent rerun returns true", async () => {
    const { app, store } = buildServer({
      preloadScenarioId: "nqm-bankstmt-12mo-clean",
      preloadTenantId: T,
    });
    await app.ready();
    try {
      await withTenantTx(T, async (c) => {
        await c.query(
          `INSERT INTO va_loan_state (tenant_id, loan_id, va_state)
           VALUES ($1, $2, 'va_doc_request_pending')`,
          [T, FIXTURE_LOAN_ID],
        );
      });

      const before = store.getLoan(FIXTURE_LOAN_ID);
      expect(before).toBeTruthy();
      const docCountBefore = before!.documents.length;

      // Mock fetch to a 200 OK response.
      let fetchCalledWith: { url: string; init?: RequestInit } | null = null;
      setFetch((async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchCalledWith = { url: String(input), init };
        return new Response("{}", { status: 200 });
      }) as typeof globalThis.fetch);

      try {
        const result = await receiveVADocResponse(
          store,
          { tenantId: T, loanId: FIXTURE_LOAN_ID, documents: DOCS },
          { kind: "internal", id: "u1" },
        );

        expect(result.accepted).toBe(DOCS.length);
        expect(result.newState).toBe("agent_review_pending");
        expect(result.agentRerunTriggered).toBe(true);
        expect(fetchCalledWith).not.toBeNull();
        expect(fetchCalledWith!.url).toMatch(
          new RegExp(`/api/twin/underwrite-multi/${FIXTURE_LOAN_ID}\\?tenant_id=${T}`),
        );

        // DB state transitioned.
        const row = await withTenantTx(T, async (c) => {
          const { rows } = await c.query<{ va_state: string }>(
            `SELECT va_state FROM va_loan_state WHERE tenant_id = $1 AND loan_id = $2`,
            [T, FIXTURE_LOAN_ID],
          );
          return rows[0];
        });
        expect(row?.va_state).toBe("agent_review_pending");

        // In-memory loan now has the new docs.
        const after = store.getLoan(FIXTURE_LOAN_ID);
        expect(after!.documents.length).toBe(docCountBefore + DOCS.length);
        const last = after!.documents.slice(-DOCS.length);
        expect(last.map((d) => d.name)).toEqual(DOCS.map((d) => d.name));
      } finally {
        setFetch(undefined);
      }
    } finally {
      await app.close();
    }
  });

  it("agent rerun failure still considered success — state advances, flag is false", async () => {
    const { app, store } = buildServer({
      preloadScenarioId: "nqm-bankstmt-12mo-clean",
      preloadTenantId: T,
    });
    await app.ready();
    try {
      await withTenantTx(T, async (c) => {
        await c.query(
          `INSERT INTO va_loan_state (tenant_id, loan_id, va_state)
           VALUES ($1, $2, 'va_doc_request_pending')`,
          [T, FIXTURE_LOAN_ID],
        );
      });

      // Mock fetch to throw a network error.
      setFetch((async () => {
        throw new Error("network unreachable");
      }) as typeof globalThis.fetch);

      try {
        const result = await receiveVADocResponse(
          store,
          { tenantId: T, loanId: FIXTURE_LOAN_ID, documents: DOCS },
          { kind: "internal", id: "u1" },
        );
        expect(result.accepted).toBe(DOCS.length);
        expect(result.newState).toBe("agent_review_pending");
        expect(result.agentRerunTriggered).toBe(false);

        // State still advanced.
        const row = await withTenantTx(T, async (c) => {
          const { rows } = await c.query<{ va_state: string }>(
            `SELECT va_state FROM va_loan_state WHERE tenant_id = $1 AND loan_id = $2`,
            [T, FIXTURE_LOAN_ID],
          );
          return rows[0];
        });
        expect(row?.va_state).toBe("agent_review_pending");
      } finally {
        setFetch(undefined);
      }
    } finally {
      await app.close();
    }
  });
});

describe("POST /loans/:id/va/docs-returned (internal route)", () => {
  it("200 happy path — flips state, adds docs, reports trigger=true", async () => {
    const { app, store } = buildServer({
      preloadScenarioId: "nqm-bankstmt-12mo-clean",
      preloadTenantId: T,
    });
    await app.ready();
    try {
      await withTenantTx(T, async (c) => {
        await c.query(
          `INSERT INTO va_loan_state (tenant_id, loan_id, va_state)
           VALUES ($1, $2, 'va_doc_request_pending')`,
          [T, FIXTURE_LOAN_ID],
        );
      });

      const docCountBefore = store.getLoan(FIXTURE_LOAN_ID)!.documents.length;

      setFetch((async () => new Response("{}", { status: 200 })) as typeof globalThis.fetch);
      try {
        const res = await app.inject({
          method: "POST",
          url: `/loans/${FIXTURE_LOAN_ID}/va/docs-returned`,
          headers: buildHeaders(),
          payload: { documents: DOCS },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.accepted).toBe(DOCS.length);
        expect(body.newState).toBe("agent_review_pending");
        expect(body.agentRerunTriggered).toBe(true);

        expect(store.getLoan(FIXTURE_LOAN_ID)!.documents.length).toBe(
          docCountBefore + DOCS.length,
        );
      } finally {
        setFetch(undefined);
      }
    } finally {
      await app.close();
    }
  });

  it("409 LOAN_NOT_AWAITING_DOCS when va_state is wrong", async () => {
    const { app } = buildServer({
      preloadScenarioId: "nqm-bankstmt-12mo-clean",
      preloadTenantId: T,
    });
    await app.ready();
    try {
      await withTenantTx(T, async (c) => {
        await c.query(
          `INSERT INTO va_loan_state (tenant_id, loan_id, va_state)
           VALUES ($1, $2, 'va_review_pending')`,
          [T, FIXTURE_LOAN_ID],
        );
      });

      // Don't even need to mock fetch here — the state guard short-circuits
      // before we'd try to call the agent.
      const res = await app.inject({
        method: "POST",
        url: `/loans/${FIXTURE_LOAN_ID}/va/docs-returned`,
        headers: buildHeaders(),
        payload: { documents: DOCS },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "LOAN_NOT_AWAITING_DOCS" });
    } finally {
      await app.close();
    }
  });
});

describe("POST /bpo/loans/:id/docs-returned (BPO route)", () => {
  it("200 happy path with valid bearer", async () => {
    const { app, store } = buildServer({
      preloadScenarioId: "nqm-bankstmt-12mo-clean",
      preloadTenantId: T,
    });
    await app.ready();
    try {
      await withTenantTx(T, async (c) => {
        await c.query(
          `INSERT INTO va_loan_state (tenant_id, loan_id, va_state, assigned_pool_id)
           VALUES ($1, $2, 'va_doc_request_pending', $3)`,
          [T, FIXTURE_LOAN_ID, POOL_ID],
        );
      });

      const docCountBefore = store.getLoan(FIXTURE_LOAN_ID)!.documents.length;

      setFetch((async () => new Response("{}", { status: 200 })) as typeof globalThis.fetch);
      try {
        const res = await app.inject({
          method: "POST",
          url: `/bpo/loans/${FIXTURE_LOAN_ID}/docs-returned`,
          headers: bearer(),
          payload: { documents: DOCS },
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.accepted).toBe(DOCS.length);
        expect(body.newState).toBe("agent_review_pending");
        expect(body.agentRerunTriggered).toBe(true);

        const after = store.getLoan(FIXTURE_LOAN_ID)!;
        expect(after.documents.length).toBe(docCountBefore + DOCS.length);
        // The new docs were uploaded by the SME (actor.kind=bpo, id=smeId).
        const last = after.documents.slice(-DOCS.length);
        expect(last.every((d) => d.uploadedBy === SME_ID)).toBe(true);
      } finally {
        setFetch(undefined);
      }
    } finally {
      await app.close();
    }
  });
});
