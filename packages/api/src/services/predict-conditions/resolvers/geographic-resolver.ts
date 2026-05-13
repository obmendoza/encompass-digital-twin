import type pg from "pg";
import type { LoanContext } from "../../doc-requirements.js";
import type { Finding, KbVersionContext } from "../pre-underwriter.js";

interface GeographicRestrictionRow {
  id: string;
  restriction: string;
  occupancy_affected: string | null;
  programs_affected: string[] | null;
  notes: string | null;
}

/**
 * Resolver: geographic_restrictions — state-level rules per spec §5.2.
 * Returns one Finding per applying row. A row "applies" when:
 *   - state matches (already covered by the WHERE clause), AND
 *   - programs_affected is null OR contains the loan's program, AND
 *   - occupancy_affected is null OR equals the loan's occupancy.
 *
 * No graceful-degradation guards: state, program, and occupancy are PC v1
 * LoanContext fields and always present.
 */
export async function resolveGeographicFindings(
  c: pg.PoolClient,
  tenantId: string,
  kbCtx: KbVersionContext,
  loan: LoanContext,
): Promise<Finding[]> {
  const { rows } = await c.query<GeographicRestrictionRow>(
    `SELECT id, restriction, occupancy_affected, programs_affected, notes
       FROM geographic_restrictions
      WHERE tenant_id = $1 AND kb_version = $2 AND state = $3`,
    [tenantId, kbCtx.versionNumber, loan.state],
  );

  const findings: Finding[] = [];
  for (const row of rows) {
    const programOk = row.programs_affected === null || row.programs_affected.includes(loan.program);
    const occupancyOk = row.occupancy_affected === null || row.occupancy_affected === loan.occupancy;
    if (!programOk || !occupancyOk) continue;
    findings.push({
      description: `${loan.state}-specific compliance documentation — ${row.restriction}`,
      note: row.notes,
      category: "PTF",
      sourceList: "geographic",
      sourceRuleTable: "geographic_restrictions",
      sourceRuleId: row.id,
      emissionKind: "deterministic",
    });
  }
  return findings;
}
