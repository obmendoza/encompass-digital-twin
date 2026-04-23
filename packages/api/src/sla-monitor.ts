import { withDb } from "./db/pool.js";
import { publishEvent } from "./event-bus.js";
import { randomUUID } from "node:crypto";
import type { StoreEvent } from "@twin/core";

export async function runSlaMonitor(): Promise<void> {
  await withDb(async (client) => {
    const { rows } = await client.query("SELECT pg_try_advisory_lock(42) AS acquired");
    if (!rows[0].acquired) return;

    try {
      const { rows: tenants } = await client.query(
        "SELECT id, settings FROM tenants WHERE status = 'active' AND deleted_at IS NULL"
      );
      for (const tenant of tenants) {
        await checkTenantSla(tenant.id, tenant.settings, client);
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(42)");
    }
  });
}

async function checkTenantSla(
  tenantId: string,
  settings: Record<string, unknown>,
  client: import("pg").PoolClient
): Promise<void> {
  const sla = (settings as { sla?: Record<string, number> }).sla;
  if (!sla) return;

  const now = Date.now();
  await client.query("SET LOCAL app.current_tenant = $1", [tenantId]);

  const { rows } = await client.query(
    "SELECT id, loans FROM world_state WHERE tenant_id = $1", [tenantId]
  );
  if (rows.length === 0) return;

  const loans = rows[0].loans as Record<string, { id: string; assignment?: { status: string; assignedAt: string } }>;

  for (const [loanId, loan] of Object.entries(loans)) {
    if (!loan.assignment) continue;
    const { status, assignedAt } = loan.assignment;
    const elapsedMinutes = (now - new Date(assignedAt).getTime()) / 60_000;

    let maxMinutes: number | undefined;
    let stage = "";

    switch (status) {
      case "queued": maxMinutes = sla.maxQueueTimeMinutes; stage = "queue"; break;
      case "in_progress": maxMinutes = sla.maxProcessingTimeMinutes; stage = "processing"; break;
      case "under_review": maxMinutes = sla.maxReviewTimeMinutes; stage = "review"; break;
    }
    if (!maxMinutes) continue;

    const pct = elapsedMinutes / maxMinutes;

    if (pct >= 1.0) {
      const event: StoreEvent = {
        id: randomUUID(), tenantId, loanId, type: "sla.breached",
        payload: { stage, elapsedMinutes: Math.round(elapsedMinutes), maxMinutes },
        timestamp: new Date().toISOString(),
      };
      await publishEvent(event);
    } else if (pct >= 0.75) {
      const event: StoreEvent = {
        id: randomUUID(), tenantId, loanId, type: "sla.warning",
        payload: { stage, elapsedMinutes: Math.round(elapsedMinutes), maxMinutes, pct: Math.round(pct * 100) },
        timestamp: new Date().toISOString(),
      };
      await publishEvent(event);
    }
  }
}

let monitorInterval: ReturnType<typeof setInterval> | null = null;

export function startSlaMonitor(): void {
  if (monitorInterval) return;
  monitorInterval = setInterval(() => {
    runSlaMonitor().catch((e) => console.error("[sla-monitor] Error:", e));
  }, 60_000);
  runSlaMonitor().catch((e) => console.error("[sla-monitor] Initial run error:", e));
  console.log("[sla-monitor] Started (60s interval, advisory-lock guarded)");
}

export function stopSlaMonitor(): void {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
}
