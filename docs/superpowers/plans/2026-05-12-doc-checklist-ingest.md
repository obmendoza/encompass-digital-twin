# NPNQM Doc Requirements Checklist Ingest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest NPNQM's engine-generated `Document_Requirements_All_Income_Types.md` into three new tenant-scoped Postgres tables, close the `kb_versions` two-key-approval gap from spec F2, and expose a single `resolveRequiredDocs(tenantId, kbVersionId, loanContext)` service that downstream features (Predictive Conditions, VA Doc Review specialist) will consume.

**Architecture:** A new CLI parses four sections of a structured markdown file into three tables (`program_doc_checklist`, `program_doc_engine_rules`, `income_type_resolver`), tied to the existing `kb_versions` row via FK. Migration 016 also adds a partial unique index on `kb_versions.tenant_id WHERE status='active'` (race-impossible activation) and an audit-log dedup constraint. A second CLI handles two-key approval with a `SELECT ... FOR UPDATE` transaction for the activation step. The resolver function returns required docs given a loan context, applying engine-rule modifiers (LLC, Field Review, USCredit). Deterministic, no LLM calls.

**Tech Stack:** TypeScript (tsx CLI), `marked` for markdown AST, `pg` for direct DB access (existing `withTenantTx` / `withDb` helpers from `@twin/api`), Vitest. Postgres with RLS, defended by explicit `WHERE tenant_id = …` predicates everywhere (BYPASSRLS pooler memory).

**Spec:** [`docs/superpowers/specs/2026-05-12-doc-checklist-ingest-design.md`](../specs/2026-05-12-doc-checklist-ingest-design.md) (commit `e9d3107`).

---

## Plan-level reviewer notes (thread through implementer awareness)

1. **Cross-migration coordination.** Migration 016 modifies `kb_versions` (owned by F2's migration 012). Header comment in 016 must name this explicitly so a future migration ledger audit doesn't get surprised.
2. **New error class — coordination point.** `IncomeTypeUnresolvedError` is new. Downstream specs (Predictive Conditions, VA Doc Review specialist) don't know about it yet. Flag in the relevant task; mention in commit message.
3. **`approve-kb.ts` is load-bearing.** Every KB-backed feature (chatbot, matrix lookup, this resolver) depends on `status='active'`. The platform-health check in Task 17 surfaces silent approval-workflow failures.

---

## Conventions used in this plan

- **Quality gates.** Every commit must keep both `pnpm --filter @twin/api test` AND `pnpm --filter @twin/api build` clean. The strict-TS backlog was cleared in commit `8b071d4`; do not regress it.
- **Tenant context.** All tenant-scoped DB access goes through `withTenantTx(tenantId, fn)`. All tenant-scoped SQL adds an explicit `WHERE tenant_id = $1` even when RLS would already cover it — Supabase session pooler has BYPASSRLS.
- **No emojis** in code or UI.
- **`pnpm`**, never `npm`.
- **One commit per task.** Subagent-driven-development handoff is cleaner that way; each task is reviewable in isolation.

---

## Task 1: Vendor the source markdown into the repo as a test fixture

**Files:**
- Create: `docs/npnqm-source/Document_Requirements_All_Income_Types.md` (copy from `/Users/omarmendoza/Downloads/Document_Requirements_All_Income_Types\ 2.md`)
- Create: `docs/npnqm-source/README.md`

**Rationale:** The integration test and the parser unit tests both need a stable file path. Vendoring the file means the test corpus tracks alongside the code. The README documents what the file is, who generated it, and the protocol for refreshing it.

- [ ] **Step 1: Copy the source file**

```bash
mkdir -p docs/npnqm-source
cp "/Users/omarmendoza/Downloads/Document_Requirements_All_Income_Types 2.md" docs/npnqm-source/Document_Requirements_All_Income_Types.md
```

Expected: file present at `docs/npnqm-source/Document_Requirements_All_Income_Types.md`, ~33KB.

- [ ] **Step 2: Write the README**

Create `docs/npnqm-source/README.md`:

```markdown
# NPNQM Source Artifacts

This directory contains operator-facing artifacts handed to us by NPNQM (the pilot tenant in the multi-tenant platform). They are the inputs to KB ingest pipelines.

## Files

- `Document_Requirements_All_Income_Types.md` — engine-generated doc-requirements snapshot from NPNQM's `eligibility_check_v2.py` (`sync_doc_requirements_from_engine.py`). Ingested via `pnpm tsx scripts/ingest-doc-checklist.ts`. See `docs/superpowers/specs/2026-05-12-doc-checklist-ingest-design.md`.

## Refresh protocol

When NPNQM publishes a new version, replace the file here and bump the `--version` integer in the ingest CLI invocation. The ingest's parity check + optional `--max-age` flag will surface drift.
```

- [ ] **Step 3: Commit**

```bash
git add docs/npnqm-source/
git commit -m "chore: vendor NPNQM doc-requirements source markdown into docs/npnqm-source/"
```

---

## Task 2: Migration 016 — three new tables + cross-migration constraints

**Files:**
- Create: `packages/api/src/db/migrations/016-doc-checklist.sql`

**Rationale:** Schema lands independently of any code change. Spec §2.1 + §8.3 specify exact DDL. Migration header explicitly names the cross-reference to F2's migration 012 (per reviewer note 1).

- [ ] **Step 1: Write the migration SQL**

Create `packages/api/src/db/migrations/016-doc-checklist.sql`:

```sql
-- 016-doc-checklist.sql
--
-- NPNQM Doc Requirements Checklist Ingest (spec 2026-05-12).
--
-- Creates three new tenant-scoped tables for the doc-checklist data model:
--   program_doc_checklist        — per-scenario doc lists
--   program_doc_engine_rules     — predicate-based rule modifiers (LLC, Field Review, USCredit)
--   income_type_resolver         — Frontend→Resolved income type lookup
--
-- Also adds two constraints to F2's kb_versions table (migration 012):
--   1. Partial unique index for single-active-version-per-tenant (race protection
--      for scripts/approve-kb.ts --activate; see spec §2.1 + §8.2).
--   2. Audit-log dedup unique constraint on tenant_audit_log so that approve-kb.ts's
--      explicit application-level write doesn't duplicate a trigger row (spec §8.3).
--
-- CROSS-MIGRATION DEPENDENCY: This migration extends two tables owned by prior
-- migrations (012-guideline-processing.sql for kb_versions, 001-tenants.sql for
-- tenant_audit_log). Future schema changes to those tables must consider these
-- constraints. See spec §10 implementation note 1.

-- ── 1. program_doc_checklist ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS program_doc_checklist (
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kb_version_id        INT  NOT NULL REFERENCES kb_versions(id) ON DELETE CASCADE,
  resolved_income_type TEXT NOT NULL,
  program              TEXT NOT NULL,
  minimum_docs         JSONB NOT NULL,
  income_docs          JSONB NOT NULL,
  raw_min_msg          TEXT NOT NULL,
  raw_income_msg       TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kb_version_id, resolved_income_type)
);
CREATE INDEX IF NOT EXISTS idx_pdc_tenant_version ON program_doc_checklist(tenant_id, kb_version_id);

ALTER TABLE program_doc_checklist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pdc ON program_doc_checklist;
CREATE POLICY tenant_isolation_pdc ON program_doc_checklist
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── 2. program_doc_engine_rules ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS program_doc_engine_rules (
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kb_version_id INT  NOT NULL REFERENCES kb_versions(id) ON DELETE CASCADE,
  rule_name     TEXT NOT NULL,
  predicate     JSONB NOT NULL,
  effect        JSONB NOT NULL,
  description   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kb_version_id, rule_name)
);

ALTER TABLE program_doc_engine_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_pder ON program_doc_engine_rules;
CREATE POLICY tenant_isolation_pder ON program_doc_engine_rules
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── 3. income_type_resolver ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS income_type_resolver (
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kb_version_id        INT  NOT NULL REFERENCES kb_versions(id) ON DELETE CASCADE,
  income_doc_type      TEXT NOT NULL,
  borrower_type        TEXT NOT NULL,
  citizenship          TEXT NOT NULL,
  is_itin              BOOLEAN NOT NULL,
  resolved_income_type TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kb_version_id, income_doc_type, borrower_type, citizenship, is_itin)
);

ALTER TABLE income_type_resolver ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_itr ON income_type_resolver;
CREATE POLICY tenant_isolation_itr ON income_type_resolver
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- ── 4. Single-active-version-per-tenant partial unique index ───────────────
-- Protects scripts/approve-kb.ts --activate from race-induced multi-active state.

CREATE UNIQUE INDEX IF NOT EXISTS kb_versions_one_active_per_tenant
  ON kb_versions (tenant_id)
  WHERE status = 'active';

-- ── 5. Audit-log dedup constraint ──────────────────────────────────────────
-- approve-kb.ts writes its own audit row inside the approval transaction. If a
-- trigger on kb_versions is later added that also writes audit rows, this
-- constraint guarantees only one row per (target_tenant, action, version,
-- actor) tuple. Metadata extraction uses jsonb_extract_path_text so the
-- constraint expression is immutable.

CREATE UNIQUE INDEX IF NOT EXISTS tenant_audit_log_kb_dedup
  ON tenant_audit_log (
    target_tenant_id,
    action,
    (metadata->>'kb_version_id'),
    actor_id
  )
  WHERE action IN ('kb_version.approve', 'kb_version.compliance_signoff', 'kb_version.activate');
```

- [ ] **Step 2: Run migrations**

```bash
pnpm --filter @twin/api dev &  # starts API which runs migrations on boot
# OR if running migrations standalone:
pnpm --filter @twin/api exec node -e "import('./src/db/migrations.js').then(m => m.runMigrations()).then(() => process.exit(0))"
```

Expected output (in API boot log or stdout): `applied migration 016-doc-checklist.sql` (one line).

- [ ] **Step 3: Verify schema with psql or a node script**

Create `/tmp/check-016.mjs` (throwaway, do not commit):

```javascript
import pg from "pg";
import { readFileSync } from "node:fs";
if (!process.env.DATABASE_URL) {
  const env = readFileSync("packages/api/.env", "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2];
  }
}
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
for (const t of ["program_doc_checklist", "program_doc_engine_rules", "income_type_resolver"]) {
  const r = await c.query(`SELECT COUNT(*) FROM ${t}`);
  console.log(t, "rows:", r.rows[0].count, "(should be 0)");
}
const idx = await c.query(`SELECT indexname FROM pg_indexes WHERE indexname IN ('kb_versions_one_active_per_tenant', 'tenant_audit_log_kb_dedup')`);
console.log("expected 2 indexes, got:", idx.rows.length, idx.rows.map(r => r.indexname));
await c.end();
```

Run: `node /tmp/check-016.mjs && rm /tmp/check-016.mjs`

Expected: three tables present with 0 rows each; both indexes present.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/db/migrations/016-doc-checklist.sql
git commit -m "feat(db): migration 016 — doc-checklist tables + kb_versions single-active guard

Three new tenant-scoped tables for NPNQM doc-checklist ingest (spec
2026-05-12-doc-checklist-ingest-design.md, §2.1):
  program_doc_checklist, program_doc_engine_rules, income_type_resolver

Plus two cross-migration constraints on existing tables:
  - kb_versions: partial unique index single-active-per-tenant (§2.1 race
    protection for scripts/approve-kb.ts --activate, spec §8.2)
  - tenant_audit_log: dedup unique index for KB approval rows (§8.3
    audit-log dedup contract)

All three new tables have RLS on app.current_tenant per project
tenant-isolation memory. Application code must still include explicit
tenant_id WHERE clauses (BYPASSRLS pooler defense)."
```

---

## Task 3: Parser module skeleton + types

**Files:**
- Create: `packages/api/src/ingestion/doc-checklist-parser.ts`
- Create: `packages/api/test/doc-checklist-parser.test.ts`

**Rationale:** Establish the exported types and the parser entry points before any parser body. Test file is empty initially; it grows with each parser task. This is the smallest commit that lets later tasks import from a real module.

- [ ] **Step 1: Write the type definitions**

Create `packages/api/src/ingestion/doc-checklist-parser.ts`:

```typescript
// Parser for NPNQM's engine-generated Document_Requirements_All_Income_Types.md.
// See spec docs/superpowers/specs/2026-05-12-doc-checklist-ingest-design.md
// §1 (source artifact) and §5 (parser design).
//
// Deterministic, no LLM. Uses marked AST. Each parser scopes to a single
// "File Section" of the source markdown (A/B/C/D — see spec §1.1).

import { createHash } from "node:crypto";
import { marked, type Tokens } from "marked";

// ── Public types ───────────────────────────────────────────────────────────

export interface DocItem {
  order: number;
  name: string;
  note: string | null;
}

export interface ScenarioRow {
  resolved_income_type: string;
  program: string;
  minimum_docs: DocItem[];
  income_docs: DocItem[];
  raw_min_msg: string;
  raw_income_msg: string;
}

export type RuleName = "llc_closing_docs" | "field_review" | "us_credit_optional";

export interface RuleRow {
  rule_name: RuleName;
  predicate: Record<string, unknown>;
  effect: { add_docs: string[]; remove_docs: string[] };
  description: string;
}

export interface ResolverRow {
  income_doc_type: string;
  borrower_type: "W2" | "Self-Employed";
  citizenship: "US Citizen" | "Foreign Nationals";
  is_itin: boolean;
  resolved_income_type: string;
}

export interface ParseResult {
  scenarios: ScenarioRow[];
  rules: RuleRow[];
  resolver: ResolverRow[];
  generatedAt: string;     // ISO from the footer
  sourceHash: string;      // sha256 of the input markdown
}

// ── Errors ─────────────────────────────────────────────────────────────────

export class DocChecklistParseError extends Error {
  constructor(message: string, public readonly section: "A" | "B" | "C" | "D" | "footer") {
    super(message);
    this.name = "DocChecklistParseError";
  }
}

// ── Entry points (impl follows in later tasks) ─────────────────────────────

export function parseScenarios(markdown: string): ScenarioRow[] {
  throw new Error("parseScenarios not yet implemented");
}

export function parseEngineRules(markdown: string): RuleRow[] {
  throw new Error("parseEngineRules not yet implemented");
}

export function parseResolverTable(markdown: string): ResolverRow[] {
  throw new Error("parseResolverTable not yet implemented");
}

export function parseAll(markdown: string): ParseResult {
  const scenarios = parseScenarios(markdown);
  const rules = parseEngineRules(markdown);
  const resolver = parseResolverTable(markdown);
  const footerMatch = markdown.match(/_Generated by [^\s]+ at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})_/);
  if (!footerMatch) {
    throw new DocChecklistParseError(
      "missing generation timestamp footer (expected `_Generated by ... at YYYY-MM-DD HH:MM:SS_`)",
      "footer",
    );
  }
  const generatedAt = new Date(footerMatch[1]!.replace(" ", "T") + "Z").toISOString();
  const sourceHash = createHash("sha256").update(markdown).digest("hex");
  return { scenarios, rules, resolver, generatedAt, sourceHash };
}

