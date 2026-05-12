"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  actionAcceptPrediction,
  actionDismissPrediction,
  actionReopenAndAcceptPrediction,
} from "@/app/loan/[loanId]/predictions/actions";

interface Prediction {
  id: string;
  status: "pending" | "accepted" | "dismissed";
  description: string;
  category: string;
  note: string | null;
  acted_role: string | null;
  dismissal_reason: string | null;
}

interface Props {
  loanId: string;
  predictions: Prediction[];
  unavailable: boolean;
}

export function VAPredictedConditionsPanel({ loanId, predictions, unavailable }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dismissModal, setDismissModal] = useState<{ predictionId: string } | null>(null);
  const [dismissReason, setDismissReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (unavailable) {
    return (
      <div className="enc-panel mb-3 border-l-4 border-[#8a4b00]">
        <h4 className="text-[12px] font-bold text-[#8a4b00] mb-1">Predicted Conditions</h4>
        <div className="text-[11px]">
          Predictions temporarily unavailable. Refresh to retry. (See server logs for details.
          The VA review can proceed — predictions are auxiliary signal, not a blocker.)
        </div>
      </div>
    );
  }

  const pendingItems = predictions.filter((p) => p.status === "pending");
  const dismissedByOperator = predictions.filter((p) => p.status === "dismissed" && p.acted_role === "operator");
  const acceptedCount = predictions.filter((p) => p.status === "accepted").length;

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

  const handleReopen = (predictionId: string) => {
    if (!confirm("You are overriding the operator's dismissal. Continue?")) return;
    setError(null);
    start(async () => {
      const r = await actionReopenAndAcceptPrediction(loanId, predictionId);
      if (!r.ok) setError(`Reopen failed: ${r.error}`);
      else router.refresh();
    });
  };

  return (
    <div className="enc-panel mb-3">
      <h4 className="text-[12px] font-bold text-[#1a2b4a] mb-2">Predicted Conditions</h4>
      {error && <div className="text-[11px] text-[#c00] mb-2">{error}</div>}

      <div className="text-[11px] font-bold mb-1">
        Pending — operator didn&apos;t act ({pendingItems.length})
      </div>
      {pendingItems.length === 0 ? (
        <div className="text-[10px] text-[#6b7a8f] mb-2">None.</div>
      ) : (
        <table className="w-full border-collapse text-[10px] mb-3">
          <tbody>
            {pendingItems.map((p, i) => (
              <tr key={p.id} className={i % 2 ? "bg-[#f5f3e8]" : ""}>
                <td className="px-2 py-[3px]"><b>[{p.category}]</b></td>
                <td className="px-2 py-[3px]">{p.description}{p.note && <span className="text-[#6b7a8f]"> ({p.note})</span>}</td>
                <td className="px-2 py-[3px] text-right">
                  <button className="enc-btn text-[9px]" disabled={pending} onClick={() => handleAccept(p.id)}>Accept</button>
                  {" "}
                  <button className="enc-btn text-[9px]" disabled={pending} onClick={() => setDismissModal({ predictionId: p.id })}>Dismiss</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="text-[11px] font-bold mb-1">
        Operator dismissed ({dismissedByOperator.length}) — shown for transparency
      </div>
      {dismissedByOperator.length === 0 ? (
        <div className="text-[10px] text-[#6b7a8f] mb-2">None.</div>
      ) : (
        <table className="w-full border-collapse text-[10px] mb-3">
          <tbody>
            {dismissedByOperator.map((p, i) => (
              <tr key={p.id} className={`opacity-60 ${i % 2 ? "bg-[#f5f3e8]" : ""}`}>
                <td className="px-2 py-[3px]"><b>[{p.category}]</b></td>
                <td className="px-2 py-[3px]">
                  {p.description}
                  <div className="text-[9px] text-[#6b7a8f] mt-[2px]">Reason: {p.dismissal_reason}</div>
                </td>
                <td className="px-2 py-[3px] text-right">
                  <button className="enc-btn text-[9px]" disabled={pending} onClick={() => handleReopen(p.id)}>Reopen + Accept</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="text-[10px] text-[#6b7a8f]">
        Operator accepted ({acceptedCount}) — now real conditions; see conditions table for status.
      </div>

      {dismissModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setDismissModal(null)}>
          <div className="bg-white border border-[#6b7a8f] p-4 w-[400px]" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-[12px] font-bold mb-2">Dismiss Prediction</h4>
            <textarea
              className="w-full border border-[#6b7a8f] text-[11px] p-2"
              rows={3}
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              placeholder="Reason (required, at least 10 chars)"
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
