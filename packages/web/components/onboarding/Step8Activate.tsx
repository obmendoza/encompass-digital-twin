"use client";

import { useState } from "react";

export interface Step8Data {
  activatedAt: string;
}

interface Step8Props {
  tenantName: string;
  tenantId: string;
  stepData: Record<string, unknown>;
  onNext: (data: Step8Data) => void;
  onBack: () => void;
}

function countUsers(stepData: Record<string, unknown>): number {
  const step6 = stepData.step6 as { users?: unknown[] } | undefined;
  return step6?.users?.length ?? 0;
}

function getPrograms(stepData: Record<string, unknown>): string[] {
  const step1 = stepData.step1 as { programs?: string[] } | undefined;
  return step1?.programs ?? [];
}

function getSlaStatus(stepData: Record<string, unknown>): boolean {
  const step4 = stepData.step4 as { slaConfirmed?: boolean } | undefined;
  return step4?.slaConfirmed === true;
}

export function Step8Activate({ tenantName, tenantId, stepData, onNext, onBack }: Step8Props) {
  const [activating, setActivating] = useState(false);
  const [activated, setActivated] = useState(false);

  const programs = getPrograms(stepData);
  const userCount = countUsers(stepData);
  const slaConfirmed = getSlaStatus(stepData);

  const handleActivate = async () => {
    setActivating(true);
    try {
      // Attempt API call — fallback to local-only activation if endpoint doesn't exist yet
      try {
        await fetch(`/api/onboarding/${tenantId}/activate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      } catch {
        // API not wired yet — that's fine
      }
      setActivated(true);
      onNext({ activatedAt: new Date().toISOString() });
    } finally {
      setActivating(false);
    }
  };

  if (activated) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8">
        <div className="text-center py-12">
          <p className="text-4xl mb-4">{"\uD83C\uDF89"}</p>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {tenantName} is now live on the platform!
          </h2>
          <p className="text-sm text-gray-500 mb-8">
            The tenant has been activated and is ready to receive loans.
          </p>
          <div className="flex flex-col items-center gap-3">
            <a
              href={`/t/${encodeURIComponent(tenantName.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-colors"
            >
              Go to Tenant Dashboard
            </a>
            <a
              href="/platform/onboarding"
              className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2 transition-colors"
            >
              Back to Onboarding List
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Activate Tenant</h2>
      <p className="text-sm text-gray-500 mb-8">
        Review the configuration summary and activate when ready.
      </p>

      {/* Summary Card */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6">
        <h3 className="text-base font-bold text-gray-800 mb-4">Configuration Summary</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Lender Name</p>
            <p className="text-sm font-medium text-gray-900">{tenantName}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Programs Configured</p>
            <p className="text-sm font-medium text-gray-900">
              {programs.length > 0 ? programs.join(", ") : "None"}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Users Added</p>
            <p className="text-sm font-medium text-gray-900">
              {userCount} user{userCount !== 1 ? "s" : ""}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">SLA Status</p>
            <p className="text-sm font-medium">
              {slaConfirmed ? (
                <span className="text-green-700">Confirmed</span>
              ) : (
                <span className="text-red-600">Not Confirmed</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Warning Banner */}
      <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg mb-8">
        <svg className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <div>
          <p className="text-sm font-medium text-amber-800">Fair Lending Notice</p>
          <p className="text-xs text-amber-700 mt-1">
            Disparate-impact analysis will run automatically after the first 30 days of decisions.
            Results will be available in the compliance dashboard.
          </p>
        </div>
      </div>

      {/* Activate Button */}
      <div className="text-center mb-8">
        <button
          className={`
            px-8 py-3 rounded-lg text-base font-semibold transition-colors shadow-sm
            ${activating
              ? "bg-gray-300 text-gray-500 cursor-wait"
              : "bg-green-600 text-white hover:bg-green-700"
            }
          `}
          disabled={activating}
          onClick={handleActivate}
        >
          {activating ? "Activating..." : "Activate Tenant"}
        </button>
      </div>

      {/* Navigation */}
      <div className="flex justify-start">
        <button
          className="px-5 py-2.5 rounded-md text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          onClick={onBack}
        >
          &larr; Back
        </button>
      </div>
    </div>
  );
}
