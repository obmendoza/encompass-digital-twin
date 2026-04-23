import { randomUUID } from "node:crypto";
import { withTenantTx } from "../db/pool.js";
import { publishEvent } from "../event-bus.js";
import { DETECTION_RULES } from "@twin/core";
import type { StoreEvent } from "@twin/core";

export interface PatternCandidate {
  ruleName: string;
  program?: string;
  overrideReason?: string;
  metricsSnapshot: Record<string, unknown>;
}

// ── Detection ─────────────────────────────────────────────────────

export async function detectPatterns(tenantId: string): Promise<PatternCandidate[]> {
  const candidates: PatternCandidate[] = [];

  await withTenantTx(tenantId, async (client) => {
    const now = new Date();

    // ── high_override_rate ───────────────────────────────────────
    {
      const rule = DETECTION_RULES.high_override_rate;
      const windowStart = new Date(now.getTime() - rule.windowDays * 86_400_000).toISOString();
      const { rows } = await client.query(
        `SELECT
           loan_program,
           override_reason,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE decision_type = 'overridden')::int AS overridden
         FROM decision_records
         WHERE decided_at >= $1
         GROUP BY loan_program, override_reason
         HAVING COUNT(*) FILTER (WHERE decision_type = 'overridden') >= $2`,
        [windowStart, rule.minSample],
      );
      for (const r of rows) {
        const rate = r.overridden / r.total;
        if (rate > rule.threshold) {
          candidates.push({
            ruleName: "high_override_rate",
            program: r.loan_program,
            overrideReason: r.override_reason ?? undefined,
            metricsSnapshot: { total: r.total, overridden: r.overridden, rate },
          });
        }
      }
    }

    // ── reason_concentration (systematic_category equiv) ─────────
    {
      const rule = DETECTION_RULES.reason_concentration;
      const windowStart = new Date(now.getTime() - rule.windowDays * 86_400_000).toISOString();
      const { rows } = await client.query(
        `SELECT
           override_reason,
           COUNT(*)::int AS reason_count,
           (SELECT COUNT(*)::int FROM decision_records
            WHERE decided_at >= $1 AND decision_type = 'overridden') AS total_overrides
         FROM decision_records
         WHERE decided_at >= $1 AND decision_type = 'overridden' AND override_reason IS NOT NULL
         GROUP BY override_reason
         HAVING COUNT(*) >= $2`,
        [windowStart, rule.minSample],
      );
      for (const r of rows) {
        if (r.total_overrides === 0) continue;
        const concentration = r.reason_count / r.total_overrides;
        if (concentration > rule.threshold) {
          candidates.push({
            ruleName: "reason_concentration",
            overrideReason: r.override_reason,
            metricsSnapshot: {
              reason: r.override_reason,
              reasonCount: r.reason_count,
              totalOverrides: r.total_overrides,
              concentration,
            },
          });
        }
      }
    }

    // ── confidence_drift (miscalibration equiv) ──────────────────
    {
      const rule = DETECTION_RULES.confidence_drift;
      const windowStart = new Date(now.getTime() - rule.windowDays * 86_400_000).toISOString();
      const bucketRanges: Array<[number, number, string]> = [
        [0, 0.2, "0-20"],
        [0.2, 0.4, "20-40"],
        [0.4, 0.6, "40-60"],
        [0.6, 0.8, "60-80"],
        [0.8, 1.01, "80-100"],
      ];
      for (const [lo, hi, label] of bucketRanges) {
        const { rows } = await client.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE decision_type = 'accepted')::int AS accepted_count
           FROM decision_records
           WHERE decided_at >= $1
             AND agent_confidence >= $2
             AND agent_confidence < $3`,
          [windowStart, lo, hi],
        );
        const r = rows[0];
        if (r.total >= rule.minSample) {
          const acceptanceRate = r.accepted_count / r.total;
          const midpoint = (lo + Math.min(hi, 1.0)) / 2;
          const drift = Math.abs(acceptanceRate - midpoint);
          if (drift > rule.threshold) {
            candidates.push({
              ruleName: "confidence_drift",
              metricsSnapshot: {
                bucket: label,
                acceptanceRate,
                expectedRate: midpoint,
                drift,
                count: r.total,
              },
            });
          }
        }
      }
    }

    // ── program_outlier (declining alignment equiv) ──────────────
    {
      const rule = DETECTION_RULES.program_outlier;
      const windowStart = new Date(now.getTime() - rule.windowDays * 86_400_000).toISOString();
      const { rows } = await client.query(
        `SELECT
           loan_program,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE decision_type = 'accepted')::int AS accepted,
           COUNT(*) FILTER (WHERE decision_type = 'overridden')::int AS overridden
         FROM decision_records
         WHERE decided_at >= $1
         GROUP BY loan_program
         HAVING COUNT(*) >= $2`,
        [windowStart, rule.minSample],
      );
      // Calculate overall alignment
      const overallTotal = rows.reduce((s, r) => s + r.total, 0);
      const overallAccepted = rows.reduce((s, r) => s + r.accepted, 0);
      const overallRate = overallTotal > 0 ? overallAccepted / overallTotal : 0;

      for (const r of rows) {
        const programRate = r.accepted / r.total;
        const deviation = overallRate - programRate;
        if (deviation > rule.threshold) {
          candidates.push({
            ruleName: "program_outlier",
            program: r.loan_program,
            metricsSnapshot: {
              programRate,
              overallRate,
              deviation,
              total: r.total,
              accepted: r.accepted,
              overridden: r.overridden,
            },
          });
        }
      }
    }
  });

  return candidates;
}

// ── Persistence ───────────────────────────────────────────────────

export async function persistPatterns(
  tenantId: string,
  candidates: PatternCandidate[],
): Promise<string[]> {
  const newIds: string[] = [];

  await withTenantTx(tenantId, async (client) => {
    for (const candidate of candidates) {
      // Check for existing active pattern with same (rule, program, reason)
      const { rows: existing } = await client.query(
        `SELECT id, status, suppressed_until
         FROM detected_patterns
         WHERE tenant_id = $1
           AND rule_name = $2
           AND COALESCE(program, '') = COALESCE($3, '')
           AND COALESCE(override_reason, '') = COALESCE($4, '')
           AND status NOT IN ('dismissed', 'applied')`,
        [tenantId, candidate.ruleName, candidate.program ?? null, candidate.overrideReason ?? null],
      );

      if (existing.length > 0) {
        const pattern = existing[0];
        // Respect suppression cooldown
        if (pattern.suppressed_until && new Date(pattern.suppressed_until) > new Date()) {
          continue;
        }
        // Update existing pattern's metrics snapshot
        await client.query(
          `UPDATE detected_patterns
           SET metrics_snapshot = $1, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(candidate.metricsSnapshot), pattern.id],
        );
        continue;
      }

      // Check suppression cooldown on dismissed patterns
      const { rows: dismissed } = await client.query(
        `SELECT id, suppressed_until
         FROM detected_patterns
         WHERE tenant_id = $1
           AND rule_name = $2
           AND COALESCE(program, '') = COALESCE($3, '')
           AND COALESCE(override_reason, '') = COALESCE($4, '')
           AND status = 'dismissed'
           AND suppressed_until > NOW()
         LIMIT 1`,
        [tenantId, candidate.ruleName, candidate.program ?? null, candidate.overrideReason ?? null],
      );
      if (dismissed.length > 0) continue;

      // Create new pattern
      const id = randomUUID();
      const statusHistory = [{ status: "new", at: new Date().toISOString() }];
      await client.query(
        `INSERT INTO detected_patterns
           (id, tenant_id, rule_name, program, override_reason, metrics_snapshot, status, status_history)
         VALUES ($1, $2, $3, $4, $5, $6, 'new', $7)`,
        [
          id,
          tenantId,
          candidate.ruleName,
          candidate.program ?? null,
          candidate.overrideReason ?? null,
          JSON.stringify(candidate.metricsSnapshot),
          JSON.stringify(statusHistory),
        ],
      );
      newIds.push(id);

      // Publish event
      const event: StoreEvent = {
        id: randomUUID(),
        tenantId,
        loanId: "",
        type: "pattern.detected",
        payload: {
          patternId: id,
          ruleName: candidate.ruleName,
          program: candidate.program,
        },
        timestamp: new Date().toISOString(),
      };
      await publishEvent(event);
    }
  });

  return newIds;
}
