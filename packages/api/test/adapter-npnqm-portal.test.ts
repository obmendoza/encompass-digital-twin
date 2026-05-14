import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { NPNQMPortalAdapter } from "../src/ingestion/adapters/npnqm-portal.js";

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
