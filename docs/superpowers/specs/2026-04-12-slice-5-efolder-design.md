# Slice 5 — eFolder + Document Tracking

**Date:** 2026-04-12
**Status:** Approved
**Depends on:** Slices 1–4 (complete)

---

## Purpose

The eFolder is where underwriters track documents associated with conditions. In the real Encompass, docs are uploaded and linked to conditions. In the digital twin, we simulate this with a document registry — metadata entries (name, type, linked condition, upload date, status) without actual file storage. This gives agents and UWs a surface to mark documents as received, link them to conditions, and track the documentation trail.

## Scope

- New domain types: `Document` with id, name, docType, linkedConditionId, status, uploadedBy, uploadedAt
- New core actions: `AddDocument`, `LinkDocument`, `UpdateDocumentStatus`
- New API endpoints: GET/POST on `/loans/:id/documents`, PATCH for status/linking
- New UI: eFolder page at `/loan/:id/efolder` with a document table + add document modal
- Conditions table gets a "Docs" count column showing linked document count
- NavTree "eFolder" link under Services (or keep existing placeholder)

## Domain Model Extension

Add to `packages/core/src/types.ts`:

```ts
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
```

Add `documents: Document[]` to the `Loan` interface.

Add new action variants to the `Action` union:
```ts
| { type: "AddDocument"; loanId: LoanId; doc: { name: string; docType: DocumentType }; actor: Actor }
| { type: "LinkDocument"; loanId: LoanId; documentId: DocumentId; conditionId: ConditionId; actor: Actor }
| { type: "UpdateDocumentStatus"; loanId: LoanId; documentId: DocumentId; status: DocumentStatus; notes?: string; actor: Actor }
```

## Core Reducer

- `AddDocument`: appends a document with status "Pending", auto-generated id `d<n+1>`, sets uploadedBy/uploadedAt.
- `LinkDocument`: sets `linkedConditionId` on the document. Throws `CONDITION_NOT_FOUND` if condition doesn't exist on the loan. Throws a new error code `DOCUMENT_NOT_FOUND` if document id missing.
- `UpdateDocumentStatus`: updates status + optional notes. Throws `DOCUMENT_NOT_FOUND` if missing.

Add `DOCUMENT_NOT_FOUND` to `ActionErrorCode`.

## API Endpoints

```
GET    /loans/:loanId/documents                    → Document[]
POST   /loans/:loanId/documents                    { doc: { name, docType }, actor }
PATCH  /loans/:loanId/documents/:docId             { status?, linkedConditionId?, notes?, actor }
POST   /loans/:loanId/documents/:docId/link        { conditionId, actor }
```

## Fixtures

Add 2-4 starter documents to each fixture (matching their condition templates). Example for bank statement scenario: "12mo Bank Statements.pdf" (Received), "4506-C Signed.pdf" (Pending), "Income Worksheet.xlsx" (Pending).

## UI

**eFolder page** (`/loan/:id/efolder`):
- Document table: #, Name, Type, Linked Condition, Status (pill), Uploaded, Actions
- Status pills: Pending (gold), Received (green), Reviewed (blue), Rejected (red)
- Add Document modal: name, docType dropdown, optional condition link
- Status update dropdown per row
- Link-to-condition dropdown per row (shows condition descriptions)

**Conditions table enhancement**: add a "Docs" column counting linked documents per condition.

## Testing

- Unit tests on reducer for AddDocument, LinkDocument, UpdateDocumentStatus
- HTTP contract tests for the 4 endpoints
- Next.js build pass
