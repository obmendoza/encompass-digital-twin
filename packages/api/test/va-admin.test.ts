import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

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
import { closePool, withDb, withTenantTx } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

// Demo tenant — same UUID used by va-routes.test.ts.
const T = "5d175193-6ee2-4d6a-b16e-f1777f7e18ad";
const ADMIN = "admin1";

// Stable identifying strings so cleanup can target our rows precisely.
const NAME_PREFIX = "TestPartner_admin_";
const SME_NAME_PREFIX = "TestSME_admin_";
const POOL_NAME_PREFIX = "TestVAAdminPool_";

// Email prefix for SMEs (UNIQUE constraint on bpo_smes.email forces uniqueness
// across runs; we suffix with epoch ms per test).
function uniqueEmail(local: string): string {
  return `${local}+${Date.now()}_${Math.floor(Math.random() * 1e9)}@test.example`;
}

async function cleanup(): Promise<void> {
  // Order matters: routing rules → pools → smes → partners → audit/api-key rows.
  await withTenantTx(T, async (c) => {
    await c.query(
      `DELETE FROM va_routing_rules
        WHERE tenant_id = $1
          AND target_pool_id IN (SELECT id FROM va_pools WHERE tenant_id = $1 AND name LIKE $2)`,
      [T, `${POOL_NAME_PREFIX}%`],
    );
    await c.query(`DELETE FROM va_pools WHERE tenant_id = $1 AND name LIKE $2`, [
      T,
      `${POOL_NAME_PREFIX}%`,
    ]);
    await c.query(
      `DELETE FROM bpo_api_keys
        WHERE tenant_id = $1
          AND sme_id IN (SELECT id FROM bpo_smes WHERE name LIKE $2)`,
      [T, `${SME_NAME_PREFIX}%`],
    );
  });
  await withDb(async (c) => {
    await c.query(`DELETE FROM bpo_smes WHERE name LIKE $1`, [`${SME_NAME_PREFIX}%`]);
    await c.query(`DELETE FROM bpo_partners WHERE name LIKE $1`, [`${NAME_PREFIX}%`]);
  });
}

beforeAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await closePool();
});

function buildHeaders(opts: { tenantId?: string; userId?: string } = {}): Record<string, string> {
  return {
    "x-tenant-id": opts.tenantId ?? T,
    "x-user-id": opts.userId ?? ADMIN,
    "x-user-email": `${opts.userId ?? ADMIN}@test`,
    "content-type": "application/json",
  };
}

// Helper to seed a partner with explicit DPA fields.
async function seedPartner(opts: {
  name: string;
  dpa_on_file: boolean;
  dpa_reference: string | null;
}): Promise<string> {
  return withDb(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO bpo_partners (name, contact_email, dpa_on_file, dpa_reference)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [opts.name, `${opts.name}@test.example`, opts.dpa_on_file, opts.dpa_reference],
    );
    return rows[0].id;
  });
}

