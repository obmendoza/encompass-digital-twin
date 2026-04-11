import type { Action, LoggedAction, Scenario, WorldState } from "./types.js";
import { ActionError } from "./errors.js";

export type ScenarioResolver = (scenarioId: string) => Scenario | undefined;

export function reduce(
  state: WorldState,
  action: Action,
  resolveScenario: ScenarioResolver,
): WorldState {
  const log = (s: WorldState): WorldState => ({
    ...s,
    actionLog: [...s.actionLog, {
      seq: s.actionLog.length + 1,
      at: s.now(),
      action,
    } satisfies LoggedAction],
  });

  switch (action.type) {
    case "LoadScenario": {
      const sc = resolveScenario(action.scenarioId);
      if (!sc) {
        throw new ActionError("SCENARIO_NOT_FOUND",
          `scenario '${action.scenarioId}' not found`,
          { scenarioId: action.scenarioId });
      }
      return log({
        ...state,
        scenarioId: sc.id,
        loans: { [sc.loan.id]: structuredClone(sc.loan) },
      });
    }

    case "ResetWorld": {
      return { scenarioId: null, loans: {}, actionLog: [], now: state.now };
    }

    default:
      // other cases added in later tasks
      return state;
  }
}
