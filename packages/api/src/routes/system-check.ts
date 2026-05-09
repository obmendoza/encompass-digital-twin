import type { FastifyInstance } from "fastify";
import type { Store } from "@twin/core";
import { getLoansForTenant } from "./_helpers.js";
import { getTenantId } from "../tenant-context.js";

export function registerSystemCheckRoutes(app: FastifyInstance, store: Store) {

  // 1. Health check — service status
  app.get("/system/health", async () => {
    const state = store.getState();
    return {
      api: "ok",
      loans: Object.keys(state.loans).length,
      auditLog: state.actionLog.length,
      timestamp: new Date().toISOString(),
    };
  });

  // 2. Data integrity check — validates all loans (scoped to tenant)
  app.get("/system/integrity", async () => {
    const loans = getLoansForTenant(store);
    const results: Array<{ loanId: string; checks: number; passed: number; failed: number; issues: string[] }> = [];

    for (const loan of loans) {
      const issues: string[] = [];
      const tx = loan.transaction;
      const q = loan.qualifying;
      const w = loan.qualifyingWorksheet;
      const a = loan.assets;
      const c = loan.credit;
      const inc = loan.income;
      const appr = loan.appraisal;
      let checks = 0;

      // LTV
      checks++;
      if (tx.appraisedValue && tx.loanAmount) {
        const ltv = Math.round(tx.loanAmount / tx.appraisedValue * 10000) / 100;
        if (Math.abs(ltv - tx.ltv) > 0.5) issues.push(`LTV: computed ${ltv}% vs stored ${tx.ltv}%`);
      }

      // PI Payment
      checks++;
      if (tx.noteRate && tx.term && tx.loanAmount) {
        const r = tx.noteRate / 100 / 12;
        const n = tx.term;
        const pi = tx.loanAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
        if (Math.abs(pi - q.piPayment) / Math.max(pi, 1) > 0.03) issues.push(`PI: computed $${Math.round(pi)} vs stored $${q.piPayment}`);
      }

      // DTI (non-DSCR)
      checks++;
      if (!["DSCR", "ForeignNational"].includes(loan.nqmProgram) && w.derivedMonthlyIncome > 0) {
        const dti = Math.round(tx.piti / w.derivedMonthlyIncome * 10000) / 100;
        if (Math.abs(dti - q.totalDti) > 2.0) issues.push(`DTI: computed ${dti}% vs stored ${q.totalDti}%`);
      }

      // Housing ratio
      checks++;
      if (!["DSCR", "ForeignNational"].includes(loan.nqmProgram) && w.derivedMonthlyIncome > 0) {
        const hr = Math.round(q.piPayment / w.derivedMonthlyIncome * 10000) / 100;
        if (Math.abs(hr - q.housingRatio) > 2.0) issues.push(`Housing: computed ${hr}% vs stored ${q.housingRatio}%`);
      }

      // Income consistency
      checks++;
      if (w.derivedMonthlyIncome !== inc.totalMonthlyIncome) issues.push(`Income mismatch: worksheet ${w.derivedMonthlyIncome} vs income ${inc.totalMonthlyIncome}`);

      // Appraisal match
      checks++;
      if (appr.appraisedValue !== tx.appraisedValue) issues.push(`Appraisal mismatch`);

      // Tradeline sums
      checks++;
      if (c.tradelines.length > 0) {
        const balSum = c.tradelines.reduce((s, t) => s + t.balance, 0);
        if (Math.abs(balSum - c.liabilities.totalBalance) > 100) issues.push(`Tradeline balance: sum $${Math.round(balSum)} vs stored $${c.liabilities.totalBalance}`);
      }

      // Reserves
      checks++;
      if (a.totalLiquid && tx.piti > 0) {
        const res = Math.round(a.totalLiquid / tx.piti * 10) / 10;
        if (Math.abs(res - a.reservesMonths) > 2.0) issues.push(`Reserves: computed ${res} vs stored ${a.reservesMonths}`);
      }

      // Bank stmt income
      checks++;
      if (w.method === "BankStatementDeposits" && w.avgDeposits) {
        const ef = w.expenseFactor ?? 0.5;
        const ci = Math.round(w.avgDeposits * (1 - ef) * 100) / 100;
        if (Math.abs(ci - w.derivedMonthlyIncome) > 10) issues.push(`Bank stmt income: computed $${ci} vs stored $${w.derivedMonthlyIncome}`);
      }

      // Condition uniqueness
      checks++;
      const condIds = loan.conditions.map(co => co.id);
      if (condIds.length !== new Set(condIds).size) issues.push("Duplicate condition IDs");

      // Doc links valid
      checks++;
      for (const doc of loan.documents) {
        if (doc.linkedConditionId && !condIds.includes(doc.linkedConditionId)) {
          issues.push(`Doc ${doc.id} linked to missing condition ${doc.linkedConditionId}`);
        }
      }

      results.push({
        loanId: loan.id,
        checks,
        passed: checks - issues.length,
        failed: issues.length,
        issues,
      });
    }

    const totalChecks = results.reduce((s, r) => s + r.checks, 0);
    const totalFailed = results.reduce((s, r) => s + r.failed, 0);

    return {
      status: totalFailed === 0 ? "pass" : "fail",
      loansChecked: results.length,
      totalChecks,
      totalPassed: totalChecks - totalFailed,
      totalFailed,
      results,
      timestamp: new Date().toISOString(),
    };
  });

  // 3. Behavioral flow test — runs key action sequences
  app.post("/system/behavioral-test", async () => {
    const results: Array<{ name: string; status: "pass" | "fail"; detail: string; durationMs: number }> = [];
    const actor = { kind: "human" as const, id: "system-test" };
    const agentActor = { kind: "agent" as const, id: "system-test-agent" };

    async function runTest(name: string, fn: () => Promise<string>) {
      const start = Date.now();
      try {
        const detail = await fn();
        results.push({ name, status: "pass", detail, durationMs: Date.now() - start });
      } catch (e) {
        results.push({ name, status: "fail", detail: String(e instanceof Error ? e.message : e).slice(0, 200), durationMs: Date.now() - start });
      }
    }

    // Reset to clean state
    store.dispatch({ type: "ResetWorld" });
    store.dispatch({ type: "LoadScenario", scenarioId: "nqm-bankstmt-12mo-clean", tenantId: getTenantId() });

    const loanId = "2501000101";

    await runTest("Assign loan", async () => {
      store.dispatch({ type: "AssignLoan", loanId, assignedTo: "test@va.com", priority: "normal", actor });
      const l = store.getLoan(loanId);
      if (l?.assignment?.status !== "queued") throw new Error("Expected queued");
      return "queued";
    });

    await runTest("Update assignment status", async () => {
      store.dispatch({ type: "UpdateAssignmentStatus", loanId, status: "in_progress", actor });
      if (store.getLoan(loanId)?.assignment?.status !== "in_progress") throw new Error("Expected in_progress");
      return "in_progress";
    });

    await runTest("Add condition", async () => {
      store.dispatch({ type: "AddCondition", loanId, condition: { category: "PTD", source: "UW", description: "System test" }, actor });
      const count = store.getLoan(loanId)?.conditions.length ?? 0;
      if (count < 5) throw new Error(`Expected 5+ conditions, got ${count}`);
      return `${count} conditions`;
    });

    await runTest("Condition dedup", async () => {
      const before = store.getLoan(loanId)?.conditions.length ?? 0;
      store.dispatch({ type: "AddCondition", loanId, condition: { category: "PTD", source: "UW", description: "System test" }, actor });
      const after = store.getLoan(loanId)?.conditions.length ?? 0;
      if (after !== before) throw new Error("Duplicate not blocked");
      return "dedup works";
    });

    await runTest("Clear condition", async () => {
      store.dispatch({ type: "ClearCondition", loanId, conditionId: "c1", notes: "test", actor });
      if (store.getLoan(loanId)?.conditions.find(c => c.id === "c1")?.status !== "Cleared") throw new Error("Not cleared");
      return "c1 cleared";
    });

    await runTest("Stage recommendation", async () => {
      store.dispatch({ type: "StageRecommendation", loanId, recommendation: {
        recommendation: "approved", rationale: "test", confidence: 0.9, conditions: [], trace: []
      }, actor: agentActor });
      if (!store.getLoan(loanId)?.pendingRecommendation) throw new Error("No rec");
      return "staged";
    });

    await runTest("Accept recommendation", async () => {
      store.dispatch({ type: "AcceptRecommendation", loanId, actor });
      const l = store.getLoan(loanId);
      if (l?.decision !== "approved") throw new Error(`Decision: ${l?.decision}`);
      if (l?.pendingRecommendation) throw new Error("Rec not cleared");
      return "decision=approved";
    });

    await runTest("Override decision", async () => {
      store.dispatch({ type: "ResetWorld" });
      store.dispatch({ type: "LoadScenario", scenarioId: "nqm-bankstmt-12mo-clean", tenantId: getTenantId() });
      store.dispatch({ type: "StageRecommendation", loanId, recommendation: {
        recommendation: "approved", rationale: "test", confidence: 0.9, conditions: [], trace: []
      }, actor: agentActor });
      store.dispatch({ type: "OverrideDecision", loanId, originalRecommendation: "approved",
        overrideDecision: "suspended", rationale: "need docs", actor });
      const l = store.getLoan(loanId);
      if (l?.decision !== "suspended") throw new Error(`Decision: ${l?.decision}`);
      return "approved\u2192suspended";
    });

    await runTest("Send back to VA", async () => {
      store.dispatch({ type: "ResetWorld" });
      store.dispatch({ type: "LoadScenario", scenarioId: "nqm-bankstmt-12mo-clean", tenantId: getTenantId() });
      store.dispatch({ type: "AssignLoan", loanId, assignedTo: "va@test.com", priority: "normal", actor });
      store.dispatch({ type: "UpdateAssignmentStatus", loanId, status: "report_ready", actor });
      store.dispatch({ type: "StageRecommendation", loanId, recommendation: {
        recommendation: "approved", rationale: "test", confidence: 0.8, conditions: [], trace: []
      }, actor: agentActor });
      store.dispatch({ type: "SendBackToVA", loanId, notes: "re-check", actor });
      const l = store.getLoan(loanId);
      if (l?.pendingRecommendation) throw new Error("Rec not cleared");
      if (l?.assignment?.status !== "in_progress") throw new Error(`Assignment: ${l?.assignment?.status}`);
      return "sent back";
    });

    await runTest("Recalculate income", async () => {
      store.dispatch({ type: "ResetWorld" });
      store.dispatch({ type: "LoadScenario", scenarioId: "nqm-bankstmt-12mo-clean", tenantId: getTenantId() });
      store.dispatch({ type: "RecalculateQualifyingIncome", loanId, worksheet: {
        method: "BankStatementDeposits", monthsCovered: 12, avgDeposits: 20000, expenseFactor: 0.5, derivedMonthlyIncome: 10000
      }, actor });
      const l = store.getLoan(loanId);
      if (l?.income.totalMonthlyIncome !== 10000) throw new Error(`Income: ${l?.income.totalMonthlyIncome}`);
      return `income=$10K, DTI=${l?.qualifying.totalDti}%`;
    });

    // Restore clean state
    store.dispatch({ type: "ResetWorld" });
    const scenarios = store.listScenarios();
    for (const s of scenarios) {
      store.dispatch({ type: "LoadScenario", scenarioId: s.id, tenantId: getTenantId() });
    }

    const passed = results.filter(r => r.status === "pass").length;
    return {
      status: passed === results.length ? "pass" : "fail",
      testsRun: results.length,
      passed,
      failed: results.length - passed,
      totalDurationMs: results.reduce((s, r) => s + r.durationMs, 0),
      results,
      timestamp: new Date().toISOString(),
    };
  });
}
