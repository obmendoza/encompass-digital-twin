import { describe, it, expect } from "vitest";
import { groupByNormalizedDescription, findDriftProgram, type Prediction, type PredictionGroup, type DriftProgram } from "@/lib/prediction-grouping";

function mkPrediction(p: Partial<Prediction> & { id: string; description: string; source_list: string }): Prediction {
  return {
    status: "pending",
    category: "PTA",
    note: null,
    source_order: 0,
    acted_by: null,
    acted_role: null,
    dismissal_reason: null,
    accepted_condition_id: null,
    portal_metadata: null,
    analysis_hash: null,
    superseded_at: null,
    ...p,
  };
}

describe("groupByNormalizedDescription", () => {
  it("groups portal-llm + matrix rows sharing the same normalized description", () => {
    const preds: Prediction[] = [
      mkPrediction({ id: "1", description: "Credit Report", source_list: "portal-llm" }),
      mkPrediction({ id: "2", description: "credit report", source_list: "matrix" }),
    ];
    const groups = groupByNormalizedDescription(preds);
    expect(groups.length).toBe(1);
    expect(groups[0]!.rows.length).toBe(2);
    expect(groups[0]!.portalRow?.id).toBe("1");
    expect(groups[0]!.pcV2Rows.map((r) => r.id)).toEqual(["2"]);
    expect(groups[0]!.hasMultipleSources).toBe(true);
  });

  it("single-source PC v2 group has hasMultipleSources=false and no portalRow", () => {
    const preds = [mkPrediction({ id: "1", description: "LTV exceeds tier", source_list: "matrix" })];
    const groups = groupByNormalizedDescription(preds);
    expect(groups.length).toBe(1);
    expect(groups[0]!.hasMultipleSources).toBe(false);
    expect(groups[0]!.portalRow).toBeUndefined();
    expect(groups[0]!.primarySource).toBe("matrix");
  });

  it("excludes accepted and dismissed rows from grouping", () => {
    const preds: Prediction[] = [
      mkPrediction({ id: "1", description: "Doc A", source_list: "portal-llm", status: "accepted" }),
      mkPrediction({ id: "2", description: "Doc B", source_list: "portal-llm", status: "dismissed" }),
      mkPrediction({ id: "3", description: "Doc C", source_list: "portal-llm", status: "pending" }),
    ];
    const groups = groupByNormalizedDescription(preds);
    expect(groups.length).toBe(1);
    expect(groups[0]!.rows[0]!.id).toBe("3");
  });

  it("portal description wins for displayDescription when both sources present", () => {
    const preds: Prediction[] = [
      mkPrediction({ id: "1", description: "Credit Report — full tri-merge required", source_list: "portal-llm" }),
      mkPrediction({ id: "2", description: "credit report", source_list: "matrix" }),
    ];
    const groups = groupByNormalizedDescription(preds);
    expect(groups[0]!.displayDescription).toBe("Credit Report — full tri-merge required");
  });

  it("sorts groups by priority: HARD-STOP, P0, P1, P2, PC-v2-only", () => {
    const preds: Prediction[] = [
      mkPrediction({ id: "p2", description: "P2 doc", source_list: "portal-llm", portal_metadata: { priority: "P2" } }),
      mkPrediction({ id: "hs", description: "Hard stop", source_list: "portal-llm", portal_metadata: { severity: "HARD-STOP" } }),
      mkPrediction({ id: "pc", description: "PC v2 only", source_list: "matrix" }),
      mkPrediction({ id: "p0", description: "P0 doc", source_list: "portal-llm", portal_metadata: { priority: "P0" } }),
      mkPrediction({ id: "p1", description: "P1 doc", source_list: "portal-llm", portal_metadata: { priority: "P1" } }),
    ];
    const groups = groupByNormalizedDescription(preds);
    expect(groups.map((g) => g.rows[0]!.id)).toEqual(["hs", "p0", "p1", "p2", "pc"]);
  });

  it("returns empty array when all predictions are accepted/dismissed", () => {
    const preds = [mkPrediction({ id: "1", description: "x", source_list: "portal-llm", status: "accepted" })];
    expect(groupByNormalizedDescription(preds)).toEqual([]);
  });

  it("collapses three sources into one group when descriptions normalize the same", () => {
    const preds: Prediction[] = [
      mkPrediction({ id: "1", description: "Income docs", source_list: "portal-llm" }),
      mkPrediction({ id: "2", description: "income docs", source_list: "income" }),
      mkPrediction({ id: "3", description: "INCOME DOCS", source_list: "requirements" }),
    ];
    const groups = groupByNormalizedDescription(preds);
    expect(groups.length).toBe(1);
    expect(groups[0]!.rows.length).toBe(3);
    expect(groups[0]!.pcV2Rows.length).toBe(2);
  });
});

