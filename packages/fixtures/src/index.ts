import type { Scenario } from "@twin/core";
import { nqmBankstmt12moClean } from "./loans/nqm-bankstmt-12mo-clean.js";

export const scenarios: Record<string, Scenario> = {
  [nqmBankstmt12moClean.id]: nqmBankstmt12moClean,
};

export function listScenarios() {
  return Object.values(scenarios).map(({ id, name, description }) => ({ id, name, description }));
}
