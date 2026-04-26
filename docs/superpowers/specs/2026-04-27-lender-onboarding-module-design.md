# Lender Onboarding Module — Design Spec (v2)

> **Goal:** Build an operator-led onboarding workbench that transforms raw lender documents into a fully configured, compliance-validated tenant — from PDF guideline manuals to a live AI underwriting environment. Two-key approval (operator + platform compliance specialist) on AI-extracted guidelines before any credit decisions are made.

> **Architecture:** 8-step wizard at `/platform/tenants` with modern SaaS design. Pluggable `DocumentProcessor` pipeline (Claude Vision + manual entry). AI-extracted guidelines require compliance gating (threshold reasonableness + two-key approval) with full provenance trail (extracted_rules → operator_edits → final_rules). Resumable sessions with optimistic concurrency. 5-case test loan suite per program before activation. Secure credential delivery via magic links (never displayed passwords).

> **Tech Stack:** Existing stack + Claude Sonnet Vision (via Anthropic SDK). Supabase Storage for documents. Magic links via Supabase Auth. Modern UI design for platform screens.

---

## 0. Cross-Spec Dependencies

This spec integrates with Tenant Isolation v2 (Spec D) and Learning & Metrics Engine (Spec B). Explicit reconciliation:

### 0.1 Tenant Isolation v2 Alignment

| Concern | How this spec handles it |
|---------|------------------------|
| Tenant lifecycle states | Step 1 creates tenant with `status = 'onboarding'`. Step 8 transitions to `active`. Middleware allows admin writes during `onboarding` (config, guidelines, users). |
| `tenant_audit_log` | All operator actions logged: `tenant_created`, `document_uploaded`, `extraction_run`, `guideline_approved`, `user_created`, `checklist_run`, `tenant_activated`, `onboarding_cancelled` |
| RLS on `onboarding_sessions` | Enabled with tenant_id policy, consistent with all other tables |
| Event schemas | Defined: `onboarding.tenant.created`, `onboarding.guideline.approved`, `onboarding.tenant.activated` |
| Test loan persistence | In-memory only with `loan.test = true` flag. Dispatch wrapper excludes `test: true` loans from `saveState`. Cleaned up on activation. |
| Lazy-load behavior | Test loan runs in Step 7 trigger the tenant's first store access. Since the tenant is `onboarding` with no Postgres data yet, the lazy-load finds nothing — only the injected test loans exist. |
| JWT verification | Onboarding endpoints are super_admin-only. JWT middleware validates super_admin flag before allowing access to `/onboarding/*` and `/platform/*` routes. |

### 0.2 Learning & Metrics Engine Alignment

| Concern | How this spec handles it |
|---------|------------------------|
| Two-key guideline approval | Initial guidelines at onboarding use the same two-key model: operator approves + platform compliance specialist co-signs (§3.5) |
| Threshold reasonableness | Extracted guidelines validated against the same bounds table from Spec B §3.8 before approval is enabled |
| Extraction provenance | Full audit trail: `extracted_rules` (raw AI output), `operator_edits` (diff), `final_rules` (approved version) stored on `tenant_guidelines` |
| Compliance officer bootstrap | Lender's own compliance officer may not exist at onboarding time (created in Step 6). Platform compliance specialist fills this role at onboarding. Post-activation, lender's compliance officer handles ongoing changes. |
| Disparate-impact check | Deferred to first 30 days post-activation (no historical decision data at onboarding time). Explicit warning on activation screen. |

---

## 1. Onboarding Wizard — 8-Step Workflow

### 1.1 Location & Access

- Located at `/platform/tenants` → "Onboard New Lender" button
- Super_admin only (JWT-verified)
- **Modern design language** — clean cards, progress stepper, large typography. NOT Encompass chrome.
- Any super_admin can resume any onboarding session (not personally owned)

### 1.2 Progress Stepper

```
① Create  ② Upload  ③ Review  ④ Configure  ⑤ Ingestion  ⑥ Users  ⑦ Checklist  ⑧ Activate
   ●─────────○─────────○──────────○───────────○──────────○─────────○──────────○
```

