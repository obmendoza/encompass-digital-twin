"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  actionAcceptPrediction,
  actionDismissPrediction,
  actionRunPredictions,
  actionClearPredictionAlert,
} from "@/app/loan/[loanId]/predictions/actions";
import { groupByNormalizedDescription, type Prediction as GroupingPrediction } from "@/lib/prediction-grouping";
import type { PortalMetadata } from "@/lib/prediction-grouping";
import { GroupedConditionCard } from "./GroupedConditionCard";
import { ModeToggle } from "./ModeToggle";
import { EligibilityDriftBanner } from "./EligibilityDriftBanner";

interface Prediction {
  id: string;
  status: "pending" | "accepted" | "dismissed";
  description: string;
  category: string;
  note: string | null;
  source_list: string;
  source_order: number;
  acted_by: string | null;
  acted_role: string | null;
  dismissal_reason: string | null;
  portal_metadata: PortalMetadata | null;
  analysis_hash: string | null;
  superseded_at: string | null;
  accepted_condition_id: string | null;
}

interface Alert {
  id: string;
  error_class: string;
  remediation_hint: string;
  cleared_at: string | null;
}

interface Props {
  loanId: string;
  predictions: Prediction[];
  alerts: Alert[];
  mode: "curation" | "drift";
  filter: "disagreements" | null;
  basePath: string;
  driftData: { disagreementCount: number; programs: Array<{ program: string; portalStatus: string; pcV2Status: string }> };
}

export function PredictedConditionsPanel({ loanId, predictions, alerts, mode, filter, basePath, driftData }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const activeAlerts = alerts.filter((a) => a.cleared_at === null);
  const noKbAlert = activeAlerts.find((a) => a.error_class === "NoActiveKbVersionError");
  const pendingGroups = groupByNormalizedDescription(predictions as GroupingPrediction[]);
  const acceptedItems = predictions.filter((p) => p.status === "accepted");
  const dismissedItems = predictions.filter((p) => p.status === "dismissed");

  const handleRerun = () => {
    start(async () => {
      const r = await actionRunPredictions(loanId);
      if (!r.ok) return;
      router.refresh();
    });
  };

  const handleClearAlert = (alertId: string) => {
    start(async () => {
      const r = await actionClearPredictionAlert(loanId, alertId);
      if (!r.ok) return;
      router.refresh();
    });
  };

  return (
    <div className="enc-panel">
      <h3 className="text-[14px] font-bold text-[#1a2b4a] mb-2">Predicted Conditions</h3>

      {activeAlerts.length > 0 && (
        <div className="mb-3">
          {activeAlerts.map((a) => (
            <div key={a.id} className="p-2 mb-1 bg-[#fff4e0] border border-[#8a4b00] text-[11px]">
              <b className="text-[#8a4b00]">Alert: {a.error_class}</b>
              <div className="mt-1">{a.remediation_hint}</div>
              <button
                className="enc-btn text-[10px] mt-1"
                disabled={pending}
                onClick={() => handleClearAlert(a.id)}
              >
                Clear alert
              </button>
            </div>
          ))}
        </div>
      )}

      <EligibilityDriftBanner
        disagreementCount={driftData.disagreementCount}
        programs={driftData.programs}
        basePath={basePath}
      />
      <ModeToggle currentMode={mode} basePath={basePath} currentFilter={filter} />

      {pendingGroups.length === 0 ? (
        <div className="text-[11px] text-[#6b7a8f]">No pending predictions.</div>
      ) : (
        <>
          <div className="text-[11px] font-bold mb-1">Pending ({pendingGroups.length} group{pendingGroups.length !== 1 ? "s" : ""})</div>
          {pendingGroups.map((group) => (
            <GroupedConditionCard
              key={group.normalizedKey}
              group={group}
              mode={mode}
              onAccept={async (predictionId) => {
                const r = await actionAcceptPrediction(loanId, predictionId);
                router.refresh();
                return r;
              }}
              onDismiss={async (predictionId, reason) => {
                const r = await actionDismissPrediction(loanId, predictionId, reason);
                router.refresh();
                return r;
              }}
            />
          ))}
        </>
      )}

      <div className="mt-3 flex items-center gap-3 text-[10px] text-[#6b7a8f]">
        <span>Accepted ({acceptedItems.length}) · Dismissed ({dismissedItems.length})</span>
        <button
          className="enc-btn text-[9px] ml-auto"
          disabled={pending}
          onClick={handleRerun}
          title={noKbAlert ? "If a KB version was activated since the last attempt, this re-run will succeed and the alert will auto-clear. Otherwise it will produce another alert." : ""}
        >
          {pending ? "Working..." : "Re-run predictions"}
        </button>
      </div>
    </div>
  );
}
