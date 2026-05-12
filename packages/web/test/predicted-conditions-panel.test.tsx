import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
};

describe("PredictedConditionsPanel (operator)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders pending list with Accept/Dismiss buttons", () => {
    render(<PredictedConditionsPanel loanId="L-1" predictions={[samplePrediction]} alerts={[]} />);
    expect(screen.getByText("Initial Loan Application (1003)")).toBeInTheDocument();
    expect(screen.getByText("Accept")).toBeInTheDocument();
    // Two "Dismiss" texts exist: the table button and the modal submit (hidden until opened).
    expect(screen.getAllByText("Dismiss").length).toBeGreaterThanOrEqual(1);
  });

  it("renders alert banner with Clear button when an active alert exists", () => {
    render(
      <PredictedConditionsPanel
        loanId="L-1"
        predictions={[]}
        alerts={[{ id: "a-1", error_class: "NoActiveKbVersionError", remediation_hint: "Activate a KB version first", cleared_at: null }]}
      />
    );
    expect(screen.getByText(/Alert: NoActiveKbVersionError/)).toBeInTheDocument();
    expect(screen.getByText(/Activate a KB version first/)).toBeInTheDocument();
    expect(screen.getByText("Clear alert")).toBeInTheDocument();
  });

  it("disables Dismiss submit on short reasons (client-side validation)", () => {
    render(<PredictedConditionsPanel loanId="L-1" predictions={[samplePrediction]} alerts={[]} />);
    // Click the table-row Dismiss button to open the modal.
    const dismissButtons = screen.getAllByText("Dismiss");
    fireEvent.click(dismissButtons[0]!);
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "short" } });
    // After opening the modal there are 2 Dismiss buttons; the submit one is disabled.
    const allDismiss = screen.getAllByText("Dismiss").filter((b) => b.tagName === "BUTTON") as HTMLButtonElement[];
    const submitBtn = allDismiss.find((b) => b.disabled);
    expect(submitBtn).toBeDefined();
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
