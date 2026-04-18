# eFolder Document Upload, Preview & IDP — Production-Ready

**Date:** 2026-04-19
**Status:** Approved

---

## Architecture

**File storage:** In-memory buffer store in the twin API (Map<fileKey, Buffer>). Interface is production-ready — swap to S3/R2 by changing one adapter. Consistent with the twin's in-memory state model.

**Upload flow:**
1. UW drags/clicks to upload a PDF/image to a loan's eFolder
2. `POST /loans/:loanId/documents/:docId/upload` — multipart file upload
3. API stores buffer, sets `fileKey`, `fileUrl`, `fileSize`, `mimeType` on the Document
4. If IDP enabled: auto-calls agent's IDP endpoint to extract structured data
5. Returns updated document with extraction results

**Preview:** `GET /uploads/:fileKey` serves the stored file with correct content-type. Browser renders PDF in iframe, images in img tag.

## Core Type Changes

Add to `Document`:
```ts
fileKey?: string;
fileUrl?: string;
fileSize?: number;
mimeType?: string;
extractedData?: Record<string, unknown>;
```

New action:
```ts
| { type: "AttachFile"; loanId: LoanId; documentId: DocumentId; fileKey: string; fileUrl: string; fileSize: number; mimeType: string }
| { type: "SetExtractedData"; loanId: LoanId; documentId: DocumentId; extractedData: Record<string, unknown> }
```

## API Endpoints

```
POST   /loans/:loanId/documents/:docId/upload    # multipart file
GET    /uploads/:fileKey                          # serve stored file
POST   /loans/:loanId/documents/:docId/extract    # trigger IDP extraction
```

## eFolder UI Redesign

Split-pane layout:
- **Left panel (40%):** Document list grouped by category (Income, Assets, Credit, Title, Insurance, Other), with upload button, status pills, condition links
- **Right panel (60%):** Document preview — PDF viewer (iframe) or image viewer, with extracted data overlay

Document card shows: name, type, status, linked condition, file size, upload date, "View" button

Upload interaction: click "+ Upload" on a document row → file picker → upload → preview appears → optionally run IDP

## Doc-to-Condition Workflow

When a document is uploaded and linked to a condition:
1. Document status auto-transitions: Pending → Received
2. UW reviews the document in the preview panel
3. One-click "Review Complete → Clear Condition" button
4. Condition transitions: Open → Cleared (with the document as evidence)

## IDP Integration

The agent's `POST /api/idp/extract-1003`, `POST /api/idp/extract-paystub`, `POST /api/idp/extract-bankstmt` endpoints accept file uploads and return structured JSON. Wire these into the eFolder:

1. Upload doc → detect type from `docType` field
2. Call appropriate IDP endpoint on the agent service
3. Store extracted data on the Document object
4. Display extracted fields in the preview panel (highlighted key-value pairs)
