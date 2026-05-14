import type { Loan, LoanContextExtras, AdapterConfig, NqmProgram, DocumentType } from "@twin/core";
import { LenderAdapter, type DocumentMetadataInput, type ValidationResult } from "../lender-adapter.js";

type Raw = Record<string, unknown>;

function pick<T>(obj: unknown, path: string): T | undefined {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc && typeof acc === "object" && k in (acc as Raw)) return (acc as Raw)[k];
    return undefined;
  }, obj) as T | undefined;
}

export class NPNQMPortalAdapter extends LenderAdapter {
  readonly adapterType = "npnqm-portal";

  extractExternalLoanId(raw: unknown): string {
    const id = pick<string>(raw, "borrowerCaseId") ?? pick<string>(raw, "externalId");
    if (!id) throw new Error("npnqm-portal: payload missing borrowerCaseId");
    return id;
  }

  transformLoan(raw: unknown, config: AdapterConfig): Partial<Loan> {
    const lenderProgram = pick<string>(raw, "selectedProgram") ?? pick<string>(raw, "programName");
    const program = (lenderProgram && config.programMapping?.[lenderProgram]) ?? lenderProgram ?? undefined;
    return {
      nqmProgram: program as NqmProgram | undefined,
      borrower: {
        fullName: pick<string>(raw, "borrower.fullName") ?? pick<string>(raw, "primaryBorrower.name") ?? "Unknown",
        ssnMasked: pick<string>(raw, "borrower.ssnMasked") ?? "xxx-xx-0000",
        dob: pick<string>(raw, "borrower.dob") ?? "1990-01-01",
        maritalStatus: (pick<string>(raw, "borrower.maritalStatus") ?? "Unmarried") as never,
      },
      transaction: {
        loanPurpose: (pick<string>(raw, "loanPurpose") ?? "Purchase") as never,
        loanAmount: pick<number>(raw, "loanAmount") ?? 0,
        salesPrice: pick<number>(raw, "salesPrice") ?? 0,
        appraisedValue: pick<number>(raw, "appraisedValue") ?? 0,
        ltv: pick<number>(raw, "ltv") ?? 0,
        cltv: pick<number>(raw, "cltv") ?? pick<number>(raw, "ltv") ?? 0,
        hcltv: pick<number>(raw, "hcltv") ?? pick<number>(raw, "ltv") ?? 0,
        noteRate: pick<number>(raw, "noteRate") ?? 7,
        term: pick<number>(raw, "term") ?? 360,
        amortType: (pick<string>(raw, "amortType") ?? "Fixed") as never,
        lienPosition: 1 as 1 | 2,
        occupancy: (pick<string>(raw, "occupancy") ?? "Primary") as never,
        isInvestmentProperty: pick<string>(raw, "occupancy") === "Investment",
        piti: pick<number>(raw, "piti") ?? 0,
      },
    };
  }

  validateLoan(partial: Partial<Loan>): ValidationResult {
    const errors: string[] = [];
    if (!partial.transaction) errors.push("transaction block required");
    if (!partial.borrower) errors.push("borrower block required");
    return { valid: errors.length === 0, errors };
  }

  extractExternalDocId(raw: unknown): string {
    const id = pick<string>(raw, "attachmentId") ?? pick<string>(raw, "externalDocId") ?? pick<string>(raw, "docId");
    if (!id) throw new Error("npnqm-portal: document payload missing attachmentId");
    return id;
  }

  transformDocument(raw: unknown, config: AdapterConfig): DocumentMetadataInput {
    const classification = pick<string>(raw, "attachmentType") ?? pick<string>(raw, "type") ?? "Other";
    const map = config.documentTypeMapping ?? {};
    const docType = (map[classification] ?? (classification as DocumentType)) as DocumentType;
    return {
      externalDocId: this.extractExternalDocId(raw),
      docType,
      fileName: pick<string>(raw, "attachmentName") ?? "unknown.bin",
      contentHash: pick<string>(raw, "contentHash"),
      fileSize: pick<number>(raw, "sizeBytes") ?? pick<number>(raw, "fileSize"),
      mimeType: pick<string>(raw, "mime") ?? pick<string>(raw, "mimeType"),
      sourceUrl: pick<string>(raw, "downloadUrl") ?? pick<string>(raw, "url") ?? "",
      classification,
    };
  }

  validateDocument(meta: DocumentMetadataInput): ValidationResult {
    const errors: string[] = [];
    if (!meta.externalDocId) errors.push("externalDocId required");
    if (!meta.fileName) errors.push("fileName required");
    if (!meta.sourceUrl) errors.push("sourceUrl required");
    if (meta.sourceUrl && !meta.sourceUrl.startsWith("https://")) {
      errors.push("sourceUrl must use https:// scheme (SSRF defense)");
    }
    return { valid: errors.length === 0, errors };
  }

  deriveContextFields(loan: Loan, raw: unknown, _config: AdapterConfig): Partial<LoanContextExtras> {
    return {
      repFico: pick<number>(raw, "borrower.fico") ?? pick<number>(raw, "creditScore"),
      ltv: loan.transaction?.ltv,
      loanAmount: loan.transaction?.loanAmount,
      loanPurpose: this.normalizePurpose(loan.transaction?.loanPurpose),
      propertyType: pick<string>(raw, "propertyType"),
      dti: pick<number>(raw, "totalDti"),
      reservesMonths: pick<number>(raw, "reservesMonths"),
      noteRate: loan.transaction?.noteRate,
      county: pick<string>(raw, "propertyCounty") ?? pick<string>(raw, "property.county"),
      isItin: pick<boolean>(raw, "borrower.isItin") ?? false,
      llcOrLegalEntity: pick<string>(raw, "borrower.entityType") === "LLC",
    };
  }

  private normalizePurpose(p: string | undefined): LoanContextExtras["loanPurpose"] {
    if (p === "Purchase") return "Purchase";
    if (p === "Refi-CO") return "Cash-Out Refinance";
    if (p === "Refi-RT") return "Rate & Term Refinance";
    return undefined;
  }
}
