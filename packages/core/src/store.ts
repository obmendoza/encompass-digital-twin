import type { Action, Loan, LoggedAction, Scenario, WorldState } from "./types.js";
import { reduce, type ScenarioResolver } from "./reduce.js";

export interface StoreOptions {
  scenarios: Record<string, Scenario>;
  now?: () => string;
}

export interface Store {
  dispatch(action: Action): WorldState;
  getState(): WorldState;
  getLoan(loanId: string): Loan | undefined;
  getAuditLog(): LoggedAction[];
  listScenarios(): Array<{ id: string; name: string; description: string }>;
}

export function createStore(opts: StoreOptions): Store {
  const resolve: ScenarioResolver = (id) => opts.scenarios[id];
  const now = opts.now ?? (() => new Date().toISOString());
  let state: WorldState = { scenarioId: null, loans: {}, actionLog: [], now };

  return {
    dispatch(action) {
      state = reduce(state, action, resolve);
      return state;
    },
    getState() { return state; },
    getLoan(id) { return state.loans[id]; },
    getAuditLog() { return state.actionLog; },
    listScenarios() {
      return Object.values(opts.scenarios).map(({ id, name, description }) => ({ id, name, description }));
    },
  };
}
