# Intelligent Guideline Processing — Design Spec (F1)

> **Goal:** Build a document processing pipeline that transforms lender guideline PDFs (narrative text + matrix tables) into a searchable, queryable knowledge base — with hierarchical RAG chunking in ChromaDB for narrative guidelines, structured Postgres tables for LTV/FICO matrices, and a conversational chatbot that lets VAs and UWs ask natural language questions with source citations.

> **Architecture:** Three processing methods for three document types, all running in the Python agent service. Narrative guidelines → hierarchical paragraph chunking with section metadata → ChromaDB (semantic embeddings + metadata filtering). Matrix tables → Claude Vision structured extraction per program → Postgres tables (program_matrix_tiers, program_requirements, geographic_restrictions). Chatbot + agent tools query both stores with smart routing (narrative questions → ChromaDB, parameter queries → Postgres). Per-tenant isolation throughout.

> **Tech Stack:** Python (FastAPI, pdfplumber, ChromaDB, Anthropic SDK), Postgres (structured matrices), Voyage/OpenAI embeddings, Claude Sonnet (chatbot + extraction). Runs in existing agent service at `~/Downloads/mortgage_uw_agent/`.

---

## 1. Document Classification & Processing Pipeline

### 1.1 Processing Flow

```
Operator uploads PDFs in Onboarding Step 2
    ↓
Step 3: Operator clicks "Process Documents"
    ↓
API sends each document to: POST /api/guidelines/ingest
    ↓
Agent service classifies by upload category + content analysis
    ↓
Routes to appropriate processor:
    Guideline Manual → Hierarchical RAG Chunker → ChromaDB
    Rate Sheet/Matrix → Matrix Table Extractor → Postgres
    Document Checklist → Checklist Extractor → GuidelineRules JSON
    Compliance Policy → RAG Chunker (tagged topic: compliance)
    ↓
Returns summary: chunks created, programs found, parameters extracted
    ↓
Step 3 Review UI shows results from both stores
```

### 1.2 Auto-Classification

| Upload Category | Processor | Output Store |
|----------------|-----------|-------------|
| Guideline Manual | Hierarchical RAG Chunker | ChromaDB `{tenantId}_guidelines` |
| Rate Sheet / LTV Matrix | Matrix Table Extractor | `program_matrix_tiers` + `program_requirements` |
| Document Checklist | Checklist Extractor | `GuidelineRules.documents.required[]` |
| Condition Templates | Simple Extractor | `GuidelineRules.conditions.defaultTemplates[]` |
| Compliance Policy | RAG Chunker | ChromaDB tagged `topic: compliance` |

### 1.3 Per-Tenant Isolation

- ChromaDB: each tenant gets its own collection `{tenantId}_guidelines`
- Postgres: all tables have `tenant_id` column with RLS
- Agents and chatbot always query with `tenant_id` context

---

## 2. Hierarchical RAG Chunker (Narrative Guidelines)

### 2.1 Input

PDF guideline documents like the 143-page NPNQM "Flex NonQM and DSCR Underwriting Guidelines." Narrative prose with hierarchical structure: major sections → sub-sections → individual rules with bullet points.

### 2.2 Processing Steps

**Step 1 — Parse document structure:**
- Extract text using `pdfplumber` (preserves layout better than PyPDF2)
- Detect headings by pattern: ALL CAPS lines, lines ending with page numbers, indented sub-sections
- Parse the Table of Contents to build the hierarchy tree
- Map each heading to its page range

**Step 2 — Chunk by paragraph with hierarchy context:**
- Split on heading boundaries (not fixed token count)
- Each chunk = 1-3 paragraphs under the same sub-section heading (~200-800 tokens)
- If a sub-section exceeds 800 tokens, split at bullet point boundaries
- Each chunk carries metadata:

```python
{
    "tenant_id": "uuid",
    "doc_id": "upload-uuid",
    "doc_name": "Flex NonQM and DSCR Underwriting Guidelines",
    "section_path": "INCOME > BANK STATEMENT > SELF-EMPLOYMENT",
    "section_level": 3,
    "page_start": 65,
    "page_end": 67,
    "programs_applicable": ["Flex Supreme", "Flex Select", "DSCR Supreme"],
    "topics": ["income", "self_employment", "bank_statement"],
    "key_terms": ["2 years", "ownership", "25%", "business"],
    "cross_refs": [
        {"type": "matrix", "target": "Flex Select Matrix", "context": "See matrix for LTV limits"},
        {"type": "external", "target": "FNMA", "context": "defer to FNMA Guidelines"}
    ],
    "parameters_mentioned": ["min_business_ownership_years", "expense_factor"],
    "chunk_index": 142,
    "total_chunks": 350
}
```

