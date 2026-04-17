"use client";

import { useState, useMemo, useTransition } from "react";
import type { Loan, QualifyingIncomeWorksheet, QualifyingMethod } from "@twin/core";
import { actionRecalcIncome } from "@/app/loan/[loanId]/actions";
import { money, pct } from "@/lib/format";

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