// ── Internal helpers used by multiple parsers ──────────────────────────────

/** Walk a marked AST, yielding only top-level heading tokens with text. */
export function* iterHeadings(tokens: Tokens.Generic[]): Generator<{ depth: number; text: string; index: number }> {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === "heading") {
      yield { depth: (t as Tokens.Heading).depth, text: (t as Tokens.Heading).text, index: i };
    }
  }
}

/** Verify the input parses to a non-empty marked AST. Throws DocChecklistParseError otherwise. */
export function parseAst(markdown: string): Tokens.Generic[] {
  const tokens = marked.lexer(markdown);
  if (!tokens || tokens.length === 0) {
    throw new DocChecklistParseError("empty markdown input", "A");
  }
  return tokens;
}
```

- [ ] **Step 2: Write the test scaffold**

Create `packages/api/test/doc-checklist-parser.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  parseScenarios,
  parseEngineRules,
  parseResolverTable,
  parseAll,
  DocChecklistParseError,
} from "../src/ingestion/doc-checklist-parser.js";

const FIXTURE_PATH = "../../docs/npnqm-source/Document_Requirements_All_Income_Types.md";

function loadFixture(): string {
  return readFileSync(new URL(FIXTURE_PATH, import.meta.url), "utf8");
}

describe("doc-checklist-parser — module shape", () => {
  it("exports the four entry points and the error class", () => {
    expect(typeof parseScenarios).toBe("function");
    expect(typeof parseEngineRules).toBe("function");
    expect(typeof parseResolverTable).toBe("function");
    expect(typeof parseAll).toBe("function");
    expect(DocChecklistParseError).toBeDefined();
  });

  it("entry points throw 'not yet implemented' until later tasks", () => {
    expect(() => parseScenarios("")).toThrow(/not yet implemented/);
  });

  it("fixture file exists and is non-empty", () => {
    const md = loadFixture();
    expect(md.length).toBeGreaterThan(1000);
    expect(md).toContain("Engine-synced");
  });
});
```

- [ ] **Step 3: Run tests + build**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-parser.test.ts
pnpm --filter @twin/api build
```

Expected: 3 tests pass, build clean.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/ingestion/doc-checklist-parser.ts packages/api/test/doc-checklist-parser.test.ts
git commit -m "feat(api/ingestion): doc-checklist-parser module skeleton + types

Exports parseScenarios/parseEngineRules/parseResolverTable/parseAll + types
(ScenarioRow, RuleRow, ResolverRow, ParseResult) per spec §5. Bodies are
stubs that throw 'not yet implemented'; subsequent tasks fill them in TDD.

Includes parseAll wiring (footer timestamp + sha256 hash) and shared AST
helpers (iterHeadings, parseAst). marked is the markdown lexer."
```

---

## Task 4: `parseScenarios` — happy path + invariant violations

**Files:**
- Modify: `packages/api/src/ingestion/doc-checklist-parser.ts`
- Modify: `packages/api/test/doc-checklist-parser.test.ts`

**Rationale:** First real parser. Spec §1.2 lists the invariants this parser enforces. We cover happy path (real fixture → 25 scenarios) plus each invariant violation in its own test case.

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/test/doc-checklist-parser.test.ts`:

```typescript
describe("parseScenarios", () => {
  it("parses all 25 scenarios from the real fixture", () => {
    const rows = parseScenarios(loadFixture());
    expect(rows).toHaveLength(25);
    // First scenario is Full Doc (W2)
    const first = rows[0]!;
    expect(first.resolved_income_type).toBe("Full Documentation - Wage Earner");
    expect(first.program).toBe("Flex Select");
    expect(first.minimum_docs).toHaveLength(9);
    expect(first.minimum_docs[0]!.name).toBe("Initial Loan Application (1003)");
    expect(first.income_docs).toHaveLength(2);
    expect(first.income_docs[0]!.name).toBe("Most recent paystub(s) reflecting 30 days of pay");
    expect(first.raw_min_msg).toContain("Missing base documents:");
    expect(first.raw_income_msg).toContain("Required documents:");
  });

  it("attaches per-item notes when the engine includes them", () => {
    const rows = parseScenarios(loadFixture());
    const bankStmts12mo = rows.find((r) => r.resolved_income_type === "Bank Statement - 12 Mo. Personal")!;
    const thirdParty = bankStmts12mo.income_docs.find((d) => d.name.startsWith("3rd Party Expense"))!;
    expect(thirdParty).toBeDefined();
    expect(thirdParty.note).toContain("50% Expense Ratio");
  });

  it("rejects markdown missing the Resolved label", () => {
    const broken = `## 2. Document output by income scenario

### Full Doc (W2)

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)

#### Income documentation (engine order)

1. Most recent paystub(s) reflecting 30 days of pay
`;
    expect(() => parseScenarios(broken)).toThrow(DocChecklistParseError);
    expect(() => parseScenarios(broken)).toThrow(/Resolved Neo4j income type/);
  });

  it("rejects markdown missing the Raw engine messages details block", () => {
    const broken = `## 2. Document output by income scenario

### Full Doc (W2)

**Resolved Neo4j income type**: \`Full Documentation - Wage Earner\`
**Program (validation context)**: \`Flex Select\`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)

#### Income documentation (engine order)

1. Most recent paystub(s) reflecting 30 days of pay
`;
    expect(() => parseScenarios(broken)).toThrow(/Raw engine messages/);
  });
});
```

- [ ] **Step 2: Run tests, see them fail**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-parser.test.ts -t "parseScenarios"
```

Expected: 4 failures, all `not yet implemented` or `Resolved Neo4j` etc.

- [ ] **Step 3: Implement `parseScenarios`**

Replace the body of `parseScenarios` in `packages/api/src/ingestion/doc-checklist-parser.ts`:

```typescript
export function parseScenarios(markdown: string): ScenarioRow[] {
  const tokens = parseAst(markdown);

  // Find File Section B: ## 2. Document output by income scenario
  let inSection = false;
  const scenarioBlocks: { name: string; start: number; end: number }[] = [];
  let currentBlockStart = -1;
  let currentBlockName = "";

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === "heading") {
      const h = t as Tokens.Heading;
      if (h.depth === 2 && /^2\.\s+Document output by income scenario/i.test(h.text)) {
        inSection = true;
        continue;
      }
      if (h.depth === 2 && inSection) {
        // Next H2 closes the section. Close any open scenario.
        if (currentBlockStart >= 0) {
          scenarioBlocks.push({ name: currentBlockName, start: currentBlockStart, end: i });
        }
        inSection = false;
        currentBlockStart = -1;
        break;
      }
      if (inSection && h.depth === 3) {
        if (currentBlockStart >= 0) {
          scenarioBlocks.push({ name: currentBlockName, start: currentBlockStart, end: i });
        }
        currentBlockStart = i;
        currentBlockName = h.text;
      }
    }
  }
  if (currentBlockStart >= 0) {
    scenarioBlocks.push({ name: currentBlockName, start: currentBlockStart, end: tokens.length });
  }

  return scenarioBlocks.map((b) => parseOneScenario(tokens, b.start, b.end, b.name));
}

function parseOneScenario(tokens: Tokens.Generic[], start: number, end: number, name: string): ScenarioRow {
  let resolvedIncomeType: string | null = null;
  let program: string | null = null;
  let minimumDocs: DocItem[] = [];
  let incomeDocs: DocItem[] = [];
  let rawMin: string | null = null;
  let rawIncome: string | null = null;

  // Walk the scenario's token slice.
  let i = start + 1;
  while (i < end) {
    const t = tokens[i]!;
    // Resolved label + Program label are inside a paragraph token with inline strong/code children
    if (t.type === "paragraph") {
      const raw = (t as Tokens.Paragraph).raw;
      const m1 = raw.match(/\*\*Resolved Neo4j income type\*\*:\s*`([^`]+)`/);
      if (m1) resolvedIncomeType = m1[1]!;
      const m2 = raw.match(/\*\*Program \(validation context\)\*\*:\s*`([^`]+)`/);
      if (m2) program = m2[1]!;
    }
    if (t.type === "heading" && (t as Tokens.Heading).depth === 4) {
      const h = (t as Tokens.Heading).text;
      if (/Minimum required documents/i.test(h)) {
        // Next list token holds the items.
        const list = nextListAfter(tokens, i, end);
        if (list) minimumDocs = listItemsToDocs(list);
      } else if (/Income documentation/i.test(h)) {
        const list = nextListAfter(tokens, i, end);
        if (list) incomeDocs = listItemsToDocs(list);
      }
    }
    if (t.type === "html") {
      const html = (t as Tokens.HTML).raw;
      const minMatch = html.match(/Minimum:\s*`([^`]+)`/);
      const incMatch = html.match(/Income:\s*`([^`]+)`/);
      if (minMatch) rawMin = minMatch[1]!;
      if (incMatch) rawIncome = incMatch[1]!;
    }
    i++;
  }

  if (!resolvedIncomeType) {
    throw new DocChecklistParseError(`scenario '${name}': missing **Resolved Neo4j income type** label`, "B");
  }
  if (!program) {
    throw new DocChecklistParseError(`scenario '${name}': missing **Program (validation context)** label`, "B");
  }
  if (minimumDocs.length === 0) {
    throw new DocChecklistParseError(`scenario '${name}': missing or empty 'Minimum required documents' list`, "B");
  }
  if (incomeDocs.length === 0) {
    throw new DocChecklistParseError(`scenario '${name}': missing or empty 'Income documentation' list`, "B");
  }
  if (rawMin === null || rawIncome === null) {
    throw new DocChecklistParseError(`scenario '${name}': missing 'Raw engine messages' <details> block (need both Minimum: and Income: lines)`, "B");
  }
  return {
    resolved_income_type: resolvedIncomeType,
    program,
    minimum_docs: minimumDocs,
    income_docs: incomeDocs,
    raw_min_msg: rawMin,
    raw_income_msg: rawIncome,
  };
}

function nextListAfter(tokens: Tokens.Generic[], from: number, end: number): Tokens.List | null {
  for (let i = from + 1; i < end; i++) {
    const t = tokens[i]!;
    if (t.type === "list") return t as Tokens.List;
    if (t.type === "heading") return null; // ran into the next section, no list found
  }
  return null;
}

function listItemsToDocs(list: Tokens.List): DocItem[] {
  return list.items.map((item, idx) => {
    const text = item.text.trim();
    // Notes are inside parentheses suffix like "...(Note: foo)" or "(Note: bar)"
    const noteMatch = text.match(/\s*\(Note:\s*([^)]+)\)\s*$/i);
    if (noteMatch) {
      return {
        order: idx + 1,
        name: text.replace(noteMatch[0], "").trim(),
        note: noteMatch[1]!.trim(),
      };
    }
    return { order: idx + 1, name: text, note: null };
  });
}
```

- [ ] **Step 4: Run tests, see them pass**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-parser.test.ts -t "parseScenarios"
pnpm --filter @twin/api build
```

Expected: 4 tests pass, build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/doc-checklist-parser.ts packages/api/test/doc-checklist-parser.test.ts
git commit -m "feat(api/ingestion): parseScenarios — File Section B → ScenarioRow[]

Parses the 25 income-scenario blocks from spec §1.1 File Section B. Each
scenario produces minimum_docs + income_docs arrays (with per-item notes
extracted from '(Note: ...)' suffix) plus the raw engine pipe-lists from
the <details> block for parity verification.

Enforces the four invariants from spec §1.2 with DocChecklistParseError on
violation. All four test cases pass: happy-path 25-row parse, per-item
note extraction, missing Resolved label rejection, missing Raw messages
block rejection."
```

---

## Task 5: `parseEngineRules` — three known rules + unknown-rule rejection

**Files:**
- Modify: `packages/api/src/ingestion/doc-checklist-parser.ts`
- Modify: `packages/api/test/doc-checklist-parser.test.ts`

**Rationale:** Spec §2.2 specifies the three rules and their predicate shapes. We extract from File Section A's engine-rules table. Unknown rule names abort the ingest (spec §6 exit code 5).

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/test/doc-checklist-parser.test.ts`:

```typescript
describe("parseEngineRules", () => {
  it("extracts the three known rules from the real fixture", () => {
    const rules = parseEngineRules(loadFixture());
    expect(rules).toHaveLength(3);
    const llc = rules.find((r) => r.rule_name === "llc_closing_docs")!;
    expect(llc).toBeDefined();
    expect(llc.predicate.LLCOrLegalEntity).toBe(true);
    expect(llc.predicate.occupancy_in).toEqual(["investment"]);
    expect(llc.predicate.program_not_in).toEqual(
      expect.arrayContaining(["Investor DSCR", "DSCR Supreme", "DSCR Multi", "Investor DSCR No Ratio"]),
    );
    const fr = rules.find((r) => r.rule_name === "field_review")!;
    expect(fr.predicate.state).toBe("NY");
    expect(fr.predicate.county_in).toEqual(expect.arrayContaining(["Brooklyn", "Kings"]));
    const us = rules.find((r) => r.rule_name === "us_credit_optional")!;
    expect(us.predicate.USCredit).toBe(false);
    expect(us.effect.remove_docs).toEqual(expect.arrayContaining(["Credit Report dated within 90 days"]));
  });

  it("rejects an unknown rule name in the engine-rules table", () => {
    const broken = `## 1. How to read this document

### Engine rules (minimum docs)

| Rule | Behavior |
|------|----------|
| Quantum field gate | When QuantumPhase is true. |
`;
    expect(() => parseEngineRules(broken)).toThrow(/unknown engine rule/i);
  });
});
```

- [ ] **Step 2: Run tests, see them fail**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-parser.test.ts -t "parseEngineRules"
```

