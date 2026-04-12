"use client";

import type { Loan, GuidelineCheck } from "@twin/core";

interface Props {
  loan: Loan;
}

function ResultPill({ result }: { result: GuidelineCheck["result"] }) {
  const color =
    result === "Pass" ? "bg-[#c8e6c9] text-[#1b5e20]"
    : result === "Fail" ? "bg-[#ffcdd2] text-[#b71c1c]"
    : result === "Exception" ? "bg-[#fff9c4] text-[#827717]"
    : "bg-[#eeeeee] text-[#424242]"; // N/A
  return (
    <span className={`inline-block px-2 py-[1px] text-[9px] font-bold rounded ${color}`}>
      {result}
    </span>
  );
}

export function ProgramOverlayReport({ loan }: Props) {
  const { overlay } = loan;
  const { checks } = overlay;

  const passCount = checks.filter((c) => c.result === "Pass").length;
  const failCount = checks.filter((c) => c.result === "Fail").length;
  const exceptionCount = checks.filter((c) => c.result === "Exception").length;

  const summaryColor =
    failCount > 0 ? "text-[#b71c1c]"
    : exceptionCount > 0 ? "text-[#827717]"
    : "text-[#1b5e20]";

  return (
    <>
      {/* Program Summary */}
      <div className="enc-sec mb-2">
        <h4>Program Summary</h4>
        <div className="enc-grid-8">
          <div className="enc-field">
            <span className="enc-label">Program Name</span>
            <span className="enc-value">{overlay.programName}</span>
          </div>
          <div className="enc-field">
            <span className="enc-label">Investor</span>
            <span className="enc-value">{overlay.investorName}</span>
          </div>
          <div className="enc-field">
            <span className="enc-label">Max LTV</span>
            <span className="enc-value">{overlay.maxLTV}%</span>
          </div>
          <div className="enc-field">
            <span className="enc-label">Min FICO</span>
            <span className="enc-value">{overlay.minFICO !== null ? overlay.minFICO : "N/A"}</span>
          </div>
          <div className="enc-field">
            <span className="enc-label">Max DTI</span>
            <span className="enc-value">{overlay.maxDTI !== null ? `${overlay.maxDTI}%` : "N/A"}</span>
          </div>
          <div className="enc-field">
            <span className="enc-label">Min DSCR</span>
            <span className="enc-value">{overlay.minDSCR !== null ? overlay.minDSCR : "N/A"}</span>
          </div>
          <div className="enc-field">
            <span className="enc-label">Min Reserves</span>
            <span className="enc-value">{overlay.minReserves} mo</span>
          </div>
          <div className="enc-field">
            <span className="enc-label">Overall</span>
            <span className="enc-value">{passCount}/{checks.length} Pass</span>
          </div>
        </div>
      </div>

      {/* Guideline Checks Table */}
      <div className="enc-sec mb-2">
        <h4>Guideline Checks</h4>
        {checks.length === 0 ? (
          <p className="text-[10px] px-2 py-1 italic text-[#555]">No guideline checks defined.</p>
        ) : (
          <>
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="bg-gradient-to-b from-[#e2ddc7] to-[#cfc9ae]">
                  <th className="px-2 py-[2px] text-left border border-[#aaa] w-6">#</th>
                  <th className="px-2 py-[2px] text-left border border-[#aaa]">Category</th>
                  <th className="px-2 py-[2px] text-left border border-[#aaa]">Rule</th>
                  <th className="px-2 py-[2px] text-left border border-[#aaa]">Threshold</th>
                  <th className="px-2 py-[2px] text-left border border-[#aaa]">Actual</th>
                  <th className="px-2 py-[2px] text-left border border-[#aaa]">Result</th>
                  <th className="px-2 py-[2px] text-left border border-[#aaa]">Notes</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((check, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[#f5f3ed]"}>
                    <td className="px-2 py-[2px] border border-[#ddd]">{i + 1}</td>
                    <td className="px-2 py-[2px] border border-[#ddd]">{check.category}</td>
                    <td className="px-2 py-[2px] border border-[#ddd]">{check.rule}</td>
                    <td className="px-2 py-[2px] border border-[#ddd]">{check.threshold}</td>
                    <td className="px-2 py-[2px] border border-[#ddd]">{check.actual}</td>
                    <td className="px-2 py-[2px] border border-[#ddd]"><ResultPill result={check.result} /></td>
                    <td className="px-2 py-[2px] border border-[#ddd] text-[#555] italic">{check.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={`text-[10px] px-2 py-[3px] font-semibold ${summaryColor}`}>
              {passCount} of {checks.length} guidelines pass.{" "}
              {exceptionCount > 0 ? `${exceptionCount} exception${exceptionCount > 1 ? "s" : ""} require conditions/waivers.` : ""}
            </p>
          </>
        )}
      </div>
    </>
  );
}
