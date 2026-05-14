import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { NPNQMPortalAdapter } from "../src/ingestion/adapters/npnqm-portal.js";
import { MissingExternalIdError } from "../src/ingestion/lender-adapter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "fixtures/adapters");

describe("NPNQMPortalAdapter", () => {
  const adapter = new NPNQMPortalAdapter();
  const config = {
    allowedFetchHosts: ["docs.npnqm-portal.example.com"],
    maxFileBytes: 50_000_000,
    identityPrefix: "NPNQM-" as const,
  };

  it("adapterType is npnqm-portal", () => {
    expect(adapter.adapterType).toBe("npnqm-portal");
  });

  it("transformLoan extracts a refinance loan from the portal sample", () => {
    const raw = JSON.parse(readFileSync(join(FIX, "npnqm-portal-sample-loan.json"), "utf8"));
    const partial = adapter.transformLoan(raw.loanData, config);
    expect(partial.transaction?.loanAmount).toBeGreaterThan(0);
    expect(partial.transaction?.loanPurpose).toMatch(/Refi-CO|Refi-RT|Purchase/);
  });

  it("extractExternalLoanId reads borrowerCaseId", () => {
    const raw = { borrowerCaseId: "NPNQM-CASE-001" };
    expect(adapter.extractExternalLoanId(raw)).toBe("NPNQM-CASE-001");
  });

  it("transformDocument extracts attachments[0]-style entries", () => {
    const raw = {
      attachmentId: "ATT-1",
      attachmentName: "BankStmt_Sept.pdf",
      attachmentType: "BankStatement",
      downloadUrl: "https://docs.npnqm-portal.example.com/abc",
      sizeBytes: 200000,
      mime: "application/pdf",
    };
    const meta = adapter.transformDocument(raw, config);
    expect(meta.externalDocId).toBe("ATT-1");
    expect(meta.docType).toBe("BankStatement");
  });

  it("validateDocument rejects http:// scheme", () => {
    expect(adapter.validateDocument({
      externalDocId: "x", docType: "Other", fileName: "f",
      sourceUrl: "http://docs.npnqm-portal.example.com/abc",
    } as never).valid).toBe(false);
  });

  it("deriveContextFields produces expected LoanContext extras from the fixture", () => {
    const raw = JSON.parse(readFileSync(join(FIX, "npnqm-portal-sample-loan.json"), "utf8"));
    const partial = adapter.transformLoan(raw.loanData, config);
    const loan = { ...partial, id: "NPNQM-1", tenantId: "t" } as never;
    const extras = adapter.deriveContextFields(loan, raw.loanData, config);
    // The fixture has fico=718, ltv≈70, county="Multnomah County", isItin=false, propertyType="SFR Det.", reservesMonths=6.
    expect(extras.repFico).toBe(718);
    expect(extras.county).toBe("Multnomah County");
    expect(extras.isItin).toBe(false);
  });
});

describe("NPNQMPortalAdapter — Spec 1.5 back-compat + error handling", () => {
  const adapter = new NPNQMPortalAdapter();
  const config = {
    allowedFetchHosts: ["docs.npnqm-portal.example.com"],
    maxFileBytes: 50_000_000,
    identityPrefix: "NPNQM-" as const,
  };

  it("transformLoan reads from scenario_summary when present (new shape)", () => {
    const raw = {
      scenario_summary: {
        loan_number: "NEW-SHAPE-1",
        program: "Investor DSCR",
        numbers: { loan_amount: 350000, LTV: 65, note_rate: 7.5 },
        borrowers: [{ name: "Test", ssn: "xxx-xx-1234", dob: "1980-01-01" }],
        property: { state: "WA", property_type: "SFR", county: "King" },
        occupancy: "NOO",
        purpose: "Purchase",
        loan_terms: { term_months: 360, amortization_type: "Fixed" },
      },
    };
    const partial = adapter.transformLoan(raw, config);
    expect(partial.transaction?.loanAmount).toBe(350000);
    expect(partial.borrower?.fullName).toBe("Test");
  });

  it("transformLoan falls back to top-level fields when scenario_summary is absent (old shape)", () => {
    const raw = {
      borrowerCaseId: "OLD-SHAPE-1",
      selectedProgram: "Flex Select",
      loanAmount: 500000,
      ltv: 80,
      borrower: { fullName: "Old", ssnMasked: "x", dob: "1980-01-01" },
    };
    const partial = adapter.transformLoan(raw, config);
    expect(partial.transaction?.loanAmount).toBe(500000);
  });

  it("extractExternalLoanId throws MissingExternalIdError when no identifier is present", () => {
    expect(() => adapter.extractExternalLoanId({})).toThrow(MissingExternalIdError);
  });

  it("extractExternalLoanId prefers scenario_summary.loan_number > borrowerCaseId > externalId", () => {
    expect(adapter.extractExternalLoanId({ scenario_summary: { loan_number: "NEW-1" }, borrowerCaseId: "OLD-1", externalId: "ENV-1" }))
      .toBe("NEW-1");
    expect(adapter.extractExternalLoanId({ borrowerCaseId: "OLD-2", externalId: "ENV-2" }))
      .toBe("OLD-2");
    expect(adapter.extractExternalLoanId({ externalId: "ENV-3" }))
      .toBe("ENV-3");
  });
});
