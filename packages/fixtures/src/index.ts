import type { Scenario } from "@twin/core";

export const scenarios: Record<string, Scenario> = {};
export function listScenarios() {
  return Object.values(scenarios).map(({ id, name, description }) => ({ id, name, description }));
}
