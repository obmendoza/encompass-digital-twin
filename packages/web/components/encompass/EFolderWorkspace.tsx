"use client";

import { useState, useTransition, useRef } from "react";
import type { Loan, Document, Condition } from "@twin/core";
import { actionUploadFile, actionClearCondition, actionUpdateDocumentStatus, actionAddDocument, actionGenerateDocs, actionRunIDP, actionRecalcIncome } from "@/app/loan/[loanId]/actions";
import type { QualifyingIncomeWorksheet } from "@twin/core";

// ---------------------------------------------------------------------------
// Stare & Compare helpers
// ---------------------------------------------------------------------------

interface ComparisonEntry {
  field: string;
  label: string;
  extractedDisplay: string;
  extractedRaw: unknown;
  loanDisplay: string;
  status: "match" | "mismatch" | "extra";
  note?: string;
  pushField?: string;
}

function formatVal(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") return v >= 1000 ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(v);
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
  return String(v);
}

function fuzzyMatch(extracted: unknown, loan: unknown): boolean {
  if (extracted == null || loan == null) return false;
  const e = String(extracted).toLowerCase().replace(/[^a-z0-9.]/g, "");
  const l = String(loan).toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (e === l) return true;
  // Numeric comparison with tolerance
  const en = parseFloat(String(extracted));
  const ln = parseFloat(String(loan));
  if (!isNaN(en) && !isNaN(ln)) return Math.abs(en - ln) / Math.max(Math.abs(ln), 1) < 0.05;
  // Substring match for names
  return e.length > 3 && l.length > 3 && (e.includes(l.slice(0, 5)) || l.includes(e.slice(0, 5)));
}

