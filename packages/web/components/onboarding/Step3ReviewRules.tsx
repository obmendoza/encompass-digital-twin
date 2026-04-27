"use client";

import { useState } from "react";

const DISPUTE_POLICIES = [
  { value: "exclude_all", label: "Exclude All Disputes" },
  { value: "exclude_over_500", label: "Exclude Disputes > $500" },
  { value: "case_by_case", label: "Case-by-Case Review" },
  { value: "include_all", label: "Include All (No Exclusion)" },
] as const;

const QUALIFYING_METHODS = [
  { value: "bank_statements", label: "Bank Statements" },
  { value: "1099", label: "1099" },
  { value: "pnl", label: "P&L Statement" },
  { value: "full_doc", label: "Full Documentation" },
  { value: "asset_depletion", label: "Asset Depletion" },
  { value: "dscr", label: "DSCR" },
] as const;

type Confidence = "green" | "yellow" | "red" | "gray";

interface GuidelineField {
  value: string | number | string[];
  confidence: Confidence;
}

interface GuidelineData {
  credit: {
    minFico: GuidelineField;
    maxLate30d: GuidelineField;
    maxLate60d: GuidelineField;
    maxLate90d: GuidelineField;
    disputePolicy: GuidelineField;
  };
  income: {
    maxDtiFront: GuidelineField;
    maxDtiBack: GuidelineField;
    qualifyingMethods: GuidelineField;
  };
  ltv: {
    maxLtv: GuidelineField;
  };
  reserves: {
    minMonths: GuidelineField;
  };
}

export interface Step3Data {
  guidelines: GuidelineData;
  status: "draft" | "approved";
}

interface Step3Props {
  programs: string[];
  onNext: (data: Step3Data) => void;
  onBack: () => void;
}

