"use client";

import type { PendingRecommendation, AgentStep } from "@twin/core";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpecialistFinding {
  agent: string;
  recommendation: string;
  summary: string;
  [key: string]: unknown;
}

export interface RiskScoreFactor {
  score: number;
  weight: number;
}

export interface RiskScore {
  composite: number;
  tier: string;
  ltv?: RiskScoreFactor;
  dti?: RiskScoreFactor;
  fico?: RiskScoreFactor;
  reserves?: RiskScoreFactor;
  income?: RiskScoreFactor;
  [key: string]: unknown;
}

export interface AuditReportData {
  findings: Record<string, SpecialistFinding>;
  riskScore?: RiskScore;
  blockingIssues: string[];
  warnings: string[];
  compensatingFactors: string[];
  minorityOpinions: string[];
  executiveSummary: string;
  decision: string;
  confidence: number;
  specialistFindings?: Record<string, string>;
}

// ─── Data Extraction ──────────────────────────────────────────────────────────

export function extractAuditData(rec: PendingRecommendation): AuditReportData | null {
  const findings: Record<string, SpecialistFinding> = {};

  for (const step of rec.trace) {
    if (step.phase === "tool_result" && step.content) {
      try {
        // Strip leading/trailing non-JSON characters
        const jsonStr = step.content.replace(/^[^{[]*/, "").replace(/[^}\]]*$/, "");
        const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
        if (typeof parsed.agent === "string") {
          findings[parsed.agent] = parsed as unknown as SpecialistFinding;
        }
      } catch {
        // Not JSON or not a specialist finding — skip
      }
    }
  }

  const risk = findings["risk_synthesis"];
  if (!risk) return null;

  return {
    findings,
    riskScore: risk.risk_score as RiskScore | undefined,
    blockingIssues: (risk.blocking_issues as string[]) ?? [],
    warnings: (risk.warnings as string[]) ?? [],
    compensatingFactors: (risk.compensating_factors as string[]) ?? [],
    minorityOpinions: (risk.minority_opinions as string[]) ?? [],
    executiveSummary:
      (risk.executive_summary as string) ??
      rec.rationale.replace(/\*\*/g, "").slice(0, 300),
    decision: rec.recommendation,
    confidence: rec.confidence,
    specialistFindings: risk.specialist_findings as Record<string, string> | undefined,
  };
}

// ─── Score bar helpers ────────────────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 85) return "#1b7e35";
  if (score >= 70) return "#4caf50";
  if (score >= 55) return "#f59e0b";
  if (score >= 40) return "#f97316";
  return "#dc2626";
}

function tierColors(tier: string): { bg: string; text: string; border: string } {
  switch (tier.toUpperCase()) {
    case "LOW":
      return { bg: "#dcfce7", text: "#14532d", border: "#4ade80" };
    case "MODERATE":
      return { bg: "#fef9c3", text: "#713f12", border: "#facc15" };
    case "HIGH":
      return { bg: "#ffedd5", text: "#7c2d12", border: "#fb923c" };
    case "VERY_HIGH":
      return { bg: "#fee2e2", text: "#7f1d1d", border: "#f87171" };
    default:
      return { bg: "#f1f5f9", text: "#334155", border: "#94a3b8" };
  }
}

// ─── RiskScoreMatrix ──────────────────────────────────────────────────────────

const SCORE_FACTOR_LABELS: Record<string, string> = {
  ltv: "LTV Ratio",
  dti: "DTI Ratio",
  fico: "FICO Score",
  reserves: "Reserves",
  income: "Income Stability",
};

