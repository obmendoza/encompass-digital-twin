export type ActionErrorCode =
  | "LOAN_NOT_FOUND"
  | "CONDITION_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "SCENARIO_NOT_FOUND"
  | "REQUIRED_FIELD_MISSING"
  | "ACTION_FORBIDDEN_IN_DECISION_STATE"
  | "DOCUMENT_NOT_FOUND";

export class ActionError extends Error {
  public readonly code: ActionErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: ActionErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ActionError";
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}
