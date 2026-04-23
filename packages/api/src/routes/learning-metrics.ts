import type { FastifyInstance } from "fastify";
import { withTenantTx } from "../db/pool.js";
import { getTenantId, getTenantContext } from "../tenant-context.js";

export function registerLearningMetricsRoutes(app: FastifyInstance): void {
  // ── Alignment + calibration ─────────────────────────────────────
  app.get<{ Params: { tenantId: string }; Querystring: { window?: string } }>(
    "/metrics/:tenantId/alignment",
    async (req) => {
      const tenantId = getTenantId();
      const window = Math.min(Math.max(parseInt(req.query.window ?? "30", 10) || 30, 1), 90);
      const windowStart = new Date(Date.now() - window * 86_400_000).toISOString().slice(0, 10);
      const today = new Date().toISOString().slice(0, 10);

      return withTenantTx(tenantId, async (client) => {
        // Snapshots for completed days
        const { rows: snapshots } = await client.query(
          `SELECT snapshot_date, metrics
           FROM metrics_snapshots
           WHERE snapshot_date >= $1 AND snapshot_date < $2
           ORDER BY snapshot_date`,
          [windowStart, today],
        );

        // Live query for today
        const { rows: liveRows } = await client.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE decision_type = 'accepted')::int AS accepted,
             COUNT(*) FILTER (WHERE decision_type = 'overridden')::int AS overridden,
             COUNT(*) FILTER (WHERE decision_type = 'manual')::int AS manual
           FROM decision_records
           WHERE decided_at::date = $1::date`,
          [today],
        );
        const live = liveRows[0];
        const liveRate = live.total > 0 ? live.accepted / live.total : 0;

        // Aggregate for trend
        let totalAccepted = live.accepted;
        let totalDecisions = live.total;
        const dailyRates: Array<{ date: string; rate: number; total: number }> = [];

        for (const s of snapshots) {
          const m = s.metrics as { alignment: { accepted: number; total: number; alignmentRate: number } };
          totalAccepted += m.alignment.accepted;
          totalDecisions += m.alignment.total;
          dailyRates.push({
            date: s.snapshot_date,
            rate: m.alignment.alignmentRate,
            total: m.alignment.total,
          });
        }
        dailyRates.push({ date: today, rate: liveRate, total: live.total });

        // Calibration from today's live data
        const { rows: calRows } = await client.query(
          `SELECT agent_confidence, decision_type
           FROM decision_records
           WHERE decided_at::date = $1::date AND agent_confidence IS NOT NULL`,
          [today],
        );
        const bucketRanges: Array<[number, number, string]> = [
          [0, 0.2, "0-20"], [0.2, 0.4, "20-40"], [0.4, 0.6, "40-60"],
          [0.6, 0.8, "60-80"], [0.8, 1.01, "80-100"],
        ];
        const calibration = bucketRanges.map(([lo, hi, label]) => {
          const inBucket = calRows.filter((r) => {
            const c = Number(r.agent_confidence);
            return c >= lo && c < hi;
          });
          const count = inBucket.length;
          const acceptedCount = inBucket.filter((r) => r.decision_type === "accepted").length;
          return {
            bucket: label,
            confidence: count > 0 ? inBucket.reduce((s, r) => s + Number(r.agent_confidence), 0) / count : (lo + Math.min(hi, 1)) / 2,
            acceptanceRate: count > 0 ? acceptedCount / count : 0,
            count,
          };
        });

        return {
          window,
          overallRate: totalDecisions > 0 ? Math.round((totalAccepted / totalDecisions) * 10000) / 10000 : 0,
          totalDecisions,
          trend: dailyRates,
          todayLive: {
            total: live.total,
            accepted: live.accepted,
            overridden: live.overridden,
            manual: live.manual,
            rate: Math.round(liveRate * 10000) / 10000,
          },
          calibration,
        };
      });
    },
  );

  // ── Overrides breakdown ─────────────────────────────────────────
  app.get<{ Params: { tenantId: string }; Querystring: { window?: string } }>(
    "/metrics/:tenantId/overrides",
    async (req) => {
      const tenantId = getTenantId();
      const window = Math.min(Math.max(parseInt(req.query.window ?? "30", 10) || 30, 1), 90);
      const windowStart = new Date(Date.now() - window * 86_400_000).toISOString();

      return withTenantTx(tenantId, async (client) => {
        // By reason
        const { rows: reasonRows } = await client.query(
          `SELECT override_reason, COUNT(*)::int AS cnt
           FROM decision_records
           WHERE decided_at >= $1 AND decision_type = 'overridden' AND override_reason IS NOT NULL
           GROUP BY override_reason
           ORDER BY cnt DESC`,
          [windowStart],
        );
        const byReason: Record<string, number> = {};
        for (const r of reasonRows) {
          byReason[r.override_reason] = r.cnt;
        }

        // By program
        const { rows: progRows } = await client.query(
          `SELECT
             loan_program,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE decision_type = 'accepted')::int AS accepted,
             COUNT(*) FILTER (WHERE decision_type = 'overridden')::int AS overridden
           FROM decision_records
           WHERE decided_at >= $1
           GROUP BY loan_program
           ORDER BY total DESC`,
          [windowStart],
        );
        const byProgram: Record<string, { accepted: number; overridden: number; rate: number }> = {};
        for (const r of progRows) {
          byProgram[r.loan_program] = {
            accepted: r.accepted,
            overridden: r.overridden,
            rate: r.total > 0 ? Math.round((r.accepted / r.total) * 10000) / 10000 : 0,
          };
        }

        return { window, byReason, byProgram };
      });
    },
  );

  // ── Detected patterns + suggestions ─────────────────────────────
  app.get<{ Params: { tenantId: string } }>(
    "/metrics/:tenantId/patterns",
    async () => {
      const ctx = getTenantContext();
      const tenantId = ctx.tenantId;

      return withTenantTx(tenantId, async (client) => {
        const visibilityFilter = ctx.isSuperAdmin
          ? ""
          : "AND (ps.visibility = 'admin' OR ps.id IS NULL)";

        const { rows } = await client.query(
          `SELECT
             dp.id, dp.rule_name, dp.program, dp.override_reason,
             dp.metrics_snapshot, dp.status, dp.suppressed_until,
             dp.status_history, dp.detected_at, dp.updated_at,
             COALESCE(json_agg(
               json_build_object(
                 'id', ps.id,
                 'suggestionType', ps.suggestion_type,
                 'rootCause', ps.root_cause,
                 'specificChange', ps.specific_change,
                 'confidence', ps.confidence,
                 'riskAssessment', ps.risk_assessment,
                 'status', ps.status,
                 'visibility', ps.visibility,
                 'reviewedBy', ps.reviewed_by,
                 'complianceReviewedBy', ps.compliance_reviewed_by,
                 'expiresAt', ps.expires_at,
                 'createdAt', ps.created_at
               )
             ) FILTER (WHERE ps.id IS NOT NULL), '[]') AS suggestions
           FROM detected_patterns dp
           LEFT JOIN pattern_suggestions ps ON ps.pattern_id = dp.id ${visibilityFilter}
           WHERE dp.status NOT IN ('dismissed', 'applied')
           GROUP BY dp.id
           ORDER BY dp.detected_at DESC`,
        );

        return rows;
      });
    },
  );
}
