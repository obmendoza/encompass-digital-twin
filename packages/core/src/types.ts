export type LoanId = string;

export type LoanState =
  | "agent_review_pending"
  | "va_review_pending"
  | "va_in_review"
  | "va_doc_request_pending"
  | "uw_review_pending"
  | "decided";

export type ConditionId = string;
export type DocumentId = string;
export type DocumentStatus = "Pending" | "Received" | "Reviewed" | "Rejected";
export type DocumentType =
  | "BankStatement" | "TaxReturn" | "PayStub" | "1099" | "PnL"
  | "CPA_Letter" | "ID" | "Insurance" | "Appraisal" | "Title"
  | "LeaseAgreement" | "LOX" | "BKDocs" | "CreditReport" | "Other";

export interface Document {
  id: DocumentId;
  name: string;
  docType: DocumentType;
  linkedConditionId?: ConditionId;
  status: DocumentStatus;
  uploadedBy: string;
  uploadedAt: string;
  notes?: string;
  fileKey?: string;
  fileUrl?: string;
  fileSize?: number;
  mimeType?: string;
  extractedData?: Record<string, unknown>;
}

export type NqmProgram =
  // Phase 2 (2026-05-10) — active KB display names from the ingested guidelines.
  | "Flex Select" | "Flex Supreme"
  | "Investor DSCR" | "Investor DSCR No Ratio"
  | "DSCR Supreme" | "DSCR Multi (5-8 Units)"
  | "Foreign National" | "Select ITIN"
  | "Second Lien Select" | "Super Jumbo"
  // Legacy PascalCase taxonomy — kept for back-compat (older fixtures, tests, type assertions).
  | "BankStatement12" | "BankStatement24"
  | "DSCR" | "AssetDepletion"
  | "1099Only" | "PnL"
  | "ForeignNational" | "ITIN"
  | "FullDocNonQM";

export type QualifyingMethod =
  | "BankStatementDeposits"
  | "DSCRCoverage"
  | "AssetDepletionMonths"
  | "1099Gross"
  | "PnLCPACertified"
  | "TraditionalDocs";

export type UwDecision =
  | "pending" | "approved" | "suspended" | "counter" | "denied";

export type AgentStepPhase = "thinking" | "tool_call" | "tool_result" | "message" | "decision" | "validation";

export interface AgentStep {
  phase: AgentStepPhase;
  content: string;
  metadata?: Record<string, unknown>;
  at: string;
}

export interface PendingRecommendation {
  recommendation: UwDecision;
  rationale: string;
  confidence: number;
  conditions: string[];
  trace: AgentStep[];
  stagedAt: string;
  stagedBy: string;
}

export type ConditionCategory = "PTA" | "PTD" | "PTF" | "PTP";
export type ConditionSource = "UW" | "AUS" | "Compliance" | "Investor" | "Predicted";
export type ConditionStatus =
  | "Open" | "Requested" | "Received" | "Cleared" | "Waived";

export interface Actor {
  kind: "human" | "agent" | "internal" | "bpo" | "system";
  id: string;
  // Optional fields used by specific kinds; back-compat with existing callers.
  email?: string;          // typically present when kind === "internal"
  partnerId?: string;      // present when kind === "bpo"
  smeId?: string;          // present when kind === "bpo"
  smeName?: string;        // present when kind === "bpo"
}

export interface BorrowerSummary {
  fullName: string;
  ssnMasked: string;
  dob: string;
  maritalStatus: "Married" | "Unmarried" | "Separated";
}

export interface PropertySummary {
  street: string;
  city: string;
  state: string;
  zip: string;
  propertyType: "SFR Det." | "Condo" | "PUD" | "2-4 Unit" | "5-8 Unit" | "Multi-Family";
  units: number;
  yearBuilt: number;
}

export interface TransactionDetails {
  loanPurpose: "Purchase" | "Refi-RT" | "Refi-CO";
  loanAmount: number;
  salesPrice?: number;
  appraisedValue: number;
  ltv: number;
  cltv: number;
  hcltv: number;
  noteRate: number;
  term: number;
  amortType: "Fixed" | "ARM";
  lienPosition: 1 | 2;
  occupancy: "Primary" | "Second" | "Investment";
  isInvestmentProperty: boolean;
  rentalIncome?: number;
  piti: number;
  pitia?: number;
  dscrRatio?: number;
}

