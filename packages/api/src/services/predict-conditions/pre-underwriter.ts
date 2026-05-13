// Pre-Underwriter orchestrator. Composes the doc-checklist resolver (PC v1)
// and the three new PC v2 resolvers (matrix, geographic, requirements),
// aggregates their findings, dedups by normalized description with a
// documented cross-resolver priority ladder, and returns the consolidated
// Finding[] for the service layer to emit as predicted_conditions rows.
//
// See spec docs/superpowers/specs/2026-05-14-pc-v2-pre-underwriter-design.md.

import type pg from "pg";
import { normalizeConditionDescription } from "@twin/core";
import type { LoanContext } from "../doc-requirements.js";
import { resolveMatrixFindings } from "./resolvers/matrix-resolver.js";
import { resolveGeographicFindings } from "./resolvers/geographic-resolver.js";

export interface KbVersionContext {
  /** kb_versions.id — used for predicted_conditions.kb_version_id FK. */
  readonly rowId: number;
  /** kb_versions.version — used for program_matrix_tiers.kb_version,
   *  program_requirements.kb_version, geographic_restrictions.kb_version lookups. */
  readonly versionNumber: number;
}

export interface Finding {
  description: string;
  note: string | null;
  category: "PTA" | "PTD" | "PTF" | "PTP";
  sourceList: "minimum" | "income" | "matrix" | "requirements" | "geographic";
  sourceRuleTable: "program_matrix_tiers" | "program_requirements" | "geographic_restrictions" | null;
  sourceRuleId: string | null;
  emissionKind: "deterministic" | "llm";
}

/**
 * Spec §5.4 priority ladder. Lower value = higher priority = survives
 * dedup. Within sourceList='requirements', Stage A (deterministic) is
 * processed before Stage B (llm) by the orchestrator so a deterministic
 * finding always wins over a semantically-similar LLM finding (R3).
 */
const PRIORITY: Record<Finding["sourceList"], number> = {
  minimum: 1,
  income: 2,
  matrix: 3,
  geographic: 4,
  requirements: 5,
};

/**
 * Within sourceList='requirements', deterministic findings come first
 * (sub-priority 0); LLM findings come last (sub-priority 1). For all
 * other sourceLists, all findings are deterministic so this doesn't
 * matter.
 */
function subPriority(f: Finding): number {
  if (f.sourceList === "requirements" && f.emissionKind === "llm") return 1;
  return 0;
}

/**
 * Dedup the merged findings from all resolvers. Processes in the
 * documented 6-step order; first insertion at a given normalized
 * description wins. Later findings with the same key are dropped with
 * console.warn for observability.
 *
 * The dedup key combines sourceList AND the normalized description so
 * the cross-resolver dedup (a finding in 'matrix' that normalizes to
 * the same description as one already accepted from 'minimum' loses
 * to minimum) works correctly. See the cross-key walk below.
 */
export function dedupFindings(findings: readonly Finding[]): Finding[] {
  // Build a stable processing order: by (priority, subPriority, original-index).
  // Then walk in order, inserting into a Map keyed by normalized description.
  // First insert wins (later inserts at the same key are dropped).
  const indexed = findings.map((f, idx) => ({ f, idx }));
  indexed.sort((a, b) => {
    const pa = PRIORITY[a.f.sourceList];
    const pb = PRIORITY[b.f.sourceList];
    if (pa !== pb) return pa - pb;
    const sa = subPriority(a.f);
    const sb = subPriority(b.f);
    if (sa !== sb) return sa - sb;
    return a.idx - b.idx;
  });

  const accepted: Finding[] = [];
  const acceptedKeys = new Set<string>();
  for (const { f } of indexed) {
    const key = normalizeConditionDescription(f.description);
    if (acceptedKeys.has(key)) {
      console.warn("[pre-underwriter] dedup dropped finding", {
        description: f.description,
        sourceList: f.sourceList,
        emissionKind: f.emissionKind,
      });
      continue;
    }
    acceptedKeys.add(key);
    accepted.push(f);
  }
  return accepted;
}

/**
 * Orchestrator. Takes the doc-checklist findings (PC v1 output, adapted
 * to Finding[] by the service layer) and appends matrix + geographic
 * findings (Phase B; requirements lands in Phase C/D). Returns the
 * deduped, priority-ordered Finding[] for the service layer to emit
 * as predicted_conditions rows.
 */
export async function runPreUnderwriter(
  c: pg.PoolClient,
  tenantId: string,
  kbCtx: KbVersionContext,
  docChecklistFindings: readonly Finding[],
  loan: LoanContext,
): Promise<Finding[]> {
  const matrixFindings = await resolveMatrixFindings(c, tenantId, kbCtx, loan);
  const geoFindings = await resolveGeographicFindings(c, tenantId, kbCtx, loan);
  return dedupFindings([
    ...docChecklistFindings,
    ...matrixFindings,
    ...geoFindings,
  ]);
}