function buildComparisons(doc: Document, loan: Loan, extracted: Record<string, unknown>): ComparisonEntry[] {
  const results: ComparisonEntry[] = [];
  const docType = doc.docType;

  type FieldMap = Record<string, { label: string; getLoanVal: (loan: Loan) => unknown; note?: string; pushField?: string }>;

  const bankStmtFields: FieldMap = {
    account_holder: { label: "Account Holder", getLoanVal: (l) => l.borrower.fullName },
    total_deposits: { label: "Total Deposits (this month)", getLoanVal: (l) => l.qualifyingWorksheet.avgDeposits, note: "Loan uses monthly avg across all statements; this is a single month", pushField: "avgDeposits" },
    beginning_balance: { label: "Beginning Balance", getLoanVal: (l) => { const liq = l.assets.totalLiquid; return liq > 0 ? liq : null; }, note: "Loan record shows total liquid assets, not per-account balance" },
    ending_balance: { label: "Ending Balance", getLoanVal: (l) => { const liq = l.assets.totalLiquid; return liq > 0 ? liq : null; }, note: "Loan record shows total liquid assets" },
    total_withdrawals: { label: "Total Withdrawals", getLoanVal: () => null },
    statement_start: { label: "Statement Period Start", getLoanVal: (l) => l.qualifyingWorksheet.monthsCovered ? `${l.qualifyingWorksheet.monthsCovered} months covered` : null },
    statement_end: { label: "Statement Period End", getLoanVal: (l) => l.qualifyingWorksheet.monthsCovered ? `${l.qualifyingWorksheet.monthsCovered} months covered` : null, note: "Loan tracks total months covered, not individual dates" },
    account_number_last4: { label: "Account (last 4)", getLoanVal: (l) => l.borrower.ssnMasked.slice(-4), note: "Compared against SSN last 4 for identity verification" },
    large_deposits: { label: "Large Deposits", getLoanVal: (l) => l.qualifyingWorksheet.nsfCount != null ? `NSF count: ${l.qualifyingWorksheet.nsfCount}` : null, note: "Large deposits require sourcing; NSF count tracked separately" },
  };

  const app1003Fields: FieldMap = {
    borrower_name: { label: "Borrower Name", getLoanVal: (l) => l.borrower.fullName },
    ssn_last4: { label: "SSN (last 4)", getLoanVal: (l) => l.borrower.ssnMasked.slice(-4) },
    subject_property_address: { label: "Property Address", getLoanVal: (l) => `${l.property.street}, ${l.property.city} ${l.property.state}` },
    subject_property_state: { label: "State", getLoanVal: (l) => l.property.state },
    occupancy: { label: "Occupancy", getLoanVal: (l) => l.transaction.occupancy },
    property_type: { label: "Property Type", getLoanVal: (l) => l.property.propertyType },
    loan_purpose: { label: "Loan Purpose", getLoanVal: (l) => l.transaction.loanPurpose },
    loan_amount: { label: "Loan Amount", getLoanVal: (l) => l.transaction.loanAmount },
    purchase_price: { label: "Purchase Price", getLoanVal: (l) => l.transaction.salesPrice },
    appraised_value: { label: "Appraised Value", getLoanVal: (l) => l.transaction.appraisedValue },
    estimated_ltv: { label: "LTV", getLoanVal: (l) => l.transaction.ltv },
    stated_income_monthly: { label: "Monthly Income", getLoanVal: (l) => l.income.totalMonthlyIncome },
    stated_assets_total: { label: "Total Assets", getLoanVal: (l) => l.assets.totalLiquid + l.assets.totalRetirement },
  };

  const leaseFields: FieldMap = {
    tenant: { label: "Tenant", getLoanVal: () => null },
    monthly_rent: { label: "Monthly Rent", getLoanVal: (l) => l.transaction.rentalIncome },
    lease_start: { label: "Lease Start", getLoanVal: () => null },
    lease_end: { label: "Lease End", getLoanVal: () => null },
    security_deposit: { label: "Security Deposit", getLoanVal: () => null },
    is_executed: { label: "Executed", getLoanVal: () => null },
    landlord: { label: "Landlord", getLoanVal: (l) => l.borrower.fullName },
  };

  const form1099Fields: FieldMap = {
    recipient_name: { label: "Recipient", getLoanVal: (l) => l.borrower.fullName },
    gross_receipts: { label: "Gross Receipts", getLoanVal: (l) => l.qualifyingWorksheet.gross1099 },
    tax_year: { label: "Tax Year", getLoanVal: () => null },
    variant: { label: "Form Variant", getLoanVal: () => null },
  };

  let fieldMap: FieldMap = {};
  if (docType === "BankStatement" || doc.name.toLowerCase().includes("bank")) {
    fieldMap = bankStmtFields;
  } else if (doc.name.toLowerCase().includes("1003") || docType === "Other") {
    fieldMap = app1003Fields;
  } else if (docType === "LeaseAgreement") {
    fieldMap = leaseFields;
  } else if (docType === "1099") {
    fieldMap = form1099Fields;
  } else {
    fieldMap = app1003Fields;
  }

  for (const [key, config] of Object.entries(fieldMap)) {
    const extractedVal = extracted[key];
    if (extractedVal === undefined) continue;

    const loanVal = config.getLoanVal(loan);
    const isMatch = fuzzyMatch(extractedVal, loanVal);
    const hasLoanVal = loanVal != null;

    results.push({
      field: key,
      label: config.label,
      extractedDisplay: formatVal(extractedVal),
      extractedRaw: extractedVal,
      loanDisplay: hasLoanVal ? formatVal(loanVal) : "—",
      status: !hasLoanVal ? "extra" : isMatch ? "match" : "mismatch",
      note: config.note,
      pushField: config.pushField,
    });
  }

  for (const [key, val] of Object.entries(extracted)) {
    if (key.startsWith("_")) continue;
    if (results.some(r => r.field === key)) continue;
    results.push({
      field: key,
      label: key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      extractedDisplay: formatVal(val),
      extractedRaw: val,
      loanDisplay: "—",
      status: "extra",
    });
  }

  return results;
}

