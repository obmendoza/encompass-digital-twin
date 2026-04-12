"use client";

import type { Loan, ComplianceFlag } from "@twin/core";

interface Props {
  loan: Loan;
}

function money(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function BoolPill({ value, trueLabel = "Yes", falseLabel = "No" }: { value: boolean; trueLabel?: string; falseLabel?: string }) {
  return (
    <span className={`inline-block px-2 py-[1px] text-[9px] font-bold rounded ${value ? "bg-[#c8e6c9] text-[#1b5e20]" : "bg-[#ffcdd2] text-[#b71c1c]"}`}>
      {value ? trueLabel : falseLabel}
    </span>
  );
}

function QmPill({ status }: { status: Loan["compliance"]["qmStatus"] }) {
  const color =
    status === "QM-Safe Harbor" ? "bg-[#c8e6c9] text-[#1b5e20]"
    : status === "QM-Rebuttable" ? "bg-[#dcedc8] text-[#33691e]"
    : status === "Exempt" ? "bg-[#e3f2fd] text-[#0d47a1]"
    : "bg-[#fff9c4] text-[#827717]"; // Non-QM — gold
  return (
    <span className={`inline-block px-2 py-[1px] text-[9px] font-bold rounded ${color}`}>
      {status}
    </span>
  );
}

function TestPill({ result }: { result: "Pass" | "Fail" | "N/A" }) {
  const color =
    result === "Pass" ? "bg-[#c8e6c9] text-[#1b5e20]"
    : result === "Fail" ? "bg-[#ffcdd2] text-[#b71c1c]"
    : "bg-[#eeeeee] text-[#424242]";
  return (
    <span className={`inline-block px-2 py-[1px] text-[9px] font-bold rounded ${color}`}>
      {result}
    </span>
  );
}

function SeverityPill({ severity }: { severity: ComplianceFlag["severity"] }) {
  const color =
    severity === "Info" ? "bg-[#e3f2fd] text-[#0d47a1]"
    : severity === "Warning" ? "bg-[#fff9c4] text-[#827717]"
    : "bg-[#ffcdd2] text-[#b71c1c]"; // Violation
  return (
    <span className={`inline-block px-2 py-[1px] text-[9px] font-bold rounded ${color}`}>
      {severity}
    </span>
  );
}

function nqmDesignationText(loan: Loan): string {
  switch (loan.nqmProgram) {
    case "BankStatement12":
    case "BankStatement24":
      return "Non-QM: qualified using bank statement deposits (non-standard income documentation)";
    case "DSCR":
      return "Non-QM: qualified using DSCR coverage (no personal income verification)";
    case "AssetDepletion":
      return "Non-QM: qualified using asset depletion methodology";
    case "1099Only":
      return "Non-QM: qualified using 1099 gross income (non-standard income documentation)";
    case "PnL":
      return "Non-QM: qualified using CPA-certified profit & loss statement";
    case "ForeignNational":
      return "Non-QM: foreign national borrower — no US credit history; qualified via DSCR";
    case "ITIN":
      return "Non-QM: ITIN borrower — qualified using alternative credit and bank statement income";
    case "FullDocNonQM":
      return "Non-QM: full documentation borrower with non-qualifying credit event (e.g., recent bankruptcy)";
    default:
      return "Non-QM: loan does not meet standard Qualified Mortgage requirements";
  }
}

export function ComplianceReport({ loan }: Props) {
  const { compliance } = loan;

  return (
    <>
      {/* Status Summary */}
      <div className="enc-sec mb-2">
        <h4>Compliance Status Summary</h4>
        <div className="enc-grid-8">
          <div className="enc-field">
            <span className="enc-label">QM Status</span>
            <span className="enc-value"><QmPill status={compliance.qmStatus} /></span>
          </div>
          <div className="enc-field">
            <span className="enc-label">ATR Compliant</span>
            <span className="enc-value"><BoolPill value={compliance.atrCompliant} /></span>
          </div>
          <div className="enc-field">
            <span className="enc-label">HPML</span>
            <span className="enc-value"><BoolPill value={compliance.hpml} /></span>
          </div>
          <div className="enc-field">
            <span className="enc-label">HOEPA</span>
            <span className="enc-value"><BoolPill value={compliance.hoepa} /></span>
          </div>
          <div className="enc-field">
            <span className="enc-label">State High-Cost</span>
            <span className="enc-value"><TestPill result={compliance.stateHighCostTest} /></span>
          </div>
          <div className="enc-field">
            <span className="enc-label">TRID Tolerance Cure</span>
            <span className="enc-value">{compliance.tridToleranceCure}</span>
          </div>
          <div className="enc-field">
            <span className="enc-label">Points & Fees</span>
            <span className="enc-value">
              {money(compliance.totalPointsAndFees)} / {money(compliance.pointsAndFeesThreshold)}{" "}
              <TestPill result={compliance.pointsAndFeesPass ? "Pass" : "Fail"} />
            </span>
          </div>
          <div className="enc-field">
            <span className="enc-label">Higher-Priced Covered</span>
            <span className="enc-value"><BoolPill value={compliance.higherPricedCoveredTransaction} /></span>
          </div>
          <div className="enc-field">
            <span className="enc-label">State License Reqd</span>
            <span className="enc-value"><BoolPill value={compliance.stateLicenseRequired} /></span>
          </div>
        </div>
      </div>

      {/* Compliance Flags */}
      <div className="enc-sec mb-2">
        <h4>Compliance Flags</h4>
        {compliance.flags.length === 0 ? (
          <p className="text-[10px] px-2 py-1 italic text-[#555]">No compliance flags.</p>
        ) : (
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-gradient-to-b from-[#e2ddc7] to-[#cfc9ae]">
                <th className="px-2 py-[2px] text-left border border-[#aaa] w-6">#</th>
                <th className="px-2 py-[2px] text-left border border-[#aaa]">Code</th>
                <th className="px-2 py-[2px] text-left border border-[#aaa]">Severity</th>
                <th className="px-2 py-[2px] text-left border border-[#aaa]">Description</th>
                <th className="px-2 py-[2px] text-left border border-[#aaa]">Regulation</th>
              </tr>
            </thead>
            <tbody>
              {compliance.flags.map((flag, i) => (
                <tr key={flag.code} className={i % 2 === 0 ? "bg-white" : "bg-[#f5f3ed]"}>
                  <td className="px-2 py-[2px] border border-[#ddd]">{i + 1}</td>
                  <td className="px-2 py-[2px] border border-[#ddd] font-mono">{flag.code}</td>
                  <td className="px-2 py-[2px] border border-[#ddd]"><SeverityPill severity={flag.severity} /></td>
                  <td className="px-2 py-[2px] border border-[#ddd]">{flag.description}</td>
                  <td className="px-2 py-[2px] border border-[#ddd] font-mono text-[9px]">{flag.regulation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* NQM Designation */}
      <div className="enc-sec">
        <h4>NQM Designation</h4>
        <div className="px-2 py-2 text-[10px]">
          <p className="mb-1">
            <span className="font-bold">Program:</span> {loan.nqmProgram}
          </p>
          <p className="mb-1">
            <span className="font-bold">Qualifying Method:</span> {loan.qualifyingMethod}
          </p>
          <p className="text-[#333] leading-relaxed">
            {nqmDesignationText(loan)}
          </p>
        </div>
      </div>
    </>
  );
}