**Step 3 — Detect cross-references:**
- Pattern match: "See Page X", "refer to Matrix", "defer to FNMA", "See Guide for..."
- Store as structured metadata on the chunk
- At query time, if a retrieved chunk has cross-refs, automatically fetch the linked chunks

**Step 4 — Generate embeddings + store:**
- Embed each chunk using Voyage embeddings (or OpenAI `text-embedding-3-small`)
- Store in ChromaDB collection `{tenantId}_guidelines`
- All metadata fields are filterable at query time

**Step 5 — Build key terms index:**
- Extract mortgage-specific terms from each chunk: FICO scores, LTV percentages, DTI ratios, program names, document types, time periods
- Store as metadata arrays: `programs_applicable`, `topics`, `key_terms`, `parameters_mentioned`

### 2.3 Estimated Output

For the 143-page NPNQM Guidelines: ~300-400 chunks with rich metadata. Ingestion time: ~2-3 minutes (text extraction + embedding generation).

---

## 3. Matrix Table Extractor (LTV/FICO Matrices)

### 3.1 Input

PDF matrix documents like the 37-page NPNQM "NonQM and DSCR Matrices." Contains 10 loan programs, each with LTV/FICO grids by occupancy type + program-specific requirements.

### 3.2 Processing Steps

**Step 1 — Split by program:**
- Detect program boundaries using header patterns ("Flex Supreme Matrix", "Flex Select Matrix", etc.)
- Page 1 (Geographic Restrictions) extracted separately as shared rules
- Each program's pages grouped for targeted extraction

**Step 2 — Extract structured matrices per program:**
- Claude Vision processes each program's pages with a program-specific tool schema
- Per-occupancy LTV/FICO tiers extracted as structured rows
- Program requirements extracted by category (general, borrower, credit, DTI, income, reserves, property)

**Step 3 — Store in Postgres:**

```sql
CREATE TABLE program_matrix_tiers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    program TEXT NOT NULL,
    occupancy TEXT NOT NULL,
    min_fico INT NOT NULL,
    max_fico INT NOT NULL,
    max_loan_amount NUMERIC,
    max_ltv_purchase NUMERIC,
    max_ltv_cashout NUMERIC,
    property_types TEXT[],
    source_page INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE program_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    program TEXT NOT NULL,
    category TEXT NOT NULL,
    requirement_key TEXT NOT NULL,
    requirement_value JSONB NOT NULL,
    source_page INT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE geographic_restrictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    state TEXT NOT NULL,
    restriction TEXT NOT NULL,
    occupancy_affected TEXT,
    programs_affected TEXT[],
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

RLS enabled on all three tables with tenant_id policy.

Indexes:
```sql
CREATE INDEX idx_matrix_lookup ON program_matrix_tiers(tenant_id, program, occupancy, min_fico, max_fico);
CREATE INDEX idx_requirements_lookup ON program_requirements(tenant_id, program, category);
CREATE INDEX idx_geo_lookup ON geographic_restrictions(tenant_id, state);
```

### 3.3 Estimated Output

For the 37-page NPNQM Matrices: ~10 programs × ~15 tiers = ~150 matrix rows + ~200 requirement rows + ~20 geographic restrictions. Extraction time: ~3-5 minutes.

---

## 4. Retrieval & Query Interface

### 4.1 Two Query Modes

**Mode 1: Semantic Guideline Search** (for narrative questions)

```python
def guideline_search(tenant_id, query, program=None, topic=None, max_results=5):
    # 1. Embed query
    # 2. Search ChromaDB {tenant_id}_guidelines
    # 3. Apply metadata filters (program, topic)
    # 4. Return top-K chunks with metadata
    # 5. Fetch cross-referenced chunks for results with cross_refs
    # Return: chunks[] with section_path, page, confidence, cross_ref_content
```

**Mode 2: Matrix Parameter Lookup** (for specific parameter queries)

```python
def matrix_lookup(tenant_id, program, fico=None, ltv=None, occupancy=None,
                  loan_amount=None, property_type=None, loan_purpose=None, state=None):
    # 1. Query program_matrix_tiers with exact parameters
    # 2. If match: eligible=True + tier details
    # 3. If no match: nearest qualifying tier + explain gap
    # 4. Query program_requirements for relevant category
    # 5. Query geographic_restrictions for state
    # Return: eligibility, tier, requirements, restrictions