function mkGroup(overrides: Partial<PredictionGroup> & { description?: string } = {}): PredictionGroup {
  const { description = "Credit Report", ...rest } = overrides;
  const row = mkPrediction({ id: "r1", description, source_list: "portal-llm" });
  return {
    normalizedKey: description.toLowerCase().replace(/\s+/g, ""),
    displayDescription: description,
    primarySource: "portal-llm",
    rows: [row],
    portalRow: row,
    pcV2Rows: [],
    hasMultipleSources: false,
    ...rest,
  };
}

describe("findDriftProgram", () => {
  const programs: DriftProgram[] = [
    { program: "Investor DSCR", portalStatus: "PASS", pcV2Status: "FAIL" },
    { program: "Bank Statement", portalStatus: "FAIL", pcV2Status: "PASS" },
  ];

  it("matches when program name appears in displayDescription", () => {
    const g = mkGroup({ description: "Investor DSCR — rental income analysis" });
    const result = findDriftProgram(g, programs);
    expect(result?.program).toBe("Investor DSCR");
  });

  it("matches via portal_metadata tags", () => {
    const row = mkPrediction({
      id: "r1",
      description: "Income Documentation",
      source_list: "portal-llm",
      portal_metadata: { tags: ["bank statement income", "self-employed"] },
    });
    const g: PredictionGroup = {
      normalizedKey: "incomedocumentation",
      displayDescription: "Income Documentation",
      primarySource: "portal-llm",
      rows: [row],
      portalRow: row,
      pcV2Rows: [],
      hasMultipleSources: false,
    };
    const result = findDriftProgram(g, programs);
    expect(result?.program).toBe("Bank Statement");
  });

  it("returns null when no program matches description or tags", () => {
    const g = mkGroup({ description: "Title Insurance" });
    expect(findDriftProgram(g, programs)).toBeNull();
  });

  it("returns null when portal_metadata is null (empty-tags edge case)", () => {
    const row = mkPrediction({ id: "r1", description: "Some doc", source_list: "portal-llm", portal_metadata: null });
    const g: PredictionGroup = {
      normalizedKey: "somedoc",
      displayDescription: "Some doc",
      primarySource: "portal-llm",
      rows: [row],
      portalRow: row,
      pcV2Rows: [],
      hasMultipleSources: false,
    };
    expect(findDriftProgram(g, programs)).toBeNull();
  });

  it("returns null when portal_metadata.tags is empty array", () => {
    const row = mkPrediction({ id: "r1", description: "Some doc", source_list: "portal-llm", portal_metadata: { tags: [] } });
    const g: PredictionGroup = {
      normalizedKey: "somedoc",
      displayDescription: "Some doc",
      primarySource: "portal-llm",
      rows: [row],
      portalRow: row,
      pcV2Rows: [],
      hasMultipleSources: false,
    };
    expect(findDriftProgram(g, programs)).toBeNull();
  });

  it("returns null for empty drift programs list", () => {
    const g = mkGroup({ description: "Investor DSCR — something" });
    expect(findDriftProgram(g, [])).toBeNull();
  });
});
