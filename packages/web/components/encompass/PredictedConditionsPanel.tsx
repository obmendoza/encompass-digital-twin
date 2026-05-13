"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  actionAcceptPrediction,
  actionDismissPrediction,
  actionRunPredictions,
  actionClearPredictionAlert,
} from "@/app/loan/[loanId]/predictions/actions";

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
}

export function PredictedConditionsPanel({ loanId, predictions, alerts }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dismissModal, setDismissModal] = useState<{ predictionId: string } | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeAlerts = alerts.filter((a) => a.cleared_at === null);
  const noKbAlert = activeAlerts.find((a) => a.error_class === "NoActiveKbVersionError");
  const pendingItems = predictions.filter((p) => p.status === "pending");
  const acceptedCount = predictions.filter((p) => p.status === "accepted").length;
  const dismissedCount = predictions.filter((p) => p.status === "dismissed").length;

  const handleAccept = (predictionId: string) => {
    setError(null);
    start(async () => {
      const r = await actionAcceptPrediction(loanId, predictionId);
      if (!r.ok) setError(`Accept failed: ${r.error}`);
      else router.refresh();
    });
  };

  const handleDismissSubmit = () => {
    if (!dismissModal) return;
    if (dismissReason.trim().length < 10) {
      setError("Dismissal reason must be at least 10 characters.");
      return;
    }
    const predictionId = dismissModal.predictionId;
    const reason = dismissReason.trim();
    setError(null);
    start(async () => {
      const r = await actionDismissPrediction(loanId, predictionId, reason);
      if (!r.ok) setError(`Dismiss failed: ${r.error}`);
      else {
        setDismissModal(null);
        setDismissReason("");
        router.refresh();
      }
    });
  };

  const handleRerun = () => {
    setError(null);
    start(async () => {
      const r = await actionRunPredictions(loanId);
      if (!r.ok) setError(`Re-run failed: ${r.error}`);
      else router.refresh();
    });
  };

  const handleClearAlert = (alertId: string) => {
    setError(null);
    start(async () => {
      const r = await actionClearPredictionAlert(loanId, alertId);
      if (!r.ok) setError(`Clear failed: ${r.error}`);
      else router.refresh();
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

      {error && <div className="text-[11px] text-[#c00] mb-2">{error}</div>}

      {pendingItems.length === 0 ? (
        <div className="text-[11px] text-[#6b7a8f]">No pending predictions.</div>
      ) : (
        <>
          <div className="text-[11px] font-bold mb-1">Pending ({pendingItems.length})</div>
          <table className="w-full border-collapse text-[10px]">
            <tbody>
              {pendingItems.map((p, i) => (
                <tr key={p.id} className={i % 2 ? "bg-[#f5f3e8]" : ""}>
                  <td className="px-2 py-[3px]"><b>[{p.category}]</b></td>
                  <td className="px-2 py-[3px]">
                    {p.description}
                    {p.note && <span className="text-[#6b7a8f]"> ({p.note})</span>}
                  </td>
                  <td className="px-2 py-[3px] text-right">
                    <button className="enc-btn text-[9px]" disabled={pending} onClick={() => handleAccept(p.id)}>
                      Accept
                    </button>
                    {" "}
                    <button className="enc-btn text-[9px]" disabled={pending} onClick={() => setDismissModal({ predictionId: p.id })}>
                      Dismiss
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="mt-3 flex items-center gap-3 text-[10px] text-[#6b7a8f]">
        <span>Accepted ({acceptedCount}) · Dismissed ({dismissedCount})</span>
        <button
          className="enc-btn text-[9px] ml-auto"
          disabled={pending}
          onClick={handleRerun}
          title={noKbAlert ? "If a KB version was activated since the last attempt, this re-run will succeed and the alert will auto-clear. Otherwise it will produce another alert." : ""}
        >
          {pending ? "Working..." : "Re-run predictions"}
        </button>
      </div>

      {dismissModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setDismissModal(null)}>
          <div className="bg-white border border-[#6b7a8f] p-4 w-[400px]" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-[12px] font-bold mb-2">Dismiss Prediction</h4>
            <p className="text-[10px] text-[#404040] mb-2">Reason (required, at least 10 chars):</p>
            <textarea
              className="w-full border border-[#6b7a8f] text-[11px] p-2"
              rows={3}
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
            />
            <div className="mt-2 flex justify-end gap-2">
              <button className="enc-btn text-[10px]" onClick={() => setDismissModal(null)}>Cancel</button>
              <button
                className="enc-btn enc-btn--primary text-[10px]"
                disabled={pending || dismissReason.trim().length < 10}
                onClick={handleDismissSubmit}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
