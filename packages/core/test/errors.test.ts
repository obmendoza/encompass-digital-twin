import { describe, expect, it } from "vitest";
import { ActionError } from "../src/errors.js";

describe("ActionError", () => {
  it("carries code, message, and optional details", () => {
    const err = new ActionError("LOAN_NOT_FOUND", "no such loan", { loanId: "X" });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("LOAN_NOT_FOUND");
    expect(err.message).toBe("no such loan");
    expect(err.details).toEqual({ loanId: "X" });
    expect(err.name).toBe("ActionError");
  });

  it("is serializable to a plain object", () => {
    const err = new ActionError("INVALID_TRANSITION", "bad state");
    expect(err.toJSON()).toEqual({
      code: "INVALID_TRANSITION",
      message: "bad state",
      details: undefined,
    });
  });
});
