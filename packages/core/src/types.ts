export type LoanId = string;
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
}

export type NqmProgram =
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

export type ConditionCategory = "PTA" | "PTD" | "PTF" | "PTP";
export type ConditionSource = "UW" | "AUS" | "Compliance" | "Investor";
export type ConditionStatus =
  | "Open" | "Requested" | "Received" | "Cleared" | "Waived";

export interface Actor {
  kind: "human" | "agent";
  id: string;
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
  propertyType: "SFR Det." | "Condo" | "PUD" | "2-4 Unit";
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
  milestones: Milestone[];
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
  | { type: "LoadScenario"; scenarioId: string }
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
  | { type: "UpdateDocumentStatus"; loanId: LoanId; documentId: DocumentId; status: DocumentStatus; notes?: string; actor: Actor };
