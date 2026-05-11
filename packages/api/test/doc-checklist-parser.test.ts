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
});
