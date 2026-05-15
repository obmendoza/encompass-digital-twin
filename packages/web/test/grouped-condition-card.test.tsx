import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { GroupedConditionCard } from "@/components/encompass/GroupedConditionCard";
import type { PredictionGroup } from "@/lib/prediction-grouping";

afterEach(() => cleanup());

const mkGroup = (overrides: Partial<PredictionGroup> = {}): PredictionGroup => {
  const g: PredictionGroup = {
    normalizedKey: "creditreport",
    displayDescription: "Credit Report",
    primarySource: "portal-llm",
    rows: [
      {
        id: "p1", status: "pending", description: "Credit Report", category: "PTA",
        note: null, source_list: "portal-llm", source_order: 0,
        acted_by: null, acted_role: null, dismissal_reason: null, accepted_condition_id: null,
        portal_metadata: { priority: "P0", severity: "SOFT-STOP", document_category: "Credit", specifications: ["Tri-merge"], reasons_needed: ["FICO validation"] },
        analysis_hash: "h1", superseded_at: null,
      },
      {
        id: "m1", status: "pending", description: "credit report", category: "PTA",
        note: null, source_list: "matrix", source_order: 0,
        acted_by: null, acted_role: null, dismissal_reason: null, accepted_condition_id: null,
        portal_metadata: null, analysis_hash: null, superseded_at: null,
      },
    ],
    portalRow: undefined,
    pcV2Rows: [],
    hasMultipleSources: true,
    ...overrides,
  };
  g.portalRow = g.rows.find((r) => r.source_list === "portal-llm");
  g.pcV2Rows = g.rows.filter((r) => r.source_list !== "portal-llm");
  return g;
};

describe("GroupedConditionCard — Curation mode", () => {
  let onAccept: ReturnType<typeof vi.fn>;
  let onDismiss: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    onAccept = vi.fn(async () => ({ ok: true }));
    onDismiss = vi.fn(async () => ({ ok: true }));
  });

  it("renders portal description and source badges", () => {
    render(<GroupedConditionCard group={mkGroup()} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    expect(screen.getByText("Credit Report")).toBeInTheDocument();
    expect(screen.getByText(/P0/)).toBeInTheDocument();
    expect(screen.getByText(/SOFT-STOP/)).toBeInTheDocument();
  });

  it("hides per-row controls in Curation mode", () => {
    render(<GroupedConditionCard group={mkGroup()} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    expect(screen.queryByRole("button", { name: /Accept matrix row/i })).not.toBeInTheDocument();
  });

  it("group-level Accept calls onAccept on portal row then onDismiss on each PC v2 row", async () => {
    render(<GroupedConditionCard group={mkGroup()} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /^Accept$/ }));
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith("m1", "duplicate_of_portal"));
  });
});

describe("GroupedConditionCard — Drift mode", () => {
  it("shows per-row Accept/Dismiss buttons on each side", () => {
    const onAccept = vi.fn(async () => ({ ok: true }));
    const onDismiss = vi.fn(async () => ({ ok: true }));
    render(<GroupedConditionCard group={mkGroup()} mode="drift" onAccept={onAccept} onDismiss={onDismiss} />);
    expect(screen.getByRole("button", { name: /Accept portal-llm row/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Accept matrix row/i })).toBeInTheDocument();
  });

  it("renders drift chip with program details when driftProgram is provided", () => {
    const onAccept = vi.fn(async () => ({ ok: true }));
    const onDismiss = vi.fn(async () => ({ ok: true }));
    const driftProgram = { program: "Investor DSCR", portalStatus: "PASS", pcV2Status: "FAIL" };
    render(
      <GroupedConditionCard
        group={mkGroup()}
        mode="drift"
        driftProgram={driftProgram}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />
    );
    expect(screen.getByTestId("drift-chip")).toBeInTheDocument();
    expect(screen.getByText(/Drift: Investor DSCR \(Portal PASS, PC v2 FAIL\)/)).toBeInTheDocument();
  });

  it("does not render drift chip in curation mode even when driftProgram is provided", () => {
    const onAccept = vi.fn(async () => ({ ok: true }));
    const onDismiss = vi.fn(async () => ({ ok: true }));
    const driftProgram = { program: "Investor DSCR", portalStatus: "PASS", pcV2Status: "FAIL" };
    render(
      <GroupedConditionCard
        group={mkGroup()}
        mode="curation"
        driftProgram={driftProgram}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />
    );
    expect(screen.queryByTestId("drift-chip")).not.toBeInTheDocument();
  });

  it("does not render drift chip in drift mode when driftProgram is null", () => {
    const onAccept = vi.fn(async () => ({ ok: true }));
    const onDismiss = vi.fn(async () => ({ ok: true }));
    render(
      <GroupedConditionCard
        group={mkGroup()}
        mode="drift"
        driftProgram={null}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />
    );
    expect(screen.queryByTestId("drift-chip")).not.toBeInTheDocument();
  });
});

