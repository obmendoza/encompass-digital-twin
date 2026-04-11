import type {
  Loan, NewCondition, QualifyingIncomeWorksheet, UwDecision, Actor, Condition, LoggedAction,
} from "@twin/core";

const base = process.env.TWIN_API_URL ?? "http://127.0.0.1:4000";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: { "content-type": "application/json" },
    cache: "no-store",
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ code: "INTERNAL", message: res.statusText }));
    throw new Error(`${body.code}: ${body.message}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listScenarios: () => req<Array<{ id: string; name: string; description: string }>>("/scenarios"),
  loadScenario: (scenarioId: string) =>
    req<{ scenarioId: string | null }>("/world/load-scenario", {
      method: "POST", body: JSON.stringify({ scenarioId }),
    }),
  reset: () => req<{ scenarioId: null }>("/world/reset", { method: "POST" }),
  getLoan: (loanId: string) => req<Loan>(`/loans/${loanId}`),
  listLoans: () => req<Array<{ id: string; borrower: string; program: string;
    loanAmount: number; ltv: number; decision: string; openConditions: number }>>("/loans"),
  getConditions: (loanId: string) => req<Condition[]>(`/loans/${loanId}/conditions`),
  getAudit: (loanId: string) => req<LoggedAction[]>(`/loans/${loanId}/audit`),
  setDecision: (loanId: string, decision: UwDecision, rationale: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/decision`, {
      method: "POST", body: JSON.stringify({ decision, rationale, actor }),
    }),
  recalcIncome: (loanId: string, worksheet: QualifyingIncomeWorksheet, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/qualifying-income`, {
      method: "POST", body: JSON.stringify({ worksheet, actor }),
    }),
  addCondition: (loanId: string, condition: NewCondition, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/conditions`, {
      method: "POST", body: JSON.stringify({ condition, actor }),
    }),
  clearCondition: (loanId: string, conditionId: string, notes: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/conditions/${conditionId}/clear`, {
      method: "POST", body: JSON.stringify({ notes, actor }),
    }),
  waiveCondition: (loanId: string, conditionId: string, rationale: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/conditions/${conditionId}/waive`, {
      method: "POST", body: JSON.stringify({ rationale, actor }),
    }),
  removeCondition: (loanId: string, conditionId: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/conditions/${conditionId}`, {
      method: "DELETE", body: JSON.stringify({ actor }),
    }),
};
