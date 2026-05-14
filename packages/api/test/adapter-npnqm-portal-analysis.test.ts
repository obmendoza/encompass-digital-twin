import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { NPNQMPortalAdapter } from "../src/ingestion/adapters/npnqm-portal.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "fixtures/portal-analysis");

function loadSample(loan: string): unknown {
  return JSON.parse(readFileSync(join(FIX, `${loan}_output.json`), "utf8"));
}

describe("NPNQMPortalAdapter.transformAnalysisOutput — real samples", () => {
  const adapter = new NPNQMPortalAdapter();
  const config = {
    allowedFetchHosts: ["docs.npnqm-portal.example.com"],
    maxFileBytes: 50_000_000,
    identityPrefix: "NPNQM-" as const,
  };

  it.each([
    ["aubrey", 17],
    ["montes", 17],
    ["niccum", 17],
    ["nyarko", 18],
    ["weingarten", 16],
  ])("transforms %s sample with %d predictions", (loan, expectedCount) => {
    const sample = loadSample(loan);
    const result = adapter.transformAnalysisOutput(sample, config);
    expect(result.portalPredictions.length).toBe(expectedCount);
    expect(result.loan.transaction?.loanAmount).toBeGreaterThan(0);
    expect(result.eligibilityVerdict.eligiblePrograms.length).toBeGreaterThan(0);
    expect(result.stats.totalDocumentRequests).toBe(expectedCount);
    expect(result.stats.elapsedSeconds).toBeGreaterThan(0);
    expect(result.stats.toolCalls).toBeGreaterThan(0);
  });

  it("aubrey: extracts FICO 800 and DSCR income type", () => {
    const result = adapter.transformAnalysisOutput(loadSample("aubrey"), config);
    expect(result.extras.repFico).toBe(800);
    expect(result.extras.primaryIncomeType).toBe("DSCR");
    // aubrey is in Sacramento County
    expect(result.extras.county).toBe("Sacramento");
  });

  it("aubrey: PortalPrediction shape carries spec'd fields", () => {
    const result = adapter.transformAnalysisOutput(loadSample("aubrey"), config);
    const cred = result.portalPredictions.find((p) => p.documentType === "Credit Report");
    expect(cred).toBeDefined();
    expect(cred!.documentCategory).toBe("Credit");
    expect(cred!.priority).toBe("P0");
    expect(cred!.severity).toBe("SOFT-STOP");
    expect(cred!.portalStatus).toBe("needed");
    expect(cred!.specifications.length).toBeGreaterThan(0);
    expect(cred!.reasonsNeeded.length).toBeGreaterThan(0);
  });

  it("eligibility verdict captures eligible + ineligible programs", () => {
    const result = adapter.transformAnalysisOutput(loadSample("aubrey"), config);
    expect(result.eligibilityVerdict.eligiblePrograms).toContain("Investor DSCR");
    expect(result.eligibilityVerdict.ineligiblePrograms.length).toBeGreaterThan(0);
    const dscr = result.eligibilityVerdict.perProgram.find((p) => p.program === "Investor DSCR");
    expect(dscr).toBeDefined();
    expect(dscr!.status).toBe("PASS");
  });

  it("occupancy 'NOO' is canonicalized to 'Investment'", () => {
    const result = adapter.transformAnalysisOutput(loadSample("aubrey"), config);
    expect(result.extras.occupancy).toBe("Investment");
  });

  it("loan purpose 'Delayed Financing' is canonicalized to 'Cash-Out Refinance'", () => {
    const result = adapter.transformAnalysisOutput(loadSample("aubrey"), config);
    expect(result.extras.loanPurpose).toBe("Cash-Out Refinance");
  });
});
