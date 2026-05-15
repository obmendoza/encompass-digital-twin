import { normalizeConditionDescription } from "@twin/core";

export interface DriftProgram {
  program: string;
  portalStatus: string;
  pcV2Status: string;
}

export function findDriftProgram(g: PredictionGroup, driftPrograms: DriftProgram[]): DriftProgram | null {
  const desc = g.displayDescription.toLowerCase();
  const tags = (g.portalRow?.portal_metadata?.tags ?? []).map((t) => t.toLowerCase());
  for (const dp of driftPrograms) {
    const programLower = dp.program.toLowerCase();
    if (desc.includes(programLower)) return dp;
    if (tags.some((t) => t.includes(programLower))) return dp;
  }
  return null;
}

export interface PortalMetadata {
  priority?: "P0" | "P1" | "P2";
  severity?: "HARD-STOP" | "SOFT-STOP";
  document_category?: "Credit" | "Cross-Cutting" | "Compliance" | "Income" | "Assets" | "Property" | "Title";
  document_type?: string;
  specifications?: string[];
  reasons_needed?: string[];
  source_references?: string[];
  tags?: string[];
  source_module?: string;
  applies_to?: string;
  portal_status?: string;
}

export interface Prediction {
  id: string;
  status: "pending" | "accepted" | "dismissed" | string;
  description: string;
  category: string;
  note: string | null;
  source_list: string;
  source_order: number;
  acted_by: string | null;
  acted_role: string | null;
  dismissal_reason: string | null;
  accepted_condition_id: string | null;
  portal_metadata: PortalMetadata | null;
  analysis_hash: string | null;
  superseded_at: string | null;
}

export interface PredictionGroup {
  normalizedKey: string;
  displayDescription: string;
  primarySource: "portal-llm" | "matrix" | "geographic" | "requirements" | "minimum" | "income";
  rows: Prediction[];
  portalRow?: Prediction;
  pcV2Rows: Prediction[];
  hasMultipleSources: boolean;
}

export function groupByNormalizedDescription(predictions: Prediction[]): PredictionGroup[] {
  const groups = new Map<string, Prediction[]>();
  for (const p of predictions) {
    if (p.status !== "pending") continue;
    const key = normalizeConditionDescription(p.description);
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  return Array.from(groups.entries())
    .map(([key, rows]) => {
      const portalRow = rows.find((r) => r.source_list === "portal-llm");
      const pcV2Rows = rows.filter((r) => r.source_list !== "portal-llm");
      return {
        normalizedKey: key,
        displayDescription: (portalRow ?? rows[0]!).description,
        primarySource: (portalRow?.source_list ?? rows[0]!.source_list) as PredictionGroup["primarySource"],
        rows,
        portalRow,
        pcV2Rows,
        hasMultipleSources: new Set(rows.map((r) => r.source_list)).size > 1,
      };
    })
    .sort((a, b) => priorityRank(a) - priorityRank(b));
}

export function priorityRank(g: PredictionGroup): number {
  const meta = g.portalRow?.portal_metadata;
  if (meta?.severity === "HARD-STOP") return 0;
  if (meta?.priority === "P0") return 1;
  if (meta?.priority === "P1") return 2;
  if (meta?.priority === "P2") return 3;
  return 4;
}
