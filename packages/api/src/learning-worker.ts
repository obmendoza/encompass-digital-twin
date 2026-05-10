import { withDb } from "./db/pool.js";
import { withTenantTx } from "./db/pool.js";
import { detectPatterns, persistPatterns } from "./learning/pattern-detector.js";
import { detectVAPatterns } from "./learning/va-pattern-detector.js";
import { computeDailySnapshot, saveSnapshot } from "./learning/metrics-computer.js";
import { generateInsight } from "./learning/insight-generator.js";

// ── Janitor Constants ────────────────────────────────────────────
const STUCK_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour
const MAX_RETRIES = 3;

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

          // 2b. VA pattern detection — co-tenant pass on the same lock-43 cycle.
          // Wrapped in its own try/catch so VA errors don't poison the existing
          // decision-record patterns or downstream insight generation.
          try {
            const vaCandidates = await detectVAPatterns(tenant.id);
            if (vaCandidates.length > 0) {
              const newIds = await persistPatterns(tenant.id, vaCandidates);
              if (newIds.length > 0) {
                console.log(
                  `[learning] Tenant ${tenant.id}: ${newIds.length} new VA patterns detected`,
                );
              }
            }
          } catch (e) {
            console.error(
              `[learning] VA pattern detection failed for tenant ${tenant.id}:`,
              e,
            );
          }

          // 3. Insight generation for new patterns
          await processNewPatterns(tenant.id);

          // 4. Janitor: reset stuck patterns
          await janitorStuckPatterns(tenant.id);
        } catch (e) {
          console.error(`[learning] Error processing tenant ${tenant.id}:`, e);
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(43)");
    }
  });
}

// ── Insight Generation ───────────────────────────────────────────

async function processNewPatterns(tenantId: string): Promise<void> {
  // Find patterns with status 'new'
  const patterns = await withTenantTx(tenantId, async (client) => {
    const { rows } = await client.query(
      `SELECT id, rule_name, program, metrics_snapshot
       FROM detected_patterns
       WHERE tenant_id = $1 AND status = 'new'
       ORDER BY detected_at ASC
       LIMIT 10`,
      [tenantId],
    );
    return rows;
  });

  for (const pattern of patterns) {
    try {
      // Optimistic concurrency: acquire the pattern
      const acquired = await withTenantTx(tenantId, async (client) => {
        const { rows } = await client.query(
          `UPDATE detected_patterns
           SET status = 'analyzing', updated_at = NOW()
           WHERE id = $1 AND status = 'new'
           RETURNING id`,
          [pattern.id],
        );
        return rows.length > 0;
      });

      if (!acquired) continue;

      // Load the active guideline for this program
      const guidelineData = await withTenantTx(tenantId, async (client) => {
        const program = pattern.program || "default";
        const { rows } = await client.query(
          `SELECT rules FROM tenant_guidelines
           WHERE tenant_id = $1 AND program = $2 AND active = true
           ORDER BY version DESC LIMIT 1`,
          [tenantId, program],
        );
        return rows.length > 0 ? JSON.stringify(rows[0].rules) : "{}";
      });

      // Load sample overrides for this pattern
      const samples = await withTenantTx(tenantId, async (client) => {
        const { rows } = await client.query(
          `SELECT dr.loan_id AS id, dr.loan_program AS "loanProgram",
                  dr.agent_confidence AS confidence, dr.rationale,
                  dr.override_reason AS "overrideReason"
           FROM decision_records dr
           WHERE dr.tenant_id = $1
             AND dr.decision_type = 'overridden'
             AND ($2::text IS NULL OR dr.loan_program = $2)
           ORDER BY dr.decided_at DESC
           LIMIT 50`,
          [tenantId, pattern.program || null],
        );
        return rows;
      });

      const patternSummary = JSON.stringify({
        ruleName: pattern.rule_name,
        program: pattern.program,
        metricsSnapshot: pattern.metrics_snapshot,
      });

      const result = await generateInsight(
        tenantId,
        pattern.id,
        patternSummary,
        guidelineData,
        samples,
      );

      if (!result.success) {
        console.warn(
          `[learning] Insight generation failed for pattern ${pattern.id}: ${result.error}`,
        );
        // Revert to 'new' so janitor or retry can pick it up
        await withTenantTx(tenantId, async (client) => {
          await client.query(
            `UPDATE detected_patterns
             SET status = 'new', updated_at = NOW()
             WHERE id = $1`,
            [pattern.id],
          );
        });
      }
    } catch (e) {
      console.error(`[learning] Error generating insight for pattern ${pattern.id}:`, e);
    }
  }
}

// ── Janitor: Reset Stuck Patterns ────────────────────────────────

async function janitorStuckPatterns(tenantId: string): Promise<void> {
  await withTenantTx(tenantId, async (client) => {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();

    // Find patterns stuck in 'analyzing' for too long
    const { rows: stuck } = await client.query(
      `SELECT id, retry_count, status_history
       FROM detected_patterns
       WHERE tenant_id = $1
         AND status = 'analyzing'
         AND updated_at < $2`,
      [tenantId, cutoff],
    );

    for (const pattern of stuck) {
      const retryCount = (pattern.retry_count ?? 0) + 1;
      const statusHistory =
        (pattern.status_history as Array<Record<string, unknown>>) ?? [];

      if (retryCount >= MAX_RETRIES) {
        // Too many retries — mark as failed
        statusHistory.push({
          status: "analysis_failed",
          at: new Date().toISOString(),
          by: "system:janitor",
          reason: `Exceeded ${MAX_RETRIES} retries`,
        });

        await client.query(
          `UPDATE detected_patterns
           SET status = 'analysis_failed',
               retry_count = $1,
               status_history = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [retryCount, JSON.stringify(statusHistory), pattern.id],
        );

        console.warn(
          `[learning] Pattern ${pattern.id} failed after ${MAX_RETRIES} retries`,
        );
      } else {
        // Reset to 'new' for retry
        statusHistory.push({
          status: "new",
          at: new Date().toISOString(),
          by: "system:janitor",
          reason: `Reset from stuck analyzing (retry ${retryCount})`,
        });

        await client.query(
          `UPDATE detected_patterns
           SET status = 'new',
               retry_count = $1,
               status_history = $2,
               updated_at = NOW()
           WHERE id = $3`,
          [retryCount, JSON.stringify(statusHistory), pattern.id],
        );

        console.log(
          `[learning] Pattern ${pattern.id} reset to 'new' (retry ${retryCount}/${MAX_RETRIES})`,
        );
      }
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
