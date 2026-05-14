import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { EncompassLOSAdapter } from "../src/ingestion/adapters/encompass-los.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, "fixtures/adapters");

function loadFixture(name: string): { source: string; externalId: string; loanData: unknown } {
  return JSON.parse(readFileSync(join(FIX, name), "utf8"));
}

describe("EncompassLOSAdapter", () => {
  const adapter = new EncompassLOSAdapter();
  const config = {
    allowedFetchHosts: ["docs.encompass.example.com"],
    maxFileBytes: 50_000_000,
    identityPrefix: "ENC-" as const,
  };

  it("adapterType is encompass-los", () => {
    expect(adapter.adapterType).toBe("encompass-los");
  });

  it("transformLoan extracts top-level fields from the sample payload", () => {
    const raw = loadFixture("encompass-los-sample-loan.json");
    // Pass loanData directly (as the route would, after parsing the outer envelope).
    const partial = adapter.transformLoan(raw.loanData, config);
    expect(partial.transaction?.loanAmount).toBeGreaterThan(0);
    expect(partial.borrower?.fullName).toBeTruthy();
  });

  it("extractExternalLoanId returns the lender's loan number", () => {
    const raw = loadFixture("encompass-los-sample-loan.json");
    const id = adapter.extractExternalLoanId(raw.loanData);
    expect(id).toMatch(/.+/);
  });

  it("validateLoan rejects payload with no transaction block", () => {
    const r = adapter.validateLoan({} as never);
    expect(r.valid).toBe(false);
    expect(r.errors.join(" ")).toMatch(/transaction/i);
  });

  it("validateLoan accepts a complete payload", () => {
    const raw = loadFixture("encompass-los-sample-loan.json");
    const partial = adapter.transformLoan(raw.loanData, config);
    expect(adapter.validateLoan(partial).valid).toBe(true);
  });

  it("deriveContextFields populates F2-deferred fields from raw payload", () => {
    const raw = loadFixture("encompass-los-sample-loan.json");
    const partial = adapter.transformLoan(raw.loanData, config);
    const loan = { ...partial, id: "ENC-X", tenantId: "t" } as never;
    const extras = adapter.deriveContextFields(loan, raw.loanData, config);
    expect(typeof extras.repFico).toBe("number");
    expect(typeof extras.ltv).toBe("number");
    expect(typeof extras.loanAmount).toBe("number");
    expect(extras.county).toBe("King County");
  });

  it("programMapping translates lender program name to canonical", () => {
    const raw = loadFixture("encompass-los-program-mapping.json");
    const cfg = { ...config, programMapping: { FlexSelect_NPNQM: "Flex Select" } };
    const partial = adapter.transformLoan(raw.loanData, cfg);
    expect(partial.nqmProgram).toBe("Flex Select");
  });

  it("transformDocument extracts required fields", () => {
    const raw = {
      docId: "DOC-1", documentName: "Pay Stub.pdf", classification: "PayStub",
      url: "https://docs.encompass.example.com/secure/abc", sizeBytes: 12345, mime: "application/pdf",
    };
    const meta = adapter.transformDocument(raw, config);
    expect(meta.externalDocId).toBe("DOC-1");
    expect(meta.docType).toBe("PayStub");
    expect(meta.sourceUrl).toBe("https://docs.encompass.example.com/secure/abc");
  });

  it("validateDocument rejects http:// scheme", () => {
    expect(adapter.validateDocument({
      externalDocId: "x", docType: "Other", fileName: "f",
      sourceUrl: "http://docs.encompass.example.com/insecure",
    } as never).valid).toBe(false);
    expect(adapter.validateDocument({
      externalDocId: "x", docType: "Other", fileName: "f",
      sourceUrl: "https://attacker.example.com/file",
    } as never).valid).toBe(true);
    // host allowlist is enforced at the fetch-security layer, not here.
  });
});
