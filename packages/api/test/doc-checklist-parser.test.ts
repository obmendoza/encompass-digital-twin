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

  it("entry points throw 'not yet implemented' until later tasks", () => {
    expect(() => parseScenarios("")).toThrow(/not yet implemented/);
  });

  it("fixture file exists and is non-empty", () => {
    const md = loadFixture();
    expect(md.length).toBeGreaterThan(1000);
    expect(md).toContain("Engine-synced");
  });
});
