import { withDb } from "./db/pool.js";
import { detectPatterns, persistPatterns } from "./learning/pattern-detector.js";
import { computeDailySnapshot, saveSnapshot } from "./learning/metrics-computer.js";

export async function runLearningCycle(): Promise<void> {
  await withDb(async (client) => {
    const { rows } = await client.query("SELECT pg_try_advisory_lock(43) AS acquired");
    if (!rows[0].acquired) return;

    try {
      const { rows: tenants } = await client.query(
        "SELECT id FROM tenants WHERE status = 'active' AND deleted_at IS NULL"
      );

      for (const tenant of tenants) {
        try {
          // 1. Compute yesterday's metrics snapshot
          const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
          const snapshot = await computeDailySnapshot(tenant.id, yesterday);
          await saveSnapshot(tenant.id, yesterday, snapshot);

          // 2. Run pattern detection
          const candidates = await detectPatterns(tenant.id);
          if (candidates.length > 0) {
            const newIds = await persistPatterns(tenant.id, candidates);
            if (newIds.length > 0) {
              console.log(`[learning] Tenant ${tenant.id}: ${newIds.length} new patterns detected`);
            }
          }
        } catch (e) {
          console.error(`[learning] Error processing tenant ${tenant.id}:`, e);
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(43)");
    }
  });
}

let learningInterval: ReturnType<typeof setInterval> | null = null;

export function startLearningWorker(): void {
  if (learningInterval) return;
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  learningInterval = setInterval(() => {
    runLearningCycle().catch((e) => console.error("[learning] Cycle error:", e));
  }, SIX_HOURS);
  setTimeout(() => {
    runLearningCycle().catch((e) => console.error("[learning] Initial cycle error:", e));
  }, 30_000);
  console.log("[learning] Worker started (6h interval, advisory-lock 43)");
}

export function stopLearningWorker(): void {
  if (learningInterval) { clearInterval(learningInterval); learningInterval = null; }
}
