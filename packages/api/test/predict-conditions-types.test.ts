import { describe, it, expect } from "vitest";
import {
  PredictionNotFoundError,
  PredictionNotPendingError,
  PredictionNotDismissedError,
  DismissalReasonTooShortError,
  AlertNotFoundError,
} from "../src/services/predict-conditions/index.js";

describe("predict-conditions module shape", () => {
  it("exports the five domain error classes", () => {
    expect(PredictionNotFoundError).toBeDefined();
    expect(PredictionNotPendingError).toBeDefined();
    expect(PredictionNotDismissedError).toBeDefined();
    expect(DismissalReasonTooShortError).toBeDefined();
    expect(AlertNotFoundError).toBeDefined();
  });

  it("errors are instanceof Error", () => {
    const e = new PredictionNotFoundError("abc", "tnt");
    expect(e instanceof Error).toBe(true);
    expect(e.predictionId).toBe("abc");
    expect(e.tenantId).toBe("tnt");
  });

  it("DismissalReasonTooShortError carries actualLength", () => {
    const e = new DismissalReasonTooShortError(3);
    expect(e.actualLength).toBe(3);
    expect(e.message).toMatch(/at least 10 characters/);
  });
});
