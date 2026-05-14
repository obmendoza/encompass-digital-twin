import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    for (const line of readFileSync(resolvePath(here, "../.env"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* */ }
}

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { withDb, closePool } from "../src/db/pool.js";
import { buildServer } from "../src/server.js";

const T = "5d175193-6ee2-4d6a-b16e-ee00ee00ee07";
let app: FastifyInstance;

beforeAll(async () => {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'Admin Test', 'admin-test', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id = $1`, [T]);
  });
  app = buildServer({}).app;
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await withDb(async (c) => {
    await c.query(`DELETE FROM ingestion_mappings WHERE tenant_id = $1`, [T]);
  });
  await closePool();
});

const headers = {
  "x-user-id": "admin-user",
  "x-tenant-id": T,
  "x-user-role": "operator",
  "x-super-admin": "true",
};

describe("admin ingestion-mappings CRUD", () => {
  it("POST creates a mapping with valid adapter_config", async () => {
    const res = await app.inject({
      method: "POST", url: "/admin/tenants/admin-test/ingestion-mappings",
      headers,
      payload: {
        source_name: "npnqm-portal",
        adapter_type: "npnqm-portal",
        adapter_config: {
          identityPrefix: "NPNQM-",
          allowedFetchHosts: ["docs.npnqm-portal.example.com"],
          programMapping: { "Flex_NPNQM": "Flex Select" },
        },
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("POST rejects unknown adapter_type with 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/admin/tenants/admin-test/ingestion-mappings",
      headers,
      payload: { source_name: "bad", adapter_type: "no-such-adapter", adapter_config: { allowedFetchHosts: [] } },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error_class).toBe("unknown_adapter_type");
  });

  it("POST rejects invalid adapter_config with 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/admin/tenants/admin-test/ingestion-mappings",
      headers,
      payload: { source_name: "x", adapter_type: "generic-json", adapter_config: { identityPrefix: "lowercase-bad", allowedFetchHosts: [] } },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error_class).toBe("validation_failed");
  });

  it("GET lists mappings for the tenant", async () => {
    const res = await app.inject({
      method: "GET", url: "/admin/tenants/admin-test/ingestion-mappings", headers,
    });
    expect(res.statusCode).toBe(200);
    const arr = JSON.parse(res.body);
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBeGreaterThanOrEqual(1);
  });

  it("DELETE soft-deletes (sets active=false)", async () => {
    const list = JSON.parse((await app.inject({ method: "GET", url: "/admin/tenants/admin-test/ingestion-mappings", headers })).body);
    const id = list[0].id;
    const res = await app.inject({
      method: "DELETE", url: `/admin/tenants/admin-test/ingestion-mappings/${id}`, headers,
    });
    expect(res.statusCode).toBe(200);
  });

  it("every CRUD write produces a tenant_audit_log row", async () => {
    const { rows } = await withDb(async (c) => c.query<{ action: string }>(
      `SELECT action FROM tenant_audit_log
        WHERE target_tenant_id=$1 AND action LIKE 'admin.ingestion_mappings.%'
        ORDER BY created_at DESC LIMIT 10`,
      [T],
    ));
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });
});
