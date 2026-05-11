import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  parseScenarios,
  parseEngineRules,
  parseResolverTable,
  parseAll,
  DocChecklistParseError,
} from "../src/ingestion/doc-checklist-parser.js";

const FIXTURE_PATH = "../../../docs/npnqm-source/Document_Requirements_All_Income_Types.md";

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

  it("parseScenarios rejects empty input", () => {
    expect(() => parseScenarios("")).toThrow(DocChecklistParseError);
  });

  it("fixture file exists and is non-empty", () => {
    const md = loadFixture();
    expect(md.length).toBeGreaterThan(1000);
    expect(md).toContain("Engine-synced");
  });
});

describe("parseScenarios", () => {
  it("parses all 32 scenarios from the real fixture", () => {
    const rows = parseScenarios(loadFixture());
    expect(rows).toHaveLength(32);
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

  it("captures notes that contain nested parentheses", () => {
    // Synthetic markdown — upstream doesn't currently emit nested parens, but
    // the engine is free to. This test pins down the contract.
    const synthetic = `## 2. Document output by income scenario

### Full Doc (W2)

**Resolved Neo4j income type**: \`Full Documentation - Wage Earner\`
**Program (validation context)**: \`Flex Select\`

#### Minimum required documents (engine order)

1. Initial Loan Application (1003)

#### Income documentation (engine order)

1. Tax return (Note: applies to LLC (single-member) borrowers)

<details><summary>Raw engine messages</summary>

- Minimum: \`Missing base documents: Initial Loan Application (1003)\`
- Income: \`Required documents: Tax return (Note: applies to LLC (single-member) borrowers)\`

</details>
`;
    const rows = parseScenarios(synthetic);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.income_docs[0]!.name).toBe("Tax return");
    expect(rows[0]!.income_docs[0]!.note).toBe("applies to LLC (single-member) borrowers");
  });

  it("captures all items in the longest scenario's income-doc list (ITIN — Bank Stmts: 24 Mo. Personal)", () => {
    const rows = parseScenarios(loadFixture());
    const longest = rows.find((r) => r.resolved_income_type === "ITIN - Bank Statement 24 Mo. Personal")!;
    expect(longest).toBeDefined();
    // 9 income docs per the fixture (lines 921-931 of the source file)
    expect(longest.income_docs).toHaveLength(9);
    const thirdParty = longest.income_docs.find((d) => d.name.startsWith("3rd Party Expense"))!;
    expect(thirdParty.note).toContain("50% Expense Ratio");
  });
});

describe("parseEngineRules", () => {
  it("extracts the three known rules from the real fixture", () => {
    const rules = parseEngineRules(loadFixture());
    expect(rules).toHaveLength(3);
    const llc = rules.find((r) => r.rule_name === "llc_closing_docs")!;
    expect(llc).toBeDefined();
    expect(llc.predicate.kind).toBe("llc_closing_docs");
    expect(llc.predicate.LLCOrLegalEntity).toBe(true);
    expect(llc.predicate.occupancy_in).toEqual(["investment"]);
    expect(llc.predicate.program_not_in).toEqual(
      expect.arrayContaining(["Investor DSCR", "DSCR Supreme", "DSCR Multi", "Investor DSCR No Ratio"]),
    );
    const fr = rules.find((r) => r.rule_name === "field_review")!;
    expect(fr.predicate.kind).toBe("field_review");
    expect(fr.predicate.state).toBe("NY");
    expect(fr.predicate.county_in).toEqual(expect.arrayContaining(["Brooklyn", "Kings"]));
    const us = rules.find((r) => r.rule_name === "us_credit_optional")!;
    expect(us.predicate.kind).toBe("us_credit_optional");
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
