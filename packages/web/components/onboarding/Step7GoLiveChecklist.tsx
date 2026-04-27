"use client";

export interface Step7Data {
  checkedAt: string;
}

interface Step7Props {
  stepData: Record<string, unknown>;
  onNext: (data: Step7Data) => void;
  onBack: () => void;
}

interface CheckItem {
  label: string;
  passed: boolean;
  required: boolean;
}

function CheckIcon({ passed, required }: { passed: boolean; required: boolean }) {
  if (passed) {
    return (
      <svg className="w-5 h-5 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (required) {
    return (
      <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  // Optional, not done
  return (
    <svg className="w-5 h-5 text-amber-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

function evaluateChecks(stepData: Record<string, unknown>): {
  required: CheckItem[];
  optional: CheckItem[];
} {
  // Check Step 3 - guidelines approved
  // Accept both "approved" status and any step3 data (user clicked Approve or Save Draft)
  const step3 = stepData.step3 as { status?: string } | undefined;
  const guidelinesApproved = !!step3;

  // Check Step 6 - users
  const step6 = stepData.step6 as { users?: { role: string; email: string }[] } | undefined;
  const users = step6?.users ?? [];
  const hasAdmin = users.some((u) => u.role === "admin" && u.email.includes("@"));
  const hasVa = users.some((u) => u.role === "va");
  const hasUw = users.some((u) => u.role === "uw");

  // Check Step 4 - SLA confirmed
  const step4 = stepData.step4 as { slaConfirmed?: boolean } | undefined;
  const slaConfirmed = step4?.slaConfirmed === true;

  // Check Step 5 - API key generated
  const step5 = stepData.step5 as { apiKeyGenerated?: boolean; skipped?: boolean } | undefined;
  const apiKeyGenerated = step5?.apiKeyGenerated === true;

  return {
    required: [
      { label: "At least 1 program has approved guidelines", passed: guidelinesApproved, required: true },
      { label: "At least 1 admin user configured", passed: hasAdmin, required: true },
      { label: "At least 1 VA and 1 UW configured", passed: hasVa && hasUw, required: true },
      { label: "SLA thresholds confirmed", passed: slaConfirmed, required: true },
    ],
    optional: [
      { label: "API key generated for ingestion", passed: apiKeyGenerated, required: false },
      { label: "Test loan suite passed", passed: false, required: false },
    ],
  };
}

export function Step7GoLiveChecklist({ stepData, onNext, onBack }: Step7Props) {
  const { required, optional } = evaluateChecks(stepData);
  const allRequiredPassed = required.every((c) => c.passed);

  const handleNext = () => {
    onNext({ checkedAt: new Date().toISOString() });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Go-Live Checklist</h2>
      <p className="text-sm text-gray-500 mb-8">
        Verify all required configuration is complete before activation.
      </p>

      {/* Debug: show what data the checklist sees */}
      <details className="mb-4 text-xs text-gray-400">
        <summary>Debug: step data received</summary>
        <pre className="bg-gray-100 p-2 rounded mt-1 overflow-auto max-h-40">
          {JSON.stringify(stepData, null, 2)}
        </pre>
      </details>

      {/* Can Activate badge */}
      <div className="mb-8">
        {allRequiredPassed ? (
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-green-100 text-green-800 border border-green-200">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Ready to Activate
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-red-100 text-red-800 border border-red-200">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Cannot Activate &mdash; Required Checks Incomplete
          </span>
        )}
      </div>

      {/* Required Checks */}
      <div className="mb-8">
        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-3">
          Required Checks
        </h3>
        <div className="space-y-3">
          {required.map((check, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 p-3 rounded-md border ${
                check.passed
                  ? "bg-green-50 border-green-200"
                  : "bg-red-50 border-red-200"
              }`}
            >
              <CheckIcon passed={check.passed} required={check.required} />
              <span className={`text-sm ${check.passed ? "text-green-800" : "text-red-800"}`}>
                {check.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Optional Checks */}
      <div className="mb-8">
        <h3 className="text-sm font-bold text-gray-800 uppercase tracking-wider mb-3">
          Optional Checks
        </h3>
        <div className="space-y-3">
          {optional.map((check, i) => (
            <div
              key={i}
              className={`flex items-center gap-3 p-3 rounded-md border ${
                check.passed
                  ? "bg-green-50 border-green-200"
                  : "bg-amber-50 border-amber-200"
              }`}
            >
              <CheckIcon passed={check.passed} required={check.required} />
              <span className={`text-sm ${check.passed ? "text-green-800" : "text-amber-800"}`}>
                {check.label}
              </span>
              {check.label === "Test loan suite passed" && !check.passed && (
                <button
                  className="ml-auto px-3 py-1.5 rounded-md text-xs font-medium bg-gray-100 text-gray-400 cursor-not-allowed"
                  disabled
                  title="Coming soon"
                >
                  Run Test Suite (Coming soon)
                </button>
              )}
            </div>
          ))}
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
            ${allRequiredPassed
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }
          `}
          disabled={!allRequiredPassed}
          onClick={handleNext}
        >
          Next: Activate &rarr;
        </button>
      </div>
    </div>
  );
}
