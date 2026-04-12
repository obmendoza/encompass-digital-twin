"use client";

import { useState, useMemo } from "react";
import Link from "next/link";

interface PipelineLoan {
  id: string;
  borrower: string;
  program: string;
  loanAmount: number;
  ltv: number;
  decision: string;
  openConditions: number;
}

type SortKey = keyof PipelineLoan;
type SortDir = "asc" | "desc";

const DECISION_PILL: Record<string, string> = {
  pending: "enc-pill enc-pill--open",
  approved: "enc-pill enc-pill--cleared",
  suspended: "enc-pill enc-pill--reqd",
  counter: "enc-pill enc-pill--rcvd",
  denied: "enc-pill enc-pill--waived",
};

const PROGRAMS: string[] = [
  "BankStatement12", "BankStatement24", "DSCR", "AssetDepletion",
  "1099Only", "PnL", "ForeignNational", "ITIN", "FullDocNonQM",
];

const DECISIONS = ["pending", "approved", "suspended", "counter", "denied"];

const COLS: Array<{ key: SortKey; label: string; fmt?: (v: unknown) => string }> = [
  { key: "id", label: "Loan #" },
  { key: "borrower", label: "Borrower" },
  { key: "program", label: "Program" },
  { key: "loanAmount", label: "Loan Amount", fmt: (v) => `$${(v as number).toLocaleString()}` },
  { key: "ltv", label: "LTV", fmt: (v) => `${(v as number).toFixed(2)}%` },
  { key: "decision", label: "Decision" },
  { key: "openConditions", label: "Open Conds" },
];

export function PipelineTable({ loans }: { loans: PipelineLoan[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterDecision, setFilterDecision] = useState("all");
  const [filterProgram, setFilterProgram] = useState("all");

  const filtered = useMemo(() => {
    let result = loans;
    if (filterDecision !== "all") result = result.filter((l) => l.decision === filterDecision);
    if (filterProgram !== "all") result = result.filter((l) => l.program === filterProgram);
    return result;
  }, [loans, filterDecision, filterProgram]);

  const sorted = useMemo(() => {
    const key = sortKey;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  return (
    <div>
      <div className="flex gap-4 mb-2 text-[11px]">
        <label>
          Decision:{" "}
          <select className="border border-[#7f9db9] text-[11px]"
            value={filterDecision} onChange={(e) => setFilterDecision(e.target.value)}>
            <option value="all">All</option>
            {DECISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label>
          Program:{" "}
          <select className="border border-[#7f9db9] text-[11px]"
            value={filterProgram} onChange={(e) => setFilterProgram(e.target.value)}>
            <option value="all">All</option>
            {PROGRAMS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <span className="ml-auto text-[#404040]">{sorted.length} of {loans.length} loans</span>
      </div>

      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr className="bg-gradient-to-b from-[#0a52a0] to-[#08407d] text-white">
            {COLS.map((col) => (
              <th key={col.key}
                className="text-left px-2 py-[3px] border-r border-[#08407d] cursor-pointer select-none"
                onClick={() => toggleSort(col.key)}>
                {col.label}
                {sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((loan, i) => (
            <tr key={loan.id}
              className={`${i % 2 ? "bg-[#f5f3e8]" : ""} hover:bg-[#cde0f7] cursor-pointer`}>
              {COLS.map((col) => (
                <td key={col.key} className="px-2 py-[2px] border-b border-[#c8c4b5]">
                  {col.key === "id" ? (
                    <Link href={`/loan/${loan.id}/transmittal`} className="text-[#0a52a0] underline">
                      {loan.id}
                    </Link>
                  ) : col.key === "decision" ? (
                    <span className={DECISION_PILL[loan.decision] ?? ""}>{loan.decision}</span>
                  ) : col.fmt ? (
                    col.fmt(loan[col.key])
                  ) : (
                    String(loan[col.key])
                  )}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr><td colSpan={COLS.length} className="px-2 py-4 text-center text-[#404040]">No loans match filters</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
