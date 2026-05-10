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
import Fastify from "fastify";
import { closePool, withDb } from "../src/db/pool.js";
import { verifyBpoToken } from "../src/middleware/bpo-auth.js";

// Demo tenant — same one used by va-routes.test.ts
const TENANT_ID = "5d175193-6ee2-4d6a-b16e-f1777f7e18ad";

// Stable test ids so cleanup is targeted.
const PARTNER_ID = "00000000-0000-0000-0000-0000000bbb01";
const SME_ID = "00000000-0000-0000-0000-0000000bbb02";
const KEY_ID_VALID = "00000000-0000-0000-0000-0000000bbb03";
const KEY_ID_REVOKED = "00000000-0000-0000-0000-0000000bbb04";

const TOKEN_VALID = randomBytes(32).toString("hex");
const TOKEN_REVOKED = randomBytes(32).toString("hex");
const HASH_VALID = createHash("sha256").update(TOKEN_VALID).digest();
const HASH_REVOKED = createHash("sha256").update(TOKEN_REVOKED).digest();

function makeTestApp() {
  const app = Fastify();
  app.post("/test/bpo-auth", async (req, reply) => {
    const result = await verifyBpoToken(req, reply);
    if (!result.ok) return; // reply already sent
    return reply.send(result);
  });
  return app;
}

async function cleanup() {
  await withDb(async (c) => {
    await c.query(`DELETE FROM bpo_api_keys WHERE id = ANY($1::uuid[])`, [
      [KEY_ID_VALID, KEY_ID_REVOKED],
    ]);
    await c.query(`DELETE FROM bpo_smes WHERE id = $1`, [SME_ID]);
    await c.query(`DELETE FROM bpo_partners WHERE id = $1`, [PARTNER_ID]);
  });
}

beforeAll(async () => {
  await cleanup();
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO bpo_partners (id, name, contact_email, active, dpa_on_file, dpa_reference)
       VALUES ($1, 'Test BPO Partner', 'partner@test.example', true, true, 'DPA-TEST-1')`,
      [PARTNER_ID],
    );
    await c.query(
      `INSERT INTO bpo_smes (id, bpo_partner_id, name, email, active)
       VALUES ($1, $2, 'Test SME', 'test-sme-bpo-auth@test.example', true)`,
      [SME_ID, PARTNER_ID],
    );
  });
});

beforeEach(async () => {
  // Re-create the keys fresh each test so last_used_at assertions are stable.
  await withDb(async (c) => {
    await c.query(`DELETE FROM bpo_api_keys WHERE id = ANY($1::uuid[])`, [
      [KEY_ID_VALID, KEY_ID_REVOKED],
    ]);
    await c.query(
      `INSERT INTO bpo_api_keys (id, sme_id, tenant_id, key_hash)
       VALUES ($1, $2, $3, $4)`,
      [KEY_ID_VALID, SME_ID, TENANT_ID, HASH_VALID],
    );
    await c.query(
      `INSERT INTO bpo_api_keys (id, sme_id, tenant_id, key_hash, revoked_at)
       VALUES ($1, $2, $3, $4, now())`,
      [KEY_ID_REVOKED, SME_ID, TENANT_ID, HASH_REVOKED],
    );
  });
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

describe("verifyBpoToken", () => {
  it("missing Authorization header → 401 missing_bearer_token", async () => {
    const app = makeTestApp();
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/test/bpo-auth" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "missing_bearer_token" });
    await app.close();
  });

  it("invalid token → 401 invalid_or_revoked_token", async () => {
    const app = makeTestApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/test/bpo-auth",
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "invalid_or_revoked_token" });
    await app.close();
  });

  it("valid token → 200 with sme/partner/tenant ids and bumps last_used_at", async () => {
    const app = makeTestApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/test/bpo-auth",
      headers: { authorization: `Bearer ${TOKEN_VALID}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.tenantId).toBe(TENANT_ID);
    expect(body.smeId).toBe(SME_ID);
    expect(body.partnerId).toBe(PARTNER_ID);
    expect(body.smeName).toBe("Test SME");
    await app.close();

    // Allow the fire-and-forget last_used_at update to land.
    await new Promise((r) => setTimeout(r, 100));

    const lastUsed = await withDb(async (c) => {
      const { rows } = await c.query<{ last_used_at: Date | null }>(
        `SELECT last_used_at FROM bpo_api_keys WHERE id = $1`,
        [KEY_ID_VALID],
      );
      return rows[0]?.last_used_at ?? null;
    });
    expect(lastUsed).not.toBeNull();
  });

  it("revoked token → 401 invalid_or_revoked_token", async () => {
    const app = makeTestApp();
    await app.ready();
    const res = await app.inject({
      method: "POST",
      url: "/test/bpo-auth",
      headers: { authorization: `Bearer ${TOKEN_REVOKED}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "invalid_or_revoked_token" });
    await app.close();
  });
});
