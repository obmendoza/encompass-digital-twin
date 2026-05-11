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

  // Spec §1.2: File Section B's H2 ("## 2. Document output by income scenario")
  // is the only anchor that puts the parser into a working state. If upstream
  // renames or removes that heading, scenarioBlocks would be empty and we'd
  // silently return []. Fail loud instead.
  if (scenarioBlocks.length === 0) {
    throw new DocChecklistParseError(
      "no scenarios found — File Section B (## 2. Document output by income scenario) missing or renamed",
      "B",
    );
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
    // marked v18 splits <details>...</details> into three tokens:
    //   html (<details> opener), list (the bullet items), html (</details> closer).
    // The raw messages are in the list that immediately follows the <details> opener.
    if (t.type === "html" && (t as Tokens.HTML).raw.startsWith("<details")) {
      const list = nextListAfter(tokens, i, end);
      if (list) {
        for (const item of list.items) {
          const text: string = item.text;
          const minMatch = text.match(/^Minimum:\s*`([^`]+)`/);
          const incMatch = text.match(/^Income:\s*`([^`]+)`/);
          if (minMatch) rawMin = minMatch[1]!;
          if (incMatch) rawIncome = incMatch[1]!;
        }
      }
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
    throw new DocChecklistParseError(
      `scenario '${name}': missing 'Raw engine messages' <details> block (need both Minimum: and Income: lines)`,
      "B",
    );
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
    // Notes are inside parentheses suffix like "...(Note: foo)" or "(Note: bar)".
    // Use greedy (.+) anchored at end-of-string so notes containing nested
    // parens (e.g., "(Note: foo (bar) baz)") capture the full body. Today's
    // NPNQM fixture has no nested parens, but the engine is free to add them.
    const noteMatch = text.match(/\s*\(Note:\s*(.+)\)\s*$/i);
    if (noteMatch) {
      return {
        order: idx + 1,
        name: text.replace(noteMatch[0]!, "").trim(),
        note: noteMatch[1]!.trim(),
      };
    }
    return { order: idx + 1, name: text, note: null };
  });
}

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
        kind: "llc_closing_docs",
        LLCOrLegalEntity: true,
        occupancy_in: ["investment"],
        program_not_in: ["Investor DSCR", "DSCR Supreme", "DSCR Multi", "Investor DSCR No Ratio"],
      },
      effect: { add_docs: ["LLC closing documents"], remove_docs: [] },
      description: behavior,
    };
  }
  if (/field review/i.test(ruleText)) {
    return {
      rule_name: "field_review",
      predicate: {
        kind: "field_review",
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
      predicate: { kind: "us_credit_optional", USCredit: false },
      effect: { add_docs: [], remove_docs: ["Credit Report dated within 90 days"] },
      description: behavior,
    };
  }
  throw new DocChecklistParseError(
    `unknown engine rule in File Section A rules table: '${ruleText}'. New rules must be added to ruleTextToRow().`,
    "A",
  );
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
  // The upstream NPNQM script (sync_doc_requirements_from_engine.py) emits the
  // footer timestamp with no timezone suffix. We interpret it as UTC. If the
  // upstream ever runs in a non-UTC zone, --max-age arithmetic in the ingest
  // CLI will be wrong by the offset. Verify with the NPNQM team if drift surfaces.
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
