// VA outbox dispatcher — long-running background worker that delivers
// va_event_outbox rows to per-tenant adapters. Holds advisory lock 44 while
// running so only one API instance leads at a time.

import { withDb } from "../db/pool.js";

const LOCK_KEY = 44;
const POLL_INTERVAL_MS = 2_000;
const RETRY_LOCK_INTERVAL_MS = 30_000;
// Backoff for attempts 1..5; attempt 6 is dead-letter (next_attempt_at = infinity).
const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
const BATCH_SIZE = 25;
const WEBHOOK_TIMEOUT_MS = 20_000;

interface OutboxEvent {
  id: string;
  tenant_id: string;
  event_type: string;
  loan_id: string;
  payload: unknown;
  attempts: number;
}

interface DocRequestAdapter {
  kind: "ui-only" | "portal-webhook" | "npnqm-portal";
  url?: string;
  secretRef?: string;
}

let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function startVAOutboxDispatcher(): Promise<void> {
  if (running) return;
  running = true;
  void dispatcherLoop();
}

export function stopVAOutboxDispatcher(): void {
  running = false;
}

async function dispatcherLoop(): Promise<void> {
  while (running) {
    const acquired = await withDb(async (c) => {
      const { rows } = await c.query<{ ok: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS ok",
        [LOCK_KEY],
      );
      return rows[0]?.ok ?? false;
    }).catch((e) => {
      console.error("[va-outbox] Failed to attempt advisory lock:", e);
      return false;
    });

    if (!acquired) {
      await sleep(RETRY_LOCK_INTERVAL_MS);
      continue;
    }

    console.log(
      `[va-outbox] Acquired advisory lock ${LOCK_KEY}; starting dispatch loop`,
    );
    try {
      while (running) {
        let processed = 0;
        try {
          processed = await processBatch();
        } catch (e) {
          console.error("[va-outbox] Batch error:", e);
        }
        if (processed === 0) await sleep(POLL_INTERVAL_MS);
      }
    } finally {
      await withDb(async (c) =>
        c.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]),
      ).catch((e) =>
        console.warn("[va-outbox] Failed to release lock:", e),
      );
    }
  }
}

// `tenantFilter` is a test-only escape hatch. The production loop calls
// processBatch() with no args (process all tenants); tests pass their
// dedicated tenant id so concurrent test files don't poach each other's
// outbox rows.
async function processBatch(opts?: { tenantFilter?: string }): Promise<number> {
  const events = await withDb(async (c) => {
    const params: unknown[] = [BATCH_SIZE];
    let where = "WHERE delivered_at IS NULL AND next_attempt_at <= now()";
    if (opts?.tenantFilter) {
      params.push(opts.tenantFilter);
      where += ` AND tenant_id = $${params.length}`;
    }
    const { rows } = await c.query<OutboxEvent>(
      `SELECT id, tenant_id, event_type, loan_id, payload, attempts
         FROM va_event_outbox
        ${where}
        ORDER BY created_at ASC
        LIMIT $1`,
      params,
    );
    return rows;
  });

  for (const ev of events) {
    await dispatchOne(ev);
  }
  return events.length;
}

async function dispatchOne(ev: OutboxEvent): Promise<void> {
  let adapter: DocRequestAdapter;
  try {
    adapter = await getAdapterForTenant(ev.tenant_id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "adapter lookup failed";
    await markRetry(ev, msg);
    return;
  }

  try {
    await invokeAdapter(adapter, ev);
    await withDb(async (c) =>
      c.query(
        `UPDATE va_event_outbox
            SET delivered_at = now(),
                last_attempted_at = now(),
                attempts = attempts + 1,
                last_error = NULL
          WHERE id = $1`,
        [ev.id],
      ),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await markRetry(ev, msg);
  }
}

async function markRetry(ev: OutboxEvent, errorMsg: string): Promise<void> {
  const newAttempts = ev.attempts + 1;
  if (newAttempts >= BACKOFF_MINUTES.length + 1) {
    await withDb(async (c) =>
      c.query(
        `UPDATE va_event_outbox
            SET attempts = $1,
                last_attempted_at = now(),
                last_error = $2,
                next_attempt_at = 'infinity'
          WHERE id = $3`,
        [newAttempts, `dead_letter: ${errorMsg}`, ev.id],
      ),
    );
    console.warn(
      `[va-outbox] Event ${ev.id} dead-lettered after ${newAttempts} attempts: ${errorMsg}`,
    );
    return;
  }
  const minutes = BACKOFF_MINUTES[newAttempts - 1];
  await withDb(async (c) =>
    c.query(
      `UPDATE va_event_outbox
          SET attempts = $1,
              last_attempted_at = now(),
              last_error = $2,
              next_attempt_at = now() + ($3::text || ' minutes')::interval
        WHERE id = $4`,
      [newAttempts, errorMsg, String(minutes), ev.id],
    ),
  );
}

async function getAdapterForTenant(tenantId: string): Promise<DocRequestAdapter> {
  const rows = await withDb(async (c) => {
    const r = await c.query<{ adapter: DocRequestAdapter | null }>(
      "SELECT (settings->'va'->'docRequestAdapter') AS adapter FROM tenants WHERE id = $1",
      [tenantId],
    );
    return r.rows;
  });
  return rows[0]?.adapter ?? { kind: "ui-only" };
}

async function invokeAdapter(
  adapter: DocRequestAdapter,
  ev: OutboxEvent,
): Promise<void> {
  switch (adapter.kind) {
    case "ui-only":
      // No external delivery — event is visible in the in-app feed only.
      return;
    case "portal-webhook": {
      if (!adapter.url) throw new Error("portal-webhook missing url");
      const res = await fetch(adapter.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-uas-event": ev.event_type,
        },
        body: JSON.stringify({
          eventId: ev.id,
          tenantId: ev.tenant_id,
          loanId: ev.loan_id,
          payload: ev.payload,
        }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`webhook ${res.status}: ${body}`);
      }
      return;
    }
    case "npnqm-portal":
      // Placeholder — separate implementation spec. Throw so the dispatcher
      // retries with backoff until the real adapter lands.
      throw new Error("npnqm-portal adapter not implemented (separate spec)");
    default:
      throw new Error(
        `unknown adapter kind: ${(adapter as { kind: string }).kind}`,
      );
  }
}

// Exported for tests so they can drive a single batch deterministically
// without spinning up the worker loop.
export const __testing = {
  processBatch,
  dispatchOne,
  invokeAdapter,
  getAdapterForTenant,
};