export interface QualifyingRatios {
  housingRatio: number;
  totalDti: number;
  piPayment: number;
  qualifyingRate: number;
}

export interface QualifyingIncomeWorksheet {
  method: QualifyingMethod;
  monthsCovered?: number;
  avgDeposits?: number;
  expenseFactor?: number;
  nsfCount?: number;
  dscrNumerator?: number;
  dscrDenominator?: number;
  totalAssets?: number;
  depletionMonths?: number;
  gross1099?: number;
  cpaCertifiedNetIncome?: number;
  derivedMonthlyIncome: number;
}

export interface IncomeSummary {
  totalMonthlyIncome: number;
  notes?: string;
}

export interface AssetSummary {
  totalLiquid: number;
  totalRetirement: number;
  reservesMonths: number;
}

export interface Tradeline {
  creditorName: string;
  accountType: "Revolving" | "Installment" | "Mortgage" | "Collection" | "Other";
  balance: number;
  monthlyPayment: number;
  limit?: number;
  monthsOpen: number;
  late30: number;
  late60: number;
  late90: number;
  isDisputed: boolean;
}

export interface LiabilitySummary {
  totalMonthlyPayments: number;
  revolvingBalance: number;
  installmentBalance: number;
  mortgageBalance: number;
  collectionsBalance: number;
  totalBalance: number;
}

export interface CreditSummary {
  repScore: number | null;
  tradelinesOpen: number;
  tradelinesTotal: number;
  lastLate30d?: string;
  tradelines: Tradeline[];
  liabilities: LiabilitySummary;
}

export interface ComparableSale {
  address: string;
  salePrice: number;
  saleDate: string;
  sqft: number;
  distance: string;
  adjustedValue: number;
}

export interface AppraisalDetails {
  appraisalDate: string;
  appraiserName: string;
  appraisalType: "Full" | "Exterior-Only" | "Desktop" | "Hybrid";
  appraisedValue: number;
  marketCondition: "Stable" | "Increasing" | "Declining";
  neighborhoodRating: "Good" | "Average" | "Fair" | "Poor";
  siteArea: string;
  grossLivingArea: number;
  roomCount: number;
  bedroomCount: number;
  bathroomCount: number;
  garageSpaces: number;
  condition: "Good" | "Average" | "Fair" | "Poor";
  comparables: ComparableSale[];
  notes?: string;
}

export interface AusResult {
  engine: "DU" | "LPA";
  recommendation: string;
  caseId: string;
  findingsDate: string;
}

export interface Condition {
  id: ConditionId;
  category: ConditionCategory;
  source: ConditionSource;
  description: string;
  status: ConditionStatus;
  addedBy: string;
  addedAt: string;
  clearedBy?: string;
  clearedAt?: string;
  notes?: string;
}

export interface NewCondition {
  category: ConditionCategory;
  source: ConditionSource;
  description: string;
  status?: ConditionStatus;
}

export interface Milestone {
  name: string;
  at: string;
  by: string;
}

export interface ComplianceFlag {
  code: string;
  severity: "Info" | "Warning" | "Violation";
  description: string;
  regulation: string;
}

export interface ComplianceSnapshot {
  qmStatus: "QM-Safe Harbor" | "QM-Rebuttable" | "Non-QM" | "Exempt";
  atrCompliant: boolean;
  hpml: boolean;
  hoepa: boolean;
  higherPricedCoveredTransaction: boolean;
  stateLicenseRequired: boolean;
  stateHighCostTest: "Pass" | "Fail" | "N/A";
  tridToleranceCure: "None" | "10%" | "Unlimited";
  totalPointsAndFees: number;
  pointsAndFeesThreshold: number;
  pointsAndFeesPass: boolean;
  flags: ComplianceFlag[];
}

export interface GuidelineCheck {
  category: "LTV" | "FICO" | "DTI" | "Reserves" | "DSCR" | "Seasoning" | "Property" | "Income" | "Occupancy" | "Other";
  rule: string;
  threshold: string;
  actual: string;
  result: "Pass" | "Fail" | "Exception" | "N/A";
  notes?: string;
}