function ConfidenceDot({ confidence }: { confidence: Confidence }) {
  const colors: Record<Confidence, string> = {
    green: "bg-green-500",
    yellow: "bg-yellow-400",
    red: "bg-red-500",
    gray: "bg-gray-300",
  };

  const labels: Record<Confidence, string> = {
    green: "High confidence",
    yellow: "Medium confidence",
    red: "Low confidence",
    gray: "Not extracted",
  };

  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${colors[confidence]} flex-shrink-0`}
      title={labels[confidence]}
    />
  );
}

function defaultGuidelines(): GuidelineData {
  return {
    credit: {
      minFico: { value: 620, confidence: "gray" },
      maxLate30d: { value: 2, confidence: "gray" },
      maxLate60d: { value: 1, confidence: "gray" },
      maxLate90d: { value: 0, confidence: "gray" },
      disputePolicy: { value: "exclude_over_500", confidence: "gray" },
    },
    income: {
      maxDtiFront: { value: 43, confidence: "gray" },
      maxDtiBack: { value: 50, confidence: "gray" },
      qualifyingMethods: { value: ["bank_statements", "1099"], confidence: "gray" },
    },
    ltv: {
      maxLtv: { value: 80, confidence: "gray" },
    },
    reserves: {
      minMonths: { value: 6, confidence: "gray" },
    },
  };
}

export function Step3ReviewRules({ programs, onNext, onBack }: Step3Props) {
  const [guidelines, setGuidelines] = useState<GuidelineData>(defaultGuidelines);

  const updateField = (
    section: keyof GuidelineData,
    field: string,
    value: string | number | string[],
  ) => {
    setGuidelines((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: { ...(prev[section] as Record<string, GuidelineField>)[field], value },
      },
    }));
  };

  const getConfidence = (section: keyof GuidelineData, field: string): Confidence => {
    return (guidelines[section] as Record<string, GuidelineField>)[field]?.confidence ?? "gray";
  };

  const toggleMethod = (method: string) => {
    const current = guidelines.income.qualifyingMethods.value as string[];
    const updated = current.includes(method)
      ? current.filter((m) => m !== method)
      : [...current, method];
    updateField("income", "qualifyingMethods", updated);
  };

  const handleApprove = () => {
    onNext({ guidelines, status: "approved" });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Review Extracted Rules</h2>
      <p className="text-sm text-gray-500 mb-6">
        Review and adjust guideline parameters for{" "}
        {programs.length > 0
          ? programs.join(", ")
          : "your programs"}
        . Confidence dots indicate AI extraction accuracy.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left side: Document Preview placeholder */}
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center min-h-[500px]">
          <svg
            className="w-16 h-16 text-gray-300 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-sm text-gray-400 font-medium">Document Preview</p>
          <p className="text-xs text-gray-300 mt-1">PDF viewer will render here</p>
        </div>

        {/* Right side: Guideline form */}
        <div className="space-y-6">
          {/* Credit Section */}
          <div>
            <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-3 border-b border-gray-200 pb-2">
              Credit
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
                  <ConfidenceDot confidence={getConfidence("credit", "minFico")} />
                  Min FICO
                </label>
                <input
                  type="number"
                  min={300}
                  max={850}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={guidelines.credit.minFico.value as number}
                  onChange={(e) => updateField("credit", "minFico", parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
                  <ConfidenceDot confidence={getConfidence("credit", "maxLate30d")} />
                  Max 30d Late
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={guidelines.credit.maxLate30d.value as number}
                  onChange={(e) => updateField("credit", "maxLate30d", parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
                  <ConfidenceDot confidence={getConfidence("credit", "maxLate60d")} />
                  Max 60d Late
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={guidelines.credit.maxLate60d.value as number}
                  onChange={(e) => updateField("credit", "maxLate60d", parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
                  <ConfidenceDot confidence={getConfidence("credit", "maxLate90d")} />
                  Max 90d Late
                </label>
                <input
                  type="number"
                  min={0}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={guidelines.credit.maxLate90d.value as number}
                  onChange={(e) => updateField("credit", "maxLate90d", parseInt(e.target.value, 10) || 0)}
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
                <ConfidenceDot confidence={getConfidence("credit", "disputePolicy")} />
                Dispute Policy
              </label>
              <select
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                value={guidelines.credit.disputePolicy.value as string}
                onChange={(e) => updateField("credit", "disputePolicy", e.target.value)}
              >
                {DISPUTE_POLICIES.map((dp) => (
                  <option key={dp.value} value={dp.value}>
                    {dp.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Income Section */}
          <div>
            <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-3 border-b border-gray-200 pb-2">
              Income
            </h3>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
                  <ConfidenceDot confidence={getConfidence("income", "maxDtiFront")} />
                  Max DTI Front (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={guidelines.income.maxDtiFront.value as number}
                  onChange={(e) => updateField("income", "maxDtiFront", parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
                  <ConfidenceDot confidence={getConfidence("income", "maxDtiBack")} />
                  Max DTI Back (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={guidelines.income.maxDtiBack.value as number}
                  onChange={(e) => updateField("income", "maxDtiBack", parseInt(e.target.value, 10) || 0)}
                />
              </div>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-2">
                <ConfidenceDot confidence={getConfidence("income", "qualifyingMethods")} />
                Qualifying Methods
              </label>
              <div className="grid grid-cols-2 gap-2">
                {QUALIFYING_METHODS.map((qm) => (
                  <label
                    key={qm.value}
                    className={`
                      flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer text-sm transition-colors
                      ${(guidelines.income.qualifyingMethods.value as string[]).includes(qm.value)
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 hover:border-gray-300 text-gray-700"
                      }
                    `}
                  >
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={(guidelines.income.qualifyingMethods.value as string[]).includes(qm.value)}
                      onChange={() => toggleMethod(qm.value)}
                    />
                    {qm.label}
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* LTV Section */}
          <div>
            <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-3 border-b border-gray-200 pb-2">
              LTV
            </h3>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
                <ConfidenceDot confidence={getConfidence("ltv", "maxLtv")} />
                Max LTV (%)
              </label>
              <input
                type="number"
                min={0}
                max={100}
                className="w-full max-w-[200px] border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={guidelines.ltv.maxLtv.value as number}
                onChange={(e) => updateField("ltv", "maxLtv", parseInt(e.target.value, 10) || 0)}
              />
            </div>
          </div>

          {/* Reserves Section */}
          <div>
            <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-3 border-b border-gray-200 pb-2">
              Reserves
            </h3>
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1">
                <ConfidenceDot confidence={getConfidence("reserves", "minMonths")} />
                Min Months
              </label>
              <input
                type="number"
                min={0}
                className="w-full max-w-[200px] border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                value={guidelines.reserves.minMonths.value as number}
                onChange={(e) => updateField("reserves", "minMonths", parseInt(e.target.value, 10) || 0)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Extract with AI button */}
      <div className="mt-6">
        <button
          className="px-4 py-2 rounded-md text-sm font-medium bg-gray-100 text-gray-400 cursor-not-allowed"
          disabled
          title="Coming soon"
        >
          Extract with AI (Coming soon)
        </button>
      </div>

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <button
          className="px-5 py-2.5 rounded-md text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          onClick={onBack}
        >
          &larr; Back
        </button>
        <div className="flex gap-3">
          <button
            className="px-5 py-2.5 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            onClick={() => onNext({ guidelines, status: "draft" })}
          >
            Save Draft
          </button>
          <button
            className="px-5 py-2.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-colors"
            onClick={handleApprove}
          >
            Approve Guidelines &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