Expected: 2 failures (`not yet implemented`).

- [ ] **Step 3: Implement `parseEngineRules`**

Replace the body of `parseEngineRules` in `packages/api/src/ingestion/doc-checklist-parser.ts`:

```typescript
export function parseEngineRules(markdown: string): RuleRow[] {
  const tokens = parseAst(markdown);
  // The rules table is under H3 "Engine rules (minimum docs)" inside H2 §1.
  let inSection = false;
  let table: Tokens.Table | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === "heading") {
      const h = t as Tokens.Heading;
      if (h.depth === 3 && /Engine rules/i.test(h.text)) {
        inSection = true;
        continue;
      }
      if (inSection && h.depth <= 3) break;
    }
    if (inSection && t.type === "table") {
      table = t as Tokens.Table;
      break;
    }
  }
  if (!table) {
    throw new DocChecklistParseError("File Section A: missing 'Engine rules' table under H3", "A");
  }

  return table.rows.map((row) => {
    const ruleText = (row[0] as Tokens.TableCell).text.trim();
    const behavior = (row[1] as Tokens.TableCell).text.trim();
    return ruleTextToRow(ruleText, behavior);
  });
}

function ruleTextToRow(ruleText: string, behavior: string): RuleRow {
  // Match by the human-readable rule text in the first column; map to the
  // three known structured shapes. New rule names → throw.
  if (/LLC closing documents/i.test(ruleText)) {
    return {
      rule_name: "llc_closing_docs",
      predicate: {
        LLCOrLegalEntity: true,
        occupancy_in: ["investment"],
        program_not_in: ["Investor DSCR", "DSCR Supreme", "DSCR Multi", "Investor DSCR No Ratio"],
      },
      effect: { add_docs: ["LLC closing documents"], remove_docs: [] },
      description: behavior,
    };
  }
  if (/Field [Rr]eview/.test(ruleText)) {
    return {
      rule_name: "field_review",
      predicate: {
        state: "NY",
        county_in: ["Brooklyn", "Kings"],
        occupancy_in: ["investment"],
      },
      effect: { add_docs: ["Field review"], remove_docs: [] },
      description: behavior,
    };
  }
  if (/US credit/i.test(ruleText)) {
    return {
      rule_name: "us_credit_optional",
      predicate: { USCredit: false },
      effect: { add_docs: [], remove_docs: ["Credit Report dated within 90 days"] },
      description: behavior,
    };
  }
  throw new DocChecklistParseError(
    `unknown engine rule in File Section A rules table: '${ruleText}'. New rules must be added to ruleTextToRow().`,
    "A",
  );
}
```

- [ ] **Step 4: Run tests, see them pass**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-parser.test.ts -t "parseEngineRules"
pnpm --filter @twin/api build
```

Expected: 2 tests pass, build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/doc-checklist-parser.ts packages/api/test/doc-checklist-parser.test.ts
git commit -m "feat(api/ingestion): parseEngineRules — File Section A → RuleRow[]

Extracts the three known engine-rule modifiers (llc_closing_docs,
field_review, us_credit_optional) from File Section A's rules table.

Each rule produces the structured predicate/effect shape from spec §2.2.
Unknown rule names throw DocChecklistParseError so future engine releases
that add a new rule fail loud (caught in CLI as exit code 5 per spec §6)."
```

---

## Task 6: `parseResolverTable` — Frontend → resolved type lookup

**Files:**
- Modify: `packages/api/src/ingestion/doc-checklist-parser.ts`
- Modify: `packages/api/test/doc-checklist-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/api/test/doc-checklist-parser.test.ts`:

```typescript
describe("parseResolverTable", () => {
  it("parses all 32 resolver rows from the real fixture", () => {
    const rows = parseResolverTable(loadFixture());
    expect(rows).toHaveLength(32);
    // First row: Full Doc / W2 / US Citizen / not-ITIN → Full Documentation - Wage Earner
    const first = rows[0]!;
    expect(first.income_doc_type).toBe("Full Doc");
    expect(first.borrower_type).toBe("W2");
    expect(first.citizenship).toBe("US Citizen");
    expect(first.is_itin).toBe(false);
    expect(first.resolved_income_type).toBe("Full Documentation - Wage Earner");
    // ITIN row spot-check
    const itin = rows.find((r) => r.is_itin && r.income_doc_type === "Bank Stmts: 12 Mo. Personal")!;
    expect(itin.resolved_income_type).toBe("ITIN - Bank Statement 12 Mo. Personal");
  });

  it("rejects a table with the wrong header order", () => {
    const broken = `## 4. Quick reference: Frontend → resolved Neo4j type

| BorrowerType | IncomeDocType | Citizenship | ITIN | Resolved |
|---|---|---|---|---|
| W2 | Full Doc | US Citizen | False | Full Documentation - Wage Earner |
`;
    expect(() => parseResolverTable(broken)).toThrow(/header.*column.*order/i);
  });
});
```

- [ ] **Step 2: Run tests, see them fail**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-parser.test.ts -t "parseResolverTable"
```

Expected: 2 failures.

- [ ] **Step 3: Implement `parseResolverTable`**

Replace the body of `parseResolverTable` in `packages/api/src/ingestion/doc-checklist-parser.ts`:

```typescript
export function parseResolverTable(markdown: string): ResolverRow[] {
  const tokens = parseAst(markdown);
  // File Section D: ## 4. Quick reference: Frontend → resolved Neo4j type
  let inSection = false;
  let table: Tokens.Table | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === "heading") {
      const h = t as Tokens.Heading;
      if (h.depth === 2 && /Quick reference.*resolved Neo4j type/i.test(h.text)) {
        inSection = true;
        continue;
      }
      if (inSection && h.depth === 2) break;
    }
    if (inSection && t.type === "table") {
      table = t as Tokens.Table;
      break;
    }
  }
  if (!table) {
    throw new DocChecklistParseError("File Section D: missing resolver table under H2", "D");
  }

  // Strict header-order check per spec §1.2.
  const headers = table.header.map((h) => (h as Tokens.TableCell).text.trim());
  const expected = ["`IncomeDocType`", "`BorrowerType`", "`Citizenship`", "ITIN", "Resolved"];
  if (headers.length !== expected.length) {
    throw new DocChecklistParseError(
      `File Section D: header column count mismatch (expected ${expected.length}, got ${headers.length})`,
      "D",
    );
  }
  for (let i = 0; i < expected.length; i++) {
    if (headers[i] !== expected[i]) {
      throw new DocChecklistParseError(
        `File Section D: header column order wrong at index ${i} (expected '${expected[i]}', got '${headers[i]}')`,
        "D",
      );
    }
  }

  return table.rows.map((row) => {
    const cells = row.map((c) => (c as Tokens.TableCell).text.trim().replace(/^`|`$/g, ""));
    const [incomeDocType, borrowerType, citizenship, itinRaw, resolved] = cells;
    if (borrowerType !== "W2" && borrowerType !== "Self-Employed") {
      throw new DocChecklistParseError(`File Section D: invalid BorrowerType '${borrowerType}'`, "D");
    }
    if (citizenship !== "US Citizen" && citizenship !== "Foreign Nationals") {
      throw new DocChecklistParseError(`File Section D: invalid Citizenship '${citizenship}'`, "D");
    }
    const isItin = itinRaw === "True" || itinRaw === "true";
    return {
      income_doc_type: incomeDocType!,
      borrower_type: borrowerType,
      citizenship,
      is_itin: isItin,
      resolved_income_type: resolved!,
    };
  });
}
```

- [ ] **Step 4: Run tests, see them pass**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-parser.test.ts -t "parseResolverTable"
pnpm --filter @twin/api build
```

Expected: 2 tests pass, build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/doc-checklist-parser.ts packages/api/test/doc-checklist-parser.test.ts
git commit -m "feat(api/ingestion): parseResolverTable — File Section D → ResolverRow[]

Parses the Frontend→Resolved-Neo4j-type mapper table from File Section D.
Strict header-order check per spec §1.2 invariant. Returns 32 rows for the
NPNQM fixture; ITIN flag normalized to boolean."
```

---

## Task 7: `parseAll` composer + parity verifier

**Files:**
- Modify: `packages/api/src/ingestion/doc-checklist-parser.ts`
- Modify: `packages/api/test/doc-checklist-parser.test.ts`

**Rationale:** `parseAll` is already wired in Task 3; we add the parity verifier (spec §3.4) which cross-checks each ScenarioRow's parsed lists against `raw_min_msg` / `raw_income_msg`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/test/doc-checklist-parser.test.ts`:

```typescript
import { verifyParity } from "../src/ingestion/doc-checklist-parser.js";

describe("parseAll + verifyParity", () => {
  it("parseAll returns 25 scenarios + 3 rules + 32 resolver rows + footer + hash", () => {
    const md = loadFixture();
    const r = parseAll(md);
    expect(r.scenarios).toHaveLength(25);
    expect(r.rules).toHaveLength(3);
    expect(r.resolver).toHaveLength(32);
    expect(r.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(r.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifyParity passes for the real fixture", () => {
    const md = loadFixture();
    const r = parseAll(md);
    // Should not throw
    verifyParity(r.scenarios);
  });

  it("verifyParity throws when a parsed list differs from raw_min_msg", () => {
    const md = loadFixture();
    const r = parseAll(md);
    // Hand-corrupt one scenario's minimum_docs
    const corrupt = JSON.parse(JSON.stringify(r.scenarios)) as typeof r.scenarios;
    corrupt[0]!.minimum_docs[0]!.name = "TOTALLY DIFFERENT DOC";
    expect(() => verifyParity(corrupt)).toThrow(/parity mismatch/i);
  });
});
```

- [ ] **Step 2: Run tests, see them fail**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-parser.test.ts -t "parseAll"
```

Expected: 3 failures (`verifyParity` not exported yet).

- [ ] **Step 3: Implement `verifyParity`**

Append to `packages/api/src/ingestion/doc-checklist-parser.ts`:

```typescript
/**
 * Verify that each scenario's parsed minimum_docs/income_docs reproduce the
 * raw_min_msg / raw_income_msg pipe-lists embedded in the source markdown's
 * <details> block. Catches:
 *   - Parser bugs (we emitted a different list than the engine produced)
 *   - Stale markdown (the file's parsed sections don't match its own raw lines)
 *   - Hand-edits post-generation
 *
 * Spec §3.4.
 */
export function verifyParity(scenarios: ScenarioRow[]): void {
  for (const s of scenarios) {
    const parsedMin = `Missing base documents: ${docsToPipeList(s.minimum_docs)}`;
    const parsedInc = `Required documents: ${docsToPipeList(s.income_docs)}`;
    if (parsedMin !== s.raw_min_msg.trim()) {
      throw new DocChecklistParseError(
        `parity mismatch for scenario '${s.resolved_income_type}' minimum_docs:\n  parsed: ${parsedMin}\n  raw:    ${s.raw_min_msg.trim()}`,
        "B",
      );
    }
    if (parsedInc !== s.raw_income_msg.trim()) {
      throw new DocChecklistParseError(
        `parity mismatch for scenario '${s.resolved_income_type}' income_docs:\n  parsed: ${parsedInc}\n  raw:    ${s.raw_income_msg.trim()}`,
        "B",
      );
    }
  }
}

function docsToPipeList(items: DocItem[]): string {
  return items.map((d) => (d.note ? `${d.name} (Note: ${d.note})` : d.name)).join(" | ");
}
```

- [ ] **Step 4: Run tests, see them pass**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-parser.test.ts -t "parseAll"
pnpm --filter @twin/api build
```

Expected: 3 tests pass, build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/ingestion/doc-checklist-parser.ts packages/api/test/doc-checklist-parser.test.ts
git commit -m "feat(api/ingestion): verifyParity — cross-check parsed lists vs raw engine messages

Reproduces each scenario's pipe-list from its parsed minimum_docs/income_docs
arrays and compares against the <details> block's raw engine messages (spec
§3.4). Catches parser bugs, stale markdown, and hand-edits before any DB
write.

parseAll already wired in Task 3; this completes File Section B coverage."
```

---

## Task 8: Error classes + resolver test scaffold

**Files:**
- Create: `packages/api/src/services/doc-requirements.ts`
- Create: `packages/api/test/doc-checklist-resolver.test.ts`

**Rationale:** The resolver service has a four-row error contract per spec §4. We define the three error classes and the function signature first, then fill in the body in subsequent tasks.

**Reviewer note 2:** `IncomeTypeUnresolvedError` is a NEW error class downstream callers don't know about. When future Predictive Conditions / VA Doc Review specs are written, they must include explicit handlers for it. Flagging in commit message.

- [ ] **Step 1: Write the failing test**

Create `packages/api/test/doc-checklist-resolver.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  NoActiveKbVersionError,
  KbVersionNotFoundError,
  IncomeTypeUnresolvedError,
  resolveRequiredDocs,
} from "../src/services/doc-requirements.js";

describe("doc-requirements module shape", () => {
  it("exports the three domain error classes", () => {
    expect(NoActiveKbVersionError).toBeDefined();
    expect(KbVersionNotFoundError).toBeDefined();
    expect(IncomeTypeUnresolvedError).toBeDefined();
    expect(new NoActiveKbVersionError("test", "t1") instanceof Error).toBe(true);
  });

  it("resolveRequiredDocs is exported", () => {
    expect(typeof resolveRequiredDocs).toBe("function");
  });
});
```

- [ ] **Step 2: Run test, see it fail**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-resolver.test.ts
```

Expected: failure — module not found.

- [ ] **Step 3: Create the service skeleton**

Create `packages/api/src/services/doc-requirements.ts`:

