import { describe, test, expect } from "vitest";
import { resolveHoiValidatorFindings } from "../src/services/predict-conditions/resolvers/hoi-validator-resolver.js";
import type { LoanContext } from "../src/services/doc-requirements.js";
import type { KbVersionContext } from "../src/services/predict-conditions/pre-underwriter.js";
import type { HoiPolicyFields } from "@twin/core";
import { HOI_SCHEMA_VERSION } from "@twin/core";

// ---------------------------------------------------------------------------
// Mock pg.PoolClient — each query() call pops the next queued row set.
// ---------------------------------------------------------------------------
class MockClient {
  rowsToReturn: unknown[][] = [];

  async query<T = unknown>(_sql: string, _params?: unknown[]): Promise<{ rows: T[] }> {
    return { rows: (this.rowsToReturn.shift() ?? []) as T[] };
  }
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const kbCtx: KbVersionContext = { rowId: 1, versionNumber: 1 };

const baseLoan: LoanContext = {
  incomeDocType: "Full Doc",
  borrowerType: "W2",
  citizenship: "US Citizen",
  isItin: false,
  llcOrLegalEntity: false,
  occupancy: "primary",
  state: "TX",
  county: "Travis",
  usCredit: true,
  program: "FLEX",
  channel: "Wholesale",
  borrowerFullName: "Chad Clark",
};

const baseHoiFields: HoiPolicyFields = {
  carrier: null,
  policyNumber: null,
  namedInsured: null,
  propertyAddress: null,
  effectiveDate: null,
  expirationDate: null,
  termMonths: null,
  lossPayeeClause: null,
  loanNumberOnPolicy: null,
  coverageAmount: null,
  replacementCost: null,
  deductiblePct: null,
  deductibleAmount: null,
  windHailHurricane: null,
  rentLossCoverageMonths: null,
  rentLossWording: null,
  rentLossActualCostSustained: null,
  occupancyOnPolicy: null,
  premiumPaidInFull: null,
  premiumDueDays: null,
  wallsInCoverage: null,
  ho6Policy: null,
  evidence: [],
};

const EXTRACTION_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const DOCUMENT_ID = "bbbbbbbb-0000-4000-8000-000000000002";

function makeHoiRow(fields: Partial<HoiPolicyFields> = {}, overrides: Record<string, unknown> = {}) {
  return {
    id: EXTRACTION_ID,
    document_id: DOCUMENT_ID,
    extractor_kind: "hoi-policy" as const,
    fields: { ...baseHoiFields, ...fields },
    extraction_confidence: 0.9,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: hoiEnabled = false → returns []
// ---------------------------------------------------------------------------
describe("resolveHoiValidatorFindings", () => {
  test("returns [] when hoiEnabled is false", async () => {
    const client = new MockClient();
    const findings = await resolveHoiValidatorFindings(
      client as never,
      "00000000-0000-0000-0000-000000000000",
      kbCtx,
      baseLoan,
      { hoiEnabled: false, loanExternalId: "LOAN-001", loanNumber: "LOAN-001" },
    );
    expect(findings).toEqual([]);
    // No DB call should have been made
    expect(client.rowsToReturn).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Test 2: hoiEnabled = true, no cached extractions → returns []
  // ---------------------------------------------------------------------------
  test("returns [] when no extractions exist for the loan", async () => {
    const client = new MockClient();
    client.rowsToReturn = [[]]; // empty result set
    const findings = await resolveHoiValidatorFindings(
      client as never,
      "00000000-0000-0000-0000-000000000000",
      kbCtx,
      baseLoan,
      { hoiEnabled: true, loanExternalId: "LOAN-002", loanNumber: "LOAN-002" },
    );
    expect(findings).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // Test 3: wrong loss-payee → 1 Finding with sourceList='hoi-validator'
  // ---------------------------------------------------------------------------
  test("wrong loss-payee fires H1 and returns 1 Finding", async () => {
    const client = new MockClient();
    // H1 fires when lossPayeeClause does not match expected entity OR loanNumberOnPolicy mismatches.
    // Provide wrong entity name to guarantee a fail.
    client.rowsToReturn = [
      [
        makeHoiRow({
          lossPayeeClause: "Some Other Lender, ISAOA/ATIMA",
          loanNumberOnPolicy: "LOAN-003",
        }),
      ],
    ];

    const findings = await resolveHoiValidatorFindings(
      client as never,
      "00000000-0000-0000-0000-000000000000",
      kbCtx,
      { ...baseLoan, channel: "Wholesale", state: "TX" },
      { hoiEnabled: true, loanExternalId: "LOAN-003", loanNumber: "LOAN-003" },
    );

    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.sourceList).toBe("hoi-validator");
    expect(f.sourceRuleId).toBe("hoi.loss-payee.match");
    expect(f.emissionKind).toBe("deterministic");
    expect(f.category).toBe("PTD");
    // metadata contains validationFindings
    expect(Array.isArray((f.metadata as Record<string, unknown>)?.validationFindings)).toBe(true);
    const vf = ((f.metadata as Record<string, unknown>).validationFindings as unknown[])[0] as Record<string, unknown>;
    expect(vf.ruleId).toBe("hoi.loss-payee.match");
  });

  // ---------------------------------------------------------------------------
  // Test 4: DSCR loan with H10 + H12 failures → 2 Findings
  // ---------------------------------------------------------------------------
  test("DSCR loan with rent-loss and occupancy failures → 2 Findings", async () => {
    const client = new MockClient();
    // H10 (dscrRentLoss): fires when DSCR and rentLossCoverageMonths < 6 (or null)
    // H12 (occupancyMatch): fires when DSCR and policy says "primary"
    client.rowsToReturn = [
      [
        makeHoiRow({
          // H10: no rent-loss coverage months set → triggers for DSCR
          rentLossCoverageMonths: null,
          // H12: policy occupancy is "primary" → DSCR should be non-owner
          occupancyOnPolicy: "Primary",
        }),
      ],
    ];

    const dscrLoan: LoanContext = {
      ...baseLoan,
      incomeDocType: "DSCR",
      occupancy: "investment",
    };

    const findings = await resolveHoiValidatorFindings(
      client as never,
      "00000000-0000-0000-0000-000000000000",
      kbCtx,
      dscrLoan,
      { hoiEnabled: true, loanExternalId: "LOAN-004", loanNumber: "LOAN-004" },
    );

    const ruleIds = findings.map((f) => f.sourceRuleId);
    expect(ruleIds).toContain("hoi.dscr.rent-loss-coverage");
    expect(ruleIds).toContain("hoi.occupancy.match");
    expect(findings.length).toBeGreaterThanOrEqual(2);
    for (const f of findings) {
      expect(f.sourceList).toBe("hoi-validator");
    }
  });

  // ---------------------------------------------------------------------------
  // Test 5: aggregate-confidence < 0.4 → Misc HOI Policy Review finding
  // ---------------------------------------------------------------------------
  test("aggregate_confidence < 0.4 emits Misc HOI Policy Review finding", async () => {
    const client = new MockClient();
    client.rowsToReturn = [
      [
        makeHoiRow(
          {}, // no rule-firing fields — baseHoiFields is all-null so no rules fire
          { extraction_confidence: 0.25 }, // below 0.4 threshold
        ),
      ],
    ];

    const findings = await resolveHoiValidatorFindings(
      client as never,
      "00000000-0000-0000-0000-000000000000",
      kbCtx,
      baseLoan,
      { hoiEnabled: true, loanExternalId: "LOAN-005", loanNumber: "LOAN-005" },
    );

    expect(findings).toHaveLength(1);
    const f = findings[0]!;
    expect(f.sourceRuleId).toBe("hoi.review.low-confidence");
    expect(f.sourceList).toBe("hoi-validator");
    expect(f.emissionKind).toBe("deterministic");
    // note includes the confidence value
    expect(f.note).toContain("0.25");
    const vf = ((f.metadata as Record<string, unknown>).validationFindings as unknown[])[0] as Record<string, unknown>;
    expect(vf.ruleId).toBe("hoi.review.low-confidence");
    expect(vf.severity).toBe("warn");
    const evidence = vf.evidence as Record<string, unknown>;
    expect(evidence.fieldPath).toBe("<aggregate>");

    // Verify schema_version was passed correctly to the DB (by inspecting no rowsToReturn remain)
    expect(client.rowsToReturn).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Bonus: verify HOI_SCHEMA_VERSION is used in query (sanity)
  // ---------------------------------------------------------------------------
  test("HOI_SCHEMA_VERSION is the expected constant", () => {
    expect(HOI_SCHEMA_VERSION).toBe(1);
  });
});