function ScoreBar({ score }: { score: number }) {
  const color = scoreColor(score);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-[8px] bg-[#e5e7eb] rounded overflow-hidden">
        <div
          className="h-full rounded transition-all"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[10px] font-bold w-[28px] text-right" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

function RiskScoreMatrix({ score }: { score: RiskScore }) {
  const tier = tierColors(score.tier);
  const factors = Object.entries(SCORE_FACTOR_LABELS)
    .map(([key, label]) => {
      const factor = score[key] as RiskScoreFactor | undefined;
      if (!factor) return null;
      return { key, label, score: factor.score, weight: factor.weight };
    })
    .filter(Boolean) as { key: string; label: string; score: number; weight: number }[];

  return (
    <div className="mb-4">
      <div className="text-[10px] font-bold text-[#1e3a5f] uppercase tracking-wider mb-2">
        Risk Score Matrix
      </div>
      <div className="border border-[#c8c4b5] bg-white overflow-hidden">
        {/* Composite score header */}
        <div className="flex items-center gap-4 px-4 py-3 bg-[#f0f4f8] border-b border-[#c8c4b5]">
          <div>
            <div className="text-[9px] text-[#6b7a8f] uppercase tracking-wide">Composite Score</div>
            <div
              className="text-[32px] font-black leading-none"
              style={{ color: scoreColor(score.composite) }}
            >
              {score.composite.toFixed(1)}
            </div>
          </div>
          <div className="flex-1" />
          <div
            className="px-3 py-1 text-[11px] font-bold uppercase tracking-widest border"
            style={{
              backgroundColor: tier.bg,
              color: tier.text,
              borderColor: tier.border,
            }}
          >
            {score.tier} RISK
          </div>
        </div>

        {/* Per-factor table */}
        {factors.length > 0 && (
          <div className="divide-y divide-[#e5e7eb]">
            {factors.map((f) => (
              <div key={f.key} className="flex items-center gap-3 px-4 py-2">
                <div className="w-[100px] text-[10px] font-semibold text-[#1f2d40]">
                  {f.label}
                </div>
                <div className="flex-1">
                  <ScoreBar score={f.score} />
                </div>
                <div className="text-[9px] text-[#6b7a8f] w-[52px] text-right">
                  wt {Math.round(f.weight * 100)}%
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SpecialistCard ───────────────────────────────────────────────────────────

const SPECIALIST_META: Record<
  string,
  { label: string; icon: string }
> = {
  doc_review: { label: "Doc Review", icon: "📄" },
  income_analysis: { label: "Income Analysis", icon: "💰" },
  credit_assessment: { label: "Credit Assessment", icon: "📊" },
  compliance: { label: "Compliance", icon: "⚖️" },
  risk_synthesis: { label: "Risk Synthesis", icon: "🧮" },
};

function recommendationStyle(rec: string): {
  border: string;
  badge: string;
  icon: string;
  text: string;
} {
  switch (rec.toLowerCase()) {
    case "pass":
    case "approve":
      return {
        border: "border-[#4ade80]",
        badge: "bg-[#dcfce7] text-[#14532d] border-[#4ade80]",
        icon: "✅",
        text: "PASS",
      };
    case "marginal":
    case "conditional":
      return {
        border: "border-[#facc15]",
        badge: "bg-[#fef9c3] text-[#713f12] border-[#facc15]",
        icon: "⚠️",
        text: "MARGINAL",
      };
    case "fail":
    case "deny":
      return {
        border: "border-[#f87171]",
        badge: "bg-[#fee2e2] text-[#7f1d1d] border-[#f87171]",
        icon: "❌",
        text: "FAIL",
      };
    default:
      return {
        border: "border-[#94a3b8]",
        badge: "bg-[#f1f5f9] text-[#334155] border-[#94a3b8]",
        icon: "ℹ️",
        text: rec.toUpperCase(),
      };
  }
}

function SpecialistCard({
  agentKey,
  finding,
}: {
  agentKey: string;
  finding: SpecialistFinding;
}) {
  const meta = SPECIALIST_META[agentKey] ?? {
    label: agentKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    icon: "🔍",
  };
  const style = recommendationStyle(finding.recommendation ?? "");

  return (
    <div
      className={`border-2 ${style.border} bg-white p-3 flex flex-col gap-1 min-h-[90px]`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[14px]">{meta.icon}</span>
        <span className="text-[10px] font-bold text-[#1f2d40] uppercase tracking-wide">
          {meta.label}
        </span>
      </div>
      <div>
        <span
          className={`inline-flex items-center gap-1 px-2 py-[2px] text-[9px] font-bold border uppercase tracking-wide ${style.badge}`}
        >
          {style.icon} {style.text}
        </span>
      </div>
      {finding.summary && (
        <div className="text-[10px] text-[#404040] leading-snug mt-1">
          {finding.summary}
        </div>
      )}
    </div>
  );
}

// ─── SpecialistGrid ───────────────────────────────────────────────────────────

const GRID_ORDER = ["doc_review", "income_analysis", "credit_assessment", "compliance"];

function SpecialistGrid({
  findings,
  specialistFindings,
}: {
  findings: Record<string, SpecialistFinding>;
  specialistFindings?: Record<string, string>;
}) {
  // Build display list: prefer full SpecialistFinding objects; fall back to
  // specialist_findings status strings from the risk_synthesis output.
  const cards: { key: string; finding: SpecialistFinding }[] = [];

  for (const key of GRID_ORDER) {
    if (findings[key]) {
      cards.push({ key, finding: findings[key]! });
    } else if (specialistFindings?.[key]) {
      // Construct a minimal SpecialistFinding from the status string
      cards.push({
        key,
        finding: {
          agent: key,
          recommendation: specialistFindings[key]!,
          summary: "",
        },
      });
    }
  }

  // Also include any specialist findings not in the default order
  for (const [k, v] of Object.entries(findings)) {
    if (!GRID_ORDER.includes(k) && k !== "risk_synthesis") {
      cards.push({ key: k, finding: v });
    }
  }

  if (cards.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="text-[10px] font-bold text-[#1e3a5f] uppercase tracking-wider mb-2">
        Specialist Findings
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map(({ key, finding }) => (
          <SpecialistCard key={key} agentKey={key} finding={finding} />
        ))}
      </div>
    </div>
  );
}

// ─── IssuesAndFactors ─────────────────────────────────────────────────────────

function CalloutBox({
  items,
  label,
  emptyLabel,
  colorClass,
  icon,
}: {
  items: string[];
  label: string;
  emptyLabel: string;
  colorClass: string;
  icon: string;
}) {
  return (
    <div className="mb-2">
      <div className={`text-[9px] font-bold uppercase tracking-wider mb-1 ${colorClass}`}>
        {label}
      </div>
      {items.length === 0 ? (
        <div
          className={`p-2 text-[10px] text-[#6b7a8f] border border-dashed border-[#c8c4b5] bg-[#f9fafb]`}
        >
          {emptyLabel}
        </div>
      ) : (
        items.map((item, i) => (
          <div key={i} className={`p-2 mb-1 border-l-4 text-[10px] ${colorClass.replace("text-", "border-")} ${colorClass.includes("red") ? "bg-[#fde8e8]" : colorClass.includes("amber") || colorClass.includes("yellow") ? "bg-[#fef9c3]" : "bg-[#dcfce7]"}`}>
            <span className="mr-1">{icon}</span>
            {item}
          </div>
        ))
      )}
    </div>
  );
}

function IssuesAndFactors({
  blockingIssues,
  warnings,
  compensatingFactors,
}: {
  blockingIssues: string[];
  warnings: string[];
  compensatingFactors: string[];
}) {
  const hasAny = blockingIssues.length + warnings.length + compensatingFactors.length > 0;
  if (!hasAny) return null;

  return (
    <div className="mb-4">
      <div className="text-[10px] font-bold text-[#1e3a5f] uppercase tracking-wider mb-2">
        Issues & Compensating Factors
      </div>
      <div className="border border-[#c8c4b5] bg-white p-3 space-y-1">
        <CalloutBox
          items={blockingIssues}
          label="Blocking Issues"
          emptyLabel="None — no blocking issues identified"
          colorClass="text-[#8a0000]"
          icon="🚫"
        />
        <CalloutBox
          items={warnings}
          label="Warnings"
          emptyLabel="No warnings"
          colorClass="text-[#78350f]"
          icon="⚠️"
        />
        <CalloutBox
          items={compensatingFactors}
          label="Compensating Factors"
          emptyLabel="None noted"
          colorClass="text-[#14532d]"
          icon="✅"
        />
      </div>
    </div>
  );
}

// ─── MinorityOpinions ─────────────────────────────────────────────────────────

function MinorityOpinions({ opinions }: { opinions: string[] }) {
  if (opinions.length === 0) return null;
  return (
    <div className="mb-4">
      <div className="text-[10px] font-bold text-[#1e3a5f] uppercase tracking-wider mb-2">
        Minority Opinions
      </div>
      <div className="border border-[#c8c4b5] bg-[#fafbfc] p-3 space-y-1">
        {opinions.map((op, i) => (
          <div key={i} className="flex gap-2 text-[10px] py-1 border-b border-[#e5e7eb] last:border-0">
            <span className="shrink-0 font-bold text-[#6b7a8f]">{i + 1}.</span>
            <span className="text-[#1f2d40]">{op}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ExecutiveSummary ─────────────────────────────────────────────────────────

function ExecutiveSummary({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="mb-4">
      <div className="text-[10px] font-bold text-[#1e3a5f] uppercase tracking-wider mb-2">
        Executive Summary
      </div>
      <div className="border border-[#c8c4b5] bg-white p-3 text-[11px] text-[#1f2d40] leading-relaxed">
        {text}
      </div>
    </div>
  );
}

// ─── Report Header ────────────────────────────────────────────────────────────

function decisionBadgeStyle(decision: string): { bg: string; text: string } {
  switch (decision.toLowerCase()) {
    case "approve":
    case "approved":
      return { bg: "#1b5e20", text: "#ffffff" };
    case "deny":
    case "denied":
      return { bg: "#8a0000", text: "#ffffff" };
    case "suspend":
    case "suspended":
      return { bg: "#8a4b00", text: "#ffffff" };
    default:
      return { bg: "#0d47a1", text: "#ffffff" };
  }
}

function ReportHeader({
  decision,
  confidence,
  specialistCount,
}: {
  decision: string;
  confidence: number;
  specialistCount: number;
}) {
  const pct = Math.round(confidence * 100);
  const badge = decisionBadgeStyle(decision);
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="mb-4 border border-[#1e3a5f] bg-[#f0f4f8] overflow-hidden">
      {/* Banner */}
      <div className="bg-[#1e3a5f] px-4 py-2 flex items-center gap-3">
        <span className="text-white font-black text-[12px] uppercase tracking-widest">
          Underwriting Audit Report
        </span>
        <span className="ml-auto text-[#94a3b8] text-[9px]">Multi-Agent Pipeline</span>
      </div>
      {/* Meta row */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[#1f2d40]">
        <span>
          <span className="font-semibold">Prepared by:</span> Multi-Agent Pipeline ({specialistCount}{" "}
          specialist{specialistCount !== 1 ? "s" : ""})
        </span>
        <span>
          <span className="font-semibold">Date:</span> {today}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-semibold">Decision:</span>
          <span
            className="px-2 py-[2px] text-[10px] font-bold uppercase tracking-wider"
            style={{ backgroundColor: badge.bg, color: badge.text }}
          >
            {decision.toUpperCase()}
          </span>
          <span className="text-[#6b7a8f]">({pct}% confidence)</span>
        </span>
      </div>
    </div>
  );
}

// ─── AuditReport (main) ───────────────────────────────────────────────────────

export function AuditReport({ data }: { data: AuditReportData }) {
  const specialistCount = Object.keys(data.findings).length;

  return (
    <div className="enc-sec mb-3 print:border-black">
      <h4 className="!bg-gradient-to-b from-[#1e3a5f] to-[#0d2445] !text-white">
        Structured Audit Report — Multi-Agent Findings
      </h4>
      <div className="p-3 bg-white">
        <ReportHeader
          decision={data.decision}
          confidence={data.confidence}
          specialistCount={specialistCount}
        />

        {data.riskScore && <RiskScoreMatrix score={data.riskScore} />}

        <SpecialistGrid
          findings={data.findings}
          specialistFindings={data.specialistFindings}
        />

        <IssuesAndFactors
          blockingIssues={data.blockingIssues}
          warnings={data.warnings}
          compensatingFactors={data.compensatingFactors}
        />

        <ExecutiveSummary text={data.executiveSummary} />

        <MinorityOpinions opinions={data.minorityOpinions} />
      </div>
    </div>
  );
}
