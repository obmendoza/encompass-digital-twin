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

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { withDb, closePool } from "../src/db/pool.js";
import { __testing } from "../src/services/va-outbox-dispatcher.js";

// Dedicated test tenant — kept stable so we can hard-delete it on cleanup.
const TEST_TENANT_ID = "00000000-0000-0000-0000-000000aabb44";
const TEST_LOAN_PREFIX = "TEST_VA_OUTBOX_";

interface OutboxRow {
  id: string;
  attempts: number;
  delivered_at: Date | null;
  last_error: string | null;
  next_attempt_at: Date | string | null;
}

async function setTenantAdapter(adapter: Record<string, unknown>): Promise<void> {
  await withDb(async (c) => {
    // jsonb_set won't create intermediate keys — build the full {va: {docRequestAdapter: …}}
    // object and merge it into settings via the `||` operator.
    await c.query(
      `UPDATE tenants
          SET settings = COALESCE(settings, '{}'::jsonb)
                          || jsonb_build_object('va', jsonb_build_object('docRequestAdapter', $1::jsonb))
        WHERE id = $2`,
      [JSON.stringify(adapter), TEST_TENANT_ID],
    );
  });
}

async function insertOutboxEvent(
  loanId: string,
  opts: { attempts?: number; nextAttemptAt?: string } = {},
): Promise<string> {
  return withDb(async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO va_event_outbox
         (tenant_id, event_type, loan_id, payload, attempts, next_attempt_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, COALESCE($6::timestamptz, now()))
       RETURNING id`,
      [
        TEST_TENANT_ID,
        "doc_request",
        loanId,
        JSON.stringify({ docs: ["paystub"] }),
        opts.attempts ?? 0,
        opts.nextAttemptAt ?? null,
      ],
    );
    return rows[0].id;
  });
}

async function readOutbox(id: string): Promise<OutboxRow> {
  return withDb(async (c) => {
    const { rows } = await c.query<OutboxRow>(
      `SELECT id, attempts, delivered_at, last_error, next_attempt_at
         FROM va_event_outbox WHERE id = $1`,
      [id],
    );
    return rows[0];
  });
}

async function cleanup(): Promise<void> {
  await withDb(async (c) => {
    await c.query(
      `DELETE FROM va_event_outbox
        WHERE tenant_id = $1 OR loan_id LIKE $2`,
      [TEST_TENANT_ID, `${TEST_LOAN_PREFIX}%`],
    );
  });
}

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(async () => {
  // Ensure the dedicated test tenant exists; reset its settings each run.
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, settings)
         VALUES ($1, 'Outbox Test Tenant', 'outbox-test-tenant', 'active', '{}'::jsonb)
       ON CONFLICT (id) DO UPDATE SET settings = '{}'::jsonb`,
      [TEST_TENANT_ID],
    );
  });
  await cleanup();
  // Restore real fetch between tests so stale mocks can't leak across cases.
  globalThis.fetch = ORIGINAL_FETCH;
});

afterAll(async () => {
  await cleanup();
  // Drop the dedicated tenant — outbox rows are already gone.
  await withDb(async (c) => {
    await c.query(`DELETE FROM tenants WHERE id = $1`, [TEST_TENANT_ID]);
  });
  globalThis.fetch = ORIGINAL_FETCH;
  await closePool();
});

describe("va-outbox-dispatcher", () => {
  it("ui-only adapter marks the event delivered immediately", async () => {
    await setTenantAdapter({ kind: "ui-only" });
    const id = await insertOutboxEvent(`${TEST_LOAN_PREFIX}UI`);

    const processed = await __testing.processBatch();
    expect(processed).toBeGreaterThanOrEqual(1);

    const row = await readOutbox(id);
    expect(row.delivered_at).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBeNull();
  });

  it("portal-webhook success marks the event delivered and sends correct payload", async () => {
    await setTenantAdapter({
      kind: "portal-webhook",
      url: "http://localhost:0/test-webhook",
      secretRef: "",
    });
    const id = await insertOutboxEvent(`${TEST_LOAN_PREFIX}WEBHOOK_OK`);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "",
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await __testing.processBatch();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:0/test-webhook");
    expect(init.method).toBe("POST");
    expect(init.headers["x-uas-event"]).toBe("doc_request");
    expect(init.headers["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.eventId).toBe(id);
    expect(body.tenantId).toBe(TEST_TENANT_ID);
    expect(body.loanId).toBe(`${TEST_LOAN_PREFIX}WEBHOOK_OK`);
    expect(body.payload).toEqual({ docs: ["paystub"] });

    const row = await readOutbox(id);
    expect(row.delivered_at).not.toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBeNull();
  });

  it("portal-webhook failure increments attempts and schedules retry ~1m out", async () => {
    await setTenantAdapter({
      kind: "portal-webhook",
      url: "http://localhost:0/test-webhook",
      secretRef: "",
    });
    const id = await insertOutboxEvent(`${TEST_LOAN_PREFIX}WEBHOOK_FAIL`);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "boom",
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const before = Date.now();
    await __testing.processBatch();
    const after = Date.now();

    const row = await readOutbox(id);
    expect(row.delivered_at).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.last_error).toMatch(/500/);
    // BACKOFF_MINUTES[0] is 1 minute. Allow a generous window.
    const next = new Date(row.next_attempt_at as Date | string).getTime();
    expect(next).toBeGreaterThan(before + 30_000);
    expect(next).toBeLessThan(after + 90_000);
  });

  it("npnqm-portal adapter throws → retry scheduled with not-implemented error", async () => {
    await setTenantAdapter({ kind: "npnqm-portal" });
    const id = await insertOutboxEvent(`${TEST_LOAN_PREFIX}NPNQM`);

    await __testing.processBatch();

    const row = await readOutbox(id);
    expect(row.delivered_at).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.last_error ?? "").toMatch(/not implemented/i);
  });

  it("dead-letters at attempt 6 (next_attempt_at = infinity, last_error prefixed)", async () => {
    await setTenantAdapter({ kind: "npnqm-portal" });
    // Already retried 5 times — this batch run is attempt 6, which dead-letters.
    const id = await insertOutboxEvent(`${TEST_LOAN_PREFIX}DEAD`, {
      attempts: 5,
    });

    await __testing.processBatch();

    const row = await readOutbox(id);
    expect(row.delivered_at).toBeNull();
    expect(row.attempts).toBe(6);
    expect(row.last_error ?? "").toMatch(/^dead_letter:/);
    // Postgres returns timestamptz 'infinity' as the JS string "infinity"
    // via node-postgres; tolerate either Date Infinity or the string form.
    const next = row.next_attempt_at;
    const isInfinity =
      next === "infinity" ||
      (next instanceof Date && !Number.isFinite(next.getTime())) ||
      (typeof next === "number" && next === Infinity);
    expect(isInfinity).toBe(true);
  });
});