describe("va-admin routes", () => {
  it("POST /admin/bpo/partners — creates partner and writes audit row", async () => {
    const { app } = buildServer();
    await app.ready();
    try {
      const name = `${NAME_PREFIX}create`;
      const res = await app.inject({
        method: "POST",
        url: "/admin/bpo/partners",
        headers: buildHeaders(),
        payload: {
          name,
          contact_email: "partner@test.example",
          dpa_on_file: false,
          dpa_reference: null,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

      // Verify partner row exists.
      const partner = await withDb(async (c) => {
        const { rows } = await c.query<{
          id: string;
          dpa_on_file: boolean;
          dpa_reference: string | null;
        }>(`SELECT id, dpa_on_file, dpa_reference FROM bpo_partners WHERE id = $1`, [body.id]);
        return rows[0];
      });
      expect(partner).toBeTruthy();
      expect(partner.dpa_on_file).toBe(false);
      expect(partner.dpa_reference).toBeNull();

      // Verify audit row.
      const audit = await withDb(async (c) => {
        const { rows } = await c.query<{
          actor_id: string;
          target_tenant_id: string;
          action: string;
          metadata: { partner_id: string };
        }>(
          `SELECT actor_id, target_tenant_id, action, metadata
             FROM tenant_audit_log
            WHERE action = 'bpo_partner_create'
              AND metadata->>'partner_id' = $1`,
          [body.id],
        );
        return rows[0];
      });
      expect(audit).toBeTruthy();
      expect(audit.actor_id).toBe(ADMIN);
      expect(audit.action).toBe("bpo_partner_create");
      expect(audit.metadata.partner_id).toBe(body.id);
    } finally {
      await app.close();
    }
  });

  it("POST /admin/bpo/smes — creates SME under a partner and writes audit row", async () => {
    const partnerId = await seedPartner({
      name: `${NAME_PREFIX}for_sme`,
      dpa_on_file: true,
      dpa_reference: "DPA-FOR-SME",
    });
    const { app } = buildServer();
    await app.ready();
    try {
      const smeName = `${SME_NAME_PREFIX}create`;
      const email = uniqueEmail("sme1");
      const res = await app.inject({
        method: "POST",
        url: "/admin/bpo/smes",
        headers: buildHeaders(),
        payload: { bpo_partner_id: partnerId, name: smeName, email },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

      const audit = await withDb(async (c) => {
        const { rows } = await c.query<{
          action: string;
          metadata: { sme_id: string; partner_id: string; email: string };
        }>(
          `SELECT action, metadata FROM tenant_audit_log
            WHERE action = 'bpo_sme_create' AND metadata->>'sme_id' = $1`,
          [body.id],
        );
        return rows[0];
      });
      expect(audit).toBeTruthy();
      expect(audit.metadata.partner_id).toBe(partnerId);
      expect(audit.metadata.email).toBe(email);
    } finally {
      await app.close();
    }
  });

  it("POST /admin/bpo/api-keys — returns raw token once; stored hash matches sha256(raw)", async () => {
    const partnerId = await seedPartner({
      name: `${NAME_PREFIX}for_apikey`,
      dpa_on_file: true,
      dpa_reference: "DPA-APIKEY",
    });
    const smeName = `${SME_NAME_PREFIX}for_apikey`;
    const smeId = await withDb(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO bpo_smes (bpo_partner_id, name, email)
         VALUES ($1, $2, $3) RETURNING id`,
        [partnerId, smeName, uniqueEmail("apikey_sme")],
      );
      return rows[0].id;
    });

    const { app } = buildServer();
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/admin/bpo/api-keys",
        headers: buildHeaders(),
        payload: { sme_id: smeId },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { id: string; token: string };
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
      // 32 random bytes → 64 hex chars.
      expect(body.token).toMatch(/^[0-9a-f]{64}$/);

      // Verify sha256(raw) == stored key_hash.
      const expectedHash = createHash("sha256").update(body.token).digest();
      const stored = await withTenantTx(T, async (c) => {
        const { rows } = await c.query<{ key_hash: Buffer; sme_id: string }>(
          `SELECT key_hash, sme_id FROM bpo_api_keys WHERE id = $1`,
          [body.id],
        );
        return rows[0];
      });
      expect(stored).toBeTruthy();
      expect(stored.sme_id).toBe(smeId);
      expect(Buffer.compare(stored.key_hash, expectedHash)).toBe(0);

      // Verify audit row written, and that the raw token is NOT in metadata.
      const audit = await withDb(async (c) => {
        const { rows } = await c.query<{
          metadata: Record<string, unknown>;
        }>(
          `SELECT metadata FROM tenant_audit_log
            WHERE action = 'bpo_api_key_create' AND metadata->>'api_key_id' = $1`,
          [body.id],
        );
        return rows[0];
      });
      expect(audit).toBeTruthy();
      expect(audit.metadata).toEqual({ api_key_id: body.id, sme_id: smeId });
      expect(JSON.stringify(audit.metadata)).not.toContain(body.token);
    } finally {
      await app.close();
    }
  });

  it("POST /admin/va/pools — DPA gate violation returns 409 (partner without DPA)", async () => {
    const partnerId = await seedPartner({
      name: `${NAME_PREFIX}no_dpa`,
      dpa_on_file: false,
      dpa_reference: null,
    });
    const { app } = buildServer();
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/admin/va/pools",
        headers: buildHeaders(),
        payload: {
          name: `${POOL_NAME_PREFIX}gate_violation`,
          kind: "bpo",
          bpo_partner_id: partnerId,
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("DPA_GATE_VIOLATION");

      // Verify the pool row was NOT created.
      const exists = await withTenantTx(T, async (c) => {
        const { rows } = await c.query(
          `SELECT 1 FROM va_pools WHERE tenant_id = $1 AND name = $2`,
          [T, `${POOL_NAME_PREFIX}gate_violation`],
        );
        return rows.length;
      });
      expect(exists).toBe(0);
    } finally {
      await app.close();
    }
  });

  it("POST /admin/va/pools — succeeds for partner with DPA on file", async () => {
    const partnerId = await seedPartner({
      name: `${NAME_PREFIX}with_dpa`,
      dpa_on_file: true,
      dpa_reference: "DPA-001",
    });
    const { app } = buildServer();
    await app.ready();
    try {
      const poolName = `${POOL_NAME_PREFIX}with_dpa`;
      const res = await app.inject({
        method: "POST",
        url: "/admin/va/pools",
        headers: buildHeaders(),
        payload: { name: poolName, kind: "bpo", bpo_partner_id: partnerId },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

      const audit = await withDb(async (c) => {
        const { rows } = await c.query<{ metadata: { pool_id: string; kind: string } }>(
          `SELECT metadata FROM tenant_audit_log
            WHERE action = 'va_pool_create' AND metadata->>'pool_id' = $1`,
          [body.id],
        );
        return rows[0];
      });
      expect(audit).toBeTruthy();
      expect(audit.metadata.kind).toBe("bpo");
    } finally {
      await app.close();
    }
  });

  it("POST /admin/va/pools — kind=bpo without bpo_partner_id returns 422", async () => {
    const { app } = buildServer();
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/admin/va/pools",
        headers: buildHeaders(),
        payload: {
          name: `${POOL_NAME_PREFIX}missing_partner`,
          kind: "bpo",
          bpo_partner_id: null,
        },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toBe("BPO_PARTNER_ID_REQUIRED");
    } finally {
      await app.close();
    }
  });

  it("POST /admin/va/routing-rules — happy path creates rule and audit row", async () => {
    // Need a target pool first.
    const poolName = `${POOL_NAME_PREFIX}rule_target`;
    const poolId = await withTenantTx(T, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO va_pools (tenant_id, name, kind, active)
         VALUES ($1, $2, 'internal', true) RETURNING id`,
        [T, poolName],
      );
      return rows[0].id;
    });

    const { app } = buildServer();
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/admin/va/routing-rules",
        headers: buildHeaders(),
        payload: {
          priority: 100,
          match: { program: ["NQM-Bank"], loanAmountMin: 250000 },
          target_pool_id: poolId,
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

      const rule = await withTenantTx(T, async (c) => {
        const { rows } = await c.query<{
          priority: number;
          match: { program?: string[]; loanAmountMin?: number };
          target_pool_id: string;
        }>(
          `SELECT priority, match, target_pool_id FROM va_routing_rules WHERE id = $1`,
          [body.id],
        );
        return rows[0];
      });
      expect(rule.priority).toBe(100);
      expect(rule.target_pool_id).toBe(poolId);
      expect(rule.match.program).toEqual(["NQM-Bank"]);

      const audit = await withDb(async (c) => {
        const { rows } = await c.query<{
          metadata: { rule_id: string; priority: number };
        }>(
          `SELECT metadata FROM tenant_audit_log
            WHERE action = 'va_routing_rule_create' AND metadata->>'rule_id' = $1`,
          [body.id],
        );
        return rows[0];
      });
      expect(audit).toBeTruthy();
      expect(audit.metadata.priority).toBe(100);
    } finally {
      await app.close();
    }
  });
});
