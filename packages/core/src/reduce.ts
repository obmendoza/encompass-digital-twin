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

    default:
      return state;
  }
}
