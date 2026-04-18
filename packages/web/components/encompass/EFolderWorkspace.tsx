"use client";

import { useState, useTransition, useRef } from "react";
import type { Loan, Document, Condition } from "@twin/core";
import { actionUploadFile, actionClearCondition, actionUpdateDocumentStatus, actionAddDocument } from "@/app/loan/[loanId]/actions";

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
                      <span className={`px-1 py-[1px] text-[9px] font-bold ${STATUS_STYLE[doc.status]?.bg ?? ""} ${STATUS_STYLE[doc.status]?.text ?? ""}`}>
                        {doc.status}
                      </span>
                      {!doc.fileKey && (
                        <button
                          className="enc-btn text-[9px] px-1"
                          disabled={pending}
                          onClick={(e) => { e.stopPropagation(); handleUpload(doc.id); }}
                        >
                          ↑
                        </button>
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

              {/* Extracted data */}
              {selectedDoc.extractedData && Object.keys(selectedDoc.extractedData).length > 0 && (
                <div className="px-3 py-2 bg-[#f0f5ff] border-b border-[#c8c4b5] text-[10px]">
                  <div className="font-bold text-[#1f4478] mb-1">📋 Extracted Data (IDP)</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(selectedDoc.extractedData).map(([k, v]) => (
                      <div key={k}>
                        <span className="text-[#6b7a8f]">{k.replace(/_/g, " ")}:</span>{" "}
                        <span className="font-semibold">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* File preview area */}
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
