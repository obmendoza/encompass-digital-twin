"use client";

import { useState, useCallback } from "react";
import { ProgressStepper } from "./ProgressStepper";
import { Step1CreateTenant, type Step1Data } from "./Step1CreateTenant";
import { Step2UploadDocuments, type UploadedDoc } from "./Step2UploadDocuments";
import { Step4ConfigureSettings, type Step4Data } from "./Step4ConfigureSettings";
import { Step3ReviewRules } from "./Step3ReviewRules";
import { Step5SetupIngestion } from "./Step5SetupIngestion";
import { Step6CreateUsers } from "./Step6CreateUsers";
import { Step7GoLiveChecklist } from "./Step7GoLiveChecklist";
import { Step8Activate } from "./Step8Activate";

interface OnboardingSession {
  id: string;
  tenantId: string;
  currentStep: number;
  stepData: Record<string, unknown>;
  version: number;
}

interface TenantInfo {
  id: string;
  name: string;
  slug: string;
  settings?: {
    contact?: { email?: string; phone?: string };
    lenderType?: string;
    programs?: string[];
    sla?: {
      maxQueueTimeMinutes?: number;
      maxProcessingTimeMinutes?: number;
      maxReviewTimeMinutes?: number;
      maxTotalTimeMinutes?: number;
    };
    agentBehavior?: {
      riskTolerance?: "conservative" | "moderate" | "aggressive";
      autoApproveThreshold?: number;
    };
  };
}

interface OnboardingWizardProps {
  session: OnboardingSession;
  tenant: TenantInfo;
}

const STEP_LABELS = [
  "Create",
  "Upload Documents",
  "Review Extractions",
  "Configure Settings",
  "Ingestion Setup",
  "User Management",
  "Go-Live Checklist",
  "Activate",
];

function PlaceholderStep({ stepNumber, label, onBack, onNext }: {
  stepNumber: number;
  label: string;
  onBack?: () => void;
  onNext?: () => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Step {stepNumber}: {label}</h2>
      <div className="mt-4 p-6 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-center">
        <p className="text-gray-400 text-sm">Coming soon</p>
        <p className="text-gray-300 text-xs mt-1">This step will be implemented in a future release.</p>
      </div>
      <div className="flex justify-between mt-6">
        {onBack ? (
          <button
            className="px-5 py-2.5 rounded-md text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition-colors"
            onClick={onBack}
          >
            &larr; Back
          </button>
        ) : (
          <div />
        )}
        {onNext && (
          <button
            className="px-5 py-2.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-colors"
            onClick={onNext}
          >
            Next &rarr;
          </button>
        )}
      </div>
    </div>
  );
}

export function OnboardingWizard({ session, tenant }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(session.currentStep);
  const [version, setVersion] = useState(session.version);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Local accumulator of all step data — starts from server, updated as user progresses
  const [allStepData, setAllStepData] = useState<Record<string, unknown>>(session.stepData ?? {});

  const saveStep = useCallback(
    async (step: number, stepData?: Record<string, unknown>) => {
      setSaving(true);
      setError("");
      try {
        const body: Record<string, unknown> = { currentStep: step };
        if (stepData) body.stepData = stepData;

        const res = await fetch(`/api/onboarding/${session.tenantId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "If-Match": String(version),
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Save failed" }));
          throw new Error(data.error ?? `Save failed (${res.status})`);
        }

        const result = await res.json();
        setVersion(result.version);
        setCurrentStep(step);
        // Update local step data accumulator
        if (stepData) {
          setAllStepData((prev) => ({ ...prev, ...stepData }));
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [session.tenantId, version],
  );

  const goNext = useCallback(
    (stepData?: Record<string, unknown>) => {
      const next = Math.min(currentStep + 1, 8);
      saveStep(next, stepData);
    },
    [currentStep, saveStep],
  );

  const goBack = useCallback(() => {
    const prev = Math.max(currentStep - 1, 1);
    saveStep(prev);
  }, [currentStep, saveStep]);

  // Build initial data for Step 1 from tenant record
  const step1Initial: Partial<Step1Data> = {
    tenantName: tenant.name,
    slug: tenant.slug,
    contactEmail: tenant.settings?.contact?.email ?? "",
    phone: tenant.settings?.contact?.phone ?? "",
    lenderType: tenant.settings?.lenderType ?? "correspondent",
    programs: (tenant.settings?.programs as string[]) ?? [],
  };

  // Build initial data for Step 4
  const step4Initial: Partial<Step4Data> = {
    sla: tenant.settings?.sla ? {
      maxQueueTimeMinutes: tenant.settings.sla.maxQueueTimeMinutes ?? 30,
      maxProcessingTimeMinutes: tenant.settings.sla.maxProcessingTimeMinutes ?? 60,
      maxReviewTimeMinutes: tenant.settings.sla.maxReviewTimeMinutes ?? 120,
      maxTotalTimeMinutes: tenant.settings.sla.maxTotalTimeMinutes ?? 240,
    } : undefined,
    riskTolerance: tenant.settings?.agentBehavior?.riskTolerance,
    autoApproveThreshold: tenant.settings?.agentBehavior?.autoApproveThreshold,
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <Step1CreateTenant
            initialData={step1Initial}
            onNext={(data) => goNext({ step1: data })}
          />
        );
      case 2:
        return (
          <Step2UploadDocuments
            programs={tenant.settings?.programs as string[] ?? []}
            initialDocs={(allStepData?.step2 as { documents?: UploadedDoc[] })?.documents}
            onNext={(data) => goNext({ step2: data })}
            onBack={goBack}
          />
        );
      case 3:
        return (
          <Step3ReviewRules
            programs={tenant.settings?.programs as string[] ?? []}
            onNext={(data) => goNext({ step3: data })}
            onBack={goBack}
          />
        );
      case 4:
        return (
          <Step4ConfigureSettings
            lenderType={tenant.settings?.lenderType}
            initialData={step4Initial}
            onNext={(data) => goNext({ step4: data })}
            onBack={goBack}
          />
        );
      case 5:
        return (
          <Step5SetupIngestion
            onNext={(data) => goNext({ step5: data })}
            onBack={goBack}
          />
        );
      case 6:
        return (
          <Step6CreateUsers
            contactEmail={tenant.settings?.contact?.email}
            onNext={(data) => goNext({ step6: data })}
            onBack={goBack}
          />
        );
      case 7:
        return (
          <Step7GoLiveChecklist
            stepData={allStepData}
            onNext={(data) => goNext({ step7: data })}
            onBack={goBack}
          />
        );
      case 8:
        return (
          <Step8Activate
            tenantName={tenant.name}
            tenantId={session.tenantId}
            tenantSlug={tenant.slug}
            stepData={allStepData}
            onNext={(data) => goNext({ step8: data })}
            onBack={goBack}
          />
        );
      default:
        return (
          <PlaceholderStep
            stepNumber={currentStep}
            label={STEP_LABELS[currentStep - 1] ?? `Step ${currentStep}`}
            onBack={currentStep > 1 ? goBack : undefined}
            onNext={currentStep < 8 ? () => goNext() : undefined}
          />
        );
    }
  };

  return (
    <div>
      <ProgressStepper currentStep={currentStep} />

      {/* Error banner */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Saving indicator */}
      {saving && (
        <div className="mb-4 p-2 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-600 text-center">
          Saving...
        </div>
      )}

      {renderStep()}
    </div>
  );
}