```

### 4.2 Smart Routing

When a query arrives, detect which mode to use:
- Contains specific numbers (FICO, LTV, loan amount) → **matrix_lookup** first, supplement with **guideline_search**
- Conceptual question (policy, process, requirement) → **guideline_search** first
- Both signals present → run both, merge results by relevance

### 4.3 Response Format (All Consumers)

```python
{
    "answer": "FICO 680 qualifies for max 75% LTV on Flex Select Investment...",
    "sources": [
        {"type": "matrix", "program": "Flex Select", "page": 6, "tier": {...}},
        {"type": "guideline", "section": "CREDIT REQUIREMENTS", "page": 7, "chunk_text": "..."},
    ],
    "cross_references": [
        {"type": "matrix", "target": "Geographic Restrictions", "content": "..."}
    ],
    "confidence": 0.92
}
```

---

## 5. Agent Tool Integration

### 5.1 Tools Registered for Specialist Agents

```python
GUIDELINE_TOOLS = [
    {
        "name": "guideline_search",
        "description": "Search the lender's underwriting guidelines for policies, rules, and requirements.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "program": {"type": "string"},
                "topic": {"type": "string", "enum": ["credit", "income", "property", "compliance", "seasoning", "documents", "reserves", "borrower_eligibility"]},
            },
            "required": ["query"]
        }
    },
    {
        "name": "matrix_lookup",
        "description": "Look up eligibility from the lender's program matrices. Use with specific numbers.",
        "input_schema": {
            "type": "object",
            "properties": {
                "program": {"type": "string"},
                "fico": {"type": "integer"},
                "ltv": {"type": "number"},
                "occupancy": {"type": "string", "enum": ["primary", "second_home", "investment"]},
                "loan_amount": {"type": "number"},
                "property_type": {"type": "string"},
                "loan_purpose": {"type": "string", "enum": ["purchase", "rate_term", "cashout"]},
                "state": {"type": "string"},
            },
            "required": ["program"]
        }
    }
]
```

### 5.2 Per-Agent Tool Usage

| Agent | Primary Tool | Secondary Tool |
|-------|-------------|----------------|
| Doc Review | `guideline_search(topic="documents")` | — |
| Income | `matrix_lookup(program, fico, ltv, occ)` | `guideline_search(topic="income")` |
| Credit | `matrix_lookup(...)` | `guideline_search(topic="credit")` |
| Compliance | `guideline_search(topic="compliance")` | `geographic_restrictions` query |
| Risk | Both tools | Cross-checks all specialist findings |

### 5.3 Transition Strategy

These tools **supplement** (not replace) the existing JSON guidelines in agent system prompts. The agent tries the knowledge base tools first, falls back to JSON guideline if the knowledge base has no data for this tenant. Tenants onboarded before Spec F continue working unchanged.

---

## 6. Guideline Chatbot

### 6.1 Architecture

```
User types question in chat panel
    ↓
Web sends to: POST /api/guidelines/chat (via Next.js proxy)
    ↓
Agent service: smart routing (narrative vs parameter)
    ↓
Retrieves from ChromaDB + program_matrix_tiers
    ↓
Claude Sonnet generates answer with source citations
    ↓
Returns: { answer, sources[], followUpSuggestions[] }
```

### 6.2 Chat Endpoint

```
POST /api/guidelines/chat
Body: {
    "tenantId": "uuid",
    "query": "Can a borrower with 680 FICO get 80% LTV on Flex Select investment?",
    "loanContext": {
        "loanId": "QL-2026-00006",
        "program": "Flex Select",
        "fico": 680,
        "ltv": 78,
        "occupancy": "investment"
    },
    "conversationHistory": [
        {"role": "user", "content": "previous question"},
        {"role": "assistant", "content": "previous answer"}
    ]
}