export interface ProgramOverlay {
  programName: string;
  investorName: string;
  maxLTV: number;
  minFICO: number | null;
  maxDTI: number | null;
  minDSCR: number | null;
  minReserves: number;
  checks: GuidelineCheck[];
}

export interface LoanAssignment {
  assignedTo: string;        // user email or VA id
  assignedBy: string;        // admin/UW who assigned
  assignedAt: string;        // ISO timestamp
  status: "queued" | "in_progress" | "report_ready" | "under_review" | "decided";
  priority: "normal" | "high" | "urgent";
}

export interface Loan {
  id: LoanId;
  nqmProgram: NqmProgram;
  qualifyingMethod: QualifyingMethod;
  borrower: BorrowerSummary;
  property: PropertySummary;
  transaction: TransactionDetails;
  qualifying: QualifyingRatios;
  qualifyingWorksheet: QualifyingIncomeWorksheet;
  income: IncomeSummary;
  assets: AssetSummary;
  credit: CreditSummary;
  aus?: AusResult;
  appraisal: AppraisalDetails;
  conditions: Condition[];
  documents: Document[];
  decision: UwDecision;
  pendingRecommendation?: PendingRecommendation;
  milestones: Milestone[];
  compliance: ComplianceSnapshot;
  overlay: ProgramOverlay;
  assignment?: LoanAssignment;
  tenantId?: string;
  guidelineVersionId?: string;
  slaDeadlines?: import("./tenant-types.js").SlaDeadlines;
  // ── VA review layer fields (spec 2026-05-10 v2.1) ──────────────────────────
  //
  // ⚠️  IN-MEMORY / TEST-ONLY. Do NOT read these in production code paths.
  //
  // The VA reducer cases (RouteToVA / ClaimForVAReview / SubmitVAReview / ...)
  // populate these so unit tests on the @twin/core reducer can assert on Loan
  // state. Production VA flows go through DB-only writer services
  // (va-routing, va-pool, va-review-writer, va-doc-return) that never re-enter
  // the reducer — so in real deployments these stay null/undefined.
  //
  // Authoritative sources for production reads:
  //   - state, assignedPoolId, vaId, claimedAt → va_loan_state side-table,
  //     exposed via GET /va/queue
  //   - currentVaReviewId / latest review        → GET /loans/:id/va/review-history
  //
  // See: feedback_va_loan_fields_vestigial.md (project memory).

  /** @deprecated Read from /va/queue instead — see Loan-VA fields note above. */
  state?: LoanState;                    // undefined ⇒ "agent_review_pending" by convention
  /** @deprecated Read from /loans/:id/va/review-history instead. */
  currentVaReviewId?: string | null;
  /** @deprecated Read from /va/queue (claimed_at indicates claimant via va_id column). */
  vaId?: string | null;                  // current claimant when state === "va_in_review"
  /** @deprecated Read from /va/queue. */
  claimedAt?: string | null;
  /** @deprecated Read from /va/queue. */
  assignedPoolId?: string | null;
}

// ─── VA Review Layer (spec 2026-05-10 v2.1) ─────────────────────────────────

export type VASpecialistKind =
  | "doc" | "income" | "asset" | "credit" | "property" | "compliance";

export interface VASpecialistSignoff {
  specialist: VASpecialistKind;
  signoff: "concur" | "disagree";
  notes: string | null;       // required when signoff === "disagree"
}

export interface VAConditionAction {
  conditionId: ConditionId;
  action: "clear" | "contest"; // no "add" in v1 of the spec
  note: string | null;          // required when action === "contest"
}

export interface VADocRequestItem {
  docType: string;
  reason: string;
  required: boolean;
}

export interface VADocRequest {
  docs: VADocRequestItem[];
  deadline: string;            // ISO date (YYYY-MM-DD)
  messageToOriginator: string;
}

export interface VAReview {
  id: string;
  tenantId: string;
  loanId: LoanId;
  vaId: string;
  vaPoolId: string;
  poolKind: "internal" | "bpo";
  verdict: "concur" | "request_docs";
  specialistSignoffs: VASpecialistSignoff[];   // length 6, one per specialist
  conditionActions: VAConditionAction[];
  overallRationale: string;                     // ≥ 20 chars
  docRequest: VADocRequest | null;              // non-null iff verdict === "request_docs"
  // Provenance (spec §"Provenance contract"):
  agentRecommendationId: string;
  kbVersion: string;
  chatbotConsultationIds: string[];
  claimedAt: string;
  submittedAt: string;
  reviewTimeSeconds: number;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  loan: Loan;
}

