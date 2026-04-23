import { withTenantTx } from "../db/pool.js";
import type { DailyMetricsSnapshot, OverrideReasonCategory } from "@twin/core";

/**
 * Compute a daily metrics snapshot from decision_records for a single day.
 */
export async function computeDailySnapshot(
  tenantId: string,
  date: string,
): Promise<DailyMetricsSnapshot> {
  return withTenantTx(tenantId, async (client) => {
    const dayStart = `${date}T00:00:00Z`;
    const dayEnd = `${date}T23:59:59.999Z`;

    // ── Alignment counts ──────────────────────────────────────────
    const { rows: alignRows } = await client.query(
      `SELECT decision_type, COUNT(*)::int AS cnt
       FROM decision_records
       WHERE decided_at >= $1 AND decided_at < ($2::date + interval '1 day')
       GROUP BY decision_type`,
      [dayStart, date],
    );
    let accepted = 0, overridden = 0, manual = 0;
    for (const r of alignRows) {
      if (r.decision_type === "accepted") accepted = r.cnt;
      else if (r.decision_type === "overridden") overridden = r.cnt;
      else if (r.decision_type === "manual") manual = r.cnt;
    }
    const total = accepted + overridden + manual;
    const alignmentRate = total > 0 ? accepted / total : 0;

    // ── Overrides by reason ───────────────────────────────────────
    const { rows: reasonRows } = await client.query(
      `SELECT override_reason, COUNT(*)::int AS cnt
       FROM decision_records
       WHERE decided_at >= $1 AND decided_at < ($2::date + interval '1 day')
         AND override_reason IS NOT NULL
       GROUP BY override_reason`,
      [dayStart, date],
    );
    const overridesByReason: Record<string, number> = {};
    for (const r of reasonRows) {
      overridesByReason[r.override_reason] = r.cnt;
    }

    // ── Overrides by program ──────────────────────────────────────
    const { rows: progRows } = await client.query(
      `SELECT loan_program, COUNT(*)::int AS cnt
       FROM decision_records
       WHERE decided_at >= $1 AND decided_at < ($2::date + interval '1 day')
         AND decision_type = 'overridden'
       GROUP BY loan_program`,
      [dayStart, date],
    );
    const overridesByProgram: Record<string, number> = {};
    for (const r of progRows) {
      overridesByProgram[r.loan_program] = r.cnt;
    }

    // ── Calibration buckets ───────────────────────────────────────
    const bucketRanges: Array<[number, number]> = [
      [0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.0],
    ];
    const { rows: calRows } = await client.query(
      `SELECT
         agent_confidence,
         decision_type
       FROM decision_records
       WHERE decided_at >= $1 AND decided_at < ($2::date + interval '1 day')
         AND agent_confidence IS NOT NULL`,
      [dayStart, date],
    );
    const buckets = bucketRanges.map(([lo, hi]) => {
      const inBucket = calRows.filter((r) => {
        const c = Number(r.agent_confidence);
        return c >= lo && (hi === 1.0 ? c <= hi : c < hi);
      });
      const count = inBucket.length;
      const acceptedCount = inBucket.filter((r) => r.decision_type === "accepted").length;
      const predicted = count > 0
        ? inBucket.reduce((s, r) => s + Number(r.agent_confidence), 0) / count
        : (lo + hi) / 2;
      const actual = count > 0 ? acceptedCount / count : 0;
      return { range: [lo, hi] as [number, number], predicted, actual, count };
    });

    // Brier score
    let brierSum = 0;
    let brierCount = 0;
    for (const r of calRows) {
      const conf = Number(r.agent_confidence);
      const outcome = r.decision_type === "accepted" ? 1 : 0;
      brierSum += (conf - outcome) ** 2;
      brierCount++;
    }
    const brierScore = brierCount > 0 ? brierSum / brierCount : 0;

    // ── Throughput ────────────────────────────────────────────────
    const { rows: throughputRows } = await client.query(
      `SELECT
         COUNT(*)::int AS decided,
         COALESCE(AVG(decision_time_seconds), 0) AS avg_time,
         COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY decision_time_seconds), 0) AS p95_time
       FROM decision_records
       WHERE decided_at >= $1 AND decided_at < ($2::date + interval '1 day')`,
      [dayStart, date],
    );
    const tp = throughputRows[0];

    return {
      alignment: {
        total,
        accepted,
        overridden,
        manual,
        alignmentRate: Math.round(alignmentRate * 10000) / 10000,
      },
      overridesByReason: overridesByReason as Record<OverrideReasonCategory, number>,
      overridesByProgram,
      calibration: {
        brierScore: Math.round(brierScore * 10000) / 10000,
        buckets,
      },
      throughput: {
        loansDecided: tp.decided,
        avgDecisionTimeSeconds: Math.round(Number(tp.avg_time) * 100) / 100,
        p95DecisionTimeSeconds: Math.round(Number(tp.p95_time) * 100) / 100,
      },
      sla: {
        withinSla: 0,
        breached: 0,
        slaComplianceRate: 0,
      },
    } satisfies DailyMetricsSnapshot;
  });
}

/**
 * Upsert a daily metrics snapshot.
 */
export async function saveSnapshot(
  tenantId: string,
  date: string,
  metrics: DailyMetricsSnapshot,
): Promise<void> {
  await withTenantTx(tenantId, async (client) => {
    await client.query(
      `INSERT INTO metrics_snapshots (tenant_id, snapshot_date, metrics)
       VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, snapshot_date)
       DO UPDATE SET metrics = $3, created_at = NOW()`,
      [tenantId, date, JSON.stringify(metrics)],
    );
  });
}
