import { describe, it, expect } from "vitest";
import { groupByNormalizedDescription, type Prediction } from "@/lib/prediction-grouping";

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
