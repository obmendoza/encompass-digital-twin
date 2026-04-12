import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import { ActionError } from "../src/errors.js";
import type { WorldState } from "../src/types.js";

const fixedNow = () => "2026-04-11T12:00:00.000Z";
function emptyState(): WorldState {
  return { scenarioId: null, loans: {}, actionLog: [], now: fixedNow };
}

describe("error details", () => {
  it("throws with correct error details", () => {
    const resolve = (sid: string) => undefined;
    expect(() => 
      reduce(emptyState(), { type: "LoadScenario", scenarioId: "missing-id" }, resolve)
    ).toThrow();
    
    try {
      reduce(emptyState(), { type: "LoadScenario", scenarioId: "missing-id" }, resolve);
    } catch (e: any) {
      expect(e.code).toBe("SCENARIO_NOT_FOUND");
      expect(e.details?.scenarioId).toBe("missing-id");
    }
  });
});
