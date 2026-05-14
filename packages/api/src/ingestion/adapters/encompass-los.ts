import type { Loan, LoanContextExtras, AdapterConfig, NqmProgram, DocumentType } from "@twin/core";
import { LenderAdapter, type DocumentMetadataInput, type ValidationResult } from "../lender-adapter.js";

type Raw = Record<string, unknown>;

function pick<T>(obj: unknown, path: string): T | undefined {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Raw)) return (acc as Raw)[key];
    return undefined;
  }, obj) as T | undefined;
}

const DEFAULT_DOC_TYPE_MAP: Record<string, DocumentType> = {
  "PayStub": "PayStub", "Pay Stub": "PayStub", "W-2": "PayStub",
  "BankStatement": "BankStatement", "Bank Statement": "BankStatement",
  "TaxReturn": "TaxReturn", "Tax Return": "TaxReturn", "1040": "TaxReturn",
  "1099": "1099", "PnL": "PnL", "P&L": "PnL",
  "CPA_Letter": "CPA_Letter", "CPA Letter": "CPA_Letter",
  "ID": "ID", "Drivers License": "ID",
  "Insurance": "Insurance", "HOI": "Insurance",
  "Appraisal": "Appraisal",
  "Title": "Title",
  "LeaseAgreement": "LeaseAgreement", "Lease": "LeaseAgreement",
  "LOX": "LOX", "Letter of Explanation": "LOX",
  "BKDocs": "BKDocs",
  "CreditReport": "CreditReport", "Credit Report": "CreditReport",
};

export class EncompassLOSAdapter extends LenderAdapter {
  readonly adapterType = "encompass-los";

  extractExternalLoanId(raw: unknown): string {
    const id = pick<string>(raw, "loanNumber") ?? pick<string>(raw, "externalId");
    if (!id) throw new Error("encompass-los: payload missing loanNumber or externalId");
    return id;
  }

  transformLoan(raw: unknown, config: AdapterConfig): Partial<Loan> {
    const lender = pick<string>(raw, "programName");
    const program = (lender && config.programMapping?.[lender]) ?? lender ?? undefined;
    return {
      nqmProgram: program as NqmProgram | undefined,
      borrower: {
        fullName: pick<string>(raw, "borrower.fullName") ?? "Unknown",
        ssnMasked: pick<string>(raw, "borrower.ssnMasked") ?? "xxx-xx-0000",
        dob: pick<string>(raw, "borrower.dob") ?? "1990-01-01",
        maritalStatus: (pick<string>(raw, "borrower.maritalStatus") ?? "Unmarried") as never,
      },
      transaction: {
        loanPurpose: (pick<string>(raw, "transaction.loanPurpose") ?? "Purchase") as never,
        loanAmount: pick<number>(raw, "transaction.loanAmount") ?? 0,
        salesPrice: pick<number>(raw, "transaction.salesPrice") ?? 0,
        appraisedValue: pick<number>(raw, "transaction.appraisedValue") ?? 0,
        ltv: pick<number>(raw, "transaction.ltv") ?? 0,
        cltv: pick<number>(raw, "transaction.cltv") ?? 0,
        hcltv: pick<number>(raw, "transaction.hcltv") ?? 0,
        noteRate: pick<number>(raw, "transaction.noteRate") ?? 7,
        term: pick<number>(raw, "transaction.term") ?? 360,
        amortType: (pick<string>(raw, "transaction.amortType") ?? "Fixed") as never,
        lienPosition: (pick<number>(raw, "transaction.lienPosition") ?? 1) as 1 | 2,
        occupancy: (pick<string>(raw, "transaction.occupancy") ?? "Primary") as never,
        isInvestmentProperty: pick<boolean>(raw, "transaction.isInvestmentProperty") ?? false,
        piti: pick<number>(raw, "transaction.piti") ?? 0,
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
    const id =
      pick<string>(raw, "docId") ??
      pick<string>(raw, "documentId") ??
      pick<string>(raw, "externalDocId");
    if (!id) throw new Error("encompass-los: document payload missing docId/documentId/externalDocId");
    return id;
  }

  transformDocument(raw: unknown, config: AdapterConfig): DocumentMetadataInput {
    const classification =
      pick<string>(raw, "classification") ?? pick<string>(raw, "type") ?? "Other";
    const map = { ...DEFAULT_DOC_TYPE_MAP, ...(config.documentTypeMapping ?? {}) };
    const docType = (map[classification] ?? "Other") as DocumentType;
    return {
      externalDocId: this.extractExternalDocId(raw),
      docType,
      fileName:
        pick<string>(raw, "documentName") ??
        pick<string>(raw, "fileName") ??
        "unknown.bin",
      contentHash: pick<string>(raw, "contentHash"),
      fileSize: pick<number>(raw, "sizeBytes") ?? pick<number>(raw, "fileSize"),
      mimeType: pick<string>(raw, "mime") ?? pick<string>(raw, "mimeType"),
      sourceUrl: pick<string>(raw, "url") ?? pick<string>(raw, "sourceUrl") ?? "",
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
      repFico:
        pick<number>(raw, "credit.representativeScore") ??
        pick<number>(raw, "borrower.fico"),
      ltv: loan.transaction?.ltv,
      loanAmount: loan.transaction?.loanAmount,
      loanPurpose: this.normalizePurpose(loan.transaction?.loanPurpose),
      propertyType: pick<string>(raw, "property.propertyType"),
      dti:
        pick<number>(raw, "qualifying.totalDti") ??
        pick<number>(raw, "borrower.totalDti"),
      reservesMonths: pick<number>(raw, "assets.reservesMonths"),
      noteRate: loan.transaction?.noteRate,
      county: pick<string>(raw, "property.county"),
      isItin: pick<string>(raw, "borrower.taxpayerIdType") === "ITIN",
      llcOrLegalEntity:
        pick<string>(raw, "borrower.entityType") !== undefined &&
        pick<string>(raw, "borrower.entityType") !== "Individual",
    };
  }

  private normalizePurpose(p: string | undefined): LoanContextExtras["loanPurpose"] {
    if (p === "Purchase") return "Purchase";
    if (p === "Refi-CO") return "Cash-Out Refinance";
    if (p === "Refi-RT") return "Rate & Term Refinance";
    return undefined;
  }
}