### 1.3 Step Details

**Step 1 — Create Tenant:**
- Fields: Name, Slug (auto-generated, editable), Primary Contact Email, Phone
- Lender type: Correspondent, Wholesale, Retail, Direct (determines SLA presets in Step 4)
- Programs offered: multi-select checkboxes (BankStatement12, BankStatement24, DSCR, AssetDepletion, 1099Only, PnL, ForeignNational, ITIN, FullDocNonQM)
- Creates `tenants` row (status `onboarding`) + `onboarding_sessions` row
- Audit log: `tenant_created`

**Step 2 — Upload Documents:**
- Drag-and-drop upload area
- Each file tagged with category + program
- Categories: "Guideline Manual", "Rate Sheet / LTV Matrix", "Document Checklist", "Condition Templates", "Compliance Policy", "Other"
- Security enforced server-side (§2.5)
- Upload list: file name, category, program, upload date, processing status
- Audit log: `document_uploaded` per file

**Step 3 — Review Extracted Rules:**
- Split-pane: source document (left) / extracted rules editor (right)
- "Extract with AI" triggers Claude Vision processing
- Multi-document per program: operator imports from multiple docs with conflict highlighting (§3.3)
- Compliance gating before approval (§3.5)
- Two-key approval: operator approves → platform compliance specialist co-signs
- Full provenance stored (§3.6)
- Audit log: `extraction_run`, `guideline_approved`

**Step 4 — Configure Platform Settings:**
- SLA thresholds: pre-filled per lender type (§1.4), operator must check "I've confirmed these values with the lender" checkbox
- Agent behavior: risk tolerance, auto-approve threshold, escalation triggers
- Webhook URLs: HTTPS only, SSRF-protected (§1.5)
- Branding: logo upload, color picker with WCAG AA contrast validation

**Step 5 — Set Up Ingestion (optional, skippable):**
- Source name, transformer type, field mapping editor
- "Test Mapping" button with sample JSON
- API key generation: shown once with 30-second auto-clear (§1.6)
- Example curl command
- "Skip — we'll configure ingestion later"

**Step 6 — Create Users:**
- Table: email, role (admin/uw/va/compliance_officer), display name
- "Add User" row button, bulk CSV upload
- Users receive **magic link invite email** (never a displayed password)
- Admin email verified before Step 7 can complete
- Rate limit: max 25 users per hour per session
- If no compliance_officer created: explicit acknowledgment checkbox — "This tenant has no compliance officer. Guideline changes will require platform-level compliance review."
- Audit log: `user_created` per user

**Step 7 — Go-Live Checklist:**
- Required checks (must all pass):
  - At least 1 program has active approved guidelines
  - Guidelines pass schema validation
  - At least 1 admin user created
  - Admin email verified
  - At least 1 VA + 1 UW created
  - SLA confirmed checkbox checked
  - Platform compliance specialist signed off on guidelines
- Optional checks (warning if skipped):
  - API key generated
  - Ingestion mapping tested
  - Test loan suite passed (5 cases per program — strongly recommended)
  - Compliance officer exists (or acknowledgment checkbox)
- "Run All Checks" button
- "Run Test Suite" button (§5)

**Step 8 — Activate:**
- Summary card: tenant name, programs, user count, guideline versions
- Warning: "Disparate-impact analysis will run automatically after first 30 days of decisions"
- "Activate Tenant" confirmation dialog
- Status `onboarding` → `active`
- Test loans cleaned up (§5.4)
- Success screen: portal URL, "invite emails sent" confirmation, quick links to `/t/{slug}/va`, `/t/{slug}/uw`, `/t/{slug}/admin/settings`
- "Onboard Another Lender" button
- Audit log: `tenant_activated`

### 1.4 SLA Presets Per Lender Type

| Lender Type | Queue | Processing | Review | Total |
|-------------|-------|-----------|--------|-------|
| Correspondent | 30min | 60min | 120min | 240min |
| Wholesale | 20min | 45min | 90min | 180min |
| Retail | 45min | 90min | 180min | 360min |
| Direct | 15min | 30min | 60min | 120min |