Response: {
    "answer": "No. Per the Flex Select Investment matrix (page 6)...",
    "sources": [
        {"type": "matrix", "program": "Flex Select", "page": 6},
        {"type": "guideline", "section": "CREDIT REQUIREMENTS", "page": 7}
    ],
    "followUpSuggestions": [
        "What are the reserve requirements at 75% LTV?",
        "Compare all programs eligible for 680 FICO investment",
        "What's the max loan amount at 75% LTV?"
    ],
    "confidence": 0.92
}
```

### 6.3 Key Features

| Feature | How |
|---------|-----|
| **Loan-aware** | If user is viewing a loan, chat pre-fills context (program, FICO, LTV) — answers specific to that loan |
| **Conversational** | History maintained per session — follow-up questions understand prior context |
| **Source citations** | Every answer cites matrix row, guideline section, or page number |
| **Follow-up suggestions** | Claude generates 2-3 relevant follow-up questions |
| **Role-aware** | VA gets operational answers, UW gets analytical answers |
| **Cross-program comparison** | "Compare all programs for this borrower" → queries all matrices, presents eligibility table |

### 6.4 UI — Floating Side Panel

- Collapsed: small chat icon in bottom-right corner of every UW screen
- Expanded: 350px wide panel on the right side
- When viewing a loan: auto-shows "Ask about this loan's eligibility" prompt
- Conversation persists within session
- **Modern design** (matches onboarding wizard style, not Encompass chrome)
- Available to all roles (VA, UW, admin, compliance_officer)

---

## 7. Onboarding Integration — Enhanced Step 3

### 7.1 Two-Phase Process

**Phase 1: Ingest into Knowledge Base**

Operator clicks "Process Documents" in Step 3:
1. Guideline narrative PDF → `POST /api/guidelines/ingest` → ChromaDB
2. Matrix PDF → `POST /api/guidelines/ingest` → Postgres tables
3. Checklist PDF → simple extraction → GuidelineRules

Progress display: "Processing Guidelines... 143 pages, 347 chunks created" / "Processing Matrices... 10 programs, 152 tiers extracted"

**Phase 2: Review Extracted Data**

After ingestion, Step 3 shows a tabbed review interface:

| Tab | Source | What it shows |
|-----|--------|--------------|
| Programs | `program_matrix_tiers` | All programs with LTV/FICO grids — operator verifies |
| Requirements | `program_requirements` | Per-program rules by category — operator edits inline |
| Geographic | `geographic_restrictions` | State restrictions table — operator verifies |
| Guidelines | ChromaDB summary | Section tree with chunk count — drill into any section |
| Documents | Extraction | Required docs per income type — operator edits |

### 7.2 Test Knowledge Base

Before approving, operator tests the knowledge base:
- Built-in test queries: "Min FICO for Flex Select?", "Max LTV for DSCR investment 720 FICO?"
- Operator types custom questions
- Answers with source citations for verification

### 7.3 Approval & Versioning

- Operator reviews all tabs, corrects errors
- "Approve Knowledge Base" → all data marked as verified
- Both structured data (matrices) AND RAG chunks locked as version 1
- Future guideline updates create new versions

---

## 8. Agent Service Endpoints

All new endpoints added to the existing Python agent service (`~/Downloads/mortgage_uw_agent/`), organized in `backend/guidelines/` module.

### 8.1 Ingestion

```
POST /api/guidelines/ingest
Body: {
    "tenantId": "uuid",
    "documentId": "uuid",
    "documentBase64": "...",
    "mimeType": "application/pdf",
    "category": "guideline_manual | rate_sheet | document_checklist | compliance_policy",
    "fileName": "Flex NonQM Guidelines.pdf"
}

Response: {
    "success": true,
    "documentType": "guideline_manual",
    "processingMethod": "hierarchical_rag_chunker",
    "results": {
        "chunks_created": 347,
        "sections_found": 42,
        "programs_detected": ["Flex Supreme", "Flex Select", "DSCR Supreme", ...],
        "cross_references_found": 28,
        "processing_time_seconds": 145
    }
}
```

### 8.2 Search

```
POST /api/guidelines/search
Body: {
    "tenantId": "uuid",
    "query": "seasoning requirements for Chapter 7 BK",
    "program": "Flex Select",
    "topic": "credit",
    "maxResults": 5
}

Response: {
    "results": [
        {
            "text": "Minimum 4 years seasoning required. Chapter 13: use filing date if discharged...",
            "section_path": "CREDIT REQUIREMENTS > CREDIT/HOUSING EVENTS",
            "page": 7,
            "program": "Flex Select",
            "confidence": 0.94,
            "cross_refs": [...]
        }
    ]
}
```

### 8.3 Matrix Lookup

```
POST /api/guidelines/matrix-lookup
Body: {
    "tenantId": "uuid",
    "program": "Flex Select",
    "fico": 680,
    "ltv": 80,
    "occupancy": "investment",
    "loanAmount": 1500000,
    "loanPurpose": "purchase",
    "state": "CA"
}

