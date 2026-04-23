"use client";

interface MetricsCardsProps {
  alignmentRate: number;
  overrideRate: number;
  avgDecisionTime: number;
  slaCompliance: number;
}

export function MetricsCards({ alignmentRate, overrideRate, avgDecisionTime, slaCompliance }: MetricsCardsProps) {
  const cards = [
    { label: "UW Alignment", value: `${alignmentRate.toFixed(1)}%`, sub: "30d" },
    { label: "Override Rate", value: `${overrideRate.toFixed(1)}%`, sub: "30d" },
    { label: "Avg Decision", value: `${Math.round(avgDecisionTime / 60)} min`, sub: "mean" },
    { label: "SLA Compliance", value: `${slaCompliance.toFixed(1)}%`, sub: "30d" },
  ];
  return (
    <div className="grid grid-cols-4 gap-3 mb-4">
      {cards.map((c) => (
        <div key={c.label} className="enc-panel p-3 text-center">
          <div className="text-[10px] text-[#6b7a8f] uppercase">{c.label}</div>
          <div className="text-xl font-bold text-[#1a2b4a]">{c.value}</div>
          <div className="text-[9px] text-[#8899aa]">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}
