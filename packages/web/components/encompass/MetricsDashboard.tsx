"use client";

export interface MetricsData {
  totalLoans: number;
  decisions: { pending: number; approved: number; denied: number; suspended: number; counter: number };
  assignments: { unassigned: number; queued: number; in_progress: number; report_ready: number; under_review: number; decided: number };
  programs: Record<string, number>;
  conditions: { total: number; cleared: number; open: number };
  documents: { total: number; withFiles: number };
  pendingRecommendations: number;
  overrides: number;
  auditLogEntries: number;
}

function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex-1 h-3 bg-[#e0ddd5] rounded overflow-hidden">
      <div className={`h-full rounded ${color}`} style={{ width: `${width}%` }} />
    </div>
  );
}

function StatCard({ value, label, color }: { value: string | number; label: string; color: string }) {
  return (
    <div className={`border border-[#9aa0a8] rounded p-3 flex flex-col items-center min-w-[100px] ${color}`}>
      <span className="text-3xl font-bold leading-none">{value}</span>
      <span className="text-xs mt-1 text-center font-medium">{label}</span>
    </div>
  );
}

export function MetricsDashboard({ metrics }: { metrics: MetricsData }) {
  const totalDecisions = metrics.totalLoans;
  const decidedCount = metrics.decisions.approved + metrics.decisions.denied + metrics.decisions.suspended + metrics.decisions.counter;

  // Accuracy: how many decided loans were NOT overridden
  const accuracyPct = decidedCount > 0
    ? Math.max(0, Math.round(((decidedCount - metrics.overrides) / decidedCount) * 100))
    : 0;

  const decisionMax = Math.max(
    metrics.decisions.pending,
    metrics.decisions.approved,
    metrics.decisions.denied,
    metrics.decisions.suspended,
    metrics.decisions.counter,
    1,
  );

  const assignmentEntries: Array<[string, number]> = [
    ["Unassigned", metrics.assignments.unassigned],
    ["Queued", metrics.assignments.queued],
    ["In Progress", metrics.assignments.in_progress],
    ["Report Ready", metrics.assignments.report_ready],
    ["Under Review", metrics.assignments.under_review],
    ["Decided", metrics.assignments.decided],
  ];

  const programEntries = Object.entries(metrics.programs).sort((a, b) => b[1] - a[1]);

  const docsCompletePct = pct(metrics.documents.withFiles, metrics.documents.total);
  const condWaivedCount = metrics.conditions.total - metrics.conditions.cleared - metrics.conditions.open;

  return (
    <div className="font-mono text-[13px] text-[#1a1a1a]">
      <div className="text-base font-bold mb-3 border-b border-[#9aa0a8] pb-1">
        Platform Metrics
      </div>

      {/* Stat Cards */}
      <div className="flex gap-3 flex-wrap mb-4">
        <StatCard value={metrics.totalLoans} label="Total Loans" color="bg-[#1a3a5c] text-white" />
        <StatCard value={metrics.decisions.approved} label="Approved" color="bg-[#1a7a3a] text-white" />
        <StatCard value={metrics.decisions.pending} label="Pending" color="bg-[#8a6800] text-white" />
        <StatCard value={`${accuracyPct}%`} label="Accuracy" color="bg-[#1a4a8a] text-white" />
        <StatCard value={metrics.pendingRecommendations} label="Pending Recs" color="bg-[#5a3a8a] text-white" />
        <StatCard value={metrics.overrides} label="Overrides" color="bg-[#8a3a1a] text-white" />
      </div>

      <div className="grid grid-cols-1 gap-3">
        {/* Decision Distribution */}
        <div className="border border-[#9aa0a8] rounded p-3">
          <div className="font-bold mb-2 text-[#1a1a6a]">Decision Distribution</div>
          {(
            [
              ["Pending", metrics.decisions.pending, "bg-[#c4a400]"],
              ["Approved", metrics.decisions.approved, "bg-[#1a7a3a]"],
              ["Denied", metrics.decisions.denied, "bg-[#8a1a1a]"],
              ["Suspended", metrics.decisions.suspended, "bg-[#8a5a00]"],
              ["Counter", metrics.decisions.counter, "bg-[#4a4a8a]"],
            ] as Array<[string, number, string]>
          ).map(([label, count, color]) => (
            <div key={label} className="flex items-center gap-2 mb-1">
              <span className="w-20 text-right shrink-0">{label}</span>
              <Bar value={count} max={decisionMax} color={color} />
              <span className="w-24 shrink-0 text-[#555]">
                {count} ({pct(count, totalDecisions)}%)
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* Assignment Pipeline */}
          <div className="border border-[#9aa0a8] rounded p-3">
            <div className="font-bold mb-2 text-[#1a1a6a]">Assignment Pipeline</div>
            {assignmentEntries.map(([label, count]) => (
              <div key={label} className="flex justify-between py-[2px] border-b border-[#e8e5de] last:border-b-0">
                <span>{label}</span>
                <span className="font-bold">{count}</span>
              </div>
            ))}
          </div>

          {/* Program Distribution */}
          <div className="border border-[#9aa0a8] rounded p-3">
            <div className="font-bold mb-2 text-[#1a1a6a]">Program Distribution</div>
            {programEntries.length === 0 && (
              <div className="text-[#888]">No data</div>
            )}
            {programEntries.map(([program, count]) => (
              <div key={program} className="flex justify-between py-[2px] border-b border-[#e8e5de] last:border-b-0">
                <span className="truncate max-w-[130px]" title={program}>{program}</span>
                <span className="font-bold">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Document & Condition Health */}
        <div className="border border-[#9aa0a8] rounded p-3">
          <div className="font-bold mb-2 text-[#1a1a6a]">Document &amp; Condition Health</div>
          <div className="mb-2 text-[#444]">
            Conditions: <strong>{metrics.conditions.total}</strong> total &middot;&nbsp;
            <span className="text-[#c4a400]"><strong>{metrics.conditions.open}</strong> open</span> &middot;&nbsp;
            <span className="text-[#1a7a3a]"><strong>{metrics.conditions.cleared}</strong> cleared</span> &middot;&nbsp;
            <span className="text-[#888]"><strong>{condWaivedCount < 0 ? 0 : condWaivedCount}</strong> waived</span>
          </div>
          <div className="mb-2 text-[#444]">
            Documents: <strong>{metrics.documents.total}</strong> total &middot;&nbsp;
            <strong>{metrics.documents.withFiles}</strong> with files
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 w-28">Docs complete</span>
            <div className="flex-1 h-4 bg-[#e0ddd5] rounded overflow-hidden">
              <div
                className="h-full bg-[#1a4a8a] rounded"
                style={{ width: `${docsCompletePct}%` }}
              />
            </div>
            <span className="shrink-0 w-10 text-right">{docsCompletePct}%</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="shrink-0 w-28">Conds cleared</span>
            <div className="flex-1 h-4 bg-[#e0ddd5] rounded overflow-hidden">
              <div
                className="h-full bg-[#1a7a3a] rounded"
                style={{ width: `${pct(metrics.conditions.cleared, metrics.conditions.total)}%` }}
              />
            </div>
            <span className="shrink-0 w-10 text-right">{pct(metrics.conditions.cleared, metrics.conditions.total)}%</span>
          </div>
        </div>

        {/* Audit Summary */}
        <div className="border border-[#9aa0a8] rounded p-3">
          <div className="font-bold mb-2 text-[#1a1a6a]">Audit Summary</div>
          <div className="flex gap-6 flex-wrap">
            <div>
              <span className="text-[#888]">Audit log entries: </span>
              <strong>{metrics.auditLogEntries}</strong>
            </div>
            <div>
              <span className="text-[#888]">Decision overrides: </span>
              <strong>{metrics.overrides}</strong>
            </div>
            <div>
              <span className="text-[#888]">Agent accuracy: </span>
              <strong>{accuracyPct}%</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
