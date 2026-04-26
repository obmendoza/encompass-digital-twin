"use client";

import { useState, useEffect } from "react";

const SLA_PRESETS: Record<string, { queue: number; processing: number; review: number; total: number }> = {
  correspondent: { queue: 30, processing: 60, review: 120, total: 240 },
  wholesale: { queue: 45, processing: 90, review: 180, total: 360 },
  retail: { queue: 60, processing: 120, review: 240, total: 480 },
  direct: { queue: 30, processing: 45, review: 90, total: 180 },
};

const RISK_TOLERANCE_OPTIONS = [
  { value: "conservative", label: "Conservative -- stricter agent decisions" },
  { value: "moderate", label: "Moderate -- balanced approach" },
  { value: "aggressive", label: "Aggressive -- more auto-approvals" },
] as const;

export interface Step4Data {
  sla: {
    maxQueueTimeMinutes: number;
    maxProcessingTimeMinutes: number;
    maxReviewTimeMinutes: number;
    maxTotalTimeMinutes: number;
  };
  slaConfirmed: boolean;
  riskTolerance: "conservative" | "moderate" | "aggressive";
  autoApproveThreshold: number;
}

interface Step4Props {
  lenderType?: string;
  initialData?: Partial<Step4Data>;
  onNext: (data: Step4Data) => void;
  onBack: () => void;
}

export function Step4ConfigureSettings({ lenderType, initialData, onNext, onBack }: Step4Props) {
  const preset = SLA_PRESETS[lenderType ?? "correspondent"] ?? SLA_PRESETS.correspondent;

  const [queue, setQueue] = useState(initialData?.sla?.maxQueueTimeMinutes ?? preset.queue);
  const [processing, setProcessing] = useState(initialData?.sla?.maxProcessingTimeMinutes ?? preset.processing);
  const [review, setReview] = useState(initialData?.sla?.maxReviewTimeMinutes ?? preset.review);
  const [total, setTotal] = useState(initialData?.sla?.maxTotalTimeMinutes ?? preset.total);
  const [slaConfirmed, setSlaConfirmed] = useState(initialData?.slaConfirmed ?? false);

  const [riskTolerance, setRiskTolerance] = useState<"conservative" | "moderate" | "aggressive">(
    initialData?.riskTolerance ?? "moderate",
  );
  const [autoApproveThreshold, setAutoApproveThreshold] = useState(
    initialData?.autoApproveThreshold ?? 0.85,
  );

  // Apply preset when lender type changes (only if no initial data)
  useEffect(() => {
    if (!initialData?.sla) {
      const p = SLA_PRESETS[lenderType ?? "correspondent"] ?? SLA_PRESETS.correspondent;
      setQueue(p.queue);
      setProcessing(p.processing);
      setReview(p.review);
      setTotal(p.total);
    }
  }, [lenderType]); // eslint-disable-line react-hooks/exhaustive-deps

  const isValid = slaConfirmed;

  const handleSubmit = () => {
    if (!isValid) return;
    onNext({
      sla: {
        maxQueueTimeMinutes: queue,
        maxProcessingTimeMinutes: processing,
        maxReviewTimeMinutes: review,
        maxTotalTimeMinutes: total,
      },
      slaConfirmed,
      riskTolerance,
      autoApproveThreshold,
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Configure Settings</h2>
      <p className="text-sm text-gray-500 mb-6">
        Set SLA targets and agent behavior for this lender.
      </p>

      {/* SLA Section */}
      <div className="mb-8">
        <h3 className="text-base font-bold text-gray-800 mb-1">SLA Targets</h3>
        <p className="text-xs text-gray-500 mb-4">
          Pre-filled from <span className="font-medium text-gray-700">{lenderType ?? "correspondent"}</span> defaults.
          Adjust as needed.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Queue (min)</label>
            <input
              type="number"
              min={1}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={queue}
              onChange={(e) => setQueue(parseInt(e.target.value, 10) || 1)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Processing (min)</label>
            <input
              type="number"
              min={1}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={processing}
              onChange={(e) => setProcessing(parseInt(e.target.value, 10) || 1)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Review (min)</label>
            <input
              type="number"
              min={1}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={review}
              onChange={(e) => setReview(parseInt(e.target.value, 10) || 1)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Total (min)</label>
            <input
              type="number"
              min={1}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={total}
              onChange={(e) => setTotal(parseInt(e.target.value, 10) || 1)}
            />
          </div>
        </div>

        {/* Confirmation checkbox */}
        <label className="flex items-start gap-3 p-3 border border-gray-200 rounded-md bg-gray-50 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            checked={slaConfirmed}
            onChange={(e) => setSlaConfirmed(e.target.checked)}
          />
          <span className="text-sm text-gray-700">
            I have confirmed these SLA values with the lender
            <span className="text-red-500 ml-0.5">*</span>
          </span>
        </label>
      </div>

      {/* Agent Behavior Section */}
      <div className="mb-8">
        <h3 className="text-base font-bold text-gray-800 mb-1">Agent Behavior</h3>
        <p className="text-xs text-gray-500 mb-4">
          Configure how the AI underwriting agent handles this lender&apos;s loans.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Risk Tolerance</label>
            <select
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              value={riskTolerance}
              onChange={(e) => setRiskTolerance(e.target.value as typeof riskTolerance)}
            >
              {RISK_TOLERANCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Auto-Approve Threshold
              <span className="ml-2 text-blue-600 font-bold">
                {Math.round(autoApproveThreshold * 100)}%
              </span>
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              value={Math.round(autoApproveThreshold * 100)}
              onChange={(e) => setAutoApproveThreshold(parseInt(e.target.value, 10) / 100)}
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>0% (none)</span>
              <span>100% (all)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          className="px-5 py-2.5 rounded-md text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          onClick={onBack}
        >
          &larr; Back
        </button>
        <button
          className={`
            px-5 py-2.5 rounded-md text-sm font-medium transition-colors
            ${isValid
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }
          `}
          disabled={!isValid}
          onClick={handleSubmit}
        >
          Next: Ingestion Setup &rarr;
        </button>
      </div>
    </div>
  );
}