Operator must confirm with checkbox. Values are editable — presets are starting points, not mandates.

### 1.5 Webhook Security

- HTTPS only — reject HTTP URLs
- Block private IP ranges (RFC 1918, link-local 169.254/16, localhost)
- HMAC-SHA256 signing with shared secret (displayed once at creation)
- Test request: documented payload format, includes `X-Webhook-Signature` header
- Test timeout: 10s, no retry
- Rate limit: 5 test requests per minute

### 1.6 Credential Delivery Security

**API keys:**
- Shown once in a highlighted box with 30-second auto-clear countdown
- "I've saved this key" acknowledgment button required before continuing
- Copy-to-clipboard button (clears clipboard after 60s)
- Audit-logged: `api_key_generated`

**User accounts:**
- Invite-only via magic link email (Supabase Auth)
- Never a displayed password — user sets their own on first login
- MFA enrollment required before any tenant data access (enforced at auth level)
- Admin email verification required in Step 7 checklist
- Email address typo protection: confirmation dialog "Send invite to admin@lender.com?" before sending

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
  perFieldConfidence?: Record<string, number>;  // field path → 0-1 confidence
  overallConfidence?: number;
  warnings?: string[];
  error?: string;
  tokensUsed?: { input: number; output: number };
  cost?: number;  // estimated USD
}
```

### 2.2 Processor Registry

```typescript
const processors = new Map<string, DocumentProcessor>();
processors.set("claude-vision", new ClaudeVisionProcessor());
processors.set("manual-entry", new ManualEntryProcessor());
// Future: "excel-parser", "external-api", "custom-function", "webhook-processor"
```

### 2.3 Claude Vision Processor

1. PDF pages converted to images (or sent directly via Vision API)
2. For PDFs > 100 pages: split into batches, process sequentially, merge results
   - Operator notification: "This document has {N} pages — extracting in {batches} batches"
   - Cost estimate before extraction: "Approximately {tokens} tokens (~${cost})"
3. Each page processed with Claude Sonnet Vision + tool_use:
   - System prompt (cached): NQM guideline extraction instructions
   - Tool: `extract_guidelines` matching `GuidelineRules` structure
   - **Per-field confidence prompting:**
     ```
     For each field, return a confidence score 0-1:
     0.9+ = document explicitly states this value
     0.5-0.8 = inference required from context
     0.0-0.5 = value missing or ambiguous
     ```
   - Zero-data-retention header on all calls
4. Results merged across pages into one `GuidelineRules` draft
5. Per-field confidence + overall confidence (weighted mean of required fields)
6. Warnings for conflicting values across pages
7. Token usage and estimated cost tracked in `extraction_results`

### 2.4 Manual Entry Processor

- Operator fills guided form auto-generated from `GuidelineRulesSchema` (react-hook-form + Zod resolver)
- No AI involved — pure manual data entry
- All fields start as ⚪ Empty, filled by operator
- Used when documents are too complex for AI or as fallback

### 2.5 Document Upload Security

**Server-side validation (enforced on every upload):**

```typescript
const ALLOWED_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "image/png": ".png",
  "image/jpeg": ".jpg",
};
const MAX_FILE_SIZE = 50 * 1024 * 1024;        // 50MB per file
const MAX_FILES_PER_SESSION = 100;
const MAX_TOTAL_SIZE_PER_SESSION = 2 * 1024 * 1024 * 1024;  // 2GB total
```

- **MIME validation:** file magic bytes verified server-side (not Content-Type header)
- **Virus scanning:** ClamAV or equivalent before storage (log + reject infected files)
- **NPI detection:** Warn operator if document appears to contain SSN/account patterns — "This document may contain PII. Please verify it's appropriate for upload."
- **Storage:** Supabase Storage bucket with encryption at rest
- **Signed URLs:** Files accessed via time-limited signed URLs (15 minute expiry) for the review UI
- **Path scoping:** `onboarding/{tenantId}/{docUUID}-{sanitizedFileName}` — UUID prefix prevents collision, tenantId prefix prevents cross-tenant access
- **Cross-tenant protection:** Upload endpoint validates `tenantId` matches the onboarding session's tenant

### 2.6 Extensibility

Adding a new processor requires: (1) implement `DocumentProcessor` interface, (2) register in processor map, (3) add to processor type dropdown. No pipeline, review UI, or wizard changes needed.

---

## 3. Review & Approval UI

### 3.1 Split-Pane Layout

**Left pane — Source Document Viewer:**
- Embedded PDF/image viewer with page navigation and zoom
- Scrollable independently from right pane

**Right pane — Extracted Rules Editor:**
- Organized by `GuidelineRules` sections with appropriate input controls
- Auto-generated from schema (react-hook-form + Zod resolver for manual entry)
- Editable table for LTV matrix, reserves tiers, required docs, condition templates

### 3.2 Field Confidence States

| State | Indicator | Meaning | Action Required |
|-------|-----------|---------|-----------------|
| 🟢 High confidence (>0.8) | Green dot | AI confident — likely correct | Verify recommended |
| 🟡 Low confidence (0.5-0.8) | Yellow dot | Inference required — operator must verify | Must verify before approval |
| 🔴 Very low (<0.5) | Red dot | Ambiguous or missing — needs manual input | Must fill or confirm N/A |
| ⚪ Empty | Gray dot | Not found in document | Must fill or mark N/A |

**Known limitation documented:** Model self-reported confidence is correlated with but not identical to actual accuracy.

### 3.3 Multi-Document Per Program

When multiple documents cover the same program:

1. Extraction runs per-document (each produces its own draft)
2. Editor shows the **primary draft** (first extraction) with "Import from {other_doc}" button
3. Importing layers the second document's fields on top with **conflict highlighting**:
   - Green: new field not in primary (additive)
   - Orange: conflicting value (e.g., maxDtiBack: 50 vs 45) — operator picks
   - Gray: same value (no conflict)
4. Operator resolves all orange conflicts before approval

### 3.4 Re-Extraction Protection

"Extract Again" workflow:
1. Confirmation dialog: "This will create a new extraction. Your current edits will be preserved for comparison."
2. New extraction runs into a **separate draft**
3. 3-pane diff view: Original Extraction / New Extraction / Your Edits
4. Operator merges selectively — edits are never lost without explicit confirmation

### 3.5 Compliance Gating (Two-Key Approval)

Before "Approve for {program}" enables:

1. **Threshold reasonableness check** runs automatically on the draft:
   - Same bounds table as Learning & Metrics Spec B §3.8
   - Blocks: DTI > 65%, FICO < 500, LTV > 97%, ATR verification disabled, etc.
   - Failures shown inline on the offending fields with explanation
   - Must fix all blocks before approval

2. **Operator approval** (first key):
   - Operator clicks "Submit for Compliance Review"
   - Draft moves to `pending_compliance` status
   - Operator recorded as `approved_by`

3. **Platform compliance specialist approval** (second key):
   - Compliance specialist reviews extraction provenance + final rules
   - Sees: original document, AI extraction, operator edits, final values
   - "Approve" or "Reject with notes"
   - Recorded as `compliance_signoff_by`
   - Must be a different user than the operator (separation of duties)

4. Only after both keys: guidelines saved to `tenant_guidelines` as version 1

### 3.6 Extraction Provenance

Every approved guideline stores full audit trail:

```typescript
{
  extracted_rules: {...},       // raw AI output (unmodified)
  operator_edits: {...},        // diff between extracted and final
  final_rules: {...},           // what got saved as active guidelines
  source_document_ids: [...],   // which uploaded docs informed this version
  extraction_model_id: "claude-sonnet-4-6",
  extraction_timestamp: "...",
  extraction_tokens: { input: N, output: N },
  per_field_confidence: {...},  // AI's confidence per field
  approved_by: "operator-uuid",
  compliance_signoff_by: "specialist-uuid",
  threshold_check_results: [...],
}
```

ECOA exam response: "Here is exactly what our AI extracted, what the operator changed, and who approved the final version."

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
  version INT NOT NULL DEFAULT 1,  -- optimistic concurrency
  started_by UUID,                 -- operator who started (for audit, not ownership)
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  abandoned_at TIMESTAMPTZ         -- set by auto-archive policy
);

ALTER TABLE onboarding_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_rw ON onboarding_sessions
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::uuid);
```

