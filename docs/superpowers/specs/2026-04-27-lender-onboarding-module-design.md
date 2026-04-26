# Lender Onboarding Module — Design Spec

> **Goal:** Build an operator-led onboarding workbench that transforms raw lender documents into a fully configured tenant — from PDF guideline manuals to a live, AI-powered underwriting environment in hours instead of weeks. Pluggable document processing pipeline with Claude Vision extraction and operator review.

> **Architecture:** 8-step wizard inside `/platform/tenants` with modern SaaS design (not Encompass chrome). Pluggable `DocumentProcessor` interface for AI extraction, manual entry, and future integrations. Resumable onboarding sessions persisted in `onboarding_sessions` table. Go-live checklist with test loan validation. Operator reviews AI-extracted guidelines in a split-pane UI before approval.

> **Tech Stack:** Existing stack + Claude Sonnet Vision (via Anthropic SDK, already installed). Modern UI design for platform screens. Supabase Storage for uploaded documents.

---

## 1. Onboarding Wizard — 8-Step Workflow

### 1.1 Location & Access

- Located at `/platform/tenants` → "Onboard New Lender" button
- Super_admin only
- **Modern design language** — clean cards, progress stepper, large typography, subtle shadows. NOT Encompass chrome. (Platform/admin screens use modern SaaS design per the project's two-design-language philosophy.)

### 1.2 Progress Stepper

Displayed at the top of every step:

```
① Create  ② Upload  ③ Review  ④ Configure  ⑤ Ingestion  ⑥ Users  ⑦ Checklist  ⑧ Activate
   ●─────────○─────────○──────────○───────────○──────────○─────────○──────────○
```

Steps can be navigated backward to edit. Forward navigation validates the current step.

### 1.3 Step Details

**Step 1 — Create Tenant:**
- Fields: Name, Slug (auto-generated from name, editable), Primary Contact Email, Phone
- Lender type dropdown: Correspondent, Wholesale, Retail, Direct
- Programs offered: multi-select checkboxes (BankStatement12, BankStatement24, DSCR, AssetDepletion, 1099Only, PnL, ForeignNational, ITIN, FullDocNonQM)
- On submit: creates `tenants` row with status `onboarding` + creates `onboarding_sessions` row

**Step 2 — Upload Documents:**
- Drag-and-drop upload area accepting PDF, Excel, Word, PNG, JPG
- Each file tagged with:
  - Category dropdown: "Guideline Manual", "Rate Sheet / LTV Matrix", "Document Checklist", "Condition Templates", "Compliance Policy", "Other"
  - Program dropdown: which NQM program this applies to (or "All Programs")
- Files stored in Supabase Storage: `onboarding/{tenantId}/{fileName}`
- Upload list shows file name, category, program, upload date, processing status
- Operator can upload multiple files, reorder, delete

**Step 3 — Review Extracted Rules:**
- Split-pane view: source document (left) / extracted rules editor (right)
- Operator selects a document → clicks "Extract with AI" → Claude Vision processes it
- Extracted rules displayed in editable form organized by GuidelineRules sections
- Field confidence indicators: 🟢 high (>0.8), 🟡 low (<0.8), ⚪ empty (not found)
- Per-field actions: edit, flag for lender clarification, accept
- "Approve for {program}" button per program → validates with GuidelineRulesSchema → saves to `tenant_guidelines` as version 1
- One review per program — step complete when at least one program approved

**Step 4 — Configure Platform Settings:**
- SLA thresholds: 4 numeric inputs with industry defaults pre-filled (queue: 30min, processing: 60min, review: 120min, total: 240min)
- Agent behavior: risk tolerance (conservative/moderate/aggressive), auto-approve threshold (slider 0-1), escalation triggers (checkboxes)
- Webhook URLs (optional): event types to subscribe, URL, test button
- Branding (optional): logo upload, primary color picker

**Step 5 — Set Up Ingestion (optional):**
- Source name, transformer type selection (generic-json)
- Visual field mapping editor: source field → target field
- "Test Mapping" button: paste sample JSON → see transformed output + validation
- Generate API key: one-click, shows plaintext once with copy button
- Shows example curl command for testing ingestion
- Can be skipped: "Skip — we'll configure ingestion later"

**Step 6 — Create Users:**
- Table: email, role (dropdown: admin/uw/va/compliance_officer), display name
- "Add User" row button
- Bulk invite via CSV upload (optional): columns email, role, display_name
- On submit: creates users in Supabase Auth with `app_metadata: { tenant_id, role }`
- Minimum: 1 admin required. VA + UW recommended but not blocking.

**Step 7 — Go-Live Checklist:**
- Required checks (must all pass to activate):
  - At least 1 program has active guidelines
  - Guidelines pass schema validation
  - At least 1 admin user created
  - At least 1 VA + 1 UW created
  - SLA thresholds configured (not just defaults — operator confirmed)
- Optional checks (warning if skipped):
  - API key generated
  - Ingestion mapping tested with sample data
  - Test loan processed end-to-end (strongly recommended)
- "Run All Checks" button executes validation
- "Run Test Loan" button: generates synthetic loan, runs agent, shows results

**Step 8 — Activate:**
- Summary card: tenant name, programs, user count, guideline versions, configuration status
- "Activate Tenant" button → status `onboarding` → `active`
- Confirmation dialog: "This will enable loan ingestion and user logins for {name}. Proceed?"
- Success screen: portal URL, admin credentials, quick link to tenant settings
- Test loans cleaned up after activation

---

## 2. Document Processing Pipeline

### 2.1 Processor Interface

```typescript
interface DocumentProcessor {
  name: string;
  supportedFormats: string[];
  process(input: ProcessorInput): Promise<ProcessorOutput>;
}

interface ProcessorInput {
  fileUrl: string;
  fileName: string;
  mimeType: string;
  category: string;
  program?: string;
  tenantId: string;
  metadata?: Record<string, unknown>;
}

interface ProcessorOutput {
  success: boolean;
  extractedRules?: Partial<GuidelineRules>;
  extractedMatrix?: Array<{ minFico: number; maxFico: number; maxLtv: number; occupancy?: string }>;
  extractedConditions?: Array<{ category: string; source: string; description: string }>;
  extractedDocRequirements?: Array<{ docType: string; description: string; expirationDays?: number }>;
  rawText?: string;
  confidence?: number;
  warnings?: string[];
  error?: string;
}
```

### 2.2 Processor Registry

```typescript
const processors = new Map<string, DocumentProcessor>();
processors.set("claude-vision", new ClaudeVisionProcessor());
processors.set("manual-entry", new ManualEntryProcessor());

// Future extensibility — adding a new processor is one file + one registry entry:
// processors.set("excel-parser", new ExcelParserProcessor());
// processors.set("external-api", new ExternalApiProcessor({ endpoint, credentials }));
// processors.set("custom-function", new CustomFunctionProcessor(fn));
```

### 2.3 Built-In Processors

**Claude Vision Processor:**
1. PDF pages converted to images (or sent directly as PDF to Vision API)
2. Each page processed with Claude Sonnet Vision + tool_use:
   - System prompt: NQM guideline extraction instructions (cached via `cache_control: ephemeral`)
   - Tool: `extract_guidelines` with input schema matching `GuidelineRules` structure
   - Zero-data-retention header on all calls
3. Results merged across pages into one `GuidelineRules` draft
4. Confidence score: percentage of required fields successfully extracted
5. Warnings for ambiguous or conflicting values across pages

**Manual Entry Processor:**
- Operator fills guided form with dropdowns, number inputs, toggles
- Form structure matches `GuidelineRules` sections
- No AI involved — pure manual data entry
- Used when documents are too complex for AI or as a fallback

### 2.4 Extensibility Design

The pipeline supports future integration methods without architecture changes:

| Future Processor | Input | Method |
|-----------------|-------|--------|
| Excel Parser | .xlsx rate sheets | Programmatic parsing with `xlsx` library |
| PDF Table Extractor | PDF with tables | `pdfjs` or Tabula-based extraction |
| External API | Document URL | Send to third-party extraction service (e.g., AWS Textract, Google Document AI) |
| Custom Function | Any | TypeScript function registered by the operator |
| Webhook Processor | Event-driven | External system calls back with extraction results |

Adding any of these requires: (1) implement `DocumentProcessor` interface, (2) register in processor map, (3) add to processor type dropdown in Step 2 UI. No changes to pipeline, review UI, or wizard needed.

---

## 3. Review & Approval UI

### 3.1 Split-Pane Layout

**Left pane — Source Document Viewer:**
- Embedded PDF viewer (or image viewer for images)
- Page navigation for multi-page documents
- Zoom controls
- Scrollable independently from right pane

**Right pane — Extracted Rules Editor:**

Organized by `GuidelineRules` sections with appropriate input controls:

| Section | Fields | Input Types |
|---------|--------|-------------|
| Credit | minFico, maxLate30d/60d/90d, disputePolicy, maxOpenCollections | Number inputs, dropdown |
| Income | maxDtiFront, maxDtiBack, qualifyingMethods, expenseFactors, minDscrRatio | Sliders, checkboxes, key-value editor |
| LTV | maxLtv, matrix (FICO × occupancy → maxLtv) | Number, editable table |
| Reserves | minMonths, byLtvTier table | Number, editable table |
| Documents | Required docs list | Table: docType dropdown, description text, expiration number |
| Conditions | Default templates | Table: category dropdown, source dropdown, description text |
| Compliance | stateRestrictions, geoOverlays, maxPointsFeesPct | Multi-select, key-value, number |

### 3.2 Field Confidence States

| State | Indicator | Meaning |
|-------|-----------|---------|
| 🟢 Extracted (high confidence) | Green dot | AI confidence > 0.8 — likely correct |
| 🟡 Extracted (low confidence) | Yellow dot | AI confidence < 0.8 — operator should verify |
| ⚪ Empty | Gray dot | Not found in document — operator must fill or mark N/A |

### 3.3 Per-Field Actions

- **Edit**: click any field to modify the extracted value
- **Flag**: mark as "needs clarification from lender" — adds a note visible in the onboarding session, does not block approval
- **Accept**: confirm field is correct (removes confidence indicator, marks as verified)

### 3.4 Approval Flow

- "Extract Again" — re-run Claude Vision (useful after uploading a better document)
- "Save Draft" — persist current state without approving
- "Approve for {program}" — validates against `GuidelineRulesSchema`:
  - If valid: saves to `tenant_guidelines` as version 1, marks extraction as "reviewed"
  - If invalid: shows Zod validation errors inline on the failing fields
- One review + approval per program. Step 3 is complete when at least one program has approved guidelines.

---

## 4. Onboarding State Persistence

### 4.1 Database Schema

```sql
CREATE TABLE onboarding_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  current_step INT NOT NULL DEFAULT 1,
  step_data JSONB NOT NULL DEFAULT '{}',
  uploaded_documents JSONB NOT NULL DEFAULT '[]',
  extraction_results JSONB NOT NULL DEFAULT '{}',
  checklist_results JSONB NOT NULL DEFAULT '{}',
  notes TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

### 4.2 Resumable Workflow

- Step 1 (Create Tenant) creates both `tenants` row AND `onboarding_sessions` row
- Each step saves its data to `step_data` as `{ "step1": {...}, "step2": {...}, ... }`
- "Save & Exit" at any point — returns to tenant list
- Tenant list shows "Onboarding: Step 3 of 8" badge for in-progress sessions
- Re-opening resumes at `current_step`
- Operator can navigate backward to edit any completed step
- Forward navigation validates the current step before proceeding

### 4.3 Uploaded Documents Tracking

```json
[
  {
    "id": "doc-uuid",
    "fileName": "Acme_Guidelines_2026.pdf",
    "fileUrl": "onboarding/tenant-uuid/Acme_Guidelines_2026.pdf",
    "category": "guideline_manual",
    "program": "BankStatement12",
    "uploadedAt": "2026-04-27T10:00:00Z",
    "processorUsed": "claude-vision",
    "extractionStatus": "reviewed",
    "confidence": 0.85
  }
]
```

### 4.4 Multiple Concurrent Onboardings

The operator can have multiple tenants in onboarding simultaneously. Each has its own `onboarding_sessions` row. The tenant list shows all of them with progress badges.

---

## 5. Test Loan & Go-Live Validation

### 5.1 Test Loan Flow

1. Operator clicks "Run Test Loan" in Go-Live Checklist (Step 7)
2. Operator selects which program to test
3. System generates a synthetic test loan from `@twin/fixtures` matching that program
4. Loan tagged with tenant's ID + `test: true` flag
5. Agent pipeline runs against the **tenant's own guidelines** (not demo defaults)
6. Result displayed:
   - Agent recommendation (approve/suspend/deny)
   - Confidence score
   - Conditions generated
   - Pipeline duration
   - Any errors or warnings
7. Operator evaluates: "Does this match what this lender's guidelines would produce?"
   - If yes → check passes ✅
   - If no → go back to Step 3, adjust guidelines, re-test
8. Test loans excluded from production metrics (`test: true` filter)
9. Test loans cleaned up after activation (Step 8)

### 5.2 Go-Live Checklist API

```
POST /onboarding/:tenantId/run-checklist
  → {
      required: [
        { check: "guidelines_exist", pass: boolean, detail: string },
        { check: "guidelines_valid", pass: boolean, detail: string },
        { check: "admin_user", pass: boolean, detail: string },
        { check: "va_uw_users", pass: boolean, detail: string },
        { check: "sla_configured", pass: boolean, detail: string },
      ],
      optional: [
        { check: "api_key", pass: boolean, detail: string },
        { check: "ingestion_tested", pass: boolean, detail: string },
        { check: "test_loan", pass: boolean, detail: string },
      ],
      canActivate: boolean
    }

POST /onboarding/:tenantId/test-loan
  Body: { program: string }
  → {
      loanId: string,
      recommendation: string,
      confidence: number,
      conditions: string[],
      agentDuration: number,
      success: boolean,
      error?: string
    }
```

### 5.3 Activation (Step 8)

- Tenant status `onboarding` → `active`
- `onboarding_sessions.completed_at` set
- Test loans removed from store
- Success screen displays:
  - Portal URL (users log in, auto-scoped by JWT)
  - Admin credentials or "invite sent" confirmation
  - Quick links: tenant settings, VA dashboard, UW queue
  - "Onboard Another Lender" button

---

## 6. API Endpoints

### 6.1 Onboarding Session Management

```
POST /onboarding
  Body: { tenantName, slug, contactEmail, phone?, lenderType, programs[] }
  → Creates tenant + onboarding session, returns { tenantId, sessionId, currentStep: 1 }

GET /onboarding/:tenantId
  → Returns full onboarding session state (currentStep, stepData, documents, checklist)

PATCH /onboarding/:tenantId
  Body: { currentStep?, stepData?, notes? }
  → Updates session, returns updated state

DELETE /onboarding/:tenantId
  → Cancels onboarding, deletes tenant if no data, sets offboarding if data exists
```

### 6.2 Document Upload & Processing

```
POST /onboarding/:tenantId/documents
  Body: multipart form (file + category + program)
  → Stores file, returns { documentId, fileUrl, fileName }

POST /onboarding/:tenantId/documents/:docId/process
  Body: { processor: "claude-vision" | "manual-entry" }
  → Runs extraction, returns ProcessorOutput

GET /onboarding/:tenantId/documents
  → List all uploaded documents with extraction status

DELETE /onboarding/:tenantId/documents/:docId
  → Remove document from session + storage
```

### 6.3 Guideline Review & Approval

```
GET /onboarding/:tenantId/extraction/:docId
  → Returns extracted GuidelineRules draft for review

PUT /onboarding/:tenantId/extraction/:docId
  Body: { rules: Partial<GuidelineRules> }
  → Saves operator's edits to the draft

POST /onboarding/:tenantId/approve-guidelines/:program
  Body: { rules: GuidelineRules }
  → Validates with GuidelineRulesSchema, saves to tenant_guidelines v1
```

### 6.4 Validation & Activation

```
POST /onboarding/:tenantId/run-checklist
  → Runs all checks, returns results

POST /onboarding/:tenantId/test-loan
  Body: { program: string }
  → Generates + processes test loan, returns results

POST /onboarding/:tenantId/activate
  → Validates checklist, activates tenant, cleans up test data
```

---

## 7. Testing Strategy

### 7.1 Onboarding Flow Tests

```
- Create tenant via onboarding → status = "onboarding", session created
- Save and resume → step data persisted, resumes at correct step
- Upload document → stored in Supabase Storage, tracked in session
- Delete document → removed from storage and session
- Navigate backward → previous step data preserved
- Cancel onboarding → tenant cleaned up
```

### 7.2 Document Processing Tests

```
- Claude Vision processor: mock Anthropic SDK, verify tool_use call structure
- Claude Vision processor: merge multi-page results into single GuidelineRules
- Manual entry processor: returns operator-provided data as-is
- Unknown processor name → error
- Processor failure → error propagated, document marked as failed
```

### 7.3 Review & Approval Tests

```
- Approve valid guidelines → saved to tenant_guidelines version 1
- Approve invalid guidelines → Zod validation errors returned
- Save draft → extraction_results updated in session
- Re-extract → previous results replaced with new extraction
```

### 7.4 Go-Live Checklist Tests

```
- All required checks pass → canActivate = true
- Missing guidelines → canActivate = false
- Missing users → canActivate = false
- Optional checks failed → canActivate = true with warnings
- Test loan succeeds → check passes
- Test loan fails (agent error) → check fails with error detail
```

### 7.5 Activation Tests

```
- Activate with passing checklist → status = "active", session completed
- Activate with failing required check → rejected
- Test loans cleaned up after activation
- Activation event published (for audit trail)
```

---

## Non-Goals (Explicitly Out of Scope)

- **Self-service onboarding** — Operator-led only. Lenders don't have direct access to the wizard.
- **Excel parser processor** — Interface designed for it, but only Claude Vision + Manual Entry built in this spec.
- **External API processor** — Interface supports it, implementation deferred.
- **Automated guideline comparison** — Comparing lender guidelines to industry benchmarks. Future feature.
- **Lender-facing onboarding portal** — All onboarding happens through the platform operator's admin UI.
- **Document OCR / text extraction** — Claude Vision handles this natively. No separate OCR pipeline.
- **Billing / subscription management** — Tenant activation doesn't trigger billing. Deferred to business operations spec.
