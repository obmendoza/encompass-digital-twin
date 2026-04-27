"use client";

import { useState, useRef } from "react";

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
  tenantId: string;
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

export function Step3ReviewRules({ programs, tenantId, onNext, onBack }: Step3Props) {
  const [guidelines, setGuidelines] = useState<GuidelineData>(defaultGuidelines);
  const [extracting, setExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState("");
  const [extractionCost, setExtractionCost] = useState<{ tokens: number; cost: number } | null>(null);
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExtract = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset the input so the same file can be re-selected
    e.target.value = "";

    setExtracting(true);
    setExtractionError("");
    setExtractionWarnings([]);

    try {
      // Read file as base64 using FileReader (handles binary data correctly)
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          // Strip the "data:mime;base64," prefix to get raw base64
          const base64Data = dataUrl.split(",")[1] ?? "";
          resolve(base64Data);
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });

      // Call extraction API
      const res = await fetch(`/api/onboarding/${tenantId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentBase64: base64,
          mimeType: file.type || "application/pdf",
          category: "guideline_manual",
          program: programs[0] ?? "BankStatement12",
          fileName: file.name,
        }),
      });

      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error ?? "Extraction failed");
      }

      // Map extracted rules to form fields with confidence
      if (result.extractedRules) {
        mapExtractionToForm(result.extractedRules, result.perFieldConfidence ?? {});
      }

      if (result.warnings && result.warnings.length > 0) {
        setExtractionWarnings(result.warnings);
      }

      if (result.tokensUsed) {
        setExtractionCost({
          tokens: (result.tokensUsed.input ?? 0) + (result.tokensUsed.output ?? 0),
          cost: result.cost ?? 0,
        });
      }
    } catch (err) {
      setExtractionError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  };

  const mapExtractionToForm = (
    rules: Record<string, unknown>,
    confidence: Record<string, number>,
  ) => {
    const toConfidence = (score: number | undefined): Confidence => {
      if (score === undefined) return "gray";
      if (score >= 0.8) return "green";
      if (score >= 0.5) return "yellow";
      return "red";
    };

    setGuidelines((prev) => {
      const next = { ...prev };

      // Credit — processor uses maxLatePayments30/60/90, form uses maxLate30d/60d/90d
      const credit = rules.credit as Record<string, unknown> | undefined;
      if (credit) {
        if (credit.minFico !== undefined) {
          next.credit = { ...next.credit, minFico: { value: Number(credit.minFico), confidence: toConfidence(confidence["credit.minFico"]) } };
        }
        if (credit.maxLatePayments30 !== undefined) {
          next.credit = { ...next.credit, maxLate30d: { value: Number(credit.maxLatePayments30), confidence: toConfidence(confidence["credit.maxLatePayments30"]) } };
        }
        if (credit.maxLatePayments60 !== undefined) {
          next.credit = { ...next.credit, maxLate60d: { value: Number(credit.maxLatePayments60), confidence: toConfidence(confidence["credit.maxLatePayments60"]) } };
        }
        if (credit.maxLatePayments90 !== undefined) {
          next.credit = { ...next.credit, maxLate90d: { value: Number(credit.maxLatePayments90), confidence: toConfidence(confidence["credit.maxLatePayments90"]) } };
        }
      }

      // Income — processor uses methods, form uses qualifyingMethods
      const income = rules.income as Record<string, unknown> | undefined;
      if (income) {
        if (income.methods !== undefined && Array.isArray(income.methods)) {
          // Map processor method names to form values where possible
          const methodMap: Record<string, string> = {
            BankStatementDeposits: "bank_statements",
            "1099Gross": "1099",
            PnLCPACertified: "pnl",
            TraditionalDocs: "full_doc",
            AssetDepletionMonths: "asset_depletion",
            DSCRCoverage: "dscr",
          };
          const mapped = (income.methods as string[])
            .map((m) => methodMap[m] ?? m)
            .filter((m) => QUALIFYING_METHODS.some((qm) => qm.value === m));
          if (mapped.length > 0) {
            next.income = { ...next.income, qualifyingMethods: { value: mapped, confidence: toConfidence(confidence["income.methods"]) } };
          }
        }
      }

      // LTV
      const ltv = rules.ltv as Record<string, unknown> | undefined;
      if (ltv?.maxLtv !== undefined) {
        next.ltv = { ...next.ltv, maxLtv: { value: Number(ltv.maxLtv), confidence: toConfidence(confidence["ltv.maxLtv"]) } };
      }

      // Reserves
      const reserves = rules.reserves as Record<string, unknown> | undefined;
      if (reserves?.minMonths !== undefined) {
        next.reserves = { ...next.reserves, minMonths: { value: Number(reserves.minMonths), confidence: toConfidence(confidence["reserves.minMonths"]) } };
      }

      return next;
    });
  };

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

      {/* Extract with AI */}
      <div className="mt-6">
        {/* Hidden file input for document selection */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className="hidden"
          onChange={handleFileSelected}
        />

        <button
          className={`px-4 py-2.5 rounded-md text-sm font-medium transition-colors ${
            extracting
              ? "bg-blue-100 text-blue-400 cursor-wait"
              : "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
          }`}
          disabled={extracting}
          onClick={handleExtract}
        >
          {extracting ? "Extracting with Claude Vision..." : "Extract with AI"}
        </button>

        {extractionError && (
          <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
            {extractionError}
          </div>
        )}

        {extractionWarnings.length > 0 && (
          <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
            <p className="font-medium mb-1">Warnings:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {extractionWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {extractionCost && (
          <div className="mt-2 p-2 bg-blue-50 border border-blue-100 rounded-md text-xs text-blue-600">
            Extraction used {extractionCost.tokens.toLocaleString()} tokens (~${extractionCost.cost.toFixed(2)})
          </div>
        )}
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
