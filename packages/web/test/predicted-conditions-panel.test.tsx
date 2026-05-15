import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PredictedConditionsPanel } from "@/components/encompass/PredictedConditionsPanel";
import { VAPredictedConditionsPanel } from "@/components/encompass/VAPredictedConditionsPanel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/loan/[loanId]/predictions/actions", () => ({
  actionAcceptPrediction: vi.fn(async () => ({ ok: true, conditionId: "c-1", predictionId: "p-1" })),
  actionDismissPrediction: vi.fn(async () => ({ ok: true, predictionId: "p-1" })),
  actionReopenAndAcceptPrediction: vi.fn(async () => ({ ok: true, conditionId: "c-2", predictionId: "p-d-1" })),
  actionRunPredictions: vi.fn(async () => ({ ok: true, runId: "r-1", predictionCount: 1, alertCount: 0, reused: false })),
  actionClearPredictionAlert: vi.fn(async () => ({ ok: true, alertId: "a-1" })),
}));

// ModeToggle uses next/link — mock it so tests don't need router context.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const samplePrediction = {
  id: "p-1",
  status: "pending" as const,
  description: "Initial Loan Application (1003)",
  category: "PTD",
  note: null,
  source_list: "minimum",
  source_order: 1,
  acted_by: null,
  acted_role: null,
  dismissal_reason: null,
  portal_metadata: null,
  analysis_hash: null,
  superseded_at: null,
  accepted_condition_id: null,
};

describe("PredictedConditionsPanel (operator)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders pending list with Accept/Dismiss buttons", () => {
    render(
      <PredictedConditionsPanel
        loanId="L-1"
        predictions={[samplePrediction]}
        alerts={[]}
        mode="curation"
        filter={null}
        basePath="/test"
        driftData={{ disagreementCount: 0, programs: [] }}
      />
    );
    expect(screen.getByText("Initial Loan Application (1003)")).toBeInTheDocument();
    // GroupedConditionCard renders Accept and Dismiss buttons at group level.
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
  });

  it("renders alert banner with Clear button when an active alert exists", () => {
    render(
      <PredictedConditionsPanel
        loanId="L-1"
        predictions={[]}
        alerts={[{ id: "a-1", error_class: "NoActiveKbVersionError", remediation_hint: "Activate a KB version first", cleared_at: null }]}
        mode="curation"
        filter={null}
        basePath="/test"
        driftData={{ disagreementCount: 0, programs: [] }}
      />
    );
    expect(screen.getByText(/Alert: NoActiveKbVersionError/)).toBeInTheDocument();
    expect(screen.getByText(/Activate a KB version first/)).toBeInTheDocument();
    expect(screen.getByText("Clear alert")).toBeInTheDocument();
  });

  // TODO: The per-row dismiss modal (client-side reason validation) was removed in Task 5.
  // GroupedConditionCard uses a fixed reason ("uw_not_required") for group-level dismissal.
  // This test no longer applies to the current UI surface. Re-add a test for
  // GroupedConditionCard's per-row Drift mode dismiss if that UI path needs coverage.
  it.skip("disables Dismiss submit on short reasons (client-side validation) — removed in Task 5", () => {
    // Panel-level DismissModal was removed; reason validation now lives in GroupedConditionCard (Drift mode).
  });
});

describe("VAPredictedConditionsPanel (VA)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the degraded banner when unavailable=true and hides sections", () => {
    render(<VAPredictedConditionsPanel loanId="L-1" predictions={[]} unavailable={true} />);
    expect(screen.getByText(/Predictions temporarily unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/Pending — operator didn/)).not.toBeInTheDocument();
  });
});
