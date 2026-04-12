import { describe, expect, it } from "vitest";
import { scenarios, listScenarios } from "../src/index.js";

describe("fixture manifest", () => {
  it("contains all 20 expected scenarios", () => {
    const ids = Object.keys(scenarios).sort();
    expect(ids).toEqual([
      "nqm-1099-only",
      "nqm-asset-depletion",
      "nqm-bankstmt-12mo-clean",
      "nqm-bankstmt-24mo-business",
      "nqm-deny-candidate",
      "nqm-dscr-investor-purchase",
      "nqm-dscr-sub-1",
      "nqm-edge-comingled-funds",
      "nqm-edge-declining-income",
      "nqm-edge-gift-funds-nqm",
      "nqm-edge-large-deposit",
      "nqm-edge-nsf-compensating",
      "nqm-edge-property-flip",
      "nqm-edge-restricted-assets",
      "nqm-edge-short-lease-dscr",
      "nqm-foreign-national",
      "nqm-full-doc-recent-bk",
      "nqm-itin-bankstmt",
      "nqm-pnl-only-cpa",
      "nqm-suspend-candidate",
    ]);
  });

  it("every scenario has a unique loan id and at least one starter condition", () => {
    const loanIds = new Set<string>();
    for (const s of Object.values(scenarios)) {
      expect(loanIds.has(s.loan.id)).toBe(false);
      loanIds.add(s.loan.id);
      expect(s.loan.conditions.length).toBeGreaterThan(0);
    }
  });

  it("listScenarios returns 20 entries", () => {
    expect(listScenarios()).toHaveLength(20);
  });
});
