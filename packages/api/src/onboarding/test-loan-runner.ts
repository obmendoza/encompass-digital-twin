// ── Test Loan Runner — 5 synthetic test cases per program for go-live validation ──

import type { Loan } from "@twin/core";
import { scenarios } from "@twin/fixtures";

export interface TestLoanCase {
  loan: Loan;
  testCase: string;
  expected: string;
}

/**
 * Generate 5 test loan cases for a given program.
 * Uses fixture scenarios as base loans, finding one that matches the program
 * or falling back to the first available scenario.
 */
export function generateTestLoans(
  program: string,
  tenantId: string,
): TestLoanCase[] {
  // Find a fixture matching the program, or use first available as fallback
  const allScenarios = Object.values(scenarios);
  const matchingScenario = allScenarios.find(
    (s) => s.loan.nqmProgram === program || s.loan.overlay.programName.toLowerCase().includes(program.toLowerCase()),
  );
  const fallback = matchingScenario ?? allScenarios[0];
  if (!fallback) {
    throw new Error("No fixture scenarios available to generate test loans");
  }
  const base = fallback.loan;

  return [
    makeStrongFile(base, program, tenantId, 0),
    makeMarginalFile(base, program, tenantId, 1),
    makeWeakFile(base, program, tenantId, 2),
    makeMissingIncomeDocs(base, program, tenantId, 3),
    makeHighLtvLowFico(base, program, tenantId, 4),
  ];
}

// ── Test Case 1: Strong file (clear approve) ───────────────────────
function makeStrongFile(
  base: Loan,
  program: string,
  tenantId: string,
  index: number,
): TestLoanCase {
  const loan: Loan = {
    ...base,
    id: `TEST-${program}-${index}`,
    tenantId,
    credit: {
      ...base.credit,
      repScore: 780,
      tradelines: base.credit.tradelines.map((t) => ({
        ...t,
        late30: 0,
        late60: 0,
        late90: 0,
        isDisputed: false,
      })),
    },
    transaction: {
      ...base.transaction,
      ltv: 65,
      cltv: 65,
      hcltv: 65,
    },
    qualifying: {
      ...base.qualifying,
      totalDti: 28,
      housingRatio: 22,
    },
    assets: {
      ...base.assets,
      totalLiquid: 200000,
      reservesMonths: 36,
    },
    decision: "pending",
  };

  return {
    loan,
    testCase: "Strong file — clear approve",
    expected: "approved",
  };
}

// ── Test Case 2: Marginal file at threshold ─────────────────────────
function makeMarginalFile(
  base: Loan,
  program: string,
  tenantId: string,
  index: number,
): TestLoanCase {
  const loan: Loan = {
    ...base,
    id: `TEST-${program}-${index}`,
    tenantId,
    credit: {
      ...base.credit,
      repScore: 660,
    },
    transaction: {
      ...base.transaction,
      ltv: 85,
      cltv: 85,
      hcltv: 85,
    },
    qualifying: {
      ...base.qualifying,
      totalDti: 48,
      housingRatio: 38,
    },
    assets: {
      ...base.assets,
      totalLiquid: 30000,
      reservesMonths: 6,
    },
    decision: "pending",
  };

  return {
    loan,
    testCase: "Marginal file — borderline values",
    expected: "suspended",
  };
}

// ── Test Case 3: Weak file (clear deny) ─────────────────────────────
function makeWeakFile(
  base: Loan,
  program: string,
  tenantId: string,
  index: number,
): TestLoanCase {
  const loan: Loan = {
    ...base,
    id: `TEST-${program}-${index}`,
    tenantId,
    credit: {
      ...base.credit,
      repScore: 520,
      tradelines: base.credit.tradelines.map((t) => ({
        ...t,
        late30: 3,
        late60: 2,
        late90: 1,
      })),
    },
    transaction: {
      ...base.transaction,
      ltv: 95,
      cltv: 95,
      hcltv: 95,
    },
    qualifying: {
      ...base.qualifying,
      totalDti: 58,
      housingRatio: 45,
    },
    assets: {
      ...base.assets,
      totalLiquid: 5000,
      reservesMonths: 1.5,
    },
    decision: "pending",
  };

  return {
    loan,
    testCase: "Weak file — clear deny",
    expected: "denied",
  };
}

// ── Test Case 4: Missing income docs ────────────────────────────────
function makeMissingIncomeDocs(
  base: Loan,
  program: string,
  tenantId: string,
  index: number,
): TestLoanCase {
  const loan: Loan = {
    ...base,
    id: `TEST-${program}-${index}`,
    tenantId,
    documents: [],
    income: {
      totalMonthlyIncome: 0,
      notes: "No income documentation provided",
    },
    qualifyingWorksheet: {
      ...base.qualifyingWorksheet,
      derivedMonthlyIncome: 0,
    },
    qualifying: {
      ...base.qualifying,
      totalDti: 999,
      housingRatio: 999,
    },
    decision: "pending",
  };

  return {
    loan,
    testCase: "Missing income docs — no documentation",
    expected: "suspended",
  };
}

// ── Test Case 5: High LTV + Low FICO — matrix edge case ────────────
function makeHighLtvLowFico(
  base: Loan,
  program: string,
  tenantId: string,
  index: number,
): TestLoanCase {
  const loan: Loan = {
    ...base,
    id: `TEST-${program}-${index}`,
    tenantId,
    credit: {
      ...base.credit,
      repScore: 580,
    },
    transaction: {
      ...base.transaction,
      ltv: 90,
      cltv: 90,
      hcltv: 90,
    },
    qualifying: {
      ...base.qualifying,
      totalDti: 43,
    },
    assets: {
      ...base.assets,
      reservesMonths: 4,
    },
    decision: "pending",
  };

  return {
    loan,
    testCase: "High LTV + low FICO — matrix edge case",
    expected: "denied",
  };
}
