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
      return log({ ...state, scenarioId: sc.id, loans: { [sc.loan.id]: structuredClone(sc.loan) } });
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

    default:
      return state;
  }
}
