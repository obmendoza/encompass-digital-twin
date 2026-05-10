export interface SpecialistSignoff {
  specialist: string;
  signoff: "concur" | "disagree";
  notes: string | null;
}

export interface ConditionAction {
  conditionId: string;
  action: "clear" | "contest";
  note: string | null;
}

export interface VAReviewProps {
  vaId: string;
  poolKind: "internal" | "bpo";
  verdict: "concur" | "request_docs";
  specialistSignoffs: SpecialistSignoff[];
  conditionActions: ConditionAction[];
  overallRationale: string;
  submittedAt: string;
  reviewTimeSeconds: number;
}

export function UWReviewPanel({ review }: { review: VAReviewProps }) {
  const disagreed = review.specialistSignoffs.filter((s) => s.signoff === "disagree");
  const verdictColor = review.verdict === "request_docs" ? "text-[#8a4b00]" : "text-[#1b5e20]";
  const verdictBg = review.verdict === "request_docs" ? "bg-[#fff4e0]" : "bg-[#e8f5e9]";

  return (
    <div className="enc-panel mb-3 border-l-4 border-[#1f4478]">
      <h3 className="text-[14px] font-bold text-[#1a2b4a] mb-2">VA Review</h3>

      <div className="text-[11px] text-[#6b7a8f] mb-2">
        <b>VA:</b> {review.vaId}
        {" · "}<b>Source:</b> {review.poolKind === "bpo" ? "BPO SME" : "Internal"}
        {" · "}<b>Submitted:</b> {new Date(review.submittedAt).toLocaleString()}
        {" · "}<b>Time:</b> {review.reviewTimeSeconds}s
      </div>

      <div className={`inline-block px-2 py-1 mb-2 text-[12px] font-bold ${verdictBg} ${verdictColor}`}>
        Verdict: {review.verdict === "concur" ? "Concur" : "Request Docs"}
      </div>

      <div className="text-[11px] mb-3 text-[#1a2b4a] whitespace-pre-wrap">
        <b>Rationale:</b> {review.overallRationale}
      </div>

      {disagreed.length > 0 && (
        <div className="p-2 mb-2 bg-[#fff4e0] border border-[#8a4b00]" data-testid="specialist-disagreements">
          <div className="text-[11px] font-bold text-[#8a4b00] mb-1">
            Specialist disagreements ({disagreed.length})
          </div>
          <ul className="ml-4 list-disc text-[11px]">
            {disagreed.map((s) => (
              <li key={s.specialist}>
                <b className="capitalize">{s.specialist}</b>: {s.notes ?? ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.conditionActions.length > 0 && (
        <div className="text-[11px] mb-1">
          <b>Condition actions:</b>
          <ul className="ml-4 list-disc">
            {review.conditionActions.map((c) => (
              <li key={c.conditionId} className={c.action === "contest" ? "text-[#8a4b00]" : "text-[#1b5e20]"}>
                <b>{c.action === "clear" ? "Cleared" : "Contested"}</b> {c.conditionId}
                {c.note ? `: ${c.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
