"use client";
import { useState } from "react";

interface MatrixTier {
  id: string;
  program: string;
  occupancy: string;
  min_fico: number;
  max_fico: number;
  max_loan_amount: number;
  max_ltv_purchase: number;
  max_ltv_cashout: number;
  max_ltv_rate_term: number;
  property_types: string[];
  source_page: number;
  extraction_confidence: number;
}

interface TabProgramMatrixProps {
  tiers: MatrixTier[];
  programs: string[];
  onEdit?: (tierId: string, field: string, value: unknown) => void;
}

function ConfidenceDot({ value }: { value: number }) {
  const color =
    value >= 0.8
      ? "bg-green-500"
      : value >= 0.5
        ? "bg-yellow-400"
        : "bg-red-500";
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color}`}
      title={`${(value * 100).toFixed(0)}%`}
    />
  );
}

function fmtDollar(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  return "$" + n.toLocaleString();
}

function fmtPct(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  return `${n}%`;
}

export function TabProgramMatrix({ tiers, programs, onEdit }: TabProgramMatrixProps) {
  const [selectedProgram, setSelectedProgram] = useState<string>(
    programs[0] ?? ""
  );

  const filteredTiers = tiers.filter((t) => t.program === selectedProgram);

  // Group by occupancy
  const occupancyGroups = filteredTiers.reduce<Record<string, MatrixTier[]>>(
    (acc, tier) => {
      const key = tier.occupancy ?? "unknown";
      if (!acc[key]) acc[key] = [];
      acc[key].push(tier);
      return acc;
    },
    {}
  );

  // Sort tiers within each group by min_fico ascending
  for (const key of Object.keys(occupancyGroups)) {
    occupancyGroups[key].sort((a, b) => a.min_fico - b.min_fico);
  }

  return (
    <div className="space-y-4">
      {/* Program selector */}
      {programs.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {programs.map((prog) => (
            <button
              key={prog}
              type="button"
              onClick={() => setSelectedProgram(prog)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                selectedProgram === prog
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              {prog}
            </button>
          ))}
        </div>
      )}

      {/* No data */}
      {Object.keys(occupancyGroups).length === 0 && (
        <p className="text-xs text-gray-400">No tiers found for this program.</p>
      )}

      {/* Per-occupancy tables */}
      {Object.entries(occupancyGroups).map(([occupancy, rows]) => (
        <div key={occupancy} className="space-y-1">
          <p className="text-xs font-semibold capitalize text-gray-600">
            {occupancy}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border border-gray-200 text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="border-b border-gray-200 px-2 py-1.5 font-medium">
                    FICO Range
                  </th>
                  <th className="border-b border-gray-200 px-2 py-1.5 font-medium">
                    Max Loan
                  </th>
                  <th className="border-b border-gray-200 px-2 py-1.5 font-medium">
                    Purchase LTV
                  </th>
                  <th className="border-b border-gray-200 px-2 py-1.5 font-medium">
                    R/T LTV
                  </th>
                  <th className="border-b border-gray-200 px-2 py-1.5 font-medium">
                    Cash-Out LTV
                  </th>
                  <th className="border-b border-gray-200 px-2 py-1.5 font-medium">
                    Confidence
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((tier) => (
                  <tr
                    key={tier.id}
                    className="cursor-default hover:bg-blue-50"
                    onClick={() => {
                      // row click — placeholder for future onEdit wiring
                    }}
                  >
                    <td className="border-b border-gray-100 px-2 py-1.5 tabular-nums">
                      {tier.min_fico ?? "—"}–{tier.max_fico ?? "—"}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-1.5 tabular-nums">
                      {fmtDollar(tier.max_loan_amount)}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-1.5 tabular-nums">
                      {fmtPct(tier.max_ltv_purchase)}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-1.5 tabular-nums">
                      {fmtPct(tier.max_ltv_rate_term)}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-1.5 tabular-nums">
                      {fmtPct(tier.max_ltv_cashout)}
                    </td>
                    <td className="border-b border-gray-100 px-2 py-1.5">
                      <ConfidenceDot value={tier.extraction_confidence} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
