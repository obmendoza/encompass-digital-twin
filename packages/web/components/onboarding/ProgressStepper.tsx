"use client";

const STEPS = [
  "Create",
  "Upload",
  "Review",
  "Configure",
  "Ingestion",
  "Users",
  "Checklist",
  "Activate",
] as const;

interface ProgressStepperProps {
  currentStep: number; // 1-based
}

export function ProgressStepper({ currentStep }: ProgressStepperProps) {
  return (
    <div className="w-full py-6 px-4">
      <div className="flex items-center justify-between">
        {STEPS.map((label, i) => {
          const stepNum = i + 1;
          const isComplete = stepNum < currentStep;
          const isActive = stepNum === currentStep;

          return (
            <div key={label} className="flex items-center flex-1 last:flex-none">
              {/* Step circle + label */}
              <div className="flex flex-col items-center">
                <div
                  className={`
                    w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold
                    transition-colors duration-200
                    ${isComplete ? "bg-emerald-500 text-white" : ""}
                    ${isActive ? "bg-blue-600 text-white ring-4 ring-blue-100" : ""}
                    ${!isComplete && !isActive ? "bg-gray-200 text-gray-400" : ""}
                  `}
                >
                  {isComplete ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    stepNum
                  )}
                </div>
                <span
                  className={`
                    mt-2 text-xs font-medium whitespace-nowrap
                    ${isComplete ? "text-emerald-600" : ""}
                    ${isActive ? "text-blue-600 font-bold" : ""}
                    ${!isComplete && !isActive ? "text-gray-400" : ""}
                  `}
                >
                  {label}
                </span>
              </div>

              {/* Connecting line */}
              {i < STEPS.length - 1 && (
                <div className="flex-1 mx-2 mt-[-1.25rem]">
                  <div
                    className={`h-0.5 w-full transition-colors duration-200 ${
                      stepNum < currentStep ? "bg-emerald-500" : "bg-gray-200"
                    }`}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