function StareAndCompare({ doc, loan, twinApiUrl }: {
  doc: Document;
  loan: Loan;
  twinApiUrl: string;
}) {
  const extracted = doc.extractedData ?? {};
  const [hoveredField, setHoveredField] = useState<string | null>(null);
  const [pushed, setPushed] = useState<Set<string>>(new Set());
  const [, startPush] = useTransition();

  const comparisons = buildComparisons(doc, loan, extracted as Record<string, unknown>);

  const handlePushToLoan = (comp: ComparisonEntry) => {
    if (!comp.pushField) return;
    const val = typeof comp.extractedRaw === "number" ? comp.extractedRaw : parseFloat(String(comp.extractedRaw));
    if (isNaN(val)) return;

    const ws: QualifyingIncomeWorksheet = {
      ...loan.qualifyingWorksheet,
      [comp.pushField]: val,
      derivedMonthlyIncome: comp.pushField === "avgDeposits"
        ? val * (1 - (loan.qualifyingWorksheet.expenseFactor ?? 0.5))
        : loan.qualifyingWorksheet.derivedMonthlyIncome,
    };

    startPush(async () => {
      await actionRecalcIncome(loan.id, ws);
      setPushed((prev) => new Set(prev).add(comp.field));
    });
  };

  const matchCount = comparisons.filter(c => c.status === "match").length;
  const mismatchCount = comparisons.filter(c => c.status === "mismatch").length;
  const extraCount = comparisons.filter(c => c.status === "extra").length;

  return (
    <div className="grid grid-cols-2 gap-[1px] bg-[#6b7a8f] flex-1" style={{ minHeight: "400px" }}>
      {/* Left: PDF */}
      <div className="bg-white p-1">
        <div className="text-[9px] text-[#6b7a8f] px-1 pb-1 font-bold uppercase">Source Document</div>
        {doc.mimeType?.includes("pdf") ? (
          <iframe
            src={`${twinApiUrl}${doc.fileUrl}`}
            className="w-full border border-[#c8c4b5]"
            style={{ height: "420px" }}
            title={doc.name}
          />
        ) : doc.mimeType?.startsWith("image/") ? (
          <img
            src={`${twinApiUrl}${doc.fileUrl}`}
            alt={doc.name}
            className="max-w-full max-h-[420px] mx-auto border border-[#c8c4b5]"
          />
        ) : (
          <div className="flex items-center justify-center h-[420px] text-[#6b7a8f] text-[11px]">
            Preview not available
          </div>
        )}
      </div>

      {/* Right: Extracted vs Loan comparison */}
      <div className="bg-white overflow-auto">
        <div className="px-2 py-1 bg-gradient-to-r from-[#1f4478] to-[#0a3060] text-white text-[10px] font-bold flex items-center gap-2">
          <span>👁 STARE &amp; COMPARE</span>
          <span className="ml-auto opacity-80">
            ✅ {matchCount}  ⚠️ {mismatchCount}  ℹ️ {extraCount}
          </span>
        </div>

        {/* Comparison table */}
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="bg-[#f0f2f5]">
              <th className="text-left px-2 py-[4px] border-b border-[#c8c4b5] font-bold text-[#1f4478]">Field</th>
              <th className="text-left px-2 py-[4px] border-b border-[#c8c4b5] font-bold text-[#1f4478]">Extracted</th>
              <th className="text-left px-2 py-[4px] border-b border-[#c8c4b5] font-bold text-[#1f4478]">Loan Record</th>
              <th className="text-center px-2 py-[4px] border-b border-[#c8c4b5] font-bold text-[#1f4478] w-[40px]">Match</th>
              <th className="text-center px-2 py-[4px] border-b border-[#c8c4b5] font-bold text-[#1f4478] w-[60px]">Action</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((comp, i) => (
              <tr
                key={i}
                className={`${
                  comp.status === "mismatch" ? "bg-[#fff8e1]" :
                  comp.status === "match" ? "" :
                  "bg-[#f8f9ff]"
                } ${hoveredField === comp.field ? "ring-2 ring-[#0a52a0] ring-inset" : ""} ${
                  i % 2 && comp.status !== "mismatch" ? "bg-[#fafbfc]" : ""
                }`}
                onMouseEnter={() => setHoveredField(comp.field)}
                onMouseLeave={() => setHoveredField(null)}
              >
                <td className="px-2 py-[3px] border-b border-[#e0dfdb] font-semibold text-[#404040]">
                  {comp.label}
                </td>
                <td className="px-2 py-[3px] border-b border-[#e0dfdb] font-mono">
                  {comp.extractedDisplay}
                </td>
                <td className="px-2 py-[3px] border-b border-[#e0dfdb]">
                  {comp.loanDisplay}
                </td>
                <td className="px-2 py-[3px] border-b border-[#e0dfdb] text-center">
                  {comp.status === "match" ? (
                    <span className="text-[#1b5e20]">✅</span>
                  ) : comp.status === "mismatch" ? (
                    <span className="text-[#8a4b00]" title={comp.note ?? ""}>⚠️</span>
                  ) : (
                    <span className="text-[#6b7a8f]">ℹ️</span>
                  )}
                </td>
                <td className="px-2 py-[3px] border-b border-[#e0dfdb] text-center">
                  {comp.pushField && !pushed.has(comp.field) ? (
                    <button
                      className="text-[9px] px-1 py-[1px] bg-[#0a52a0] text-white border-none cursor-pointer hover:bg-[#08407d]"
                      onClick={() => handlePushToLoan(comp)}
                      title={`Push ${comp.extractedDisplay} to Income Worksheet`}
                    >
                      Push →
                    </button>
                  ) : pushed.has(comp.field) ? (
                    <span className="text-[9px] text-[#1b5e20] font-bold">✓ Pushed</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mismatch notes */}
        {comparisons.filter(c => c.note).length > 0 && (
          <div className="px-2 py-2 bg-[#fffdf5] border-t border-[#c8c4b5] text-[9px]">
            <div className="font-bold text-[#8a4b00] mb-1">Notes:</div>
            {comparisons.filter(c => c.note).map((c, idx) => (
              <div key={idx} className="text-[#6b7a8f] mb-[2px]">
                • <b>{c.label}:</b> {c.note}
              </div>
            ))}
          </div>
        )}

        {/* Verification summary */}
        <div className="px-2 py-2 bg-[#f6f8fb] border-t border-[#6b7a8f]">
          <div className="font-bold text-[10px] text-[#1f4478] mb-1">Verification Summary</div>
          <div className="flex gap-3 text-[10px]">
            <span className="text-[#1b5e20] font-bold">✅ {matchCount} match{matchCount !== 1 ? "es" : ""}</span>
            {mismatchCount > 0 && <span className="text-[#8a4b00] font-bold">⚠️ {mismatchCount} review needed</span>}
            {extraCount > 0 && <span className="text-[#6b7a8f]">ℹ️ {extraCount} supplemental</span>}
          </div>
          <div className={`mt-1 text-[9px] font-bold ${mismatchCount === 0 ? "text-[#1b5e20]" : "text-[#8a4b00]"}`}>
            {mismatchCount === 0 ? "All extracted data verified against loan record" : "Review highlighted fields before clearing condition"}
          </div>
        </div>
      </div>
    </div>
  );
}

// Document categories for grouping
const DOC_CATEGORIES: Record<string, string[]> = {
  "Income": ["BankStatement", "PayStub", "1099", "PnL", "CPA_Letter"],
  "Assets": ["BankStatement"],
  "Credit": ["CreditReport"],
  "Property": ["Appraisal", "Title", "Insurance", "LeaseAgreement"],
  "Identity": ["ID"],
  "Compliance": ["LOX", "BKDocs"],
  "Other": ["Other"],
};

function categorizeDoc(docType: string): string {
  for (const [cat, types] of Object.entries(DOC_CATEGORIES)) {
    if (types.includes(docType)) return cat;
  }
  return "Other";
}

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  Pending: { bg: "bg-[#ffe8c2]", text: "text-[#8a4b00]" },
  Received: { bg: "bg-[#d7ecd0]", text: "text-[#1b5e20]" },
  Reviewed: { bg: "bg-[#cfe0f5]", text: "text-[#0d47a1]" },
  Rejected: { bg: "bg-[#f8d7d7]", text: "text-[#8a0000]" },
};

function FileIcon({ mimeType }: { mimeType?: string }) {
  if (!mimeType) return <span className="text-[14px]">📄</span>;
  if (mimeType.startsWith("image/")) return <span className="text-[14px]">🖼️</span>;
  if (mimeType.includes("pdf")) return <span className="text-[14px]">📑</span>;
  return <span className="text-[14px]">📄</span>;
}

function formatSize(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  loan: Loan;
  twinApiUrl: string;
}

const DOC_TYPES = [
  "BankStatement", "TaxReturn", "PayStub", "1099", "PnL",
  "CPA_Letter", "ID", "Insurance", "Appraisal", "Title",
  "LeaseAgreement", "LOX", "BKDocs", "CreditReport", "Other",
];

export function EFolderWorkspace({ loan, twinApiUrl }: Props) {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newDocName, setNewDocName] = useState("");
  const [newDocType, setNewDocType] = useState("Other");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<string | null>(null);
  const [idpRunning, setIdpRunning] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(true);

  const handleAddDoc = () => {
    if (!newDocName.trim()) return;
    startTransition(async () => {
      await actionAddDocument(loan.id, { name: newDocName, docType: newDocType });
      setNewDocName("");
      setShowAddForm(false);
    });
  };

  const selectedDoc = loan.documents.find((d) => d.id === selectedDocId);
  const linkedCondition = selectedDoc?.linkedConditionId
    ? loan.conditions.find((c) => c.id === selectedDoc.linkedConditionId)
    : null;

  // Group documents by category
  const grouped: Record<string, Document[]> = {};
  for (const doc of loan.documents) {
    const cat = categorizeDoc(doc.docType);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat]!.push(doc);
  }

  const handleUpload = (docId: string) => {
    setUploadingDocId(docId);
    fileInputRef.current?.click();
  };

  const onFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingDocId) return;

    const formData = new FormData();
    formData.append("file", file);

    startTransition(async () => {
      await actionUploadFile(loan.id, uploadingDocId, formData);
      setUploadingDocId(null);
    });

    e.target.value = "";
  };

  const handleGenerateDocs = () => {
    setGenerating(true);
    setGenResult(null);
    startTransition(async () => {
      const result = await actionGenerateDocs(loan.id);
      setGenerating(false);
      if (result.ok) {
        setGenResult(`${result.count} documents generated and uploaded`);
      } else {
        setGenResult(`Error: ${result.error?.message ?? "Failed"}`);
      }
    });
  };

  const handleRunIDP = (docId: string) => {
    setIdpRunning(docId);
    startTransition(async () => {
      await actionRunIDP(loan.id, docId);
      setIdpRunning(null);
    });
  };

  const clearCondition = (condId: string) => {
    startTransition(async () => {
      await actionClearCondition(loan.id, condId, "Document reviewed and verified");
    });
  };

  const pendingCount = loan.documents.filter((d) => d.status === "Pending").length;
  const receivedCount = loan.documents.filter((d) => d.status === "Received").length;
  const reviewedCount = loan.documents.filter((d) => d.status === "Reviewed").length;
  const withFiles = loan.documents.filter((d) => d.fileKey).length;

  return (
    <div>
      {/* Header */}
      <div className="enc-sec">
        <h4>
          eFolder — {loan.documents.length} Documents · {withFiles} Uploaded · {pendingCount} Pending · {receivedCount} Received · {reviewedCount} Reviewed
        </h4>
        <div className="px-2 py-1 bg-[#ece9d8] border-b border-[#c8c4b5] flex items-center gap-2 text-[10px]">
          <button
            className="enc-btn enc-btn--primary text-[10px]"
            disabled={pending || generating}
            onClick={handleGenerateDocs}
          >
            {generating ? "📄 Generating..." : "📄 Generate Sample Docs"}
          </button>
          {genResult && (
            <span className={genResult.startsWith("Error") ? "text-[#c00]" : "text-[#1b5e20]"}>
              {genResult}
            </span>
          )}
          <span className="ml-auto text-[#6b7a8f]">
            Generates program-specific PDFs from loan data
          </span>
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.gif,.tiff,.doc,.docx,.xls,.xlsx"
        className="hidden"
        onChange={onFileSelected}
      />

      {/* Split pane */}
      <div className="grid grid-cols-[380px_1fr] gap-[1px] bg-[#6b7a8f] mt-1" style={{ minHeight: "500px" }}>
        {/* Left panel: Document list */}
        <div className="bg-white overflow-auto">
          {/* Add Document toolbar */}
          <div className="bg-[#ece9d8] border-b border-[#6b7a8f] px-2 py-[4px] flex items-center gap-2 sticky top-0 z-10">
            {showAddForm ? (
              <>
                <input className="border border-[#7f9db9] text-[10px] px-1 flex-1" placeholder="Document name..."
                  value={newDocName} onChange={(e) => setNewDocName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddDoc(); }} />
                <select className="border border-[#7f9db9] text-[10px]" value={newDocType}
                  onChange={(e) => setNewDocType(e.target.value)}>
                  {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <button className="enc-btn enc-btn--primary text-[9px]" disabled={pending || !newDocName.trim()} onClick={handleAddDoc}>Add</button>
                <button className="enc-btn text-[9px]" onClick={() => setShowAddForm(false)}>Cancel</button>
              </>
            ) : (
              <button className="enc-btn enc-btn--primary text-[10px]" onClick={() => setShowAddForm(true)}>
                + Add Document
              </button>
            )}
          </div>

          {Object.entries(grouped).map(([category, docs]) => (
            <div key={category}>
              <div className="bg-gradient-to-b from-[#e2ddc7] to-[#cfc9ae] px-2 py-[3px] text-[10px] font-bold border-b border-[#6b7a8f] sticky top-0">
                {category} ({docs.length})
              </div>
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className={`px-2 py-[5px] border-b border-[#e0dfdb] cursor-pointer text-[10px] hover:bg-[#e8f0fe] ${
                    selectedDocId === doc.id ? "bg-[#cde0f7] border-l-3 border-l-[#0a52a0]" : ""
                  }`}
                  onClick={() => setSelectedDocId(doc.id)}
                >
                  <div className="flex items-center gap-2">
                    <FileIcon mimeType={doc.mimeType} />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{doc.name}</div>
                      <div className="text-[9px] text-[#6b7a8f] flex items-center gap-2">
                        <span>{doc.docType}</span>
                        <span>·</span>
                        <span>{formatSize(doc.fileSize)}</span>
                        {doc.linkedConditionId && (
                          <>
                            <span>·</span>
                            <span className="text-[#0a52a0]">🔗 {doc.linkedConditionId}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      {doc.fileKey ? (
                        <span className="px-1 py-[1px] text-[9px] font-bold bg-[#d7ecd0] text-[#1b5e20]">
                          ✓ Filed
                        </span>
                      ) : (
                        <span className="px-1 py-[1px] text-[9px] font-bold bg-[#fff3cd] text-[#856404] border border-[#856404] cursor-pointer hover:bg-[#ffe69c]"
                          onClick={(e) => { e.stopPropagation(); handleUpload(doc.id); }}
                        >
                          📎 Upload
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}

          {loan.documents.length === 0 && (
            <div className="p-4 text-center text-[#6b7a8f] text-[11px]">
              No documents in eFolder. Click &quot;+ Add Document&quot; above to start.
            </div>
          )}
        </div>

        {/* Right panel: Document preview */}
        <div className="bg-[#f6f8fb]">
          {selectedDoc ? (
            <div className="h-full flex flex-col">
              {/* Preview header */}
              <div className="bg-gradient-to-b from-[#0a52a0] to-[#08407d] text-white px-3 py-2 text-[11px]">
                <div className="font-bold">{selectedDoc.name}</div>
                <div className="text-[10px] opacity-80">
                  {selectedDoc.docType} · {formatSize(selectedDoc.fileSize)} · {selectedDoc.status}
                  {selectedDoc.uploadedAt && ` · Uploaded ${selectedDoc.uploadedAt.slice(0, 10)}`}
                </div>
              </div>

              {/* Action bar */}
              <div className="flex items-center gap-2 px-3 py-2 bg-[#ece9d8] border-b border-[#6b7a8f] text-[10px]">
                {!selectedDoc.fileKey ? (
                  <button className="enc-btn enc-btn--primary text-[10px]" disabled={pending}
                    onClick={() => handleUpload(selectedDoc.id)}>
                    📎 Upload File
                  </button>
                ) : (
                  <a href={`${twinApiUrl}${selectedDoc.fileUrl}`} target="_blank" rel="noopener"
                    className="enc-btn text-[10px] no-underline text-black">
                    ⬇ Download
                  </a>
                )}
                {selectedDoc.fileKey && (
                  <button
                    className="enc-btn text-[10px]"
                    disabled={pending || idpRunning === selectedDoc.id}
                    onClick={() => handleRunIDP(selectedDoc.id)}
                  >
                    {idpRunning === selectedDoc.id ? "🔍 Extracting..." : "🔍 Run IDP Extract"}
                  </button>
                )}
                {selectedDoc.fileKey && selectedDoc.extractedData && Object.keys(selectedDoc.extractedData).length > 0 && (
                  <button className="enc-btn text-[10px]" onClick={() => setCompareMode(!compareMode)}>
                    {compareMode ? "📄 Document Only" : "👁 Stare & Compare"}
                  </button>
                )}
                {linkedCondition && linkedCondition.status !== "Cleared" && (
                  <button className="enc-btn enc-btn--primary text-[10px]" disabled={pending}
                    onClick={() => clearCondition(linkedCondition.id)}>
                    ✓ Review Complete — Clear Condition {linkedCondition.id}
                  </button>
                )}
                {linkedCondition && linkedCondition.status === "Cleared" && (
                  <span className="text-[#1b5e20] font-bold">✓ Condition {linkedCondition.id} Cleared</span>
                )}
              </div>

              {/* Linked condition info */}
              {linkedCondition && (
                <div className="px-3 py-2 bg-[#fffdf5] border-b border-[#c8c4b5] text-[10px]">
                  <span className="font-bold text-[#1f4478]">Linked Condition:</span>{" "}
                  [{linkedCondition.category}] {linkedCondition.description}
                </div>
              )}

              {/* Content area: Stare & Compare or document-only preview */}
              {selectedDoc.fileKey && selectedDoc.extractedData && Object.keys(selectedDoc.extractedData).length > 0 && compareMode ? (
                <StareAndCompare doc={selectedDoc} loan={loan} twinApiUrl={twinApiUrl} />
              ) : (
                <div className="flex-1 p-2">
                  {selectedDoc.fileKey ? (
                    selectedDoc.mimeType?.startsWith("image/") ? (
                      <img
                        src={`${twinApiUrl}${selectedDoc.fileUrl}`}
                        alt={selectedDoc.name}
                        className="max-w-full max-h-[400px] mx-auto border border-[#c8c4b5]"
                      />
                    ) : selectedDoc.mimeType?.includes("pdf") ? (
                      <iframe
                        src={`${twinApiUrl}${selectedDoc.fileUrl}`}
                        className="w-full border border-[#c8c4b5]"
                        style={{ height: "450px" }}
                        title={selectedDoc.name}
                      />
                    ) : (
                      <div className="text-center py-8 text-[#6b7a8f] text-[11px]">
                        <FileIcon mimeType={selectedDoc.mimeType} />
                        <div className="mt-2">Preview not available for {selectedDoc.mimeType}</div>
                        <a href={`${twinApiUrl}${selectedDoc.fileUrl}`} target="_blank" rel="noopener"
                          className="text-[#0a52a0] underline">Download to view</a>
                      </div>
                    )
                  ) : (
                    <div className="h-full flex items-center justify-center">
                      <div className="text-center text-[#6b7a8f]">
                        <div className="text-[30px] mb-2">📎</div>
                        <div className="text-[11px] font-bold mb-1">No file uploaded</div>
                        <div className="text-[10px] mb-3">Upload a PDF, image, or document</div>
                        <button className="enc-btn enc-btn--primary" disabled={pending}
                          onClick={() => handleUpload(selectedDoc.id)}>
                          Upload File
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-[#6b7a8f]">
              <div className="text-center">
                <div className="text-[30px] mb-2">📂</div>
                <div className="text-[11px]">Select a document to preview</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