```typescript
// Doc Requirements resolver. Given a loan context, returns the required-docs
// list for the active (or specified) KB version, with engine-rule modifiers
// applied. See spec §4.
//
// Error contract (binding for downstream callers — Predictive Conditions, VA
// Doc Review specialist):
//   - NoActiveKbVersionError       : kbVersionId=null and no active row exists
//   - KbVersionNotFoundError       : explicit kbVersionId missing or wrong-tenant
//   - IncomeTypeUnresolvedError    : (incomeDocType, borrowerType, citizenship,
//                                     isItin) tuple has no resolver row

import { withTenantTx } from "../db/pool.js";

export interface DocItem {
  order: number;
  name: string;
  note: string | null;
}

export interface LoanContext {
  incomeDocType: string;
  borrowerType: "W2" | "Self-Employed";
  citizenship: "US Citizen" | "Foreign Nationals";
  isItin: boolean;
  llcOrLegalEntity: boolean;
  occupancy: "primary" | "second_home" | "investment";
  state: string;
  county: string;
  usCredit: boolean;
  program: string;
}

export interface ResolveResult {
  resolvedIncomeType: string;
  minimum: DocItem[];
  income: DocItem[];
  appliedRules: string[];
  kbVersionId: number;
}

export class NoActiveKbVersionError extends Error {
  constructor(public readonly tenantSlugOrId: string, public readonly tenantId: string) {
    super(`No active KB version for tenant ${tenantSlugOrId} (${tenantId}). An admin must run two-key approval (scripts/approve-kb.ts) before doc resolution is available.`);
    this.name = "NoActiveKbVersionError";
  }
}

export class KbVersionNotFoundError extends Error {
  constructor(public readonly kbVersionId: number, public readonly tenantId: string) {
    super(`KB version ${kbVersionId} not found for tenant ${tenantId} (does not exist, or belongs to a different tenant).`);
    this.name = "KbVersionNotFoundError";
  }
}

export class IncomeTypeUnresolvedError extends Error {
  constructor(
    public readonly inputs: {
      incomeDocType: string;
      borrowerType: string;
      citizenship: string;
      isItin: boolean;
    },
    public readonly tenantId: string,
    public readonly kbVersionId: number,
  ) {
    super(
      `No income_type_resolver row for tenant ${tenantId}, kb_version ${kbVersionId}, inputs (incomeDocType='${inputs.incomeDocType}', borrowerType='${inputs.borrowerType}', citizenship='${inputs.citizenship}', isItin=${inputs.isItin}). Either malformed loan input or an engine-coverage gap in the ingested KB.`,
    );
    this.name = "IncomeTypeUnresolvedError";
  }
}

export async function resolveRequiredDocs(
  tenantId: string,
  kbVersionId: number | null,
  loan: LoanContext,
): Promise<ResolveResult> {
  throw new Error("resolveRequiredDocs not yet implemented");
}
```

- [ ] **Step 4: Run test, see it pass**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-resolver.test.ts
pnpm --filter @twin/api build
```

Expected: 2 tests pass, build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/doc-requirements.ts packages/api/test/doc-checklist-resolver.test.ts
git commit -m "feat(api/services): doc-requirements module skeleton + error classes

Defines the public surface of resolveRequiredDocs per spec §4: LoanContext +
ResolveResult types, NoActiveKbVersionError / KbVersionNotFoundError /
IncomeTypeUnresolvedError. Body throws 'not yet implemented' until Task 9
fills it in via TDD.

IMPLEMENTATION NOTE FOR DOWNSTREAM SPECS: IncomeTypeUnresolvedError is new.
When Predictive Conditions and VA Doc Review specialist specs are written
they must include explicit handler stories (fall back to default? block
operation? alert ops?). See spec §10 implementation note 2."
```

---

## Task 9: `resolveRequiredDocs` happy path + 3 error cases

**Files:**
- Modify: `packages/api/src/services/doc-requirements.ts`
- Modify: `packages/api/test/doc-checklist-resolver.test.ts`

**Rationale:** Full four-row error contract from spec §4 + happy path. Tests use a dedicated test tenant; each test seeds its own scenario data.

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/test/doc-checklist-resolver.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