### 4.2 Optimistic Concurrency

- Every update requires `If-Match: {version}` header
- On save: `UPDATE ... WHERE id = $1 AND version = $2 RETURNING version + 1`
- Version mismatch → 409 Conflict: "Another session modified this onboarding. Refresh to see latest."
- Prevents silent overwrites from dual-window or multi-operator edits

### 4.3 Resumable Workflow

- Step 1 creates both `tenants` and `onboarding_sessions` rows
- Each step saves to `step_data`: `{ "step1": {...}, "step2": {...} }`
- "Save & Exit" at any point
- Tenant list shows "Onboarding: Step 3/8 — Review Rules" badge
- Any super_admin can resume any session (not personally owned)
- Backward navigation preserves forward step data (no invalidation — operator responsible for consistency)

### 4.4 Session Abandonment Policy

| Timeline | Action |
|----------|--------|
| 14 days inactive | Reminder notification to operator |
| 60 days inactive | Auto-archive: `abandoned_at` set, tenant status stays `onboarding`, badge shows "Abandoned" |
| 180 days inactive | Hard delete: documents purged from storage, tenant row deleted (if no users/data), slug released |

- Audit log entry on each lifecycle transition
- Operator can reactivate an abandoned session (resets the timer)

### 4.5 Cancellation Behavior Per Step

