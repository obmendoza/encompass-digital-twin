import { withTenantTx } from "../db/pool.js";

/**
 * VA pattern candidate. Structurally compatible with `PatternCandidate` from
 * `pattern-detector.ts` so it can be passed directly to `persistPatterns`.
 */
export interface VAPatternCandidate {
  ruleName: string;
  program?: string;
  overrideReason?: string;
  metricsSnapshot: Record<string, unknown>;
}

// ── Window & sample thresholds ────────────────────────────────────
const WINDOW_DAYS = 30;
const MIN_SAMPLE = 5;

// Per-rule rate thresholds (fractions in [0, 1]). Starting points; tune via ops.
const VA_DISAGREE_RATE_THRESHOLD = 0.20;
const VA_CONTEST_RATE_THRESHOLD = 0.30;
const VA_REQUEST_DOCS_RATE_THRESHOLD = 0.35;
const VA_CONCUR_THEN_UW_OVERRIDE_THRESHOLD = 0.15;

/**
 * Detect VA-assist patterns over a 30-day window for a single tenant.
 *
 * Four patterns are computed:
 *   - va_disagree_rate            (any specialist signoff = 'disagree')
 *   - va_contest_rate             (any condition action = 'contest')
 *   - va_request_docs_rate        (verdict = 'request_docs')
 *   - va_concur_then_uw_override  (VA concurred but UW later overrode)
 *
 * Loans live as JSONB inside `world_state.loans` (per Task 1's architectural
 * correction); attempting to LATERAL-join that here under RLS is fragile in
 * tests. The first three patterns therefore emit `program=undefined` (rates
 * remain tenant-wide, which is the substantive signal). The fourth pattern
 * uses `decision_records.loan_program`, which is natively populated.
 */
export async function detectVAPatterns(
  tenantId: string,
): Promise<VAPatternCandidate[]> {
  const candidates: VAPatternCandidate[] = [];
  const windowStart = new Date(
    Date.now() - WINDOW_DAYS * 86_400_000,
  ).toISOString();

  await withTenantTx(tenantId, async (client) => {
    // ── va_disagree_rate ─────────────────────────────────────────
    // Tenant-wide % of reviews where at least one specialist signoff = 'disagree'.
    {
      const { rows } = await client.query<{ total: number; disagreed: number }>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM jsonb_array_elements(v.specialist_signoffs) s
                WHERE s->>'signoff' = 'disagree'
             )
           )::int AS disagreed
         FROM va_reviews v
         WHERE v.submitted_at >= $1`,
        [windowStart],
      );
      const r = rows[0];
      if (r && r.total >= MIN_SAMPLE) {
        const rate = r.total > 0 ? r.disagreed / r.total : 0;
        if (rate > VA_DISAGREE_RATE_THRESHOLD) {
          candidates.push({
            ruleName: "va_disagree_rate",
            metricsSnapshot: {
              total: r.total,
              disagreed: r.disagreed,
              rate,
              threshold: VA_DISAGREE_RATE_THRESHOLD,
            },
          });
        }
      }
    }

    // ── va_contest_rate ──────────────────────────────────────────
    // Tenant-wide % of reviews with at least one contested condition action.
    {
      const { rows } = await client.query<{ total: number; contested: number }>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (
             WHERE jsonb_array_length(v.condition_actions) > 0
               AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements(v.condition_actions) ca
                  WHERE ca->>'action' = 'contest'
               )
           )::int AS contested
         FROM va_reviews v
         WHERE v.submitted_at >= $1`,
        [windowStart],
      );
      const r = rows[0];
      if (r && r.total >= MIN_SAMPLE) {
        const rate = r.total > 0 ? r.contested / r.total : 0;
        if (rate > VA_CONTEST_RATE_THRESHOLD) {
          candidates.push({
            ruleName: "va_contest_rate",
            metricsSnapshot: {
              total: r.total,
              contested: r.contested,
              rate,
              threshold: VA_CONTEST_RATE_THRESHOLD,
            },
          });
        }
      }
    }

    // ── va_request_docs_rate ─────────────────────────────────────
    // Tenant-wide % of reviews ending in verdict='request_docs'.
    {
      const { rows } = await client.query<{ total: number; requested: number }>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE v.verdict = 'request_docs')::int AS requested
         FROM va_reviews v
         WHERE v.submitted_at >= $1`,
        [windowStart],
      );
      const r = rows[0];
      if (r && r.total >= MIN_SAMPLE) {
        const rate = r.total > 0 ? r.requested / r.total : 0;
        if (rate > VA_REQUEST_DOCS_RATE_THRESHOLD) {
          candidates.push({
            ruleName: "va_request_docs_rate",
            metricsSnapshot: {
              total: r.total,
              requested: r.requested,
              rate,
              threshold: VA_REQUEST_DOCS_RATE_THRESHOLD,
            },
          });
        }
      }
    }

    // ── va_concur_then_uw_override ───────────────────────────────
    // Loans where VA concurred AND a UW decision_record arrived after the
    // review with decision_type='overridden'. Signal: VA missed something
    // the UW caught. Joined directly on (tenant_id, loan_id); program comes
    // from decision_records.loan_program (natively populated).
    {
      const { rows } = await client.query<{
        program: string | null;
        total: number;
        overridden: number;
      }>(
        `SELECT
           d.loan_program AS program,
           COUNT(DISTINCT v.id)::int AS total,
           COUNT(DISTINCT v.id) FILTER (
             WHERE d.decision_type = 'overridden'
           )::int AS overridden
         FROM va_reviews v
         JOIN decision_records d
           ON d.tenant_id = v.tenant_id
          AND d.loan_id = v.loan_id
          AND d.decided_at > v.submitted_at
          AND d.decided_at < v.submitted_at + interval '30 days'
         WHERE v.tenant_id = current_setting('app.current_tenant', true)::uuid
           AND v.verdict = 'concur'
           AND v.submitted_at >= $1
         GROUP BY d.loan_program
         HAVING COUNT(DISTINCT v.id) >= $2`,
        [windowStart, MIN_SAMPLE],
      );
      for (const r of rows) {
        const rate = r.total > 0 ? r.overridden / r.total : 0;
        if (rate > VA_CONCUR_THEN_UW_OVERRIDE_THRESHOLD) {
          candidates.push({
            ruleName: "va_concur_then_uw_override",
            program: r.program ?? undefined,
            metricsSnapshot: {
              total: r.total,
              overridden: r.overridden,
              rate,
              threshold: VA_CONCUR_THEN_UW_OVERRIDE_THRESHOLD,
            },
          });
        }
      }
    }
  });

  return candidates;
}