export interface WorldState {
  scenarioId: string | null;
  loans: Record<LoanId, Loan>;
  actionLog: LoggedAction[];
  now: () => string;
}

export interface LoggedAction {
  seq: number;
  at: string;
  action: Action;
}

export type Action =
  | { type: "LoadScenario"; scenarioId: string; tenantId?: string }
  | { type: "ResetWorld" }
  | { type: "OpenLoan"; loanId: LoanId; actor: Actor }
  | { type: "SetDecision"; loanId: LoanId; decision: UwDecision; rationale: string; actor: Actor }
  | { type: "AdvanceMilestone"; loanId: LoanId; milestone: string; actor: Actor }
  | { type: "RecalculateQualifyingIncome"; loanId: LoanId; worksheet: QualifyingIncomeWorksheet; actor: Actor }
  | { type: "AddCondition"; loanId: LoanId; condition: NewCondition; actor: Actor }
  | { type: "UpdateCondition"; loanId: LoanId; conditionId: ConditionId; patch: Partial<Condition>; actor: Actor }
  | { type: "ClearCondition"; loanId: LoanId; conditionId: ConditionId; notes?: string; actor: Actor }
  | { type: "WaiveCondition"; loanId: LoanId; conditionId: ConditionId; rationale: string; actor: Actor }
  | { type: "RemoveCondition"; loanId: LoanId; conditionId: ConditionId; actor: Actor }
  | { type: "AddDocument"; loanId: LoanId; doc: { name: string; docType: DocumentType }; actor: Actor }
  | { type: "LinkDocument"; loanId: LoanId; documentId: DocumentId; conditionId: ConditionId; actor: Actor }
  | { type: "UpdateDocumentStatus"; loanId: LoanId; documentId: DocumentId; status: DocumentStatus; notes?: string; actor: Actor }
  | { type: "RecordAgentStep"; loanId: LoanId; step: AgentStep; actor: Actor }
  | { type: "StageRecommendation"; loanId: LoanId; recommendation: { recommendation: UwDecision; rationale: string; confidence: number; conditions: string[]; trace: AgentStep[] }; actor: Actor }
  | { type: "AcceptRecommendation"; loanId: LoanId; actor: Actor }
  | { type: "ClearRecommendation"; loanId: LoanId; actor: Actor }
  | { type: "InjectLoan"; loan: Loan }
  | { type: "AttachFile"; loanId: LoanId; documentId: DocumentId; fileKey: string; fileUrl: string; fileSize: number; mimeType: string; actor: Actor }
  | { type: "SetExtractedData"; loanId: LoanId; documentId: DocumentId; extractedData: Record<string, unknown>; actor: Actor }
  | { type: "AssignLoan"; loanId: LoanId; assignedTo: string; priority: "normal" | "high" | "urgent"; actor: Actor }
  | { type: "UpdateAssignmentStatus"; loanId: LoanId; status: "queued" | "in_progress" | "report_ready" | "under_review" | "decided"; actor: Actor }
  | { type: "UnassignLoan"; loanId: LoanId; actor: Actor }
  | { type: "OverrideDecision"; loanId: LoanId; originalRecommendation: UwDecision; overrideDecision: UwDecision; overrideReason?: import("./learning-types.js").OverrideReasonCategory; rationale: string; actor: Actor }
  | { type: "SendBackToVA"; loanId: LoanId; notes: string; actor: Actor }
  | { type: "RouteToVA"; loanId: LoanId; assignedPoolId: string; actor: Actor }
  | { type: "ClaimForVAReview"; loanId: LoanId; vaId: string; poolId: string; poolKind: "internal" | "bpo"; actor: Actor }
  | { type: "ReleaseVAClaim"; loanId: LoanId; vaId: string; actor: Actor }
  | { type: "SubmitVAReview"; loanId: LoanId; review: VAReview; actor: Actor }
  | { type: "ReceiveVADocResponse"; loanId: LoanId; documents: Document[]; actor: Actor };