| Cancelled At | Data Cleanup |
|-------------|-------------|
| Step 1 (just created) | Delete tenant row + session row |
| Steps 2-3 (documents + extraction) | Delete documents from storage, delete session, retain tenant row with audit trail |
| Steps 4-5 (config + ingestion) | Revoke API keys, delete session, retain tenant + config for audit |
| Step 6 (users created) | Deactivate all created users (don't delete — audit), retain everything for retention |
| Steps 7-8 (checklist + activation) | Same as Step 6 |

All cancellations audit-logged: `onboarding_cancelled` with step number and reason.

---

## 5. Test Loan Suite & Go-Live Validation

### 5.1 Test Loan Suite (5 Cases Per Program)

Instead of a single test loan, each program runs 5 curated cases:

| Test Case | Purpose | Expected Outcome |
|-----------|---------|-----------------|
| Strong file (clear approve) | Sanity check happy path | Approve with high confidence |
| Marginal file at threshold | Validate threshold values | Conditional or marginal |
| Weak file (clear deny) | Validate denial logic | Suspend or deny |
| Missing income docs | Validate condition generation | Conditions flagged |
| High LTV + low FICO | Validate matrix lookups | Matrix-appropriate decision |

Generated from `@twin/fixtures` with values adjusted to match the tenant's guideline thresholds.

### 5.2 Test Execution

1. Operator clicks "Run Test Suite" → selects program
2. 5 synthetic loans generated with `tenantId` + `test: true`
3. Agent pipeline runs each against tenant's approved guidelines
4. Results displayed as a matrix:

```
Test Case          | Expected | Actual   | Match | Confidence
Strong file        | Approve  | Approve  | ✅    | 0.87
Marginal           | Cond.    | Cond.    | ✅    | 0.72
Weak file          | Deny     | Suspend  | ⚠️    | 0.65
Missing docs       | Cond.    | Cond.    | ✅    | 0.78
High LTV/Low FICO  | Suspend  | Suspend  | ✅    | 0.81
```

5. Pass criterion: all 5 produce expected outcome OR operator explicitly approves deviation with rationale
6. Batch completes in ~30 seconds

### 5.3 Test Loan Persistence

- Test loans exist **in-memory only** with `loan.test = true` flag
- Dispatch wrapper excludes `test: true` loans from `persistence.saveState()`
- Decision records written with `is_test: true` (excluded from metrics aggregation)
- On API restart during onboarding: test loans lost — operator re-runs test suite

### 5.4 Post-Activation Cleanup

- All test loans removed from in-memory store
- Test decision records retained (tagged `is_test: true`) for audit
- Cleanup order: loans first, then session completed_at set, then status → active
- Partial cleanup failure: log error, continue activation (test data presence is non-blocking)

---

## 6. Tenant Guidelines Schema (Extended)

```sql
-- Extended from Spec A with provenance fields
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
  CHECK (status IN ('draft', 'pending_compliance', 'active', 'archived'));
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS source_document_ids UUID[];
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS extracted_rules JSONB;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS operator_edits JSONB;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS per_field_confidence JSONB;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS extraction_model_id TEXT;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS extraction_tokens JSONB;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS compliance_signoff_by TEXT;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS threshold_check_results JSONB;
ALTER TABLE tenant_guidelines ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ;

-- Index for active guidelines lookup
CREATE INDEX IF NOT EXISTS idx_guidelines_active ON tenant_guidelines(tenant_id, program)
  WHERE status = 'active';
```

---

## 7. API Endpoints

### 7.1 Onboarding Session Management

```
POST /onboarding
  Body: { tenantName, slug, contactEmail, phone?, lenderType, programs[] }
  → { tenantId, sessionId, currentStep: 1 }
  Audit: tenant_created

GET /onboarding/:tenantId
  → Full session state (currentStep, stepData, documents, checklist)

PATCH /onboarding/:tenantId
  Headers: If-Match: {version}
  Body: { currentStep?, stepData?, notes? }
  → Updated state + new version
  409 on version mismatch

DELETE /onboarding/:tenantId
  → Cancels onboarding (cleanup per step — §4.5)
  Audit: onboarding_cancelled
```

### 7.2 Document Upload & Processing

```
POST /onboarding/:tenantId/documents
  Body: multipart form (file + category + program)
  Validation: MIME magic bytes, size ≤ 50MB, file count ≤ 100
  → { documentId, fileUrl (signed, 15min), fileName }
  Audit: document_uploaded

POST /onboarding/:tenantId/documents/:docId/process
  Body: { processor: "claude-vision" | "manual-entry" }
  → ProcessorOutput (extractedRules, perFieldConfidence, warnings, tokensUsed, cost)
  Audit: extraction_run

GET /onboarding/:tenantId/documents
  → List all documents with extraction status

DELETE /onboarding/:tenantId/documents/:docId
  → Remove from session + storage
```

### 7.3 Guideline Review & Approval

```
GET /onboarding/:tenantId/extraction/:docId
  → Extracted rules draft for review

PUT /onboarding/:tenantId/extraction/:docId
  Body: { rules: Partial<GuidelineRules> }
  → Saves operator edits (draft)

POST /onboarding/:tenantId/guidelines/:program/submit-for-review
  Body: { rules: GuidelineRules }
  → Validates with GuidelineRulesSchema + threshold reasonableness
  → Status: pending_compliance
  Audit: guideline_submitted

POST /onboarding/:tenantId/guidelines/:program/compliance-approve
  Body: { approved: boolean, notes?: string }
  Requirement: different user than submit-for-review operator
  → If approved: saves to tenant_guidelines v1 (status: active)
  → If rejected: returns to draft with notes
  Audit: guideline_approved OR guideline_rejected
```

### 7.4 Validation & Activation

```
POST /onboarding/:tenantId/run-checklist
  → { required: [...], optional: [...], canActivate: boolean }

POST /onboarding/:tenantId/test-loan
  Body: { program: string }
  → { results: [{ testCase, expected, actual, match, confidence }], passCount, totalCount }

POST /onboarding/:tenantId/activate
  → Validates checklist, activates tenant, cleans up test data
  Audit: tenant_activated
```

---

## 8. Event Schemas

```typescript
const OnboardingTenantCreatedEvent = {
  eventType: "onboarding.tenant.created",
  eventVersion: 1,
  tenantId: string,
  slug: string,
  lenderType: string,
  programs: string[],
  createdBy: string,
  occurredAt: string,
};

const OnboardingGuidelineApprovedEvent = {
  eventType: "onboarding.guideline.approved",
  eventVersion: 1,
  tenantId: string,
  program: string,
  guidelineVersion: number,
  approvedBy: string,
  complianceSignoffBy: string,
  occurredAt: string,
};

const OnboardingTenantActivatedEvent = {
  eventType: "onboarding.tenant.activated",
  eventVersion: 1,
  tenantId: string,
  programs: string[],
  guidelineVersionsByProgram: Record<string, number>,
  userCount: number,
  activatedBy: string,
  occurredAt: string,
};
```

Subscribers: Learning Engine (starts pattern detection for new tenant), SLA Monitor (starts monitoring), WebSocket (broadcasts activation event).

---

## 9. Roles

### 9.1 Platform Compliance Specialist

New role: `platform_compliance_specialist` — a platform-level employee (not tenant-scoped) who reviews AI-extracted guidelines before initial activation.

| Capability | Access |
|-----------|--------|
| Review extraction provenance | Yes |
| View source documents | Yes |
| Approve/reject initial guidelines | Yes (second key) |
| View threshold check results | Yes |
| Modify guidelines | No (operator handles edits) |
| Access tenant data (loans, decisions) | No |
| Create tenants | No |

Added to RBAC permissions. JWT `app_metadata.role = "platform_compliance_specialist"`.

---

## 10. Testing Strategy

### 10.1 Onboarding Flow Tests

```
- Create tenant → status "onboarding", session created, audit logged
- Save and resume → step data persisted, correct step resumed
- Concurrent edit → 409 on version mismatch
- Cancel at each step → appropriate cleanup per §4.5
- Abandoned session → archived at 60 days
- Different super_admin resumes session → allowed
```

### 10.2 Document Processing Tests

```
- Upload valid PDF → stored, tracked in session
- Upload invalid MIME type → rejected
- Upload > 50MB → rejected
- File count > 100 → rejected
- Claude Vision: mock SDK, verify tool_use structure + per-field confidence
- Claude Vision: large PDF (>100 pages) → split and batch processed
- Manual entry: form data passes through as-is
- Unknown processor → error
```

### 10.3 Review & Approval Tests

```
- Threshold check: DTI 70 → blocked with explanation
- Two-key: operator submits → pending_compliance status
- Two-key: same user tries compliance approve → rejected (separation of duties)
- Two-key: different user approves → saved as active v1
- Re-extraction: operator edits preserved for comparison
- Multi-document: conflict highlighted, operator resolves
- Provenance: extracted_rules, operator_edits, final_rules all stored
```

### 10.4 Go-Live Tests

```
- All required checks pass → canActivate = true
- Missing guidelines → canActivate = false
- Admin email not verified → canActivate = false
- Test suite: 5 cases run, results matrix returned
- Test suite: deviation requires operator rationale
- Activation → status = active, test data cleaned, events published
- Activation with failing required check → rejected
```

### 10.5 Security Tests

```
- Upload with spoofed Content-Type (MIME mismatch) → rejected
- Cross-tenant document access → rejected
- Unsigned URL access after expiry → rejected
- Webhook URL with private IP → rejected
- API key displayed → auto-clears after 30s
- User creation > 25/hour → rate limited
```

---

## Non-Goals (Explicitly Out of Scope)

- **Self-service onboarding** — Operator-led only.
- **Excel parser processor** — Interface designed, implementation deferred.
- **External API processor** — Interface supports it, deferred.
- **Automated guideline comparison** — Comparing to industry benchmarks. Future.
- **Lender-facing onboarding portal** — All through operator admin UI.
- **Billing / subscription** — Activation doesn't trigger billing.
- **Full disparate-impact analysis at onboarding** — Deferred to 30 days post-activation (no historical data yet).
- **Document OCR** — Claude Vision handles natively.
- **Automated NPI redaction of uploaded documents** — Warn only, operator responsible for redaction before upload.
