import type pg from "pg";
import type { LoanContext } from "../../doc-requirements.js";
import type { Finding, KbVersionContext } from "../pre-underwriter.js";

export interface RequirementRow {
  id: string;
  requirement_key: string;
  requirement_value: string | Record<string, unknown>;
}

export interface HandlerResult {
  findings: Finding[];
  /** True if the deterministic handler couldn't parse the value; the
   *  orchestrator routes the row into the LLM backstop bucket. */
  unhandled: boolean;
}

function reqValueString(v: RequirementRow["requirement_value"]): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** Parse the first integer in a string (e.g. "50%" → 50, "6 months" → 6). */
function firstInt(s: string): number | null {
  const m = s.match(/(\d+)/);
  return m ? parseInt(m[1]!, 10) : null;
}

/** Parse "Minimum $X and Max $Y" into a [min, max] pair. */
function parseLoanAmountsRange(s: string): { min: number; max: number } | null {
  const min = s.match(/Min(?:imum)?\s*\$([\d,]+)/i);
  const max = s.match(/Max(?:imum)?\s*\$([\d,]+)/i);
  if (!min || !max) return null;
  return {
    min: parseInt(min[1]!.replace(/,/g, ""), 10),
    max: parseInt(max[1]!.replace(/,/g, ""), 10),
  };
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString()}`;
}

function mkFinding(rule: RequirementRow, description: string, category: Finding["category"]): Finding {
  return {
    description,
    note: reqValueString(rule.requirement_value).slice(0, 200),
    category,
    sourceList: "requirements",
    sourceRuleTable: "program_requirements",
    sourceRuleId: rule.id,
    emissionKind: "deterministic",
  };
}

/**
 * Per-row handler dispatch. Pure function (no I/O). Returns 0..n findings
 * plus an `unhandled` flag the orchestrator uses to collect rows for the
 * LLM backstop.
 */
export function handleRequirement(loan: LoanContext, rule: RequirementRow): HandlerResult {
  const value = reqValueString(rule.requirement_value);
  switch (rule.requirement_key) {
    case "DTI Max": {
      if (loan.dti === undefined) {
        console.warn("[requirements-resolver] skipped — missing field", { missingField: "dti", ruleId: rule.id });
        return { findings: [], unhandled: false };
      }
      const cap = firstInt(value);
      if (cap === null) return { findings: [], unhandled: true };
      if (loan.dti > cap) {
        return { findings: [mkFinding(rule, `DTI ${loan.dti}% exceeds program max ${cap}% — alternate-income documentation or exception request`, "PTA")], unhandled: false };
      }
      return { findings: [], unhandled: false };
    }
    case "FICO Min": {
      if (loan.repFico === undefined) {
        console.warn("[requirements-resolver] skipped — missing field", { missingField: "repFico", ruleId: rule.id });
        return { findings: [], unhandled: false };
      }
      const min = firstInt(value);
      if (min === null) return { findings: [], unhandled: true };
      if (loan.repFico < min) {
        return { findings: [mkFinding(rule, `FICO ${loan.repFico} below program min ${min} — credit-supplement docs or exception request`, "PTA")], unhandled: false };
      }
      return { findings: [], unhandled: false };
    }
    case "Reserves Min": {
      if (loan.reservesMonths === undefined) {
        console.warn("[requirements-resolver] skipped — missing field", { missingField: "reservesMonths", ruleId: rule.id });
        return { findings: [], unhandled: false };
      }
      const min = firstInt(value);
      if (min === null) return { findings: [], unhandled: true };
      if (loan.reservesMonths < min) {
        return { findings: [mkFinding(rule, `Reserves ${loan.reservesMonths} months below program min ${min} — additional reserves documentation`, "PTD")], unhandled: false };
      }
      return { findings: [], unhandled: false };
    }
    case "Loan Amounts": {
      if (loan.loanAmount === undefined) {
        console.warn("[requirements-resolver] skipped — missing field", { missingField: "loanAmount", ruleId: rule.id });
        return { findings: [], unhandled: false };
      }
      const range = parseLoanAmountsRange(value);
      if (range === null) return { findings: [], unhandled: true };
      if (loan.loanAmount < range.min || loan.loanAmount > range.max) {
        return { findings: [mkFinding(rule, `Loan amount ${fmtUsd(loan.loanAmount)} outside program range ${fmtUsd(range.min)}–${fmtUsd(range.max)} — program-change request`, "PTA")], unhandled: false };
      }
      return { findings: [], unhandled: false };
    }
    case "Interest Only": {
      // Conservative: emit only on the unambiguous "Ineligible" signal;
      // anything else falls to backstop.
      if (value.trim() === "Ineligible") {
        return { findings: [mkFinding(rule, `Interest-only may not be permitted by program — confirm amortization type or seek exception`, "PTA")], unhandled: false };
      }
      return { findings: [], unhandled: true };
    }
    case "Exceptions": {
      if (value.trim() === "Ineligible") {
        return { findings: [mkFinding(rule, `Program does not permit exceptions — UW review required for any deviation`, "PTA")], unhandled: false };
      }
      return { findings: [], unhandled: false };
    }
    case "Loan Purpose": {
      if (loan.loanPurpose === undefined) {
        console.warn("[requirements-resolver] skipped — missing field", { missingField: "loanPurpose", ruleId: rule.id });
        return { findings: [], unhandled: false };
      }
      const hay = value.toLowerCase();
      if (!hay.includes(loan.loanPurpose.toLowerCase())) {
        return { findings: [mkFinding(rule, `Loan purpose '${loan.loanPurpose}' not in program's permitted list (${value}) — program-change request`, "PTA")], unhandled: false };
      }
      return { findings: [], unhandled: false };
    }
    default:
      return { findings: [], unhandled: true };
  }
}

/**
 * Resolver: program_requirements — deterministic Stage A. Loads all rows
 * for the (tenant, kb_version_number, program) tuple and dispatches each
 * to handleRequirement. Returns deterministic findings and the set of
 * unhandled rows for Phase D's LLM backstop.
 */
export async function resolveRequirementFindings(
  c: pg.PoolClient,
  tenantId: string,
  kbCtx: KbVersionContext,
  loan: LoanContext,
): Promise<{ findings: Finding[]; unhandledRows: RequirementRow[] }> {
  const { rows } = await c.query<RequirementRow>(
    `SELECT id, requirement_key, requirement_value
       FROM program_requirements
      WHERE tenant_id = $1 AND kb_version = $2 AND program = $3`,
    [tenantId, kbCtx.versionNumber, loan.program],
  );

  const findings: Finding[] = [];
  const unhandledRows: RequirementRow[] = [];
  for (const row of rows) {
    const result = handleRequirement(loan, row);
    findings.push(...result.findings);
    if (result.unhandled) unhandledRows.push(row);
  }
  return { findings, unhandledRows };
}
