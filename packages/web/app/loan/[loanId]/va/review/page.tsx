import { api } from "@/lib/api-client";
import { PriorReviewsPanel } from "@/components/encompass/PriorReviewsPanel";
import { ReviewClient } from "./ReviewClient";

type PredictionsFetchState =
  | { predictions: unknown[]; alerts: unknown[]; unavailable: false }
  | { predictions: []; alerts: []; unavailable: true };

export default async function Page({ params }: { params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;

  // Server-side fetch loan + history + predictions in parallel.
  const [loan, history, predictionsResp] = await Promise.all([
    api.getLoan(loanId).catch(() => null),
    api.vaReviewHistory(loanId).catch(() => ({ reviews: [] as Array<{ id: string; va_id: string; pool_kind: "internal" | "bpo"; verdict: "concur" | "request_docs"; overall_rationale: string; doc_request: unknown; submitted_at: string; review_time_seconds: number }> })),
    api.getPredictions(loanId).then(
      (r): PredictionsFetchState => ({ predictions: r.predictions, alerts: r.alerts, unavailable: false }),
    ).catch((err: { status?: number }): PredictionsFetchState => {
      if (err.status === 404) return { predictions: [], alerts: [], unavailable: false };
      console.error("[va-review] predictions fetch failed", { loanId, err });
      return { predictions: [], alerts: [], unavailable: true };
    }),
  ]);

  if (!loan) {
    return (
      <div className="p-4 max-w-[1200px] mx-auto">
        <div className="enc-panel text-[12px]">Loan {loanId} not found.</div>
      </div>
    );
  }

  // pendingRecommendation may not have an id (the original spec assumed one);
  // fall back to a deterministic placeholder so the schema's UUID validation still works.
  // (The agent-recommendation FK isn't enforced — see project memory project_foundation_specs_drift.md.)
  const agentRecommendationId = "00000000-0000-0000-0000-000000000000";
  const kbVersion = "kb-current";  // best-effort placeholder until kb_version is wired through

  return (
    <div className="p-4 max-w-[1200px] mx-auto">
      <PriorReviewsPanel
        reviews={history.reviews.map((r) => ({
          id: r.id,
          va_id: r.va_id,
          pool_kind: r.pool_kind,
          verdict: r.verdict,
          overall_rationale: r.overall_rationale,
          doc_request: r.doc_request,
          submitted_at: r.submitted_at,
          review_time_seconds: r.review_time_seconds,
        }))}
      />
      <ReviewClient
        loan={loan}
        loanId={loanId}
        agentRecommendationId={agentRecommendationId}
        kbVersion={kbVersion}
        predictions={predictionsResp.predictions}
        predictionsUnavailable={predictionsResp.unavailable}
      />
    </div>
  );
}