describe("GroupedConditionCard — dismiss reason picker (I1+I2)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls onDismiss with operator-supplied reason when prompt returns a valid string", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("borrower exempt from requirement");
    const onAccept = vi.fn(async () => ({ ok: true }));
    const onDismiss = vi.fn(async () => ({ ok: true }));
    render(<GroupedConditionCard group={mkGroup()} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss$/ }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledWith("p1", "borrower exempt from requirement"));
  });

  it("does not call onDismiss when operator cancels prompt (null)", async () => {
    vi.spyOn(window, "prompt").mockReturnValue(null);
    const onAccept = vi.fn(async () => ({ ok: true }));
    const onDismiss = vi.fn(async () => ({ ok: true }));
    render(<GroupedConditionCard group={mkGroup()} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss$/ }));
    await new Promise((r) => setTimeout(r, 50));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("does not call onDismiss when reason is too short (< 10 chars)", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("no");
    vi.spyOn(window, "alert").mockImplementation(() => {});
    const onAccept = vi.fn(async () => ({ ok: true }));
    const onDismiss = vi.fn(async () => ({ ok: true }));
    render(<GroupedConditionCard group={mkGroup()} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /^Dismiss$/ }));
    await new Promise((r) => setTimeout(r, 50));
    expect(onDismiss).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalled();
  });
});

describe("GroupedConditionCard — partial-failure recovery (Spec 1.5-UI §5.1.1)", () => {
  it("renders cleanup-failure banner when a dismiss-as-duplicate fails", async () => {
    const onAccept = vi.fn(async () => ({ ok: true }));
    const onDismiss = vi.fn(async () => ({ ok: false, error: "advisory_lock_contention" }));
    render(<GroupedConditionCard group={mkGroup()} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /^Accept$/ }));
    await waitFor(() => expect(screen.getByText(/cleanup incomplete/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Retry cleanup/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Dismiss as-is/i })).toBeInTheDocument();
  });

  it("Retry cleanup re-issues the failed dismiss calls", async () => {
    const onAccept = vi.fn(async () => ({ ok: true }));
    let dismissCalls = 0;
    const onDismiss = vi.fn(async () => {
      dismissCalls++;
      return dismissCalls === 1 ? { ok: false, error: "transient" } : { ok: true };
    });
    render(<GroupedConditionCard group={mkGroup()} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /^Accept$/ }));
    await waitFor(() => screen.getByRole("button", { name: /Retry cleanup/i }));
    fireEvent.click(screen.getByRole("button", { name: /Retry cleanup/i }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(2));
  });

  it("aria-busy is set during the transition", async () => {
    const onAccept = vi.fn(() => new Promise<{ ok: boolean }>((r) => setTimeout(() => r({ ok: true }), 50)));
    const onDismiss = vi.fn(async () => ({ ok: true }));
    render(<GroupedConditionCard group={mkGroup()} mode="curation" onAccept={onAccept} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /^Accept$/ }));
    const card = screen.getByTestId("grouped-condition-card");
    expect(card.getAttribute("aria-busy")).toBe("true");
    await waitFor(() => expect(card.getAttribute("aria-busy")).toBe("false"), { timeout: 500 });
  });
});
