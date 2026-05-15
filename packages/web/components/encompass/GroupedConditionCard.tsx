"use client";
import { useState, useTransition } from "react";
import type { PredictionGroup, PortalMetadata, Prediction, DriftProgram } from "@/lib/prediction-grouping";

type ActionResult = { ok: true } | { ok: false; error?: string };

interface Props {
  group: PredictionGroup;
  mode: "curation" | "drift";
  driftProgram?: DriftProgram | null;
  onAccept: (predictionId: string) => Promise<ActionResult>;
  onDismiss: (predictionId: string, reason: string) => Promise<ActionResult>;
}

function promptForDismissReason(): string | null {
  if (typeof window === "undefined") return "uw_not_required"; // SSR fallback
  const r = window.prompt("Dismiss reason (e.g., 'doc not required', 'borrower exempt'):");
  if (r === null) return null; // operator cancelled
  if (r.trim().length < 4) {
    alert("Reason must be at least 4 characters.");
    return null;
  }
  return r.trim();
}

export function GroupedConditionCard({ group, mode, driftProgram = null, onAccept, onDismiss }: Props): JSX.Element {
  const [pending, start] = useTransition();
  const [partialFailure, setPartialFailure] = useState<{ failedPcRowIds: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const meta = group.portalRow?.portal_metadata as PortalMetadata | null;

  const handleGroupAccept = (): void => {
    setError(null);
    setPartialFailure(null);
    start(async () => {
      const acceptTarget = group.portalRow ?? group.rows[0]!;
      const r = await onAccept(acceptTarget.id);
      if (!r.ok) { setError(`Accept failed: ${"error" in r ? r.error : "unknown"}`); return; }
      const failed: string[] = [];
      if (group.portalRow) {
        for (const pcRow of group.pcV2Rows) {
          const dr = await onDismiss(pcRow.id, "duplicate_of_portal");
          if (!dr.ok) failed.push(pcRow.id);
        }
      }
      if (failed.length > 0) setPartialFailure({ failedPcRowIds: failed });
    });
  };

  const handleGroupDismiss = (): void => {
    const reason = promptForDismissReason();
    if (reason === null) return; // operator cancelled
    setError(null);
    setPartialFailure(null);
    start(async () => {
      const dismissTarget = group.portalRow ?? group.rows[0]!;
      const r = await onDismiss(dismissTarget.id, reason);
      if (!r.ok) { setError(`Dismiss failed: ${"error" in r ? r.error : "unknown"}`); return; }
      const failed: string[] = [];
      if (group.portalRow) {
        for (const pcRow of group.pcV2Rows) {
          const dr = await onDismiss(pcRow.id, "duplicate_of_portal_dismiss");
          if (!dr.ok) failed.push(pcRow.id);
        }
      }
      if (failed.length > 0) setPartialFailure({ failedPcRowIds: failed });
    });
  };

  const handleRetryCleanup = (): void => {
    if (!partialFailure) return;
    start(async () => {
      const stillFailed: string[] = [];
      for (const id of partialFailure.failedPcRowIds) {
        const r = await onDismiss(id, "duplicate_of_portal");
        if (!r.ok) stillFailed.push(id);
      }
      setPartialFailure(stillFailed.length > 0 ? { failedPcRowIds: stillFailed } : null);
    });
  };

  const hasDrift = mode === "drift" && driftProgram !== null;

  return (
    <div
      data-testid="grouped-condition-card"
      className={`enc-panel mb-2 ${hasDrift ? "border-l-4 border-[#8a4b00]" : ""} ${pending ? "opacity-60 pointer-events-none" : ""}`}
      aria-busy={pending}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="text-[12px] font-bold text-[#1a2b4a]">
          {group.displayDescription}
        </div>
        <div className="flex items-center gap-1">
          {hasDrift && (
            <span
              data-testid="drift-chip"
              className="text-[10px] px-1 bg-[#fff4e6] border border-[#8a4b00] text-[#8a4b00]"
            >
              Drift: {driftProgram!.program} (Portal {driftProgram!.portalStatus}, PC v2 {driftProgram!.pcV2Status})
            </span>
          )}
          {meta?.priority && <span className="text-[10px] px-1 bg-[#1f4478] text-white">{meta.priority}</span>}
          {meta?.severity && <span className="text-[10px] px-1 bg-[#8a4b00] text-white">{meta.severity}</span>}
          {meta?.document_category && <span className="text-[10px] px-1 bg-[#6b7a8f] text-white">{meta.document_category}</span>}
        </div>
      </div>

      {mode === "curation"
        ? renderCuration(group, meta)
        : renderDrift(group, onAccept, onDismiss)}

      {error && <div className="text-[11px] text-[#8a1a1a] mt-1">{error}</div>}

      {partialFailure && (
        <div className="mt-1 p-1 border-l-4 border-[#8a4b00] bg-[#fff4e6] text-[11px]">
          Accept succeeded but cleanup incomplete. {partialFailure.failedPcRowIds.length} duplicate row(s) failed to dismiss.
          <button className="enc-btn ml-2" onClick={handleRetryCleanup}>Retry cleanup</button>
          <button className="enc-btn ml-1" onClick={() => setPartialFailure(null)}>Dismiss as-is</button>
        </div>
      )}

      <div className="flex gap-2 mt-1">
        <button className="enc-btn enc-btn--primary" onClick={handleGroupAccept}>Accept</button>
        <button className="enc-btn" onClick={handleGroupDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

function renderCuration(group: PredictionGroup, meta: PortalMetadata | null): JSX.Element {
  return (
    <div className="text-[11px]">
      {meta?.specifications && meta.specifications.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[#1f4478]">Specifications ({meta.specifications.length})</summary>
          <ul className="list-disc pl-4">
            {meta.specifications.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </details>
      )}
      {meta?.reasons_needed && meta.reasons_needed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[#1f4478]">Reasons ({meta.reasons_needed.length})</summary>
          <ul className="list-disc pl-4">
            {meta.reasons_needed.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </details>
      )}
      {group.pcV2Rows.length > 0 && (
        <div className="text-[10px] text-[#6b7a8f] mt-1">
          +{group.pcV2Rows.length} source ({group.pcV2Rows.map((r) => r.source_list).join(", ")})
        </div>
      )}
    </div>
  );
}

function renderDrift(
  group: PredictionGroup,
  onAccept: Props["onAccept"],
  onDismiss: Props["onDismiss"],
): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2 text-[11px]">
      {group.portalRow && (
        <div className="border-r border-[#6b7a8f] pr-2">
          <div className="text-[10px] font-bold mb-1">Portal-LLM</div>
          <div>{group.portalRow.description}</div>
          <div className="flex gap-1 mt-1">
            <button className="enc-btn" aria-label="Accept portal-llm row" onClick={() => onAccept(group.portalRow!.id)}>Accept</button>
            <button className="enc-btn" aria-label="Dismiss portal-llm row" onClick={() => {
              const reason = promptForDismissReason();
              if (reason !== null) onDismiss(group.portalRow!.id, reason);
            }}>Dismiss</button>
          </div>
        </div>
      )}
      <div>
        {group.pcV2Rows.map((row: Prediction) => (
          <div key={row.id} className="mb-1">
            <div className="text-[10px] font-bold">PC v2 {row.source_list}</div>
            <div>{row.description}</div>
            <div className="flex gap-1 mt-1">
              <button className="enc-btn" aria-label={`Accept ${row.source_list} row`} onClick={() => onAccept(row.id)}>Accept</button>
              <button className="enc-btn" aria-label={`Dismiss ${row.source_list} row`} onClick={() => {
                const reason = promptForDismissReason();
                if (reason !== null) onDismiss(row.id, reason);
              }}>Dismiss</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
