import type { Action, Loan, LoggedAction, Milestone, Scenario, WorldState } from "./types.js";
import { ActionError } from "./errors.js";

export type ScenarioResolver = (scenarioId: string) => Scenario | undefined;

function requireLoan(state: WorldState, loanId: string): Loan {
  const l = state.loans[loanId];
  if (!l) {
    throw new ActionError("LOAN_NOT_FOUND", `loan '${loanId}' not found`, { loanId });
  }
  return l;
}

function withLoan(state: WorldState, loanId: string, updater: (l: Loan) => Loan): WorldState {
  const next = updater(requireLoan(state, loanId));
  return { ...state, loans: { ...state.loans, [loanId]: next } };
}

function milestone(name: string, by: string, at: string): Milestone {
  return { name, by, at };
}

export function reduce(
  state: WorldState,
  action: Action,
  resolveScenario: ScenarioResolver,
): WorldState {
  const at = state.now();
  const log = (s: WorldState): WorldState => ({
    ...s,
    actionLog: [...s.actionLog, { seq: s.actionLog.length + 1, at, action } satisfies LoggedAction],
  });

  switch (action.type) {
    case "LoadScenario": {
      const sc = resolveScenario(action.scenarioId);
      if (!sc) {
        throw new ActionError("SCENARIO_NOT_FOUND",
          `scenario '${action.scenarioId}' not found`, { scenarioId: action.scenarioId });
      }
      return log({
        ...state,
        scenarioId: sc.id,
        loans: { ...state.loans, [sc.loan.id]: structuredClone(sc.loan) },
      });
    }

    case "ResetWorld":
      return { scenarioId: null, loans: {}, actionLog: [], now: state.now };

    case "OpenLoan": {
      const next = withLoan(state, action.loanId, (l) => ({
        ...l, milestones: [...l.milestones, milestone("Opened", action.actor.id, at)],
      }));
      return log(next);
    }

    case "SetDecision": {
      if (!action.rationale || action.rationale.trim() === "") {
        throw new ActionError("REQUIRED_FIELD_MISSING",
          "rationale is required for SetDecision", { loanId: action.loanId });
      }
      const next = withLoan(state, action.loanId, (l) => ({
        ...l,
        decision: action.decision,
        milestones: [...l.milestones, milestone(`Decision:${action.decision}`, action.actor.id, at)],
      }));
      return log(next);
    }

    case "AdvanceMilestone": {
      const next = withLoan(state, action.loanId, (l) => ({
        ...l, milestones: [...l.milestones, milestone(action.milestone, action.actor.id, at)],
      }));
      return log(next);
    }

    case "AddCondition": {
      const l0 = requireLoan(state, action.loanId);
      if (l0.decision === "denied") {
        throw new ActionError("ACTION_FORBIDDEN_IN_DECISION_STATE",
          `cannot add conditions on a denied loan`, { loanId: action.loanId, decision: l0.decision });
      }
      // Dedup: skip if a similar condition already exists (normalize + first 30 chars)
      const normDesc = action.condition.description.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
      const isDupe = l0.conditions.some((existing) => {
        const normExisting = existing.description.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
        return normDesc === normExisting || (normDesc.length > 10 && normExisting.includes(normDesc.slice(0, 20)));
      });
      if (isDupe) {
        return log(state);
      }
      const nextId = `c${l0.conditions.length + 1}`;
      const c = {
        id: nextId,
        category: action.condition.category,
        source: action.condition.source,
        description: action.condition.description,
        status: action.condition.status ?? "Open",
        addedBy: action.actor.id,
        addedAt: at,
      };
      return log(withLoan(state, action.loanId, (l) => ({
        ...l, conditions: [...l.conditions, c],
      })));
    }

    case "UpdateCondition": {
      const l0 = requireLoan(state, action.loanId);
      if (l0.decision === "denied") {
        throw new ActionError("ACTION_FORBIDDEN_IN_DECISION_STATE",
          `cannot update conditions on a denied loan`, { loanId: action.loanId });
      }
      const idx = l0.conditions.findIndex((c) => c.id === action.conditionId);
      if (idx === -1) {
        throw new ActionError("CONDITION_NOT_FOUND",
          `condition '${action.conditionId}' not found`, { conditionId: action.conditionId });
      }
      return log(withLoan(state, action.loanId, (l) => {
        const cs = [...l.conditions];
        cs[idx] = { ...cs[idx]!, ...action.patch, id: cs[idx]!.id };
        return { ...l, conditions: cs };
      }));
    }

    case "ClearCondition": {
      const l0 = requireLoan(state, action.loanId);
      const idx = l0.conditions.findIndex((c) => c.id === action.conditionId);
      if (idx === -1) {
        throw new ActionError("CONDITION_NOT_FOUND",
          `condition '${action.conditionId}' not found`, { conditionId: action.conditionId });
      }
      const cur = l0.conditions[idx]!;
      if (cur.status === "Waived" || cur.status === "Cleared") {
        throw new ActionError("INVALID_TRANSITION",
          `cannot clear a ${cur.status} condition`, { from: cur.status });
      }
      return log(withLoan(state, action.loanId, (l) => {
        const cs = [...l.conditions];
        cs[idx] = { ...cur, status: "Cleared", clearedBy: action.actor.id, clearedAt: at, notes: action.notes ?? cur.notes };
        return { ...l, conditions: cs };
      }));
    }

    case "WaiveCondition": {
      if (!action.rationale || action.rationale.trim() === "") {
        throw new ActionError("REQUIRED_FIELD_MISSING",
          "rationale is required for WaiveCondition", { conditionId: action.conditionId });
      }
      const l0 = requireLoan(state, action.loanId);
      const idx = l0.conditions.findIndex((c) => c.id === action.conditionId);
      if (idx === -1) {
        throw new ActionError("CONDITION_NOT_FOUND",
          `condition '${action.conditionId}' not found`, { conditionId: action.conditionId });
      }
      return log(withLoan(state, action.loanId, (l) => {
        const cs = [...l.conditions];
        cs[idx] = { ...cs[idx]!, status: "Waived", notes: action.rationale };
        return { ...l, conditions: cs };
      }));
    }

    case "RemoveCondition": {
      const l0 = requireLoan(state, action.loanId);
      const exists = l0.conditions.some((c) => c.id === action.conditionId);
      if (!exists) {
        throw new ActionError("CONDITION_NOT_FOUND",
          `condition '${action.conditionId}' not found`, { conditionId: action.conditionId });
      }
      return log(withLoan(state, action.loanId, (l) => ({
        ...l, conditions: l.conditions.filter((c) => c.id !== action.conditionId),
      })));
    }

    case "RecalculateQualifyingIncome": {
      if (!action.worksheet.derivedMonthlyIncome || action.worksheet.derivedMonthlyIncome <= 0) {
        throw new ActionError("INVALID_TRANSITION",
          "derivedMonthlyIncome must be > 0",
          { loanId: action.loanId });
      }
      const next = withLoan(state, action.loanId, (l) => {
        const monthly = action.worksheet.derivedMonthlyIncome;
        const piti = l.transaction.piti;
        const pi = l.qualifying.piPayment;
        return {
          ...l,
          qualifyingWorksheet: action.worksheet,
          income: { ...l.income, totalMonthlyIncome: monthly },
          qualifying: {
            ...l.qualifying,
            housingRatio: (pi / monthly) * 100,
            totalDti: (piti / monthly) * 100,
          },
        };
      });
      return log(next);
    }

    case "AddDocument": {
      return log(withLoan(state, action.loanId, (l) => {
        const nextId = `d${l.documents.length + 1}`;
        const doc = {
          id: nextId,
          name: action.doc.name,
          docType: action.doc.docType,
          status: "Pending" as const,
          uploadedBy: action.actor.id,
          uploadedAt: at,
        };
        return { ...l, documents: [...l.documents, doc] };
      }));
    }

    case "LinkDocument": {
      const l0 = requireLoan(state, action.loanId);
      const dIdx = l0.documents.findIndex((d) => d.id === action.documentId);
      if (dIdx === -1) {
        throw new ActionError("DOCUMENT_NOT_FOUND",
          `document '${action.documentId}' not found`, { documentId: action.documentId });
      }
      const cExists = l0.conditions.some((c) => c.id === action.conditionId);
      if (!cExists) {
        throw new ActionError("CONDITION_NOT_FOUND",
          `condition '${action.conditionId}' not found`, { conditionId: action.conditionId });
      }
      return log(withLoan(state, action.loanId, (l) => {
        const ds = [...l.documents];
        ds[dIdx] = { ...ds[dIdx]!, linkedConditionId: action.conditionId };
        return { ...l, documents: ds };
      }));
    }

    case "UpdateDocumentStatus": {
      const l0 = requireLoan(state, action.loanId);
      const dIdx = l0.documents.findIndex((d) => d.id === action.documentId);
      if (dIdx === -1) {
        throw new ActionError("DOCUMENT_NOT_FOUND",
          `document '${action.documentId}' not found`, { documentId: action.documentId });
      }
      return log(withLoan(state, action.loanId, (l) => {
        const ds = [...l.documents];
        ds[dIdx] = { ...ds[dIdx]!, status: action.status, notes: action.notes ?? ds[dIdx]!.notes };
        return { ...l, documents: ds };
      }));
    }

    case "RecordAgentStep": {
      requireLoan(state, action.loanId);
      return log(state);
    }

    case "StageRecommendation": {
      const next = withLoan(state, action.loanId, (l) => ({
        ...l,
        pendingRecommendation: {
          recommendation: action.recommendation.recommendation,
          rationale: action.recommendation.rationale,
          confidence: action.recommendation.confidence,
          conditions: action.recommendation.conditions,
          trace: action.recommendation.trace,
          stagedAt: at,
          stagedBy: action.actor.id,
        },
      }));
      return log(next);
    }

    case "AcceptRecommendation": {
      const l0 = requireLoan(state, action.loanId);
      if (!l0.pendingRecommendation) {
        throw new ActionError("INVALID_TRANSITION",
          "no pending recommendation to accept", { loanId: action.loanId });
      }
      const rec = l0.pendingRecommendation;
      const next = withLoan(state, action.loanId, (l) => ({
        ...l,
        decision: rec.recommendation,
        pendingRecommendation: undefined,
        milestones: [...l.milestones, milestone(`Decision:${rec.recommendation} (agent-accepted)`, action.actor.id, at)],
      }));
      return log(next);
    }

    case "ClearRecommendation": {
      const l0 = requireLoan(state, action.loanId);
      if (!l0.pendingRecommendation) {
        throw new ActionError("INVALID_TRANSITION",
          "no pending recommendation to clear", { loanId: action.loanId });
      }
      const next = withLoan(state, action.loanId, (l) => ({
        ...l, pendingRecommendation: undefined,
      }));
      return log(next);
    }

    case "InjectLoan": {
      return log({
        ...state,
        loans: { ...state.loans, [action.loan.id]: structuredClone(action.loan) },
      });
    }

    case "AttachFile": {
      const l0 = requireLoan(state, action.loanId);
      const dIdx = l0.documents.findIndex((d) => d.id === action.documentId);
      if (dIdx === -1) {
        throw new ActionError("DOCUMENT_NOT_FOUND",
          `document '${action.documentId}' not found`, { documentId: action.documentId });
      }
      return log(withLoan(state, action.loanId, (l) => {
        const ds = [...l.documents];
        ds[dIdx] = {
          ...ds[dIdx]!,
          fileKey: action.fileKey,
          fileUrl: action.fileUrl,
          fileSize: action.fileSize,
          mimeType: action.mimeType,
          status: ds[dIdx]!.status === "Pending" ? "Received" : ds[dIdx]!.status,
        };
        return { ...l, documents: ds };
      }));
    }

    case "SetExtractedData": {
      const l0 = requireLoan(state, action.loanId);
      const dIdx = l0.documents.findIndex((d) => d.id === action.documentId);
      if (dIdx === -1) {
        throw new ActionError("DOCUMENT_NOT_FOUND",
          `document '${action.documentId}' not found`, { documentId: action.documentId });
      }
      return log(withLoan(state, action.loanId, (l) => {
        const ds = [...l.documents];
        ds[dIdx] = { ...ds[dIdx]!, extractedData: action.extractedData };
        return { ...l, documents: ds };
      }));
    }

    case "AssignLoan": {
      return log(withLoan(state, action.loanId, (l) => ({
        ...l,
        assignment: {
          assignedTo: action.assignedTo,
          assignedBy: action.actor.id,
          assignedAt: at,
          status: "queued",
          priority: action.priority,
        },
      })));
    }

    case "UpdateAssignmentStatus": {
      const l0 = requireLoan(state, action.loanId);
      if (!l0.assignment) {
        throw new ActionError("INVALID_TRANSITION", "loan is not assigned", { loanId: action.loanId });
      }
      return log(withLoan(state, action.loanId, (l) => ({
        ...l,
        assignment: { ...l.assignment!, status: action.status },
      })));
    }

    case "UnassignLoan": {
      return log(withLoan(state, action.loanId, (l) => ({
        ...l,
        assignment: undefined,
      })));
    }

    case "OverrideDecision": {
      if (!action.rationale || action.rationale.trim() === "") {
        throw new ActionError("REQUIRED_FIELD_MISSING",
          "rationale is required for OverrideDecision", { loanId: action.loanId });
      }
      const next = withLoan(state, action.loanId, (l) => ({
        ...l,
        decision: action.overrideDecision,
        pendingRecommendation: undefined,
        milestones: [...l.milestones, milestone(
          `Decision:${action.overrideDecision} (override from ${action.originalRecommendation})`,
          action.actor.id, at
        )],
      }));
      return log(next);
    }

    case "SendBackToVA": {
      const next = withLoan(state, action.loanId, (l) => ({
        ...l,
        pendingRecommendation: undefined,
        assignment: l.assignment
          ? { ...l.assignment, status: "in_progress" as const }
          : l.assignment,
        milestones: [...l.milestones, milestone(
          `Sent back to VA: ${action.notes}`,
          action.actor.id, at
        )],
      }));
      return log(next);
    }

    default:
      return state;
  }
}
