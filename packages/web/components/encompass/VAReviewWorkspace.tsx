"use client";

import { useState, useTransition } from "react";
import type { Loan, VASpecialistKind, VASpecialistSignoff, VAConditionAction, VADocRequest } from "@twin/core";
import { VAPredictedConditionsPanel } from "@/components/encompass/VAPredictedConditionsPanel";

interface SubmitPayload {
  verdict: "concur" | "request_docs";
  specialistSignoffs: VASpecialistSignoff[];
  conditionActions: VAConditionAction[];
  overallRationale: string;
  docRequest: VADocRequest | null;
  agentRecommendationId: string;
  kbVersion: string;
  chatbotConsultationIds: string[];
}

interface Props {
  loan: Loan;
  agentRecommendationId: string;
  kbVersion: string;
  predictions: unknown[];
  predictionsUnavailable: boolean;
  onSubmit: (payload: SubmitPayload) => Promise<{ ok: true } | { ok: false; error: string }>;
}

const SPECIALISTS: VASpecialistKind[] = ["doc", "income", "asset", "credit", "property", "compliance"];

export function VAReviewWorkspace({ loan, agentRecommendationId, kbVersion, predictions, predictionsUnavailable, onSubmit }: Props) {
  // Per-specialist signoff state. Default all to "concur" with empty notes.
  const [signoffs, setSignoffs] = useState<Record<VASpecialistKind, { signoff: "concur" | "disagree"; notes: string }>>(
    Object.fromEntries(SPECIALISTS.map((s) => [s, { signoff: "concur" as const, notes: "" }])) as Record<VASpecialistKind, { signoff: "concur" | "disagree"; notes: string }>,
  );
  const [conditionActions, setConditionActions] = useState<Record<string, { action: "clear" | "contest" | null; note: string }>>({});
  const [rationale, setRationale] = useState("");
  const [verdict, setVerdict] = useState<"concur" | "request_docs">("concur");
  const [docRequest, setDocRequest] = useState<VADocRequest>({ docs: [], deadline: "", messageToOriginator: "" });
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Submit gating per spec invariants:
  // - rationale >= 20 chars
  // - every "disagree" specialist has notes
  // - every "contest" condition action has a note
  // - if verdict=request_docs: >= 1 doc, deadline set, message non-empty
  const allSignoffsValid = SPECIALISTS.every((s) =>
    signoffs[s].signoff === "concur" || signoffs[s].notes.trim().length > 0,
  );
  const allConditionsValid = Object.values(conditionActions).every((c) =>
    c.action !== "contest" || c.note.trim().length > 0,
  );
  const docRequestValid = verdict === "concur" || (
    docRequest.docs.length > 0 &&
    docRequest.deadline.length > 0 &&
    docRequest.messageToOriginator.trim().length > 0
  );
  const canSubmit =
    rationale.trim().length >= 20 &&
    allSignoffsValid &&
    allConditionsValid &&
    docRequestValid &&
    !pending;

  function submit() {
    setSubmitErr(null);
    const signoffArray: VASpecialistSignoff[] = SPECIALISTS.map((s) => ({
      specialist: s,
      signoff: signoffs[s].signoff,
      notes: signoffs[s].signoff === "disagree" ? signoffs[s].notes : null,
    }));
    const conditionArr: VAConditionAction[] = Object.entries(conditionActions)
      .filter(([, c]) => c.action !== null)
      .map(([conditionId, c]) => ({
        conditionId,
        action: c.action as "clear" | "contest",
        note: c.action === "contest" ? c.note : null,
      }));
    const payload: SubmitPayload = {
      verdict,
      specialistSignoffs: signoffArray,
      conditionActions: conditionArr,
      overallRationale: rationale,
      docRequest: verdict === "request_docs" ? docRequest : null,
      agentRecommendationId,
      kbVersion,
      chatbotConsultationIds: [],
    };
    start(async () => {
      const res = await onSubmit(payload);
      if (!res.ok) setSubmitErr(res.error);
    });
  }

  return (
    <div className="enc-panel">
      <h3 className="text-[14px] font-bold text-[#1a2b4a] mb-2">VA Review — Loan {loan.id}</h3>
      <div className="text-[11px] text-[#6b7a8f] mb-3">
        Borrower: {loan.borrower.fullName} · Program: {loan.nqmProgram} · Loan: ${loan.transaction.loanAmount.toLocaleString()}
      </div>

      <VAPredictedConditionsPanel
        loanId={loan.id}
        predictions={predictions as never}
        unavailable={predictionsUnavailable}
      />

      {/* Signoff table */}
      <table className="w-full text-[11px] mb-3 border-collapse">
        <thead>
          <tr className="bg-[#d4d0c8] text-left">
            <th className="px-2 py-1 border-b border-[#6b7a8f]">Specialist</th>
            <th className="px-2 py-1 border-b border-[#6b7a8f]">Signoff</th>
            <th className="px-2 py-1 border-b border-[#6b7a8f]">Notes (required when disagree)</th>
          </tr>
        </thead>
        <tbody>
          {SPECIALISTS.map((s) => (
            <tr key={s} className="border-b border-[#c8c4b5]">
              <td className="px-2 py-1 capitalize">{s}</td>
              <td className="px-2 py-1">
                <select
                  className="enc-input"
                  value={signoffs[s].signoff}
                  onChange={(e) => setSignoffs({ ...signoffs, [s]: { ...signoffs[s], signoff: e.target.value as "concur" | "disagree" } })}
                  data-testid={`signoff-${s}`}
                >
                  <option value="concur">Concur</option>
                  <option value="disagree">Disagree</option>
                </select>
              </td>
              <td className="px-2 py-1">
                <input
                  className="enc-input w-full"
                  disabled={signoffs[s].signoff === "concur"}
                  value={signoffs[s].notes}
                  onChange={(e) => setSignoffs({ ...signoffs, [s]: { ...signoffs[s], notes: e.target.value } })}
                  data-testid={`notes-${s}`}
                  placeholder={signoffs[s].signoff === "disagree" ? "Required when disagree" : ""}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Condition actions */}
      <div className="mb-3">
        <h4 className="text-[12px] font-bold text-[#1a2b4a] mb-1">Condition actions (clear / contest)</h4>
        {loan.conditions.length === 0 ? (
          <div className="text-[11px] text-[#6b7a8f]">No conditions on this loan.</div>
        ) : (
          loan.conditions.map((c) => {
            const cur = conditionActions[c.id] ?? { action: null, note: "" };
            return (
              <div key={c.id} className="flex gap-2 items-center text-[11px] py-1 border-b border-[#c8c4b5]">
                <span className="flex-1">{c.description}</span>
                <select
                  className="enc-input"
                  value={cur.action ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    const nextAction: "clear" | "contest" | null = v === "clear" || v === "contest" ? v : null;
                    setConditionActions({
                      ...conditionActions,
                      [c.id]: { action: nextAction, note: cur.note },
                    });
                  }}
                  data-testid={`condition-action-${c.id}`}
                >
                  <option value="">— No action —</option>
                  <option value="clear">Clear</option>
                  <option value="contest">Contest</option>
                </select>
                {cur.action === "contest" && (
                  <input
                    className="enc-input flex-1"
                    placeholder="Reason for contest (required)"
                    value={cur.note}
                    onChange={(e) => setConditionActions({ ...conditionActions, [c.id]: { ...cur, note: e.target.value } })}
                    data-testid={`condition-note-${c.id}`}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Overall rationale */}
      <textarea
        className="enc-input w-full mb-3"
        rows={4}
        placeholder="Overall rationale (>= 20 chars, required)"
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        data-testid="rationale"
      />

      {/* Verdict picker */}
      <div className="mb-3 flex gap-4 text-[12px] text-[#1a2b4a]">
        <label className="flex items-center gap-1">
          <input type="radio" name="verdict" checked={verdict === "concur"} onChange={() => setVerdict("concur")} data-testid="verdict-concur" />
          Concur — forward to UW
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="verdict" checked={verdict === "request_docs"} onChange={() => setVerdict("request_docs")} data-testid="verdict-request_docs" />
          Request docs from originator
        </label>
      </div>

      {verdict === "request_docs" && (
        <DocRequestForm value={docRequest} onChange={setDocRequest} />
      )}

      {submitErr && (
        <div className="text-[11px] text-[#c00] bg-[#fef0f0] border border-[#c00] p-2 mb-2" data-testid="submit-error">
          Submit failed: {submitErr}
        </div>
      )}

      <button
        className="enc-btn enc-btn--primary"
        disabled={!canSubmit}
        onClick={submit}
        data-testid="submit"
      >
        {pending ? "Submitting…" : "Submit Review"}
      </button>
    </div>
  );
}

function DocRequestForm({ value, onChange }: { value: VADocRequest; onChange: (v: VADocRequest) => void }) {
  function addDoc() {
    onChange({ ...value, docs: [...value.docs, { docType: "", reason: "", required: true }] });
  }
  function updateDoc(i: number, patch: Partial<VADocRequest["docs"][number]>) {
    const docs = value.docs.map((d, idx) => (idx === i ? { ...d, ...patch } : d));
    onChange({ ...value, docs });
  }
  function removeDoc(i: number) {
    onChange({ ...value, docs: value.docs.filter((_, idx) => idx !== i) });
  }
  return (
    <div className="enc-panel mb-3 border-l-4 border-[#1f4478]">
      <h4 className="text-[12px] font-bold text-[#1a2b4a] mb-2">Doc Request to Originator</h4>
      <div className="mb-2">
        <label className="text-[11px] text-[#6b7a8f]">Deadline (YYYY-MM-DD)</label>
        <input
          type="date"
          className="enc-input"
          value={value.deadline}
          onChange={(e) => onChange({ ...value, deadline: e.target.value })}
          data-testid="docrequest-deadline"
        />
      </div>
      <div className="mb-2">
        <label className="text-[11px] text-[#6b7a8f]">Message to originator</label>
        <textarea
          className="enc-input w-full"
          rows={2}
          value={value.messageToOriginator}
          onChange={(e) => onChange({ ...value, messageToOriginator: e.target.value })}
          data-testid="docrequest-message"
        />
      </div>
      <div className="mb-1">
        <label className="text-[11px] text-[#6b7a8f]">Documents requested ({value.docs.length})</label>
      </div>
      {value.docs.map((d, i) => (
        <div key={i} className="flex gap-1 items-center mb-1">
          <input
            className="enc-input flex-1"
            placeholder="Doc type"
            value={d.docType}
            onChange={(e) => updateDoc(i, { docType: e.target.value })}
            data-testid={`docrequest-doc-type-${i}`}
          />
          <input
            className="enc-input flex-1"
            placeholder="Reason"
            value={d.reason}
            onChange={(e) => updateDoc(i, { reason: e.target.value })}
            data-testid={`docrequest-doc-reason-${i}`}
          />
          <label className="text-[11px] flex items-center gap-1">
            <input type="checkbox" checked={d.required} onChange={(e) => updateDoc(i, { required: e.target.checked })} />
            Required
          </label>
          <button className="enc-btn text-[9px]" onClick={() => removeDoc(i)}>Remove</button>
        </div>
      ))}
      <button className="enc-btn text-[10px]" onClick={addDoc} data-testid="docrequest-add">+ Add Document</button>
    </div>
  );
}