// Boot .env so DATABASE_URL is set (mirrors other integration tests).
if (!process.env.DATABASE_URL) {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    for (const line of readFileSync(resolvePath(here, "../.env"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* .env not present — DATABASE_URL error will surface clearly */ }
}

import { beforeAll, afterAll } from "vitest";
import { withDb, withTenantTx, closePool } from "../src/db/pool.js";

const T = "5d175193-6ee2-4d6a-b16e-cc00cc00cc01"; // dedicated resolver test tenant

async function seedTenantAndKbVersion(kind: "active" | "pending"): Promise<number> {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO tenants (id, name, slug, status, type)
       VALUES ($1, 'Resolver Test Tenant', 'resolver-test', 'active', 'demo')
       ON CONFLICT (id) DO NOTHING`,
      [T],
    );
  });
  return await withDb(async (c) => {
    // Pick a fresh version int we don't collide on.
    const { rows: maxRows } = await c.query<{ max: number | null }>(
      `SELECT MAX(version) AS max FROM kb_versions WHERE tenant_id = $1`, [T],
    );
    const v = (maxRows[0]?.max ?? 0) + 1;
    const status = kind === "active" ? "active" : "pending_approval";
    const { rows } = await c.query<{ id: number }>(
      `INSERT INTO kb_versions (tenant_id, version, status, source_documents)
         VALUES ($1, $2, $3, '{"kind":"doc_checklist"}'::jsonb)
       RETURNING id`,
      [T, v, status],
    );
    return rows[0]!.id;
  });
}

async function seedHappyPathRows(kbId: number): Promise<void> {
  await withTenantTx(T, async (c) => {
    await c.query(
      `INSERT INTO income_type_resolver
         (tenant_id, kb_version_id, income_doc_type, borrower_type, citizenship, is_itin, resolved_income_type)
       VALUES ($1, $2, 'Full Doc', 'W2', 'US Citizen', false, 'Full Documentation - Wage Earner')
       ON CONFLICT DO NOTHING`,
      [T, kbId],
    );
    await c.query(
      `INSERT INTO program_doc_checklist
         (tenant_id, kb_version_id, resolved_income_type, program, minimum_docs, income_docs, raw_min_msg, raw_income_msg)
       VALUES ($1, $2, 'Full Documentation - Wage Earner', 'Flex Select',
               $3::jsonb, $4::jsonb, 'raw_min_test', 'raw_inc_test')
       ON CONFLICT DO NOTHING`,
      [
        T, kbId,
        JSON.stringify([{ order: 1, name: "Initial Loan Application (1003)", note: null }]),
        JSON.stringify([{ order: 1, name: "Most recent paystub(s) reflecting 30 days of pay", note: null }]),
      ],
    );
  });
}

async function cleanup(): Promise<void> {
  await withDb(async (c) => {
    await c.query(`DELETE FROM income_type_resolver  WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM program_doc_checklist WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM program_doc_engine_rules WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM kb_versions WHERE tenant_id = $1`, [T]);
  });
}

beforeAll(async () => { await cleanup(); });
afterAll(async () => { await cleanup(); await closePool(); });

describe("resolveRequiredDocs — error contract (spec §4)", () => {
  it("throws NoActiveKbVersionError when null and no active row", async () => {
    await cleanup();
    await seedTenantAndKbVersion("pending");
    await expect(
      resolveRequiredDocs(T, null, baseLoanContext()),
    ).rejects.toBeInstanceOf(NoActiveKbVersionError);
  });

  it("throws KbVersionNotFoundError for a non-existent explicit id", async () => {
    await expect(
      resolveRequiredDocs(T, 999999999, baseLoanContext()),
    ).rejects.toBeInstanceOf(KbVersionNotFoundError);
  });

  it("throws IncomeTypeUnresolvedError when no resolver row matches", async () => {
    await cleanup();
    const kbId = await seedTenantAndKbVersion("active");
    // No rows in income_type_resolver
    await expect(
      resolveRequiredDocs(T, kbId, baseLoanContext()),
    ).rejects.toBeInstanceOf(IncomeTypeUnresolvedError);
  });

  it("happy path returns the resolved type + lists when all rows present", async () => {
    await cleanup();
    const kbId = await seedTenantAndKbVersion("active");
    await seedHappyPathRows(kbId);
    const r = await resolveRequiredDocs(T, null, baseLoanContext());
    expect(r.resolvedIncomeType).toBe("Full Documentation - Wage Earner");
    expect(r.minimum).toHaveLength(1);
    expect(r.income).toHaveLength(1);
    expect(r.appliedRules).toEqual([]);
    expect(r.kbVersionId).toBe(kbId);
  });
});

function baseLoanContext(): import("../src/services/doc-requirements.js").LoanContext {
  return {
    incomeDocType: "Full Doc",
    borrowerType: "W2",
    citizenship: "US Citizen",
    isItin: false,
    llcOrLegalEntity: false,
    occupancy: "primary",
    state: "CA",
    county: "Los Angeles",
    usCredit: true,
    program: "Flex Select",
  };
}
```

- [ ] **Step 2: Run tests, see them fail**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-resolver.test.ts -t "error contract"
```

Expected: 4 failures (`not yet implemented`).

- [ ] **Step 3: Implement `resolveRequiredDocs`**

Replace the body of `resolveRequiredDocs` in `packages/api/src/services/doc-requirements.ts`:

```typescript
export async function resolveRequiredDocs(
  tenantId: string,
  kbVersionId: number | null,
  loan: LoanContext,
): Promise<ResolveResult> {
  return withTenantTx(tenantId, async (c) => {
    // 1. Resolve target kb_version_id
    let resolvedKbId: number;
    if (kbVersionId === null) {
      const { rows } = await c.query<{ id: number }>(
        `SELECT id FROM kb_versions WHERE tenant_id = $1 AND status = 'active' LIMIT 1`,
        [tenantId],
      );
      if (rows.length === 0) throw new NoActiveKbVersionError(tenantId, tenantId);
      resolvedKbId = rows[0]!.id;
    } else {
      const { rows } = await c.query<{ id: number }>(
        `SELECT id FROM kb_versions WHERE id = $1 AND tenant_id = $2`,
        [kbVersionId, tenantId],
      );
      if (rows.length === 0) throw new KbVersionNotFoundError(kbVersionId, tenantId);
      resolvedKbId = kbVersionId;
    }

    // 2. Resolve income type
    const { rows: resolverRows } = await c.query<{ resolved_income_type: string }>(
      `SELECT resolved_income_type FROM income_type_resolver
        WHERE tenant_id = $1 AND kb_version_id = $2
          AND income_doc_type = $3 AND borrower_type = $4
          AND citizenship = $5 AND is_itin = $6`,
      [tenantId, resolvedKbId, loan.incomeDocType, loan.borrowerType, loan.citizenship, loan.isItin],
    );
    if (resolverRows.length === 0) {
      throw new IncomeTypeUnresolvedError(
        {
          incomeDocType: loan.incomeDocType,
          borrowerType: loan.borrowerType,
          citizenship: loan.citizenship,
          isItin: loan.isItin,
        },
        tenantId,
        resolvedKbId,
      );
    }
    const resolvedIncomeType = resolverRows[0]!.resolved_income_type;

    // 3. Fetch base lists
    const { rows: checklistRows } = await c.query<{
      minimum_docs: DocItem[];
      income_docs: DocItem[];
    }>(
      `SELECT minimum_docs, income_docs FROM program_doc_checklist
        WHERE tenant_id = $1 AND kb_version_id = $2 AND resolved_income_type = $3`,
      [tenantId, resolvedKbId, resolvedIncomeType],
    );
    if (checklistRows.length === 0) {
      throw new IncomeTypeUnresolvedError(
        {
          incomeDocType: loan.incomeDocType,
          borrowerType: loan.borrowerType,
          citizenship: loan.citizenship,
          isItin: loan.isItin,
        },
        tenantId,
        resolvedKbId,
      );
    }
    const minimum = [...checklistRows[0]!.minimum_docs];
    const income = [...checklistRows[0]!.income_docs];

    // 4. Fetch + apply engine rules (Task 10 fills in predicate evaluation)
    const appliedRules: string[] = [];
    // Placeholder — Task 10 implements applyEngineRules. For now no modifiers run.

    return { resolvedIncomeType, minimum, income, appliedRules, kbVersionId: resolvedKbId };
  });
}
```

- [ ] **Step 4: Run tests, see them pass**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-resolver.test.ts -t "error contract"
pnpm --filter @twin/api build
```

Expected: 4 tests pass, build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/doc-requirements.ts packages/api/test/doc-checklist-resolver.test.ts
git commit -m "feat(api/services): resolveRequiredDocs happy path + four-row error contract

Implements the spec §4 binding contract:
  - kbVersionId=null + no active row → NoActiveKbVersionError
  - explicit kbVersionId not found / wrong tenant → KbVersionNotFoundError
  - missing income_type_resolver row → IncomeTypeUnresolvedError
  - happy path → resolved type + base lists + applied-rules array

Engine-rule predicate evaluation is stubbed (returns no modifiers); Task 10
fills it in. All four resolver tests pass against a dedicated test tenant
(cc00cc00cc01) that the test seeds + cleans up itself."
```

---

## Task 10: Engine-rule predicate evaluation

**Files:**
- Modify: `packages/api/src/services/doc-requirements.ts`
- Modify: `packages/api/test/doc-checklist-resolver.test.ts`

**Rationale:** Spec §2.2 specifies three rule shapes. Each has a deterministic predicate; the resolver iterates rules and applies effects whose predicate matches the LoanContext.

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/test/doc-checklist-resolver.test.ts`:

```typescript
async function seedAllThreeRules(kbId: number): Promise<void> {
  await withTenantTx(T, async (c) => {
    await c.query(
      `INSERT INTO program_doc_engine_rules (tenant_id, kb_version_id, rule_name, predicate, effect, description)
       VALUES ($1, $2, 'llc_closing_docs',
               '{"LLCOrLegalEntity": true, "occupancy_in": ["investment"], "program_not_in": ["Investor DSCR"]}'::jsonb,
               '{"add_docs": ["LLC closing documents"], "remove_docs": []}'::jsonb,
               'LLC closing docs')
       ON CONFLICT DO NOTHING`,
      [T, kbId],
    );
    await c.query(
      `INSERT INTO program_doc_engine_rules (tenant_id, kb_version_id, rule_name, predicate, effect, description)
       VALUES ($1, $2, 'field_review',
               '{"state": "NY", "county_in": ["Brooklyn", "Kings"], "occupancy_in": ["investment"]}'::jsonb,
               '{"add_docs": ["Field review"], "remove_docs": []}'::jsonb,
               'Field review for NY investment')
       ON CONFLICT DO NOTHING`,
      [T, kbId],
    );
    await c.query(
      `INSERT INTO program_doc_engine_rules (tenant_id, kb_version_id, rule_name, predicate, effect, description)
       VALUES ($1, $2, 'us_credit_optional',
               '{"USCredit": false}'::jsonb,
               '{"add_docs": [], "remove_docs": ["Credit Report dated within 90 days"]}'::jsonb,
               'US credit optional')
       ON CONFLICT DO NOTHING`,
      [T, kbId],
    );
  });
}

describe("resolveRequiredDocs — engine-rule predicates", () => {
  it("applies llc_closing_docs when LLCOrLegalEntity=true + investment occupancy + not DSCR", async () => {
    await cleanup();
    const kbId = await seedTenantAndKbVersion("active");
    await seedHappyPathRows(kbId);
    await seedAllThreeRules(kbId);
    const loan = { ...baseLoanContext(), llcOrLegalEntity: true, occupancy: "investment" as const, program: "Flex Select" };
    const r = await resolveRequiredDocs(T, kbId, loan);
    expect(r.appliedRules).toContain("llc_closing_docs");
    expect(r.minimum.map((d) => d.name)).toContain("LLC closing documents");
  });

  it("does NOT apply llc_closing_docs when program is DSCR", async () => {
    await cleanup();
    const kbId = await seedTenantAndKbVersion("active");
    await seedHappyPathRows(kbId);
    await seedAllThreeRules(kbId);
    const loan = { ...baseLoanContext(), llcOrLegalEntity: true, occupancy: "investment" as const, program: "Investor DSCR" };
    const r = await resolveRequiredDocs(T, kbId, loan);
    expect(r.appliedRules).not.toContain("llc_closing_docs");
  });

  it("applies field_review when state=NY + county=Brooklyn + occupancy=investment", async () => {
    await cleanup();
    const kbId = await seedTenantAndKbVersion("active");
    await seedHappyPathRows(kbId);
    await seedAllThreeRules(kbId);
    const loan = { ...baseLoanContext(), state: "NY", county: "Brooklyn", occupancy: "investment" as const };
    const r = await resolveRequiredDocs(T, kbId, loan);
    expect(r.appliedRules).toContain("field_review");
    expect(r.minimum.map((d) => d.name)).toContain("Field review");
  });

  it("removes Credit Report when usCredit=false", async () => {
    await cleanup();
    const kbId = await seedTenantAndKbVersion("active");
    // Seed a checklist row that DOES include Credit Report
    await withTenantTx(T, async (c) => {
      await c.query(
        `INSERT INTO income_type_resolver (tenant_id, kb_version_id, income_doc_type, borrower_type, citizenship, is_itin, resolved_income_type)
         VALUES ($1, $2, 'Full Doc', 'W2', 'US Citizen', false, 'Full Documentation - Wage Earner')`,
        [T, kbId],
      );
      await c.query(
        `INSERT INTO program_doc_checklist (tenant_id, kb_version_id, resolved_income_type, program, minimum_docs, income_docs, raw_min_msg, raw_income_msg)
         VALUES ($1, $2, 'Full Documentation - Wage Earner', 'Flex Select',
                 $3::jsonb, '[]'::jsonb, 'raw', 'raw')`,
        [T, kbId, JSON.stringify([
          { order: 1, name: "Initial Loan Application (1003)", note: null },
          { order: 2, name: "Credit Report dated within 90 days", note: null },
        ])],
      );
    });
    await seedAllThreeRules(kbId);
    const loan = { ...baseLoanContext(), usCredit: false };
    const r = await resolveRequiredDocs(T, kbId, loan);
    expect(r.appliedRules).toContain("us_credit_optional");
    expect(r.minimum.map((d) => d.name)).not.toContain("Credit Report dated within 90 days");
  });
});
```

- [ ] **Step 2: Run tests, see them fail**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-resolver.test.ts -t "engine-rule"
```

Expected: 4 failures (rule application not implemented).

- [ ] **Step 3: Implement predicate evaluation**

Replace the rule-application placeholder in `packages/api/src/services/doc-requirements.ts` (inside `resolveRequiredDocs`, replace the `appliedRules` block):

```typescript
    // 4. Fetch + apply engine rules
    const { rows: ruleRows } = await c.query<{
      rule_name: string;
      predicate: Record<string, unknown>;
      effect: { add_docs: string[]; remove_docs: string[] };
    }>(
      `SELECT rule_name, predicate, effect FROM program_doc_engine_rules
        WHERE tenant_id = $1 AND kb_version_id = $2`,
      [tenantId, resolvedKbId],
    );
    const appliedRules: string[] = [];
    for (const rule of ruleRows) {
      if (rulePredicateMatches(rule.predicate, loan)) {
        appliedRules.push(rule.rule_name);
        // Add: append at end with auto-incremented order
        for (const docName of rule.effect.add_docs) {
          minimum.push({ order: minimum.length + 1, name: docName, note: null });
        }
        // Remove: filter by exact name match
        for (const docName of rule.effect.remove_docs) {
          const idx = minimum.findIndex((d) => d.name === docName);
          if (idx >= 0) minimum.splice(idx, 1);
        }
      }
    }
```

Add the predicate matcher function near the bottom of the file:

```typescript
function rulePredicateMatches(predicate: Record<string, unknown>, loan: LoanContext): boolean {
  for (const [key, val] of Object.entries(predicate)) {
    if (key === "LLCOrLegalEntity" && loan.llcOrLegalEntity !== val) return false;
    if (key === "USCredit" && loan.usCredit !== val) return false;
    if (key === "state" && loan.state !== val) return false;
    if (key === "county_in" && Array.isArray(val) && !val.includes(loan.county)) return false;
    if (key === "occupancy_in" && Array.isArray(val) && !val.includes(loan.occupancy)) return false;
    if (key === "program_not_in" && Array.isArray(val) && val.includes(loan.program)) return false;
  }
  return true;
}
```

- [ ] **Step 4: Run tests, see them pass**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-resolver.test.ts
pnpm --filter @twin/api build
```

Expected: 8 resolver tests pass, build clean.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/doc-requirements.ts packages/api/test/doc-checklist-resolver.test.ts
git commit -m "feat(api/services): engine-rule predicate evaluation + effect application

Implements the spec §2.2 predicate matcher for the three known rule shapes:
  - llc_closing_docs   (LLCOrLegalEntity + occupancy_in + program_not_in)
  - field_review       (state + county_in + occupancy_in)
  - us_credit_optional (USCredit=false → remove Credit Report)

Rules whose predicate matches the LoanContext have their effect applied
to the minimum_docs list (append for add_docs, filter for remove_docs).
appliedRules array names which rules fired. All four behavioral tests
pass against the resolver test tenant."
```

---

## Task 11: Shared CLI arg-parser helper

**Files:**
- Create: `scripts/lib/cli-args.ts`

**Rationale:** Both `ingest-doc-checklist.ts` and `approve-kb.ts` parse similar flags (`--tenant`, `--as`, `--yes`, etc.). Extracting a tiny helper keeps the two CLIs DRY and consistent on error messages.

- [ ] **Step 1: Write the helper**

Create `scripts/lib/cli-args.ts`:

```typescript
// Tiny no-dependency CLI arg helper shared by scripts/ingest-doc-checklist.ts
// and scripts/approve-kb.ts. Long flags only ('--foo value' or '--flag').
// Unknown flags throw; missing required flags throw.

export type ArgSpec = {
  name: string;
  required?: boolean;
  hasValue?: boolean;     // default true
  default?: string;
};

export class CliArgsError extends Error {
  constructor(message: string, public readonly exitCode = 2) {
    super(message);
    this.name = "CliArgsError";
  }
}

export function parseArgs(argv: string[], specs: ArgSpec[]): Record<string, string | true> {
  const byName = new Map(specs.map((s) => [s.name, s]));
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) {
      throw new CliArgsError(`unexpected positional argument: ${a}`);
    }
    const name = a.slice(2);
    const spec = byName.get(name);
    if (!spec) throw new CliArgsError(`unknown flag: --${name}`);
    if (spec.hasValue === false) {
      out[name] = true;
    } else {
      const v = argv[++i];
      if (v === undefined) throw new CliArgsError(`flag --${name} requires a value`);
      out[name] = v;
    }
  }
  for (const s of specs) {
    if (s.required && !(s.name in out)) {
      throw new CliArgsError(`missing required flag: --${s.name}`);
    }
    if (s.default !== undefined && !(s.name in out)) {
      out[s.name] = s.default;
    }
  }
  return out;
}

export function exitWith(code: number, message: string): never {
  process.stderr.write(message.endsWith("\n") ? message : message + "\n");
  process.exit(code);
}
```

- [ ] **Step 2: Smoke-test by compiling**

```bash
pnpm --filter @twin/api build
```

(The helper lives in `scripts/`, not in `@twin/api`, so it's tsx-loaded at runtime. The build check just confirms we haven't broken anything. No dedicated test — the helper is exercised through the two CLI integration tests in later tasks.)

Expected: build clean.

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/cli-args.ts
git commit -m "chore(scripts): tiny CLI arg-parser helper shared by ingest + approve CLIs

Long-flag-only, no dependencies. CliArgsError carries an exitCode for the
caller's process.exit(). Used by Tasks 12 (ingest-doc-checklist.ts) and
Task 14 (approve-kb.ts)."
```

---

## Task 12: `scripts/ingest-doc-checklist.ts` — arg parsing + parse + dry-run

**Files:**
- Create: `scripts/ingest-doc-checklist.ts`

**Rationale:** First half of the ingest CLI: arg parsing, file read, parser invocation, parity verify, max-age check, `--dry-run` summary print. No DB writes yet — Task 13 adds those.

- [ ] **Step 1: Write the CLI**

Create `scripts/ingest-doc-checklist.ts`:

```typescript
#!/usr/bin/env tsx
// scripts/ingest-doc-checklist.ts
//
// Parses NPNQM's Document_Requirements_All_Income_Types.md and writes the
// three doc-checklist tables (program_doc_checklist, program_doc_engine_rules,
// income_type_resolver) tied to a new kb_versions row.
//
// See spec docs/superpowers/specs/2026-05-12-doc-checklist-ingest-design.md.

import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseAll,
  verifyParity,
  DocChecklistParseError,
} from "../packages/api/src/ingestion/doc-checklist-parser.js";
import { parseArgs, exitWith, CliArgsError } from "./lib/cli-args.js";
import { withDb, withTenantTx, closePool } from "../packages/api/src/db/pool.js";

async function resolveTenantId(slugOrUuid: string): Promise<string> {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(slugOrUuid)) {
    const { rows } = await withDb(async (c) =>
      c.query<{ id: string }>(`SELECT id FROM tenants WHERE id = $1 AND deleted_at IS NULL`, [slugOrUuid]),
    );
    if (rows.length === 0) exitWith(2, `tenant ${slugOrUuid} not found`);
    return rows[0]!.id;
  }
  const { rows } = await withDb(async (c) =>
    c.query<{ id: string }>(`SELECT id FROM tenants WHERE slug = $1 AND deleted_at IS NULL`, [slugOrUuid]),
  );
  if (rows.length === 0) exitWith(2, `tenant '${slugOrUuid}' not found`);
  return rows[0]!.id;
}

async function main(): Promise<void> {
  let args: Record<string, string | true>;
  try {
    args = parseArgs(process.argv.slice(2), [
      { name: "tenant", required: true },
      { name: "version", required: true },
      { name: "as", required: true },
      { name: "file", required: true },
      { name: "max-age", required: false },
      { name: "dry-run", required: false, hasValue: false },
    ]);
  } catch (e) {
    if (e instanceof CliArgsError) exitWith(e.exitCode, `usage error: ${e.message}`);
    throw e;
  }

  const tenantSlugOrId = args.tenant as string;
  const versionInt = parseInt(args.version as string, 10);
  if (!Number.isInteger(versionInt) || versionInt < 1) {
    exitWith(2, `--version must be a positive integer (got '${args.version}')`);
  }
  const operatorUserId = args.as as string;
  const filePath = resolve(args.file as string);
  const maxAgeDays = args["max-age"] ? parseInt(args["max-age"] as string, 10) : null;
  const dryRun = args["dry-run"] === true;

  // 1. Read file
  let markdown: string;
  let fileBytes: number;
  try {
    markdown = readFileSync(filePath, "utf8");
    fileBytes = statSync(filePath).size;
  } catch (e) {
    exitWith(2, `cannot read --file ${filePath}: ${(e as Error).message}`);
  }

  // 2. Parse
  let parsed: ReturnType<typeof parseAll>;
  try {
    parsed = parseAll(markdown);
  } catch (e) {
    if (e instanceof DocChecklistParseError) {
      exitWith(3, `parser invariant violated (File Section ${e.section}): ${e.message}`);
    }
    throw e;
  }

  // 3. Parity verify
  try {
    verifyParity(parsed.scenarios);
  } catch (e) {
    if (e instanceof DocChecklistParseError) exitWith(4, e.message);
    throw e;
  }

  // 4. Max-age check
  if (maxAgeDays !== null) {
    const ageMs = Date.now() - new Date(parsed.generatedAt).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > maxAgeDays) {
      exitWith(6, `file generated at ${parsed.generatedAt} (${ageDays.toFixed(1)} days ago) exceeds --max-age ${maxAgeDays}. Regenerate upstream and re-run.`);
    }
  }

  // 5. Resolve tenant
  const tenantId = await resolveTenantId(tenantSlugOrId);

  // 6. Verify version-int not already used
  const collision = await withDb(async (c) =>
    c.query<{ status: string }>(
      `SELECT status FROM kb_versions WHERE tenant_id = $1 AND version = $2`,
      [tenantId, versionInt],
    ),
  );
  if (collision.rows.length > 0) {
    exitWith(7, `kb_versions row already exists for tenant ${tenantSlugOrId} version ${versionInt} (status: ${collision.rows[0]!.status}). Pick the next integer.`);
  }

  // 7. Summary
  console.log("");
  console.log("  Tenant:        ", tenantSlugOrId, `(${tenantId})`);
  console.log("  Version:       ", versionInt);
  console.log("  File:          ", filePath, `(${fileBytes} bytes)`);
  console.log("  Generated at:  ", parsed.generatedAt);
  console.log("  Source SHA256: ", parsed.sourceHash);
  console.log("  Scenarios:     ", parsed.scenarios.length);
  console.log("  Rules:         ", parsed.rules.length);
  console.log("  Resolver rows: ", parsed.resolver.length);
  console.log("");

  if (dryRun) {
    console.log("--dry-run: parsed + verified, no DB writes. Re-run without --dry-run to ingest.");
    await closePool();
    process.exit(0);
  }

  // Task 13 fills in the DB writes below.
  console.log("TODO: DB writes land in Task 13.");
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-test against the real file in dry-run mode**

```bash
pnpm tsx scripts/ingest-doc-checklist.ts \
  --tenant demo \
  --version 1 \
  --as 00000000-0000-0000-0000-000000000001 \
  --file docs/npnqm-source/Document_Requirements_All_Income_Types.md \
  --dry-run
```

Expected output: tenant resolved, 25 scenarios / 3 rules / 32 resolver rows, "TODO: DB writes land in Task 13.", exit 0.

- [ ] **Step 3: Commit**

```bash
git add scripts/ingest-doc-checklist.ts
git commit -m "feat(scripts): ingest-doc-checklist CLI (parse + verify + --dry-run)

Implements the first half of spec §3: arg parsing, file read, parseAll +
verifyParity, --max-age check, version-int collision check, summary print.
DB writes deferred to Task 13.

Exit codes follow spec §6 convention: 2=tenant/file not found, 3=parser
invariant, 4=parity mismatch, 6=max-age exceeded, 7=duplicate version int."
```

---

## Task 13: `scripts/ingest-doc-checklist.ts` — DB writes inside `withTenantTx`

**Files:**
- Modify: `scripts/ingest-doc-checklist.ts`

**Rationale:** Replace the `TODO: DB writes land in Task 13.` placeholder with the actual three-table transactional insert + kb_versions row.

- [ ] **Step 1: Replace the TODO block with the implementation**

In `scripts/ingest-doc-checklist.ts`, replace the lines:

```typescript
  // Task 13 fills in the DB writes below.
  console.log("TODO: DB writes land in Task 13.");
  await closePool();
```

with:

```typescript
  // 8. Write kb_versions row + all three child tables in a single transaction.
  const kbVersionId = await withDb(async (c) => {
    const { rows } = await c.query<{ id: number }>(
      `INSERT INTO kb_versions (tenant_id, version, status, source_documents, ingested_by)
         VALUES ($1, $2, 'pending_approval', $3::jsonb, $4)
       RETURNING id`,
      [
        tenantId,
        versionInt,
        JSON.stringify({
          kind: "doc_checklist",
          source_file: filePath,
          source_file_sha256: parsed.sourceHash,
          generated_at: parsed.generatedAt,
          ingested_by_cli: true,
        }),
        operatorUserId,
      ],
    );
    return rows[0]!.id;
  });

  await withTenantTx(tenantId, async (c) => {
    for (const s of parsed.scenarios) {
      await c.query(
        `INSERT INTO program_doc_checklist
           (tenant_id, kb_version_id, resolved_income_type, program,
            minimum_docs, income_docs, raw_min_msg, raw_income_msg)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
        [
          tenantId, kbVersionId,
          s.resolved_income_type, s.program,
          JSON.stringify(s.minimum_docs), JSON.stringify(s.income_docs),
          s.raw_min_msg, s.raw_income_msg,
        ],
      );
    }
    for (const r of parsed.rules) {
      await c.query(
        `INSERT INTO program_doc_engine_rules
           (tenant_id, kb_version_id, rule_name, predicate, effect, description)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
        [
          tenantId, kbVersionId,
          r.rule_name, JSON.stringify(r.predicate), JSON.stringify(r.effect),
          r.description,
        ],
      );
    }
    for (const rr of parsed.resolver) {
      await c.query(
        `INSERT INTO income_type_resolver
           (tenant_id, kb_version_id, income_doc_type, borrower_type, citizenship, is_itin, resolved_income_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tenantId, kbVersionId,
          rr.income_doc_type, rr.borrower_type, rr.citizenship, rr.is_itin, rr.resolved_income_type,
        ],
      );
    }
  });

  console.log(`Ingested. kb_versions.id = ${kbVersionId} (version ${versionInt}, status pending_approval).`);
  console.log(`Next: pnpm tsx scripts/approve-kb.ts --tenant ${tenantSlugOrId} --version-id ${kbVersionId} --as admin --user-id <admin-uuid>`);
  await closePool();
```

- [ ] **Step 2: Smoke-test against the demo tenant**

```bash
pnpm tsx scripts/ingest-doc-checklist.ts \
  --tenant demo \
  --version 99 \
  --as 00000000-0000-0000-0000-000000000001 \
  --file docs/npnqm-source/Document_Requirements_All_Income_Types.md
```

Expected: "Ingested. kb_versions.id = N (version 99, status pending_approval)." with a follow-up command.

Verify with a quick DB check:

```bash
node -e "
import('pg').then(async ({default: pg}) => {
  const fs = await import('fs');
  const env = fs.readFileSync('packages/api/.env','utf8');
  for (const line of env.split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)\$/); if (m) process.env[m[1]] ??= m[2]; }
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const r = await c.query(\"SELECT id, version, status FROM kb_versions WHERE version=99\");
  console.log(r.rows);
  await c.end();
});
"
```

Expected: one row with `version=99`, `status=pending_approval`.

- [ ] **Step 3: Clean up test data**

```bash
node -e "
import('pg').then(async ({default: pg}) => {
  const fs = await import('fs');
  const env = fs.readFileSync('packages/api/.env','utf8');
  for (const line of env.split('\n')) { const m = line.match(/^([A-Z_]+)=(.*)\$/); if (m) process.env[m[1]] ??= m[2]; }
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query(\"DELETE FROM kb_versions WHERE version=99\");
  await c.end();
});
"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/ingest-doc-checklist.ts
git commit -m "feat(scripts): ingest-doc-checklist DB writes (kb_versions + 3 tables, single tx)

Replaces the Task 12 placeholder with the actual three-table bulk insert
inside withTenantTx. kb_versions row is created in pending_approval status
with the source_documents.kind discriminator per spec §2.4. CLI prints the
follow-up approve-kb.ts command on success."
```

---

## Task 14: `scripts/approve-kb.ts` — args + tenant assertion + confirmation prompt

**Files:**
- Create: `scripts/approve-kb.ts`

**Rationale:** First half of the approval CLI: parse args, look up the version, assert tenant match (spec §8.1 cross-tenant defense), prompt for `[y/N]` unless `--yes`. No DB writes yet — Task 15 adds those.

- [ ] **Step 1: Write the CLI**

Create `scripts/approve-kb.ts`:

```typescript
#!/usr/bin/env tsx
// scripts/approve-kb.ts
//
// Two-key approval for kb_versions rows. See spec §8.
//
// Usage:
//   pnpm tsx scripts/approve-kb.ts --tenant <slug-or-uuid> --version-id <int> \
//     --as admin --user-id <uuid> [--activate] [--yes]

import { createInterface } from "node:readline/promises";
import { parseArgs, exitWith, CliArgsError } from "./lib/cli-args.js";
import { withDb, withTenantTx, closePool } from "../packages/api/src/db/pool.js";

interface KbVersionRow {
  id: number;
  tenant_id: string;
  version: number;
  status: string;
  approved_by: string | null;
  compliance_signoff_by: string | null;
}

async function lookupVersion(versionId: number): Promise<KbVersionRow | null> {
  const { rows } = await withDb(async (c) =>
    c.query<KbVersionRow>(
      `SELECT id, tenant_id, version, status, approved_by, compliance_signoff_by
         FROM kb_versions WHERE id = $1`,
      [versionId],
    ),
  );
  return rows[0] ?? null;
}

async function resolveTenantId(slugOrUuid: string): Promise<{ id: string; slug: string }> {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRe.test(slugOrUuid)) {
    const { rows } = await withDb(async (c) =>
      c.query<{ id: string; slug: string }>(
        `SELECT id, slug FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
        [slugOrUuid],
      ),
    );
    if (rows.length === 0) exitWith(2, `tenant ${slugOrUuid} not found`);
    return rows[0]!;
  }
  const { rows } = await withDb(async (c) =>
    c.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM tenants WHERE slug = $1 AND deleted_at IS NULL`,
      [slugOrUuid],
    ),
  );
  if (rows.length === 0) exitWith(2, `tenant '${slugOrUuid}' not found`);
  return rows[0]!;
}

async function promptYes(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("Proceed? [y/N]: ")).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

async function main(): Promise<void> {
  let args: Record<string, string | true>;
  try {
    args = parseArgs(process.argv.slice(2), [
      { name: "tenant", required: true },
      { name: "version-id", required: true },
      { name: "as", required: true },
      { name: "user-id", required: true },
      { name: "activate", required: false, hasValue: false },
      { name: "yes", required: false, hasValue: false },
    ]);
  } catch (e) {
    if (e instanceof CliArgsError) exitWith(e.exitCode, `usage error: ${e.message}`);
    throw e;
  }

  const tenantSlugOrId = args.tenant as string;
  const versionId = parseInt(args["version-id"] as string, 10);
  if (!Number.isInteger(versionId)) exitWith(2, `--version-id must be an integer`);
  const role = args.as as string;
  if (role !== "admin" && role !== "compliance_officer") {
    exitWith(2, `--as must be 'admin' or 'compliance_officer' (got '${role}')`);
  }
  const userId = args["user-id"] as string;
  const activate = args.activate === true;
  const skipConfirm = args.yes === true;

  if (activate && role !== "compliance_officer") {
    exitWith(2, `--activate is only valid with --as compliance_officer`);
  }

  // 1. Look up the version
  const version = await lookupVersion(versionId);
  if (!version) exitWith(2, `kb_versions row id=${versionId} not found`);

  // 2. Tenant-match assertion (defense against cross-tenant operator error)
  const tenant = await resolveTenantId(tenantSlugOrId);
  if (version.tenant_id !== tenant.id) {
    exitWith(
      2,
      `cross-tenant mismatch: kb_versions.id=${versionId} belongs to tenant ${version.tenant_id}, not '${tenantSlugOrId}' (${tenant.id}). Approval aborted.`,
    );
  }

  // 3. Confirmation prompt
  console.log("");
  console.log(`Version ${versionId} belongs to tenant ${tenant.slug} (id: ${tenant.id}).`);
  console.log(`  Current status: ${version.status}`);
  console.log(`  Action: approve as ${role} with user-id ${userId}${activate ? " + activate" : ""}.`);
  console.log("");
  if (!skipConfirm) {
    const ok = await promptYes();
    if (!ok) {
      console.log("Aborted by operator.");
      await closePool();
      process.exit(0);
    }
  }

  // Task 15 fills in the writes below.
  console.log("TODO: DB approval writes land in Task 15.");
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-test the arg parsing + confirmation flow against a stub**

```bash
# Ingest a fresh KB version first so we have one to approve
pnpm tsx scripts/ingest-doc-checklist.ts \
  --tenant demo \
  --version 99 \
  --as 00000000-0000-0000-0000-000000000001 \
  --file docs/npnqm-source/Document_Requirements_All_Income_Types.md
# Note the kb_versions.id printed (we'll call it KBID).

# Now exercise approve-kb.ts confirmation prompt:
pnpm tsx scripts/approve-kb.ts --tenant demo --version-id <KBID> --as admin --user-id 11111111-1111-1111-1111-111111111111
# Type 'n' at the prompt — should print "Aborted by operator." and exit 0.

# Test cross-tenant defense — pick an existing tenant that isn't demo:
pnpm tsx scripts/approve-kb.ts --tenant npnqm-twin --version-id <KBID> --as admin --user-id 11111111-1111-1111-1111-111111111111
# Should exit 2 with "cross-tenant mismatch: ..."
```

Cleanup: `DELETE FROM kb_versions WHERE version=99;` as in Task 13.

- [ ] **Step 3: Commit**

```bash
git add scripts/approve-kb.ts
git commit -m "feat(scripts): approve-kb CLI — args, tenant assertion, confirmation prompt

First half of spec §8 approval CLI: arg parsing (--tenant required for
cross-tenant defense per §8.1), version lookup, tenant-match assertion,
interactive [y/N] prompt unless --yes. DB writes deferred to Task 15."
```

---

## Task 15: `scripts/approve-kb.ts` — approval writes + activation transaction

**Files:**
- Modify: `scripts/approve-kb.ts`

**Rationale:** Replace the `TODO: DB approval writes land in Task 15.` placeholder with the actual UPDATE + audit-log write, plus the `--activate` transaction (spec §8.2 with `SELECT ... FOR UPDATE`).

- [ ] **Step 1: Replace the TODO block with the implementation**

In `scripts/approve-kb.ts`, replace the lines:

```typescript
  // Task 15 fills in the writes below.
  console.log("TODO: DB approval writes land in Task 15.");
  await closePool();
```

with:

```typescript
  // 4. Apply the role's writes + audit row in a single transaction
  await withTenantTx(tenant.id, async (c) => {
    if (role === "admin") {
      const r = await c.query<{ status: string }>(
        `UPDATE kb_versions
            SET approved_by = $1,
                approved_at = now(),
                status = 'pending_compliance'
          WHERE id = $2 AND tenant_id = $3 AND status = 'pending_approval'
          RETURNING status`,
        [userId, versionId, tenant.id],
      );
      if (r.rowCount !== 1) {
        throw new Error(
          `expected to update 1 kb_versions row (current status must be 'pending_approval'); updated ${r.rowCount}. Concurrent edit or wrong status?`,
        );
      }
      await c.query(
        `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
         VALUES ($1, $2, 'kb_version.approve', $3, $4::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          tenant.id,
          userId,
          `admin approval of kb_version ${versionId}`,
          JSON.stringify({ kb_version_id: String(versionId), prior_status: "pending_approval", new_status: "pending_compliance" }),
        ],
      );
      console.log(`Approved as admin. Status: pending_compliance. Next: re-run with --as compliance_officer.`);
      return;
    }

    // role === "compliance_officer"
    if (!activate) {
      const r = await c.query<{ status: string }>(
        `UPDATE kb_versions
            SET compliance_signoff_by = $1,
                compliance_signoff_at = now()
          WHERE id = $2 AND tenant_id = $3 AND status = 'pending_compliance'
          RETURNING status`,
        [userId, versionId, tenant.id],
      );
      if (r.rowCount !== 1) {
        throw new Error(
          `expected to update 1 kb_versions row (current status must be 'pending_compliance'); updated ${r.rowCount}.`,
        );
      }
      await c.query(
        `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
         VALUES ($1, $2, 'kb_version.compliance_signoff', $3, $4::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          tenant.id,
          userId,
          `compliance signoff of kb_version ${versionId}`,
          JSON.stringify({ kb_version_id: String(versionId), prior_status: "pending_compliance", new_status: "pending_compliance" }),
        ],
      );
      console.log(`Compliance signoff recorded. Status: pending_compliance. Next: re-run with --activate to make active.`);
      return;
    }

    // --activate path: atomic SELECT FOR UPDATE + demote + promote (spec §8.2)
    await c.query(
      `SELECT id FROM kb_versions
        WHERE tenant_id = $1 AND status = 'active'
          FOR UPDATE`,
      [tenant.id],
    );
    await c.query(
      `UPDATE kb_versions
          SET status = 'superseded',
              activated_at = activated_at
        WHERE tenant_id = $1 AND status = 'active'`,
      [tenant.id],
    );
    const r = await c.query<{ status: string }>(
      `UPDATE kb_versions
          SET status = 'active',
              activated_at = now(),
              compliance_signoff_by = $1,
              compliance_signoff_at = now()
        WHERE id = $2 AND tenant_id = $3 AND status = 'pending_compliance'
        RETURNING status`,
      [userId, versionId, tenant.id],
    );
    if (r.rowCount !== 1) {
      throw new Error(
        `activation: expected to promote 1 row from pending_compliance to active; promoted ${r.rowCount}. Concurrent edit raced us — transaction rolling back.`,
      );
    }
    await c.query(
      `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
       VALUES ($1, $2, 'kb_version.activate', $3, $4::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        tenant.id,
        userId,
        `activated kb_version ${versionId}`,
        JSON.stringify({ kb_version_id: String(versionId), prior_status: "pending_compliance", new_status: "active" }),
      ],
    );
    console.log(`Activated. kb_version ${versionId} is now status='active' for tenant ${tenant.slug}. Any prior active version was demoted to 'superseded'.`);
  });

  await closePool();
```

- [ ] **Step 2: Full end-to-end smoke test**

```bash
# Pick two distinct UUIDs to simulate separation of duties
ADMIN_UUID=11111111-1111-1111-1111-111111111111
COMPL_UUID=22222222-2222-2222-2222-222222222222

# Ingest
pnpm tsx scripts/ingest-doc-checklist.ts --tenant demo --version 99 \
  --as $ADMIN_UUID \
  --file docs/npnqm-source/Document_Requirements_All_Income_Types.md
# Note the kb_versions.id printed; replace KBID below.

# Admin approval
pnpm tsx scripts/approve-kb.ts --tenant demo --version-id KBID --as admin --user-id $ADMIN_UUID --yes
# Expected: "Approved as admin. Status: pending_compliance."

# Compliance signoff + activate (in one call)
pnpm tsx scripts/approve-kb.ts --tenant demo --version-id KBID --as compliance_officer --user-id $COMPL_UUID --activate --yes
# Expected: "Activated. kb_version KBID is now status='active' for tenant demo."

# Test the separation-of-duties enforcement: same user as both roles
pnpm tsx scripts/ingest-doc-checklist.ts --tenant demo --version 100 \
  --as $ADMIN_UUID \
  --file docs/npnqm-source/Document_Requirements_All_Income_Types.md
# Note new KBID2.
pnpm tsx scripts/approve-kb.ts --tenant demo --version-id KBID2 --as admin --user-id $ADMIN_UUID --yes
pnpm tsx scripts/approve-kb.ts --tenant demo --version-id KBID2 --as compliance_officer --user-id $ADMIN_UUID --activate --yes
# Expected: DB CHECK constraint 'different_approvers' fails — script exits non-zero with the constraint name.
```

Cleanup: `DELETE FROM kb_versions WHERE version IN (99,100);`

- [ ] **Step 3: Commit**

```bash
git add scripts/approve-kb.ts
git commit -m "feat(scripts): approve-kb CLI — UPDATE writes + --activate transaction

Implements spec §8.2 + §8.3:
  - --as admin       → approved_by + approved_at, status → pending_compliance
  - --as compliance  → compliance_signoff_by + compliance_signoff_at
  - --activate       → SELECT FOR UPDATE prior active + demote + promote in
                       one transaction, plus the partial unique index from
                       migration 016 as second-line race protection

Audit-log row inserted inside the same transaction as the kb_versions
write; ON CONFLICT DO NOTHING via the dedup unique index from migration
016 keeps it idempotent if a future trigger also fires. Approval cannot
happen without a matching audit row — spec §8.3 contract."
```

---

## Task 16: RLS isolation tests for the three new tables

**Files:**
- Modify: `packages/api/test/tenant-isolation.test.ts`

**Rationale:** Spec §7.3 requires per-table isolation checks. Each new table needs a test that confirms `withTenantTx(A)` cannot read tenant B's rows.

- [ ] **Step 1: Write the failing tests**

Append to `packages/api/test/tenant-isolation.test.ts`:

```typescript
import { withDb, withTenantTx, closePool } from "../src/db/pool.js";

describe("tenant isolation — doc-checklist tables (spec §7.3)", () => {
  const A = "5d175193-6ee2-4d6a-b16e-aa00000000a1";
  const B = "5d175193-6ee2-4d6a-b16e-aa00000000a2";
  let kbIdA: number;
  let kbIdB: number;

  beforeAll(async () => {
    await withDb(async (c) => {
      for (const id of [A, B]) {
        await c.query(
          `INSERT INTO tenants (id, name, slug, status, type)
           VALUES ($1, $2, $3, 'active', 'demo')
           ON CONFLICT (id) DO NOTHING`,
          [id, `Iso Test ${id.slice(-4)}`, `iso-test-${id.slice(-4)}`],
        );
      }
      const ra = await c.query<{ id: number }>(
        `INSERT INTO kb_versions (tenant_id, version, status, source_documents) VALUES ($1, 1, 'active', '{}'::jsonb) RETURNING id`,
        [A],
      );
      const rb = await c.query<{ id: number }>(
        `INSERT INTO kb_versions (tenant_id, version, status, source_documents) VALUES ($1, 1, 'active', '{}'::jsonb) RETURNING id`,
        [B],
      );
      kbIdA = ra.rows[0]!.id;
      kbIdB = rb.rows[0]!.id;
    });
    await withTenantTx(A, async (c) => {
      await c.query(
        `INSERT INTO program_doc_checklist (tenant_id, kb_version_id, resolved_income_type, program, minimum_docs, income_docs, raw_min_msg, raw_income_msg)
         VALUES ($1, $2, 'IsoTest', 'Flex Select', '[]'::jsonb, '[]'::jsonb, '', '')`,
        [A, kbIdA],
      );
      await c.query(
        `INSERT INTO program_doc_engine_rules (tenant_id, kb_version_id, rule_name, predicate, effect, description)
         VALUES ($1, $2, 'us_credit_optional', '{}'::jsonb, '{"add_docs":[],"remove_docs":[]}'::jsonb, 'iso')`,
        [A, kbIdA],
      );
      await c.query(
        `INSERT INTO income_type_resolver (tenant_id, kb_version_id, income_doc_type, borrower_type, citizenship, is_itin, resolved_income_type)
         VALUES ($1, $2, 'IsoDoc', 'W2', 'US Citizen', false, 'IsoResolved')`,
        [A, kbIdA],
      );
    });
  });

  afterAll(async () => {
    await withDb(async (c) => {
      for (const id of [A, B]) {
        await c.query(`DELETE FROM program_doc_checklist     WHERE tenant_id = $1`, [id]);
        await c.query(`DELETE FROM program_doc_engine_rules  WHERE tenant_id = $1`, [id]);
        await c.query(`DELETE FROM income_type_resolver      WHERE tenant_id = $1`, [id]);
        await c.query(`DELETE FROM kb_versions               WHERE tenant_id = $1`, [id]);
      }
    });
    await closePool();
  });

  it("tenant B cannot read tenant A's program_doc_checklist rows", async () => {
    const rows = await withTenantTx(B, async (c) => {
      const r = await c.query(
        `SELECT * FROM program_doc_checklist WHERE tenant_id = $1`, [A],
      );
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("tenant B cannot read tenant A's program_doc_engine_rules rows", async () => {
    const rows = await withTenantTx(B, async (c) => {
      const r = await c.query(`SELECT * FROM program_doc_engine_rules WHERE tenant_id = $1`, [A]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it("tenant B cannot read tenant A's income_type_resolver rows", async () => {
    const rows = await withTenantTx(B, async (c) => {
      const r = await c.query(`SELECT * FROM income_type_resolver WHERE tenant_id = $1`, [A]);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests, see them pass**

```bash
pnpm --filter @twin/api exec vitest run test/tenant-isolation.test.ts
pnpm --filter @twin/api build
```

Expected: all isolation tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/api/test/tenant-isolation.test.ts
git commit -m "test(api): RLS isolation tests for the three new doc-checklist tables

Per spec §7.3, confirms withTenantTx(B) cannot read tenant A's rows in
program_doc_checklist, program_doc_engine_rules, or income_type_resolver.

Note: these tests rely on the explicit WHERE tenant_id = ... predicate the
test query uses to be filtered by RLS. The application's defense-in-depth
pattern (explicit tenant_id in every WHERE) is what makes this safe under
the BYPASSRLS pooler — the tests just confirm RLS is correctly set up at
the policy level."
```

---

## Task 17: Platform-health endpoint check — one-active-version-per-tenant

**Files:**
- Modify: `packages/api/src/routes/system-check.ts`
- Modify: `packages/api/test/system-check.test.ts` (or create if missing)

**Rationale:** Reviewer note 3. `scripts/approve-kb.ts` is now load-bearing. A platform-health check surfaces silent approval-workflow failures (a tenant with no active version means every KB-backed feature silently degrades).

- [ ] **Step 1: Inspect what's already in system-check.ts**

```bash
cat packages/api/src/routes/system-check.ts | head -40
```

- [ ] **Step 2: Add the new endpoint**

Append to `packages/api/src/routes/system-check.ts` inside the route registration function (the pattern matches existing endpoints `/system/health` and `/system/integrity`):

```typescript
  app.get("/system/kb-health", async () => {
    return withDb(async (client) => {
      // Every active, non-deleted tenant should have exactly one kb_versions
      // row with status='active'. Tenants with 0 or >1 indicate either a
      // never-approved tenant or (impossible per migration 016's partial unique
      // index but defense-in-depth) a corrupted state.
      const { rows } = await client.query<{ tenant_id: string; slug: string; active_count: number }>(
        `SELECT t.id AS tenant_id, t.slug,
                COUNT(kv.id) FILTER (WHERE kv.status = 'active')::int AS active_count
           FROM tenants t
           LEFT JOIN kb_versions kv ON kv.tenant_id = t.id
          WHERE t.deleted_at IS NULL AND t.status = 'active'
          GROUP BY t.id, t.slug
          ORDER BY t.slug`,
      );
      const problems = rows.filter((r) => r.active_count !== 1);
      return {
        ok: problems.length === 0,
        tenant_count: rows.length,
        tenants_with_one_active: rows.filter((r) => r.active_count === 1).length,
        tenants_with_zero_active: rows.filter((r) => r.active_count === 0).map((r) => r.slug),
        tenants_with_multiple_active: rows.filter((r) => r.active_count > 1).map((r) => r.slug),
        problems,
      };
    });
  });
```

- [ ] **Step 3: Smoke-test**

Start the API if not already running, then:

```bash
curl -sS -H "x-user-id: e2e-harness" -H "x-super-admin: true" -H "x-tenant-id: any" http://localhost:4000/system/kb-health | python3 -m json.tool
```

Expected: JSON response. `ok` will be `false` in dev (no tenant has been through approval yet); `tenants_with_zero_active` lists the demo + npnqm-twin slugs. After an approve-kb.ts --activate the corresponding tenant moves to `tenants_with_one_active`.

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/system-check.ts
git commit -m "feat(api): /system/kb-health endpoint — one-active-KB-version-per-tenant invariant

Surfaces silent approval-workflow failures: any active tenant without
exactly one kb_versions row in status='active' is flagged.

Per spec §10 implementation note 3 and the reviewer's load-bearing-script
concern, this endpoint is the operational canary for the F2 approval
workflow that this spec also closed. Suitable for adding to an external
health-check ping or surfacing on a platform dashboard."
```

---

## Task 18: Integration test — end-to-end ingest → approve → resolve

**Files:**
- Create: `packages/api/test/doc-checklist-ingest.integration.test.ts`

**Rationale:** Spec §7.2 specifies the end-to-end test. It runs the CLI logic in-process (no subprocess) against the real fixture file, then exercises the resolver function against the resulting DB state. This is the regression backstop the reviewer's note N1 called out.

- [ ] **Step 1: Write the test**

Create `packages/api/test/doc-checklist-ingest.integration.test.ts`:

```typescript
import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) {
  const here = dirname(fileURLToPath(import.meta.url));
  try {
    for (const line of readFileSync(resolvePath(here, "../.env"), "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* */ }
}

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { withDb, withTenantTx, closePool } from "../src/db/pool.js";
import { parseAll, verifyParity } from "../src/ingestion/doc-checklist-parser.js";
import { resolveRequiredDocs } from "../src/services/doc-requirements.js";

const T = "5d175193-6ee2-4d6a-b16e-bb00bb00bb02"; // dedicated integration test tenant
const FIXTURE_PATH = "../../docs/npnqm-source/Document_Requirements_All_Income_Types.md";

async function ingest(kbId: number): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const md = readFileSync(resolvePath(here, FIXTURE_PATH), "utf8");
  const parsed = parseAll(md);
  verifyParity(parsed.scenarios);
  await withTenantTx(T, async (c) => {
    for (const s of parsed.scenarios) {
      await c.query(
        `INSERT INTO program_doc_checklist (tenant_id, kb_version_id, resolved_income_type, program, minimum_docs, income_docs, raw_min_msg, raw_income_msg)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
        [T, kbId, s.resolved_income_type, s.program, JSON.stringify(s.minimum_docs), JSON.stringify(s.income_docs), s.raw_min_msg, s.raw_income_msg],
      );
    }
    for (const r of parsed.rules) {
      await c.query(
        `INSERT INTO program_doc_engine_rules (tenant_id, kb_version_id, rule_name, predicate, effect, description)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6)`,
        [T, kbId, r.rule_name, JSON.stringify(r.predicate), JSON.stringify(r.effect), r.description],
      );
    }
    for (const rr of parsed.resolver) {
      await c.query(
        `INSERT INTO income_type_resolver (tenant_id, kb_version_id, income_doc_type, borrower_type, citizenship, is_itin, resolved_income_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [T, kbId, rr.income_doc_type, rr.borrower_type, rr.citizenship, rr.is_itin, rr.resolved_income_type],
      );
    }
  });
}

async function cleanup(): Promise<void> {
  await withDb(async (c) => {
    await c.query(`DELETE FROM program_doc_checklist     WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM program_doc_engine_rules  WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM income_type_resolver      WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM kb_versions               WHERE tenant_id = $1`, [T]);
    await c.query(`DELETE FROM tenants                   WHERE id = $1`, [T]);
  });
}

describe("doc-checklist ingest — end-to-end integration (spec §7.2)", () => {
  let kbId: number;

  beforeAll(async () => {
    await cleanup();
    await withDb(async (c) => {
      await c.query(
        `INSERT INTO tenants (id, name, slug, status, type) VALUES ($1, 'Doc-Checklist Integration', 'doc-checklist-integration', 'active', 'demo')
         ON CONFLICT (id) DO NOTHING`,
        [T],
      );
      const r = await c.query<{ id: number }>(
        `INSERT INTO kb_versions (tenant_id, version, status, source_documents) VALUES ($1, 1, 'active', '{"kind":"doc_checklist"}'::jsonb) RETURNING id`,
        [T],
      );
      kbId = r.rows[0]!.id;
    });
    await ingest(kbId);
  });

  afterAll(async () => {
    await cleanup();
    await closePool();
  });

  it("seeded 25 program_doc_checklist rows", async () => {
    const r = await withDb(async (c) =>
      c.query<{ count: string }>(`SELECT COUNT(*)::text FROM program_doc_checklist WHERE tenant_id = $1`, [T]),
    );
    expect(parseInt(r.rows[0]!.count, 10)).toBe(25);
  });

  it("seeded 3 program_doc_engine_rules rows", async () => {
    const r = await withDb(async (c) =>
      c.query<{ count: string }>(`SELECT COUNT(*)::text FROM program_doc_engine_rules WHERE tenant_id = $1`, [T]),
    );
    expect(parseInt(r.rows[0]!.count, 10)).toBe(3);
  });

  it("seeded 32 income_type_resolver rows", async () => {
    const r = await withDb(async (c) =>
      c.query<{ count: string }>(`SELECT COUNT(*)::text FROM income_type_resolver WHERE tenant_id = $1`, [T]),
    );
    expect(parseInt(r.rows[0]!.count, 10)).toBe(32);
  });

  it("resolveRequiredDocs returns the 9-doc minimum for Full Doc / W2 / US Citizen", async () => {
    const r = await resolveRequiredDocs(T, null, {
      incomeDocType: "Full Doc", borrowerType: "W2", citizenship: "US Citizen", isItin: false,
      llcOrLegalEntity: false, occupancy: "primary", state: "CA", county: "Los Angeles", usCredit: true,
      program: "Flex Select",
    });
    expect(r.resolvedIncomeType).toBe("Full Documentation - Wage Earner");
    expect(r.minimum).toHaveLength(9);
    expect(r.income).toHaveLength(2);
    expect(r.appliedRules).toEqual([]);
  });

  it("resolveRequiredDocs applies us_credit_optional when usCredit=false", async () => {
    const r = await resolveRequiredDocs(T, null, {
      incomeDocType: "Full Doc", borrowerType: "W2", citizenship: "US Citizen", isItin: false,
      llcOrLegalEntity: false, occupancy: "primary", state: "CA", county: "Los Angeles", usCredit: false,
      program: "Flex Select",
    });
    expect(r.appliedRules).toContain("us_credit_optional");
    expect(r.minimum.map((d) => d.name)).not.toContain("Credit Report dated within 90 days");
    expect(r.minimum).toHaveLength(8);
  });

  it("resolveRequiredDocs applies field_review for NY Brooklyn investment", async () => {
    const r = await resolveRequiredDocs(T, null, {
      incomeDocType: "Full Doc", borrowerType: "W2", citizenship: "US Citizen", isItin: false,
      llcOrLegalEntity: false, occupancy: "investment", state: "NY", county: "Brooklyn", usCredit: true,
      program: "Flex Select",
    });
    expect(r.appliedRules).toContain("field_review");
    expect(r.minimum.map((d) => d.name)).toContain("Field review");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @twin/api exec vitest run test/doc-checklist-ingest.integration.test.ts
pnpm --filter @twin/api build
```

Expected: 6 tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/api/test/doc-checklist-ingest.integration.test.ts
git commit -m "test(api): doc-checklist ingest end-to-end integration (spec §7.2)

The reviewer-flagged regression backstop (review note N1). Reads the real
docs/npnqm-source/Document_Requirements_All_Income_Types.md, runs the
parser + resolver pipeline against a dedicated test tenant
(bb00bb00bb02), and asserts:
  - 25 program_doc_checklist rows written
  - 3 program_doc_engine_rules rows written
  - 32 income_type_resolver rows written
  - resolveRequiredDocs returns the engine-correct 9-doc minimum for Full
    Doc / W2 / US Citizen
  - us_credit_optional rule fires when usCredit=false (Credit Report removed)
  - field_review rule fires for NY Brooklyn + investment occupancy

When NPNQM regenerates eligibility_check_v2.py and ships a new markdown,
this test is the first thing that breaks if structure changes — exactly
the canary the reviewer asked for."
```

---

## Task 19: Final smoke run + sign-off commit

**Files:**
- (no file changes — verification step)

**Rationale:** Spec §10 step 11. Confirm both quality gates pass, kick the smoke ingest on the demo tenant to seed it for downstream use, then commit a summary note that closes the plan.

- [ ] **Step 1: Run full test suite + build**

```bash
pnpm --filter @twin/api exec vitest run --reporter=dot
pnpm --filter @twin/api build
pnpm --filter @twin/core test
pnpm --filter @twin/web build
```

Expected: all green. New tests: 4 parser scenario tests + 2 engine-rules + 2 resolver-table + 3 parseAll + 2 module-shape + 4 error-contract + 4 engine-rule predicate + 3 RLS isolation + 6 integration = 30 new tests. All passing.

- [ ] **Step 2: Smoke-ingest the doc-checklist into the demo tenant**

```bash
ADMIN_UUID=11111111-1111-1111-1111-111111111111
COMPL_UUID=22222222-2222-2222-2222-222222222222

pnpm tsx scripts/ingest-doc-checklist.ts \
  --tenant demo --version 1 --as $ADMIN_UUID \
  --file docs/npnqm-source/Document_Requirements_All_Income_Types.md
# Note the kb_versions.id (call it KBID)

pnpm tsx scripts/approve-kb.ts --tenant demo --version-id KBID \
  --as admin --user-id $ADMIN_UUID --yes
pnpm tsx scripts/approve-kb.ts --tenant demo --version-id KBID \
  --as compliance_officer --user-id $COMPL_UUID --activate --yes

# Confirm via /system/kb-health
curl -sS -H "x-user-id: e2e-harness" -H "x-super-admin: true" -H "x-tenant-id: any" \
  http://localhost:4000/system/kb-health | python3 -m json.tool
# 'demo' should now appear in tenants_with_one_active
```

- [ ] **Step 3: Commit a sign-off note**

```bash
git commit --allow-empty -m "chore: doc-checklist ingest implementation complete (spec 2026-05-12)

All 19 tasks from docs/superpowers/plans/2026-05-12-doc-checklist-ingest.md
implemented and verified:
  - Migration 016 (schema + RLS + partial unique idx + audit-log dedup)
  - Parser module with 4 parsers + parity verifier (10 unit tests)
  - resolveRequiredDocs service with 4-row error contract (8 unit tests)
  - Two CLIs: ingest-doc-checklist.ts + approve-kb.ts
  - 3 RLS isolation tests for new tables
  - 6-case end-to-end integration test against real NPNQM fixture
  - /system/kb-health platform-health endpoint

Quality gates:
  - pnpm --filter @twin/api test: all passing (188 prior + 30 new)
  - pnpm --filter @twin/api build: clean
  - pnpm --filter @twin/core test: 116/116
  - pnpm --filter @twin/web build: clean

Reviewer notes addressed in commit history:
  - Migration 016 cross-references migration 012 in its header comment
  - IncomeTypeUnresolvedError is new; downstream specs (Predictive
    Conditions, VA Doc Review specialist) must include handler stories
  - /system/kb-health surfaces silent approval-workflow failures

Spec: docs/superpowers/specs/2026-05-12-doc-checklist-ingest-design.md (e9d3107)
Review: signed off as v2; this implementation honors all 11 items."
```

---

## Spec Coverage Check (self-review)

Mapping every spec requirement back to a task:

| Spec section | Implementation task |
|---|---|
| §0 Cross-spec deps | Task 2 (migration header comment) |
| §1.1 File Structure (A/B/C/D) | Tasks 4, 5, 6 (per-section parsers) |
| §1.2 Invariants | Tasks 4-7 (each parser enforces its slice) |
| §2.1 New tables + partial unique idx + audit-log dedup | Task 2 |
| §2.2 Predicate shape | Task 5 (parser) + Task 10 (matcher) |
| §2.4 kb_versions content discriminator | Task 13 (writes `kind: doc_checklist`) |
| §3.1 Ingest CLI args | Task 12 |
| §3.2 Ingest CLI flow | Tasks 12 + 13 |
| §3.3 Re-ingest semantics | Implicit in Task 13's per-call new kb_versions row |
| §3.4 Parity verifier | Task 7 |
| §4 resolveRequiredDocs + error contract | Tasks 8, 9, 10 |
| §5 Parser design | Tasks 3-7 |
| §6 Error handling + exit codes | Task 12 (ingest exit codes) + Task 14 (approve exit codes) |
| §7.1 Parser unit tests | Tasks 4-7 (each adds tests) |
| §7.2 Integration test | Task 18 |
| §7.3 RLS isolation tests | Task 16 |
| §7.4 W10 deferred — explicit non-goal | (no task — per spec) |
| §8.1 approve-kb CLI args | Task 14 |
| §8.2 Activation transaction | Task 15 |
| §8.3 Audit-log enforcement | Task 15 (audit insert inside same tx) + Task 2 (dedup constraint) |
| §9 Non-goals | (explicit deferrals — no tasks) |
| §10 Implementation order | Tasks 1-19 follow this order |
| Reviewer note 1 (cross-migration header) | Task 2 |
| Reviewer note 2 (IncomeTypeUnresolvedError downstream coordination) | Task 8 commit message |
| Reviewer note 3 (platform-health for one-active-version) | Task 17 |

**Zero spec sections without an implementation task.** ✅

---

## Placeholder Scan (self-review)

Searched the plan for the patterns in the "No Placeholders" section of the writing-plans skill:

- "TBD" / "TODO" / "implement later" / "fill in details" — **only used in commit-message context** (e.g., Task 12's placeholder "TODO: DB writes land in Task 13.") which is replaced in the subsequent task. No spec content is deferred via TBD.
- "Add appropriate error handling" — not present. Error handling is fully specified in Tasks 12, 14, 15.
- "Write tests for the above" without code — not present. Every test step contains the actual test code.
- "Similar to Task N" — not present. Each task duplicates needed context.
- Steps that describe what to do without showing how — none. All code-changing steps include the actual code.
- References to types / functions / methods not defined in any task — none. Every type is defined in Task 3 or Task 8 before use.

✅ No placeholders.

---

## Type Consistency Check (self-review)

| Name | Defined in | Used in |
|---|---|---|
| `ScenarioRow` | Task 3 | Tasks 4, 7 (parser), 13 (CLI), 18 (integration) |
| `RuleRow` | Task 3 | Tasks 5, 13 |
| `ResolverRow` | Task 3 | Tasks 6, 13 |
| `ParseResult` | Task 3 | Tasks 12, 13 |
| `DocItem` | Task 3 + Task 8 | Tasks 4, 9, 10 — same shape (order/name/note) in both modules |
| `LoanContext` | Task 8 | Tasks 9, 10, 18 |
| `ResolveResult` | Task 8 | Tasks 9, 10, 18 |
| `NoActiveKbVersionError` / `KbVersionNotFoundError` / `IncomeTypeUnresolvedError` | Task 8 | Task 9 (tests + impl) |
| `parseScenarios` / `parseEngineRules` / `parseResolverTable` / `parseAll` / `verifyParity` | Task 3 (signatures) | Tasks 4-7 (bodies) + Tasks 12, 18 (callers) |
| `resolveRequiredDocs` | Task 8 (signature) | Tasks 9, 10 (body) + Task 18 (caller) |
| `parseArgs` / `exitWith` / `CliArgsError` | Task 11 | Tasks 12, 14 |

✅ Consistent across tasks.

---

Plan complete and saved to `docs/superpowers/plans/2026-05-12-doc-checklist-ingest.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review between tasks (spec compliance → code quality), fast iteration. Same approach that just shipped the VA Review Layer (26 tasks) and the E2E Validation Harness (16 tasks) cleanly.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

**Which approach?**
