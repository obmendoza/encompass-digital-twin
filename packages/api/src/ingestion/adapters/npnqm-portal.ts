import type { Loan, LoanContextExtras, AdapterConfig, NqmProgram, DocumentType } from "@twin/core";
import {
  LenderAdapter,
  MissingExternalIdError,
  type DocumentMetadataInput,
  type ValidationResult,
  type PortalPrediction,
  type PortalDocCategory,
  type EligibilityVerdict,
  type PortalAnalysisStats,
  type TransformAnalysisOutput,
} from "../lender-adapter.js";

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
    const r = raw as Record<string, unknown>;
    const scenario = r.scenario_summary as Record<string, unknown> | undefined;
    const fromScenario = scenario?.loan_number as string | undefined;
    const fromCase = r.borrowerCaseId as string | undefined;
    const fromEnvelope = r.externalId as string | undefined;
    const id = fromScenario || fromCase || fromEnvelope;
    if (!id) {
      throw new MissingExternalIdError(
        `npnqm-portal: payload missing scenario_summary.loan_number, borrowerCaseId, and externalId`,
      );
    }
    return id;
  }

  transformLoan(raw: unknown, config: AdapterConfig): Partial<Loan> {
    const r = raw as Record<string, unknown>;
    const scenario = r.scenario_summary as Record<string, unknown> | undefined;
    if (scenario) return this.scenarioToLoan(scenario, config);
    return this.legacyTopLevelToLoan(r, config);
  }

  private legacyTopLevelToLoan(raw: Record<string, unknown>, config: AdapterConfig): Partial<Loan> {
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
    const r = raw as Record<string, unknown>;
    const scenario = r.scenario_summary as Record<string, unknown> | undefined;
    if (scenario) return this.scenarioToExtras(scenario);
    return this.legacyTopLevelToExtras(loan, r);
  }

  private legacyTopLevelToExtras(loan: Loan, raw: Record<string, unknown>): Partial<LoanContextExtras> {
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

  // ─── Spec 1.5: analysis-output channel ────────────────────────────────────

  transformAnalysisOutput(raw: unknown, config: AdapterConfig): TransformAnalysisOutput {
    const r = raw as Raw;
    const ao = (r.analysisOutput ?? r) as Raw;
    const scenario = (ao.scenario_summary ?? {}) as Raw;
    const docRequests = (ao.document_requests ?? []) as Array<Raw>;
    const stats = (ao.stats ?? {}) as Raw;
    const seenConflicts = (ao.seen_conflicts ?? []) as string[];

    const loan = this.scenarioToLoan(scenario, config);
    const extras = this.scenarioToExtras(scenario);
    const portalPredictions = docRequests.map((dr) => this.docRequestToPortalPrediction(dr));
    const eligibilityVerdict = this.scenarioToEligibilityVerdict(scenario);
    const statsTyped: PortalAnalysisStats = {
      totalDocumentRequests: (stats.total_document_requests as number) ?? 0,
      hardStopDocuments: (stats.hard_stop_documents as number) ?? 0,
      elapsedSeconds: (stats.elapsed_seconds as number) ?? 0,
      toolCalls: (stats.tool_calls as number) ?? 0,
      byCategory: (stats.by_category ?? {}) as Record<string, number>,
      byPriority: (stats.by_priority ?? {}) as Record<string, number>,
      byStatus: (stats.by_status ?? {}) as Record<string, number>,
    };
    return { loan, extras, portalPredictions, eligibilityVerdict, seenConflicts, stats: statsTyped };
  }

  private scenarioToLoan(scenario: Raw, config: AdapterConfig): Partial<Loan> {
    const lenderProgram = scenario.program as string | undefined;
    const program = (lenderProgram && config.programMapping?.[lenderProgram]) ?? lenderProgram ?? undefined;
    const property = (scenario.property ?? {}) as Raw;
    const numbers = (scenario.numbers ?? {}) as Raw;
    const loanTerms = (scenario.loan_terms ?? {}) as Raw;
    const borrowers = (scenario.borrowers ?? []) as Array<Raw>;
    const primary = borrowers[0] ?? {};
    return {
      nqmProgram: program as NqmProgram | undefined,
      borrower: {
        fullName: (primary.name as string) ?? "Unknown",
        ssnMasked: (primary.ssn as string) ?? "xxx-xx-0000",
        dob: (primary.dob as string) ?? "1990-01-01",
        maritalStatus: "Unmarried",
      },
      transaction: {
        loanPurpose: (this.canonicalizeLoanPurpose(scenario.purpose as string | undefined) ?? "Purchase") as never,
        loanAmount: (numbers.loan_amount as number) ?? 0,
        salesPrice: (numbers.purchase_price as number) ?? 0,
        appraisedValue: (numbers.appraised_value as number) ?? 0,
        ltv: (numbers.LTV as number) ?? 0,
        cltv: (numbers.CLTV as number) ?? 0,
        hcltv: (numbers.CLTV as number) ?? 0,
        noteRate: (numbers.note_rate as number) ?? 7,
        term: (loanTerms.term_months as number) ?? 360,
        amortType: ((loanTerms.amortization_type as string) === "Fixed" ? "Fixed" : "ARM") as never,
        lienPosition: 1 as 1 | 2,
        occupancy: (this.canonicalizeOccupancy(scenario.occupancy as string | undefined) ?? "Primary") as never,
        isInvestmentProperty: this.canonicalizeOccupancy(scenario.occupancy as string | undefined) === "Investment",
        piti: 0,
      },
    };
  }

  private scenarioToExtras(scenario: Raw): Partial<LoanContextExtras> {
    const numbers = (scenario.numbers ?? {}) as Raw;
    const credit = (scenario.credit ?? {}) as Raw;
    const property = (scenario.property ?? {}) as Raw;
    const loanTerms = (scenario.loan_terms ?? {}) as Raw;
    const borrowers = (scenario.borrowers ?? []) as Array<Raw>;
    const primary = borrowers[0] ?? {};
    const assetProfile = (scenario.asset_profile ?? {}) as Raw;
    const reoSummary = (scenario.reo_summary ?? {}) as Raw;
    const incomeProfile = (scenario.income_profile ?? {}) as Raw;
    const declarations = (credit.declarations ?? {}) as Raw;
    const ownedProperties = (scenario.owned_properties ?? []) as unknown[];

    const out: Partial<LoanContextExtras> = {};
    const fico = credit.fico as number | undefined;
    if (typeof fico === "number" && fico >= 300 && fico <= 900) out.repFico = fico;
    if (typeof numbers.LTV === "number") out.ltv = numbers.LTV;
    if (typeof numbers.CLTV === "number") out.cltv = numbers.CLTV;
    if (typeof numbers.loan_amount === "number") out.loanAmount = numbers.loan_amount;
    const purpose = this.canonicalizeLoanPurpose(scenario.purpose as string | undefined);
    if (purpose) out.loanPurpose = purpose;
    if (typeof property.property_type === "string") out.propertyType = property.property_type;
    if (typeof numbers.DTI === "number") out.dti = numbers.DTI;
    if (typeof assetProfile.months_reserves === "number") out.reservesMonths = assetProfile.months_reserves;
    if (typeof numbers.note_rate === "number") out.noteRate = numbers.note_rate;
    if (typeof property.county === "string") out.county = property.county;
    const citizenship = primary.citizenship as string | undefined;
    out.isItin = citizenship === "ITIN";
    out.llcOrLegalEntity =
      scenario.borrower_type !== undefined &&
      scenario.borrower_type !== "Individual" &&
      scenario.borrower_type !== "Wage Earner";
    const occ = this.canonicalizeOccupancy(scenario.occupancy as string | undefined);
    if (occ) out.occupancy = occ;
    if (typeof property.state === "string" && (property.state as string).length === 2) out.state = property.state;
    if (typeof property.units === "number") out.units = property.units;
    if (ownedProperties.length > 0) out.ownedPropertiesCount = ownedProperties.length;
    if (typeof reoSummary.total_lien_balance === "number") out.reoTotalLienBalance = reoSummary.total_lien_balance;
    if (typeof reoSummary.subject_property_rental_income === "number") out.subjectRentalIncome = reoSummary.subject_property_rental_income;
    if (typeof scenario.is_fthb === "boolean") out.isFirstTimeHomebuyer = scenario.is_fthb;
    if (typeof scenario.borrower_type === "string") out.borrowerType = scenario.borrower_type;
    if (typeof scenario.channel === "string") out.channel = scenario.channel;
    if (typeof scenario.product_variant === "string") out.productVariant = scenario.product_variant;
    if (typeof loanTerms.interest_only === "boolean") out.interestOnly = loanTerms.interest_only;
    if (typeof loanTerms.prepay_penalty === "boolean") out.prepayPenalty = loanTerms.prepay_penalty;
    if (typeof loanTerms.balloon === "boolean") out.balloon = loanTerms.balloon;
    if (typeof credit.is_us_credit === "boolean") out.isUsCredit = credit.is_us_credit;
    if (typeof citizenship === "string") out.citizenship = citizenship;
    if (typeof primary.self_employed === "boolean") out.selfEmployed = primary.self_employed;
    if (typeof incomeProfile.primary_income_type === "string") out.primaryIncomeType = incomeProfile.primary_income_type;
    if (typeof declarations.BankruptcyIndicator === "boolean") out.bankruptcyHistory = declarations.BankruptcyIndicator;
    if (typeof declarations.PriorPropertyForeclosureCompletedIndicator === "boolean") out.foreclosureHistory = declarations.PriorPropertyForeclosureCompletedIndicator;
    if (typeof declarations.PriorPropertyShortSaleCompletedIndicator === "boolean") out.shortSaleHistory = declarations.PriorPropertyShortSaleCompletedIndicator;
    if (typeof declarations.PresentlyDelinquentIndicator === "boolean") out.presentlyDelinquent = declarations.PresentlyDelinquentIndicator;
    if (typeof declarations.OutstandingJudgmentsIndicator === "boolean") out.outstandingJudgments = declarations.OutstandingJudgmentsIndicator;
    return out;
  }

  private docRequestToPortalPrediction(dr: Raw): PortalPrediction {
    const portalStatus = (dr.status as string) ?? "needed";
    const KNOWN_STATUSES = new Set(["needed", "satisfied", "waived", "deferred"]);
    if (!KNOWN_STATUSES.has(portalStatus)) {
      console.warn(`[npnqm-portal] unknown portalStatus value "${portalStatus}" — passing through`);
    }
    return {
      documentType: (dr.document_type as string) ?? "Other",
      documentCategory: (dr.document_category as PortalDocCategory) ?? "Cross-Cutting",
      priority: (dr.priority as "P0" | "P1" | "P2") ?? "P1",
      appliesTo: (dr.applies_to as string) ?? "all_borrowers",
      specifications: (dr.specifications as string[]) ?? [],
      reasonsNeeded: (dr.reasons_needed as string[]) ?? [],
      conditions: (dr.conditions as string[]) ?? [],
      sourceReferences: (dr.source_references as string[]) ?? [],
      severity: (dr.severity as "HARD-STOP" | "SOFT-STOP") ?? "SOFT-STOP",
      portalStatus,
      tags: (dr.tags as string[]) ?? [],
      sourceModule: (dr.source_module as string) ?? "",
    };
  }

  private scenarioToEligibilityVerdict(scenario: Raw): EligibilityVerdict {
    const detail = (scenario.program_eligibility_detail ?? {}) as Record<string, Raw>;
    return {
      eligiblePrograms: (scenario.eligible_programs as string[]) ?? [],
      ineligiblePrograms: (scenario.ineligible_programs as string[]) ?? [],
      perProgram: Object.entries(detail).map(([program, d]) => ({
        program,
        status: (d.status as "PASS" | "FAIL") ?? "FAIL",
        passedCount: (d.passed_count as number) ?? 0,
        failedCount: (d.failed_count as number) ?? 0,
        failedRules: ((d.failed_rules as Array<Record<string, string>>) ?? []).map((fr) => ({
          requirement: fr.requirement ?? "",
          message: fr.message ?? "",
        })),
      })),
    };
  }

  private canonicalizeOccupancy(value: string | undefined): "Primary" | "Secondary" | "Investment" | undefined {
    if (!value) return undefined;
    const v = value.trim();
    if (v === "Primary Residence" || v === "Owner Occupied" || v === "Primary") return "Primary";
    if (v === "Second Home" || v === "Secondary") return "Secondary";
    if (v === "NOO" || v === "Investment Property" || v === "Non-Owner Occupied" || v === "Investment") return "Investment";
    return undefined;
  }

  private canonicalizeLoanPurpose(value: string | undefined): "Purchase" | "Rate & Term Refinance" | "Cash-Out Refinance" | undefined {
    if (!value) return undefined;
    const v = value.trim();
    if (v === "Purchase") return "Purchase";
    if (v === "Rate and Term" || v === "Rate/Term" || v === "Rate/Term Refinance" || v === "Rate-Term") return "Rate & Term Refinance";
    if (v === "Cash-Out Refinance" || v === "Delayed Financing" || v === "Cash Out") return "Cash-Out Refinance";
    return undefined;
  }
}