Response: {
    "eligible": false,
    "reason": "FICO 680 max LTV for investment purchase is 75% (not 80%)",
    "matchingTier": null,
    "nearestQualifyingTier": {
        "min_fico": 680, "max_fico": 699,
        "max_ltv_purchase": 75, "max_ltv_cashout": 70,
        "max_loan_amount": 2000000
    },
    "alternatives": [
        {"change": "Increase FICO to 700", "result": "80% LTV eligible"},
        {"change": "Reduce LTV to 75%", "result": "Eligible at current FICO"}
    ],
    "geographic_restrictions": [],
    "source_page": 6
}
```

### 8.4 Chat

```
POST /api/guidelines/chat
Body: { tenantId, query, loanContext?, conversationHistory[] }
Response: { answer, sources[], followUpSuggestions[], confidence }
```

### 8.5 Knowledge Base Status

```
GET /api/guidelines/status/:tenantId
Response: {
    "hasKnowledgeBase": true,
    "guidelines": { "chunks": 347, "sections": 42, "lastUpdated": "..." },
    "matrices": { "programs": 10, "tiers": 152, "requirements": 198, "lastUpdated": "..." },
    "geographic": { "restrictions": 20 },
    "version": 1
}
```

---

## 9. Code Organization

### 9.1 Python Agent Service — New Module

```
~/Downloads/mortgage_uw_agent/backend/guidelines/
    __init__.py
    router.py               — FastAPI router with all endpoints
    chunker.py              — Hierarchical RAG chunker (TOC parsing, heading detection, paragraph splitting)
    embedder.py             — Embedding generation + ChromaDB storage
    matrix_extractor.py     — Claude Vision matrix extraction per program
    checklist_extractor.py  — Simple doc checklist extraction
    retriever.py            — Smart query routing + ChromaDB search + Postgres lookup
    chatbot.py              — Conversational chat with Claude Sonnet
    cross_ref_resolver.py   — Cross-reference detection and resolution
    metadata_enricher.py    — Key term extraction, program detection, topic classification
    db.py                   — Postgres connection + table management
```

### 9.2 Dependencies to Add

```
pdfplumber          — PDF text extraction with layout preservation
chromadb            — Already installed
anthropic           — Already installed (for Claude Vision matrix extraction)
voyageai            — Embedding generation (or openai for text-embedding-3-small)
```

---

## 10. Testing Strategy

### 10.1 Chunker Tests

```
- 143-page NPNQM Guidelines → ~300-400 chunks created
- Each chunk has section_path metadata
- TOC parsed correctly (section names + page numbers)
- No chunk exceeds 800 tokens
- Cross-references detected and tagged
- Programs correctly assigned to chunks
```

### 10.2 Matrix Extractor Tests

```
- 37-page NPNQM Matrices → 10 programs extracted
- Flex Select: 3 occupancy types × ~6 FICO tiers = ~18 matrix rows
- Geographic restrictions: ~20 state-level rules
- Per-program requirements: credit, DTI, income, reserves sections populated
- matrix_lookup(Flex Select, 680, 80, investment) → not eligible, nearest tier at 75%
- matrix_lookup(Flex Select, 760, 90, primary) → eligible
```

### 10.3 Retrieval Tests

```
- guideline_search("seasoning for BK") → returns credit/housing events section
- guideline_search("gift funds investment") → returns asset requirements with correct program
- matrix_lookup with exact tier match → eligible=true
- matrix_lookup with no match → nearest tier + alternatives
- Cross-reference: chunk mentioning "See matrices" → fetches matrix data
```

### 10.4 Chatbot Tests

```
- Simple question → answer with source citation
- Follow-up question → maintains context from prior exchange
- Loan-context question → answer specific to the loan's parameters
- Cross-program comparison → table of eligible programs
- Unknown topic → "I don't have information about that in the guidelines"
```

### 10.5 Tenant Isolation Tests

```
- Tenant A's guideline search returns only Tenant A's chunks
- Tenant A's matrix lookup returns only Tenant A's tiers
- Tenant B ingests different guidelines → no cross-contamination
```

---

## Non-Goals (Explicitly Out of Scope)

- **Graph database (Neo4j/Graphify)** — Postgres structured tables are sufficient for matrix relationships in F1. Graph DB is a future optimization if cross-program queries become complex.
- **BM25 separate index** — ChromaDB metadata filtering provides keyword-like matching. Full BM25 via Postgres `tsvector` is a future enhancement if metadata filtering proves insufficient.
- **FNMA guideline integration** — Cross-references to external guidelines (FNMA) are tagged but not resolved. External guideline ingestion is a future feature.
- **Automatic re-chunking on guideline updates** — Version 1 is created during onboarding. Guideline updates create version 2 via a separate re-ingestion process (same pipeline, new version number).
- **Multi-language support** — Guidelines are in English only.
- **OCR for scanned PDFs** — The NPNQM documents have embedded text (not scanned images). OCR support is deferred.
