// Domain errors raised by the predict-conditions service.
// Doc-checklist resolver errors (NoActiveKbVersionError, KbVersionNotFoundError,
// IncomeTypeUnresolvedError) are caught INSIDE run() and translated to
// prediction_alerts rows — they never propagate to callers of the service.

export class PredictionNotFoundError extends Error {
  constructor(public readonly predictionId: string, public readonly tenantId: string) {
    super(`prediction ${predictionId} not found for tenant ${tenantId} (does not exist, or belongs to a different tenant)`);
    this.name = "PredictionNotFoundError";
  }
}

export class PredictionNotPendingError extends Error {
  constructor(public readonly predictionId: string, public readonly currentStatus: string) {
    super(`prediction ${predictionId} is in status '${currentStatus}', not 'pending' — cannot accept or dismiss`);
    this.name = "PredictionNotPendingError";
  }
}

export class PredictionNotDismissedError extends Error {
  constructor(public readonly predictionId: string, public readonly currentStatus: string) {
    super(`prediction ${predictionId} is in status '${currentStatus}', not 'dismissed' — cannot reopen-and-accept`);
    this.name = "PredictionNotDismissedError";
  }
}

export class DismissalReasonTooShortError extends Error {
  constructor(public readonly actualLength: number) {
    super(`dismissal reason must be at least 10 characters (got ${actualLength})`);
    this.name = "DismissalReasonTooShortError";
  }
}

export class AlertNotFoundError extends Error {
  constructor(public readonly alertId: string, public readonly tenantId: string) {
    super(`alert ${alertId} not found for tenant ${tenantId}`);
    this.name = "AlertNotFoundError";
  }
}
