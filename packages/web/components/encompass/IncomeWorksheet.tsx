"use client";

import { useState, useMemo, useTransition } from "react";
import type { Loan, QualifyingIncomeWorksheet, QualifyingMethod } from "@twin/core";
import { actionRecalcIncome } from "@/app/loan/[loanId]/actions";
import { money, pct } from "@/lib/format";

// ─── BankStatementDetail ──────────────────────────────────────────────────────

interface BankStmtRow {
  mo: number;
  deposits: number;
  withdrawals: number;
  endingBalance: number;
  nsfCount: number;
  source: "IDP";
  largeDeposits: Array<{ date: string; amount: number; description: string }>;
}

function BankStatementDetail({
  loan,
  onUpdateAvg,
}: {
  loan: Loan;
  onUpdateAvg: (newAvg: number) => void;
}) {
  const [refreshKey, setRefreshKey] = useState(0);

  const bankStmtDocs = useMemo(() => {
    return loan.documents.filter(
      (d) => d.docType === "BankStatement" && d.extractedData && d.fileKey
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loan.documents, refreshKey]);

  if (bankStmtDocs.length === 0) {
    return (
      <div className="enc-sec mt-3">
        <h4>Bank Statement Detail</h4>
        <div className="p-3 text-[11px] text-[#555]">
          No bank statements extracted yet. Upload statements in the eFolder and run IDP Extract.
        </div>
      </div>
    );
  }

  const rows: BankStmtRow[] = bankStmtDocs.map((doc, idx) => {
    const d = doc.extractedData as Record<string, unknown>;
    const toNum = (v: unknown): number => {
      if (typeof v === "number") return v;
      if (typeof v === "string") return parseFloat(v.replace(/[^0-9.-]/g, "")) || 0;
      return 0;
    };
    const rawLarge = Array.isArray(d.large_deposits) ? d.large_deposits : [];
    const largeDeposits = rawLarge.map((item: unknown) => {
      const ld = item as Record<string, unknown>;
      return {
        date: typeof ld.date === "string" ? ld.date : "",
        amount: toNum(ld.amount),
        description: typeof ld.description === "string" ? ld.description : "",
      };
    });
    return {
      mo: idx + 1,
      deposits: toNum(d.total_deposits),
      withdrawals: toNum(d.total_withdrawals),
      endingBalance: toNum(d.ending_balance),
      nsfCount: 0,
      source: "IDP",
      largeDeposits,
    };
  });

  const totalDeposits = rows.reduce((s, r) => s + r.deposits, 0);
  const avgDeposits = rows.length > 0 ? totalDeposits / rows.length : 0;
  const expenseFactor = loan.qualifyingWorksheet.expenseFactor ?? 0.5;
  const netIncome = avgDeposits * (1 - expenseFactor);
  const totalNsf = rows.reduce((s, r) => s + r.nsfCount, 0);

  // Large deposit threshold: any single deposit > 25% of average monthly deposits
  const largeDepositThreshold = avgDeposits * 0.25;
  const flaggedLargeDeposits: Array<{
    mo: number;
    amount: number;
    description: string;
    date: string;
  }> = [];
  rows.forEach((row) => {
    row.largeDeposits.forEach((ld) => {
      if (ld.amount > largeDepositThreshold) {
        flaggedLargeDeposits.push({ mo: row.mo, ...ld });
      }
    });
  });

  // Trend detection: last 3 vs first 3 months
  let trendAlert: { firstAvg: number; lastAvg: number; changePct: number } | null = null;
  if (rows.length >= 6) {
    const first3 = rows.slice(0, 3);
    const last3 = rows.slice(-3);
    const firstAvg = first3.reduce((s, r) => s + r.deposits, 0) / 3;
    const lastAvg = last3.reduce((s, r) => s + r.deposits, 0) / 3;
    if (firstAvg > 0) {
      const changePct = (lastAvg - firstAvg) / firstAvg;
      if (changePct < -0.15) {
        trendAlert = { firstAvg, lastAvg, changePct };
      }
    }
  }

  const thStyle: React.CSSProperties = {
    padding: "4px 6px",
    textAlign: "left",
    fontWeight: 700,
    fontSize: 10,
    color: "#fff",
    borderRight: "1px solid #1a4a7a",
    whiteSpace: "nowrap",
  };

  const tdStyle = (align: "left" | "right" | "center" = "right"): React.CSSProperties => ({
    padding: "3px 6px",
    fontSize: 10,
    fontFamily: "monospace",
    textAlign: align,
    borderRight: "1px solid #dde3ee",
    borderBottom: "1px solid #dde3ee",
  });

  return (
    <div className="enc-sec mt-3">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h4 style={{ margin: 0 }}>Bank Statement Detail</h4>
        <button
          className="enc-btn enc-btn--secondary"
          style={{ fontSize: 9, padding: "2px 8px", marginRight: 8 }}
          onClick={() => setRefreshKey((k) => k + 1)}
        >
          Pull from eFolder
        </button>
      </div>

      <div className="p-3">
        {/* Main Grid */}
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              border: "1px solid #7f9db9",
              fontSize: 10,
            }}
          >
            <thead>
              <tr
                style={{
                  background: "linear-gradient(180deg,#1e5fa8 0%,#0a3d6f 100%)",
                }}
              >
                <th style={{ ...thStyle, width: 40, textAlign: "center" }}>Mo</th>
                <th style={thStyle}>Deposits</th>
                <th style={thStyle}>Withdrawals</th>
                <th style={thStyle}>End Balance</th>
                <th style={{ ...thStyle, width: 50, textAlign: "center" }}>NSFs</th>
                <th style={{ ...thStyle, width: 40, textAlign: "center" }}>Src</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.mo}
                  style={{ background: i % 2 === 0 ? "#ffffff" : "#f5f8ff" }}
                >
                  <td style={{ ...tdStyle("center"), fontWeight: 600 }}>{row.mo}</td>
                  <td style={tdStyle("right")}>{money(row.deposits)}</td>
                  <td style={tdStyle("right")}>{money(row.withdrawals)}</td>
                  <td style={tdStyle("right")}>{money(row.endingBalance)}</td>
                  <td style={tdStyle("center")}>{row.nsfCount}</td>
                  <td style={{ ...tdStyle("center") }}>
                    <span
                      className="bg-[#e8f0fe] text-[#0a52a0] font-bold px-1"
                      style={{ fontSize: 8, borderRadius: 2 }}
                    >
                      IDP
                    </span>
                  </td>
                </tr>
              ))}

              {/* AVG row */}
              <tr style={{ background: "#e8f0fe", borderTop: "2px solid #7f9db9" }}>
                <td style={{ ...tdStyle("center"), fontWeight: 700, color: "#0a3d6f" }}>
                  AVG
                </td>
                <td style={{ ...tdStyle("right"), fontWeight: 700, color: "#0a3d6f" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
                    {money(avgDeposits)}
                    <button
                      className="enc-btn enc-btn--primary"
                      style={{ fontSize: 9, padding: "1px 5px", marginLeft: 4 }}
                      onClick={() => onUpdateAvg(Math.round(avgDeposits * 100) / 100)}
                    >
                      Use This Average
                    </button>
                  </div>
                </td>
                <td style={tdStyle("right")} />
                <td style={tdStyle("right")} />
                <td style={{ ...tdStyle("center"), fontWeight: 700, color: "#0a3d6f" }}>
                  Tot:{totalNsf}
                </td>
                <td style={tdStyle("center")} />
              </tr>

              {/* NET row */}
              <tr style={{ background: "#e8f5e9" }}>
                <td style={{ ...tdStyle("center"), fontWeight: 700, color: "#1b5e20" }}>
                  NET
                </td>
                <td style={{ ...tdStyle("right"), fontWeight: 700, color: "#1b5e20" }}>
                  {money(netIncome)}
                </td>
                <td
                  colSpan={3}
                  style={{
                    ...tdStyle("left"),
                    fontStyle: "italic",
                    color: "#555",
                    fontSize: 9,
                  }}
                >
                  ({Math.round(expenseFactor * 100)}% expense factor applied)
                </td>
                <td style={tdStyle("center")} />
              </tr>
            </tbody>
          </table>
        </div>

        {/* Large deposit callout */}
        {flaggedLargeDeposits.length > 0 && (
          <div
            className="border-l-4 border-[#ff9800] bg-[#fff8e1]"
            style={{ marginTop: 10, padding: "8px 12px", fontSize: 10 }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 11 }}>
              ⚠️ Large Deposits Requiring Sourcing
            </div>
            {flaggedLargeDeposits.map((ld, i) => (
              <div key={i} style={{ marginBottom: 2 }}>
                Mo {ld.mo}: {money(ld.amount)}{ld.description ? ` (${ld.description})` : ""} — exceeds{" "}
                {money(largeDepositThreshold)} threshold (25% of avg)
              </div>
            ))}
          </div>
        )}

        {/* Declining trend callout */}
        {trendAlert && (
          <div
            style={{
              marginTop: 8,
              padding: "6px 10px",
              background: "#fce4ec",
              borderLeft: "4px solid #e53935",
              fontSize: 10,
              color: "#b71c1c",
            }}
          >
            📉 Declining Trend: First 3mo avg {money(trendAlert.firstAvg)} → Last 3mo avg{" "}
            {money(trendAlert.lastAvg)} ({Math.round(trendAlert.changePct * 100)}%)
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helper sub-components ────────────────────────────────────────────────────

interface Props {
  loan: Loan;
}

function InputField({ label, value, onChange, type = "number", readOnly = false }: {
  label: string; value: string | number; onChange?: (v: string) => void; type?: string; readOnly?: boolean;
}) {
  return (
    <div className="enc-field">
      <label>{label}</label>
      {readOnly ? (
        <div className="v">{typeof value === "number" ? money(value) : value}</div>
      ) : (
        <input
          className="border border-[#7f9db9] text-[11px] px-1 w-full"
          type={type}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
        />
      )}
    </div>
  );
}

function ComputedField({ label, value }: { label: string; value: string }) {
  return (
    <div className="enc-field bg-[#f0f5ff]">
      <label>{label}</label>
      <div className="v text-[#0a52a0]">{value}</div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function IncomeWorksheet({ loan }: Props) {
  const w = loan.qualifyingWorksheet;
  const method = w.method;
  const [pending, startTransition] = useTransition();

  // Form state per method
  const [monthsCovered, setMonthsCovered] = useState(w.monthsCovered ?? 12);
  const [avgDeposits, setAvgDeposits] = useState(w.avgDeposits ?? 0);
  const [expenseFactor, setExpenseFactor] = useState((w.expenseFactor ?? 0.5) * 100);
  const [nsfCount, setNsfCount] = useState(w.nsfCount ?? 0);
  const [rentalIncome, setRentalIncome] = useState(loan.transaction.rentalIncome ?? 0);
  const [totalAssets, setTotalAssets] = useState(w.totalAssets ?? 0);
  const [depletionMonths, setDepletionMonths] = useState(w.depletionMonths ?? 60);
  const [gross1099, setGross1099] = useState(w.gross1099 ?? 0);
  const [cpaCertifiedNet, setCpaCertifiedNet] = useState(w.cpaCertifiedNetIncome ?? 0);
  const [directIncome, setDirectIncome] = useState(w.derivedMonthlyIncome);

  const derived = useMemo((): number => {
    switch (method) {
      case "BankStatementDeposits":
        return avgDeposits * (1 - expenseFactor / 100);
      case "DSCRCoverage":
        return rentalIncome || 1;
      case "AssetDepletionMonths":
        return depletionMonths > 0 ? totalAssets / depletionMonths : 0;
      case "1099Gross":
        return (gross1099 / 12) * (1 - expenseFactor / 100);
      case "PnLCPACertified":
        return cpaCertifiedNet;
      case "TraditionalDocs":
        return directIncome;
      default:
        return 0;
    }
  }, [method, avgDeposits, expenseFactor, rentalIncome, totalAssets, depletionMonths, gross1099, cpaCertifiedNet, directIncome]);

  const buildWorksheet = (): QualifyingIncomeWorksheet => {
    const base: QualifyingIncomeWorksheet = { method, derivedMonthlyIncome: Math.round(derived * 100) / 100 };
    switch (method) {
      case "BankStatementDeposits":
        return { ...base, monthsCovered, avgDeposits, expenseFactor: expenseFactor / 100, nsfCount };
      case "DSCRCoverage":
        return { ...base, dscrNumerator: rentalIncome, dscrDenominator: loan.transaction.pitia ?? loan.transaction.piti };
      case "AssetDepletionMonths":
        return { ...base, totalAssets, depletionMonths };
      case "1099Gross":
        return { ...base, gross1099, expenseFactor: expenseFactor / 100 };
      case "PnLCPACertified":
        return { ...base, cpaCertifiedNetIncome: cpaCertifiedNet };
      case "TraditionalDocs":
        return base;
      default:
        return base;
    }
  };

  const handleRecalc = () => {
    const ws = buildWorksheet();
    if (ws.derivedMonthlyIncome <= 0) { alert("Derived income must be > 0"); return; }
    startTransition(async () => { await actionRecalcIncome(loan.id, ws); });
  };

  const pitia = loan.transaction.pitia ?? loan.transaction.piti;
  const dscrRatio = rentalIncome > 0 && pitia > 0 ? rentalIncome / pitia : 0;

  const hasBankStmtExtracted = loan.documents.some(
    (d) => d.docType === "BankStatement" && d.extractedData
  );

  return (
    <div>
      {/* Summary bar */}
      <div className="enc-sec mb-2">
        <h4>Income Summary</h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
          <div className="enc-field"><label>Method</label><div className="v" title={method}>{getMethodTitle(method)}</div></div>
          <div className="enc-field"><label>Program</label><div className="v" title={loan.nqmProgram}>{loan.nqmProgram}</div></div>
          <div className="enc-field"><label>Current Income</label><div className="v">{money(loan.qualifyingWorksheet.derivedMonthlyIncome)}</div></div>
          <div className="enc-field"><label>Housing Ratio</label><div className="v">{pct(loan.qualifying.housingRatio)}</div></div>
          <div className="enc-field"><label>Total DTI</label><div className="v">{pct(loan.qualifying.totalDti)}</div></div>
          <div className="enc-field"><label>PITI</label><div className="v">{money(loan.transaction.piti)}</div></div>
          <div className="enc-field"><label>PI Payment</label><div className="v">{money(loan.qualifying.piPayment)}</div></div>
          <div className="enc-field"><label>Qual Rate</label><div className="v">{pct(loan.qualifying.qualifyingRate, 4)}</div></div>
        </div>
      </div>

      {/* Method worksheet */}
      <div className="enc-sec">
        <h4>{getMethodTitle(method)} Worksheet</h4>
        <div className="p-3">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {method === "BankStatementDeposits" && (
              <>
                <InputField label="Months Covered" value={monthsCovered} onChange={(v) => setMonthsCovered(Number(v))} />
                <InputField label="Avg Monthly Deposits" value={avgDeposits} onChange={(v) => setAvgDeposits(Number(v))} />
                <InputField label="Expense Factor (%)" value={expenseFactor} onChange={(v) => setExpenseFactor(Number(v))} />
                <InputField label="NSF Count" value={nsfCount} onChange={(v) => setNsfCount(Number(v))} />
                <ComputedField label="Net Deposits" value={money(avgDeposits * (1 - expenseFactor / 100))} />
                <ComputedField label="Derived Income" value={money(derived)} />
              </>
            )}

            {method === "DSCRCoverage" && (
              <>
                <InputField label="Monthly Rental Inc." value={rentalIncome} onChange={(v) => setRentalIncome(Number(v))} />
                <InputField label="Monthly PITIA" value={pitia} readOnly />
                <ComputedField label="DSCR Ratio" value={dscrRatio.toFixed(2)} />
                <ComputedField label="Coverage" value={dscrRatio >= 1 ? "Pass" : "Below 1.0"} />
              </>
            )}

            {method === "AssetDepletionMonths" && (
              <>
                <InputField label="Total Eligible Assets" value={totalAssets} onChange={(v) => setTotalAssets(Number(v))} />
                <InputField label="Depletion Period (mo)" value={depletionMonths} onChange={(v) => setDepletionMonths(Number(v))} />
                <ComputedField label="Derived Income" value={money(derived)} />
              </>
            )}

            {method === "1099Gross" && (
              <>
                <InputField label="Annual Gross 1099" value={gross1099} onChange={(v) => setGross1099(Number(v))} />
                <InputField label="Expense Factor (%)" value={expenseFactor} onChange={(v) => setExpenseFactor(Number(v))} />
                <ComputedField label="Monthly Gross" value={money(gross1099 / 12)} />
                <ComputedField label="Derived Income" value={money(derived)} />
              </>
            )}

            {method === "PnLCPACertified" && (
              <>
                <InputField label="CPA Net Income (mo)" value={cpaCertifiedNet} onChange={(v) => setCpaCertifiedNet(Number(v))} />
                <ComputedField label="Derived Income" value={money(derived)} />
              </>
            )}

            {method === "TraditionalDocs" && (
              <>
                <InputField label="Total Monthly Income" value={directIncome} onChange={(v) => setDirectIncome(Number(v))} />
                <ComputedField label="Derived Income" value={money(derived)} />
              </>
            )}
          </div>

          {/* Bank Statement Detail — only shown for BankStatementDeposits method */}
          {method === "BankStatementDeposits" && hasBankStmtExtracted && (
            <BankStatementDetail
              loan={loan}
              onUpdateAvg={(avg) => setAvgDeposits(avg)}
            />
          )}

          {method === "BankStatementDeposits" && !hasBankStmtExtracted && (
            <div className="mt-3 text-[11px] text-[#555] p-2 bg-[#f5f5f5] border border-[#ddd]">
              No bank statements extracted yet. Upload statements in the eFolder and run IDP Extract.
            </div>
          )}

          <div className="flex items-center gap-2 mt-3 pt-2 border-t border-[#c8c4b5]">
            <ComputedField label="New Derived Income" value={money(derived)} />
            <button className="enc-btn enc-btn--primary ml-4" disabled={pending} onClick={handleRecalc}>
              Recalculate
            </button>
            {derived !== loan.qualifyingWorksheet.derivedMonthlyIncome && (
              <span className="text-[10px] text-[#8a4b00]">
                Changed from {money(loan.qualifyingWorksheet.derivedMonthlyIncome)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getMethodTitle(method: QualifyingMethod): string {
  switch (method) {
    case "BankStatementDeposits": return "Bank Statement";
    case "DSCRCoverage": return "DSCR Coverage";
    case "AssetDepletionMonths": return "Asset Depletion";
    case "1099Gross": return "1099 Income";
    case "PnLCPACertified": return "P&L (CPA Certified)";
    case "TraditionalDocs": return "Traditional Documentation";
    default: return method;
  }
}
