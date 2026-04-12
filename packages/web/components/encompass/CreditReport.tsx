"use client";

import { useState } from "react";
import type { Loan, Tradeline } from "@twin/core";

interface Props {
  loan: Loan;
}

type SortKey = "creditorName" | "accountType" | "balance" | "monthlyPayment";
type SortDir = "asc" | "desc";

function money(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function utilization(t: Tradeline): string {
  if (t.accountType !== "Revolving" || t.limit == null || t.limit === 0) return "—";
  return `${Math.round((t.balance / t.limit) * 100)}%`;
}

function SortHeader({
  label, sortKey, current, dir, onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <th
      className="px-2 py-[2px] text-left cursor-pointer select-none whitespace-nowrap hover:bg-[#d4cdb5]"
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active ? (dir === "asc" ? " ▲" : " ▼") : " ↕"}
    </th>
  );
}

export function CreditReport({ loan }: Props) {
  const { credit } = loan;
  const [sortKey, setSortKey] = useState<SortKey>("creditorName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function handleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir("asc");
    }
  }

  const sorted = [...credit.tradelines].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "creditorName") cmp = a.creditorName.localeCompare(b.creditorName);
    else if (sortKey === "accountType") cmp = a.accountType.localeCompare(b.accountType);
    else if (sortKey === "balance") cmp = a.balance - b.balance;
    else if (sortKey === "monthlyPayment") cmp = a.monthlyPayment - b.monthlyPayment;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const lib = credit.liabilities;

  return (
    <div>
      {/* Score Summary */}
      <div className="enc-sec mb-2">
        <h4>Credit Score Summary</h4>
        <div className="enc-grid-8">
          <div className="enc-field"><label>Rep Score</label><div className="v">{credit.repScore ?? "N/A"}</div></div>
          <div className="enc-field"><label>Tradelines Open</label><div className="v">{credit.tradelinesOpen}</div></div>
          <div className="enc-field"><label>Tradelines Total</label><div className="v">{credit.tradelinesTotal}</div></div>
          <div className="enc-field"><label>Last 30-Day Late</label><div className="v">{credit.lastLate30d ?? "None"}</div></div>
          <div className="enc-field"><label>Total Monthly Pmts</label><div className="v">{money(lib.totalMonthlyPayments)}</div></div>
          <div className="enc-field"><label>Total Balance</label><div className="v">{money(lib.totalBalance)}</div></div>
          <div className="enc-field" />
          <div className="enc-field" />
        </div>
      </div>

      {/* Tradeline Table */}
      <div className="enc-sec mb-2">
        <h4>Tradelines ({sorted.length})</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] border-collapse">
            <thead className="bg-gradient-to-b from-[#e2ddc7] to-[#cfc9ae] border-y border-[#6b7a8f]">
              <tr>
                <th className="px-2 py-[2px] text-left w-6">#</th>
                <SortHeader label="Creditor" sortKey="creditorName" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Type" sortKey="accountType" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Balance" sortKey="balance" current={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHeader label="Monthly Pmt" sortKey="monthlyPayment" current={sortKey} dir={sortDir} onSort={handleSort} />
                <th className="px-2 py-[2px] text-left whitespace-nowrap">Limit</th>
                <th className="px-2 py-[2px] text-left whitespace-nowrap">Utilization</th>
                <th className="px-2 py-[2px] text-left whitespace-nowrap">Late 30</th>
                <th className="px-2 py-[2px] text-left whitespace-nowrap">Late 60</th>
                <th className="px-2 py-[2px] text-left whitespace-nowrap">Late 90</th>
                <th className="px-2 py-[2px] text-left whitespace-nowrap">Disputed</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-2 py-2 text-center text-[#888] italic">
                    No tradelines on file
                  </td>
                </tr>
              ) : (
                sorted.map((t, i) => (
                  <tr
                    key={i}
                    className={"border-b border-dotted border-[#dcd7c0] " + (i % 2 === 0 ? "bg-white" : "bg-[#f7f5ee]")}
                  >
                    <td className="px-2 py-[1px] text-[#888]">{i + 1}</td>
                    <td className="px-2 py-[1px] font-medium">{t.creditorName}</td>
                    <td className="px-2 py-[1px]">{t.accountType}</td>
                    <td className="px-2 py-[1px] text-right">{money(t.balance)}</td>
                    <td className="px-2 py-[1px] text-right">{money(t.monthlyPayment)}</td>
                    <td className="px-2 py-[1px] text-right">{t.limit != null ? money(t.limit) : "—"}</td>
                    <td className={"px-2 py-[1px] text-right " + (
                      t.accountType === "Revolving" && t.limit != null && t.limit > 0 && t.balance / t.limit > 0.8
                        ? "text-[#c00]"
                        : ""
                    )}>
                      {utilization(t)}
                    </td>
                    <td className={"px-2 py-[1px] text-center " + (t.late30 > 0 ? "text-[#c00] font-bold" : "")}>{t.late30}</td>
                    <td className={"px-2 py-[1px] text-center " + (t.late60 > 0 ? "text-[#c00] font-bold" : "")}>{t.late60}</td>
                    <td className={"px-2 py-[1px] text-center " + (t.late90 > 0 ? "text-[#c00] font-bold" : "")}>{t.late90}</td>
                    <td className={"px-2 py-[1px] text-center " + (t.isDisputed ? "text-[#8a4b00] font-bold" : "")}>
                      {t.isDisputed ? "Yes" : "No"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Liability Summary */}
      <div className="enc-sec">
        <h4>Liability Summary</h4>
        <div className="enc-grid-8">
          <div className="enc-field"><label>Revolving Balance</label><div className="v">{money(lib.revolvingBalance)}</div></div>
          <div className="enc-field"><label>Installment Balance</label><div className="v">{money(lib.installmentBalance)}</div></div>
          <div className="enc-field"><label>Mortgage Balance</label><div className="v">{money(lib.mortgageBalance)}</div></div>
          <div className="enc-field"><label>Collections Balance</label><div className={"v " + (lib.collectionsBalance > 0 ? "text-[#c00]" : "")}>{money(lib.collectionsBalance)}</div></div>
          <div className="enc-field bg-[#f0f5ff]"><label>Total Balance</label><div className="v text-[#0a52a0] font-bold">{money(lib.totalBalance)}</div></div>
          <div className="enc-field bg-[#f0f5ff]"><label>Total Monthly Pmts</label><div className="v text-[#0a52a0] font-bold">{money(lib.totalMonthlyPayments)}</div></div>
          <div className="enc-field" />
          <div className="enc-field" />
        </div>
      </div>
    </div>
  );
}
