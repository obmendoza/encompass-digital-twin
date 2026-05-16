import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GroupedConditionCard } from "@/components/encompass/GroupedConditionCard";
import type { PredictionGroup } from "@/lib/prediction-grouping";

afterEach(() => cleanup());

const baseRow = {
  id: "p1",
  status: "pending" as const,
  description: "Hazard Insurance: Loss payee clause does not match required text",
  category: "PTD",
  note: null,
  source_list: "hoi-validator",
  source_order: 0,
  acted_by: null,
  acted_role: null,
  dismissal_reason: null,
  accepted_condition_id: null,
  analysis_hash: null,
  superseded_at: null,
  portal_metadata: {
    validationFindings: [
      {
        ruleId: "hoi.loss-payee.match",
        severity: "fail" as const,
        currentValue: "Wrong Lender LLC",
        expectedValue: "NQM Funding, LLC (with loan number X)",
        evidence: {
          documentId: "00000000-0000-0000-0000-000000000001",
          extractionId: "00000000-0000-0000-0000-000000000002",
          fieldPath: "lossPayeeClause",
          documentPage: 1,
        },
      },
    ],
    extractionId: "00000000-0000-0000-0000-000000000002",
  },
};

const mkGroup = (rowOverrides: Partial<typeof baseRow> = {}): PredictionGroup => {
  const row = { ...baseRow, ...rowOverrides };
  return {
    normalizedKey: "test-key",
    displayDescription: "Property: Hazard Insurance (TPO)",
    primarySource: "hoi-validator" as PredictionGroup["primarySource"],
    rows: [row],
    portalRow: undefined,
    pcV2Rows: [row],
    hasMultipleSources: false,
  };
};

describe("GroupedConditionCard — validation findings", () => {
  test("renders fail badge + ruleId when portal_metadata.validationFindings has a fail finding", () => {
    const onAccept = vi.fn(async () => ({ ok: true as const }));
    const onDismiss = vi.fn(async () => ({ ok: true as const }));
    render(
      <GroupedConditionCard
        group={mkGroup()}
        mode="curation"
        driftProgram={null}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />
    );
    expect(screen.getByText(/Validation findings/i)).toBeTruthy();
    expect(screen.getByText("FAIL")).toBeTruthy();
    expect(screen.getByText(/hoi\.loss-payee\.match/)).toBeTruthy();
  });

  test("renders warn badge when severity is warn", () => {
    const onAccept = vi.fn(async () => ({ ok: true as const }));
    const onDismiss = vi.fn(async () => ({ ok: true as const }));
    render(
      <GroupedConditionCard
        group={mkGroup({
          portal_metadata: {
            validationFindings: [
              {
                ...baseRow.portal_metadata.validationFindings[0],
                severity: "warn" as const,
              },
            ],
            extractionId: "00000000-0000-0000-0000-000000000002",
          },
        })}
        mode="curation"
        driftProgram={null}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />
    );
    expect(screen.getByText("WARN")).toBeTruthy();
  });

  test("does NOT render the section when no rows have validationFindings", () => {
    const onAccept = vi.fn(async () => ({ ok: true as const }));
    const onDismiss = vi.fn(async () => ({ ok: true as const }));
    render(
      <GroupedConditionCard
        group={mkGroup({
          portal_metadata: { priority: "P0" as const },
        })}
        mode="curation"
        driftProgram={null}
        onAccept={onAccept}
        onDismiss={onDismiss}
      />
    );
    expect(screen.queryByText(/Validation findings/i)).toBeNull();
  });
});
