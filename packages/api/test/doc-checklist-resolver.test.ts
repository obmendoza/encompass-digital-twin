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
