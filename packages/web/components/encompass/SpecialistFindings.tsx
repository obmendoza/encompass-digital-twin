"use client";

import { useState } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────

interface PipelineUsage {
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
  per_agent: Record<string, {
    input_tokens: number;
    output_tokens: number;
    model: string;
    cost_usd: number;
  }>;
}

interface SpecialistFindingsProps {
  findings: {
    _pipeline_usage?: PipelineUsage;
    doc_review?: {
      recommendation: string;
      summary: string;
      missing_documents?: string[];
      documents_reviewed?: number;
      documents_with_files?: number;
      conditions_unsatisfied?: number;
    };
    income_analysis?: {
      recommendation: string;
      summary: string;
      dti_back?: number;
      guideline_max_dti?: number;
      qualifying_method?: string;
      derived_monthly_income?: number;
      anomalies?: string[];
    };
    credit_assessment?: {
      recommendation: string;
      summary: string;
      fico_score?: number;
      min_fico_required?: number;
      derogatory_items?: string[];
      late_payments?: { "30d": number; "60d": number; "90d": number };
    };
    compliance?: {
      recommendation: string;
      summary: string;
      geo_eligible?: boolean;
      geo_blocks?: string[];
      compliance_flags?: Array<{ severity: string; description: string }>;
    };
    risk_synthesis?: {
      recommended_decision: string;
      confidence: number;
      executive_summary: string;
      risk_score?: { tier: string; composite: number };
      blocking_issues?: string[];
      conditions_to_add?: string[];
      compensating_factors?: string[];
      warnings?: string[];
    };
  };
}

// ─── Badge Utilities ───────────────────────────────────────────────────────

type BadgeTier = "pass" | "marginal" | "fail" | "error" | "unknown";

function classifyRecommendation(rec: string): BadgeTier {
  const r = rec.toLowerCase();
  if (r === "error") return "error";
  if (["pass", "approved", "clear"].includes(r)) return "pass";
  if (["marginal", "conditional", "needs_docs", "needs_review"].includes(r)) return "marginal";
  if (["fail", "critical_missing", "critical", "denied", "suspend", "suspended", "hard_stop"].includes(r)) return "fail";
  return "unknown";
}

const BADGE_CLASSES: Record<BadgeTier, string> = {
  pass:     "bg-green-100 text-green-800 border border-green-300",
  marginal: "bg-yellow-100 text-yellow-800 border border-yellow-300",
  fail:     "bg-red-100 text-red-800 border border-red-300",
  error:    "bg-gray-100 text-gray-600 border border-gray-300",
  unknown:  "bg-gray-100 text-gray-600 border border-gray-300",
};

const BADGE_LABELS: Record<string, string> = {
  pass:             "PASS",
  approved:         "PASS",
  clear:            "PASS",
  marginal:         "MARGINAL",
  conditional:      "CONDITIONAL",
  needs_docs:       "NEEDS DOCS",
  needs_review:     "NEEDS REVIEW",
  fail:             "FAIL",
  critical_missing: "CRITICAL",
  critical:         "CRITICAL",
  denied:           "FAIL",
  suspend:          "FAIL",
  suspended:        "FAIL",
  hard_stop:        "CRITICAL",
  error:            "ERROR",
};

function StatusBadge({ recommendation }: { recommendation: string }) {
  const tier = classifyRecommendation(recommendation);
  const label = BADGE_LABELS[recommendation.toLowerCase()] ?? recommendation.toUpperCase();
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${BADGE_CLASSES[tier]}`}>
      {label}
    </span>
  );
}

// ─── Risk Tier Badge ───────────────────────────────────────────────────────

function riskTierClasses(tier: string): string {
  const t = tier.toUpperCase();
  if (t === "LOW")       return "bg-green-100 text-green-800 border border-green-300";
  if (t === "MODERATE")  return "bg-yellow-100 text-yellow-800 border border-yellow-300";
  if (t === "HIGH")      return "bg-orange-100 text-orange-800 border border-orange-300";
  if (t === "VERY_HIGH") return "bg-red-100 text-red-800 border border-red-300";
  return "bg-gray-100 text-gray-700 border border-gray-300";
}

function RiskTierBadge({ tier }: { tier: string }) {
  return (
    <div className={`px-3 py-2 rounded text-center font-bold min-w-[80px] shrink-0 ${riskTierClasses(tier)}`}>
      <div className="text-[13px]">{tier.replace("_", " ")}</div>
      <div className="text-[10px] font-normal opacity-75">Risk</div>
    </div>
  );
}

// ─── Expandable Section ────────────────────────────────────────────────────

function ExpandableSection({
  label,
  count,
  defaultOpen = false,
  children,
}: {
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const header = count !== undefined ? `${label} (${count})` : label;
  return (
    <div className="mt-2">
      <button
        className="flex items-center gap-1 text-[11px] text-[#1a2b4a] font-medium hover:text-[#1f4478] transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-[10px]">{open ? "▾" : "▸"}</span>
        {header}
      </button>
      {open && <div className="mt-1 pl-3">{children}</div>}
    </div>
  );
}

// ─── Bullet List ───────────────────────────────────────────────────────────

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-1.5 text-[11px] text-[#374151]">
          <span className="mt-[2px] text-[#6b7a8f] shrink-0">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Metric Row ────────────────────────────────────────────────────────────

function MetricRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-[#6b7a8f] min-w-[140px]">{label}:</span>
      <span className={`font-medium ${highlight ? "text-red-700" : "text-[#1a2b4a]"}`}>{value}</span>
    </div>
  );
}

// ─── Shared Card Wrapper ───────────────────────────────────────────────────

function SpecialistCard({
  icon,
  title,
  recommendation,
  isError,
  summary,
  metrics,
  sections,
}: {
  icon: string;
  title: string;
  recommendation: string;
  isError: boolean;
  summary: string;
  metrics?: React.ReactNode;
  sections?: React.ReactNode;
}) {
  if (isError) {
    return (
      <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
        <div className="flex items-center gap-2">
          <span>{icon}</span>
          <span className="text-[12px] font-semibold text-gray-500">{title}</span>
          <span className="ml-auto"><StatusBadge recommendation={recommendation} /></span>
        </div>
        <p className="mt-1 text-[11px] text-gray-500">{summary}</p>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-200">
        <span>{icon}</span>
        <span className="text-[12px] font-semibold text-[#1a2b4a]">{title}</span>
        <span className="ml-auto"><StatusBadge recommendation={recommendation} /></span>
      </div>
      <div className="px-3 py-2">
        <p className="text-[11px] text-[#374151] leading-relaxed">{summary}</p>
        {metrics && <div className="mt-2 space-y-0.5">{metrics}</div>}
        {sections}
      </div>
    </div>
  );
}

// ─── Doc Review Card ──────────────────────────────────────────────────────

function DocReviewCard({
  data,
}: {
  data: NonNullable<SpecialistFindingsProps["findings"]["doc_review"]>;
}) {
  const isError = data.recommendation.toLowerCase() === "error";
  return (
    <SpecialistCard
      icon="📄"
      title="Doc Review"
      recommendation={data.recommendation}
      isError={isError}
      summary={data.summary}
      metrics={
        <>
          {data.documents_reviewed !== undefined && (
            <MetricRow label="Documents Reviewed" value={data.documents_reviewed} />
          )}
          {data.documents_with_files !== undefined && (
            <MetricRow label="With Files" value={data.documents_with_files} />
          )}
          {data.conditions_unsatisfied !== undefined && (
            <MetricRow
              label="Conditions Unsatisfied"
              value={data.conditions_unsatisfied}
              highlight={data.conditions_unsatisfied > 0}
            />
          )}
        </>
      }
      sections={
        <>
          {data.missing_documents && data.missing_documents.length > 0 && (
            <ExpandableSection
              label="Missing Documents"
              count={data.missing_documents.length}
              defaultOpen={data.missing_documents.length > 0}
            >
              <BulletList items={data.missing_documents} />
            </ExpandableSection>
          )}
          <ExpandableSection label="Details">
            <p className="text-[11px] text-[#6b7a8f] italic">
              Doc review completed. See summary above for full details.
            </p>
          </ExpandableSection>
        </>
      }
    />
  );
}

// ─── Income Analysis Card ──────────────────────────────────────────────────

function IncomeAnalysisCard({
  data,
}: {
  data: NonNullable<SpecialistFindingsProps["findings"]["income_analysis"]>;
}) {
  const isError = data.recommendation.toLowerCase() === "error";
  const dtiOver =
    data.dti_back !== undefined && data.guideline_max_dti !== undefined
      ? data.dti_back > data.guideline_max_dti
      : false;

  return (
    <SpecialistCard
      icon="💰"
      title="Income Analysis"
      recommendation={data.recommendation}
      isError={isError}
      summary={data.summary}
      metrics={
        <>
          {data.dti_back !== undefined && (
            <MetricRow
              label="Back-End DTI"
              value={`${(data.dti_back * 100).toFixed(1)}%`}
              highlight={dtiOver}
            />
          )}
          {data.guideline_max_dti !== undefined && (
            <MetricRow
              label="Guideline Max DTI"
              value={`${(data.guideline_max_dti * 100).toFixed(1)}%`}
            />
          )}
          {data.qualifying_method && (
            <MetricRow label="Qualifying Method" value={data.qualifying_method} />
          )}
          {data.derived_monthly_income !== undefined && (
            <MetricRow
              label="Derived Monthly Income"
              value={`$${data.derived_monthly_income.toLocaleString()}`}
            />
          )}
        </>
      }
      sections={
        <>
          {data.anomalies && data.anomalies.length > 0 && (
            <ExpandableSection label="Anomalies" count={data.anomalies.length} defaultOpen>
              <BulletList items={data.anomalies} />
            </ExpandableSection>
          )}
          <ExpandableSection label="Details">
            <p className="text-[11px] text-[#6b7a8f] italic">
              Income analysis completed. See metrics above for key findings.
            </p>
          </ExpandableSection>
        </>
      }
    />
  );
}

// ─── Credit Assessment Card ────────────────────────────────────────────────

function CreditAssessmentCard({
  data,
}: {
  data: NonNullable<SpecialistFindingsProps["findings"]["credit_assessment"]>;
}) {
  const isError = data.recommendation.toLowerCase() === "error";
  const ficoBelowMin =
    data.fico_score !== undefined && data.min_fico_required !== undefined
      ? data.fico_score < data.min_fico_required
      : false;

  const lp = data.late_payments;
  const lateTotal = lp ? (lp["30d"] ?? 0) + (lp["60d"] ?? 0) + (lp["90d"] ?? 0) : 0;

  return (
    <SpecialistCard
      icon="📊"
      title="Credit Assessment"
      recommendation={data.recommendation}
      isError={isError}
      summary={data.summary}
      metrics={
        <>
          {data.fico_score !== undefined && (
            <MetricRow label="FICO Score" value={data.fico_score} highlight={ficoBelowMin} />
          )}
          {data.min_fico_required !== undefined && (
            <MetricRow label="Min FICO Required" value={data.min_fico_required} />
          )}
          {lp && lateTotal > 0 && (
            <MetricRow
              label="Late Payments (30/60/90)"
              value={`${lp["30d"]}/${lp["60d"]}/${lp["90d"]}`}
              highlight
            />
          )}
        </>
      }
      sections={
        <>
          {data.derogatory_items && data.derogatory_items.length > 0 && (
            <ExpandableSection
              label="Derogatory Items"
              count={data.derogatory_items.length}
              defaultOpen
            >
              <BulletList items={data.derogatory_items} />
            </ExpandableSection>
          )}
          <ExpandableSection label="Details">
            <p className="text-[11px] text-[#6b7a8f] italic">
              Credit assessment completed. See metrics above for key findings.
            </p>
          </ExpandableSection>
        </>
      }
    />
  );
}

// ─── Compliance Card ───────────────────────────────────────────────────────

function ComplianceCard({
  data,
}: {
  data: NonNullable<SpecialistFindingsProps["findings"]["compliance"]>;
}) {
  const isError = data.recommendation.toLowerCase() === "error";
  const flags = data.compliance_flags ?? [];
  const severeFlags = flags.filter(
    (f) => f.severity.toLowerCase() === "violation" || f.severity.toLowerCase() === "error",
  );
  const warnFlags = flags.filter((f) => f.severity.toLowerCase() === "warning");

  return (
    <SpecialistCard
      icon="⚖️"
      title="Compliance"
      recommendation={data.recommendation}
      isError={isError}
      summary={data.summary}
      metrics={
        data.geo_eligible !== undefined ? (
          <MetricRow
            label="Geo Eligible"
            value={data.geo_eligible ? "Yes" : "No"}
            highlight={!data.geo_eligible}
          />
        ) : undefined
      }
      sections={
        <>
          {data.geo_blocks && data.geo_blocks.length > 0 && (
            <ExpandableSection label="Geo Blocks" count={data.geo_blocks.length} defaultOpen>
              <BulletList items={data.geo_blocks} />
            </ExpandableSection>
          )}
          {severeFlags.length > 0 && (
            <ExpandableSection label="Violations" count={severeFlags.length} defaultOpen>
              <BulletList
                items={severeFlags.map((f) => `${f.severity.toUpperCase()}: ${f.description}`)}
              />
            </ExpandableSection>
          )}
          {warnFlags.length > 0 && (
            <ExpandableSection label="Warnings" count={warnFlags.length}>
              <BulletList items={warnFlags.map((f) => f.description)} />
            </ExpandableSection>
          )}
          {flags.length === 0 && (
            <p className="mt-2 text-[11px] text-green-700">No compliance flags.</p>
          )}
          <ExpandableSection label="Details">
            <p className="text-[11px] text-[#6b7a8f] italic">
              Compliance check completed. See flags above for full details.
            </p>
          </ExpandableSection>
        </>
      }
    />
  );
}

// ─── Risk Synthesis Card ───────────────────────────────────────────────────

function RiskSynthesisCard({
  data,
}: {
  data: NonNullable<SpecialistFindingsProps["findings"]["risk_synthesis"]>;
}) {
  const confidencePct = Math.round(data.confidence * 100);
  const blockingIssues = data.blocking_issues ?? [];
  const conditions = data.conditions_to_add ?? [];
  const compensating = data.compensating_factors ?? [];
  const warnings = data.warnings ?? [];

  return (
    <div className="border-2 border-gray-300 rounded-lg overflow-hidden bg-white shadow-sm">
      {/* Header */}
      <div className="px-3 py-2 bg-[#1a2b4a] border-b border-gray-300">
        <div className="flex items-center gap-2">
          <span>🎯</span>
          <span className="text-[13px] font-bold text-white">Risk Synthesis</span>
        </div>
      </div>

      <div className="px-3 py-3">
        {/* Decision row */}
        <div className="flex items-start gap-4">
          {data.risk_score?.tier && <RiskTierBadge tier={data.risk_score.tier} />}
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#6b7a8f]">Decision:</span>
              <span className="text-[13px] font-bold text-[#1a2b4a]">
                {data.recommended_decision.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#6b7a8f]">Confidence:</span>
              <span className="text-[12px] font-semibold text-[#1a2b4a]">{confidencePct}%</span>
            </div>
            {data.risk_score?.composite !== undefined && (
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[#6b7a8f]">Risk Score:</span>
                <span className="text-[12px] font-semibold text-[#1a2b4a]">
                  {data.risk_score.composite}
                </span>
              </div>
            )}
            {blockingIssues.length > 0 && (
              <div className="text-[11px] text-red-700 font-medium">
                {blockingIssues.length} Blocking Issue{blockingIssues.length !== 1 ? "s" : ""}
              </div>
            )}
            {conditions.length > 0 && (
              <div className="text-[11px] text-[#1a2b4a]">
                {conditions.length} Condition{conditions.length !== 1 ? "s" : ""}
              </div>
            )}
            {compensating.length > 0 && (
              <div className="text-[11px] text-green-700">
                {compensating.length} Compensating Factor{compensating.length !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="mt-3 border-t border-gray-200" />

        {/* Executive summary */}
        <p className="mt-2 text-[11px] text-[#374151] leading-relaxed">{data.executive_summary}</p>

        {/* Divider */}
        <div className="mt-3 border-t border-gray-200" />

        {/* Expandable sections */}
        {blockingIssues.length > 0 && (
          <ExpandableSection label="Blocking Issues" count={blockingIssues.length} defaultOpen>
            <ul className="space-y-1">
              {blockingIssues.map((issue, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-red-700">
                  <span className="mt-[2px] shrink-0 font-bold">•</span>
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
          </ExpandableSection>
        )}

        {conditions.length > 0 && (
          <ExpandableSection label="Conditions" count={conditions.length} defaultOpen>
            <BulletList items={conditions} />
          </ExpandableSection>
        )}

        {compensating.length > 0 && (
          <ExpandableSection label="Compensating Factors" count={compensating.length}>
            <ul className="space-y-1">
              {compensating.map((factor, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-green-700">
                  <span className="mt-[2px] shrink-0">•</span>
                  <span>{factor}</span>
                </li>
              ))}
            </ul>
          </ExpandableSection>
        )}

        {warnings.length > 0 && (
          <ExpandableSection label="Warnings" count={warnings.length}>
            <BulletList items={warnings} />
          </ExpandableSection>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

function PipelineCostBar({ usage }: { usage: PipelineUsage }) {
  const agentNames: Record<string, string> = {
    doc_review: "Doc Review",
    income_analysis: "Income",
    credit_assessment: "Credit",
    compliance: "Compliance",
    risk_synthesis: "Risk Synthesis",
  };

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 mb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] font-bold text-gray-700 uppercase tracking-wider">
          AI Pipeline Cost
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          <span className="text-gray-500">
            Tokens: <span className="font-bold text-gray-800">{usage.total_tokens.toLocaleString()}</span>
          </span>
          <span className="text-gray-500">
            Cost: <span className="font-bold text-gray-800">${usage.total_cost_usd.toFixed(4)}</span>
          </span>
        </div>
      </div>
      <div className="flex gap-1">
        {Object.entries(usage.per_agent).map(([key, agent]) => {
          const pct = usage.total_cost_usd > 0
            ? (agent.cost_usd / usage.total_cost_usd) * 100
            : 0;
          const isOpus = agent.model.includes("opus");
          return (
            <div
              key={key}
              className={`h-2 rounded-full ${isOpus ? "bg-blue-600" : "bg-blue-300"}`}
              style={{ width: `${Math.max(pct, 2)}%` }}
              title={`${agentNames[key] ?? key}: ${agent.input_tokens + agent.output_tokens} tokens ($${agent.cost_usd.toFixed(4)}) — ${agent.model}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-2">
        {Object.entries(usage.per_agent).map(([key, agent]) => (
          <div key={key} className="text-[9px] text-gray-500">
            <span className="font-medium text-gray-600">{agentNames[key] ?? key}:</span>{" "}
            {(agent.input_tokens + agent.output_tokens).toLocaleString()} tok · ${agent.cost_usd.toFixed(4)}
            {agent.model.includes("opus") && <span className="ml-1 text-blue-600">(Opus)</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SpecialistFindings({ findings }: SpecialistFindingsProps) {
  const { doc_review, income_analysis, credit_assessment, compliance, risk_synthesis, _pipeline_usage } = findings;

  const hasAnySpecialist = doc_review || income_analysis || credit_assessment || compliance;
  const hasRiskSynthesis = !!risk_synthesis;

  if (!hasAnySpecialist && !hasRiskSynthesis) {
    return (
      <div className="border border-gray-200 rounded-lg p-4 text-center text-[11px] text-[#6b7a8f]">
        No specialist findings available.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {_pipeline_usage && <PipelineCostBar usage={_pipeline_usage} />}
      {doc_review && <DocReviewCard data={doc_review} />}
      {income_analysis && <IncomeAnalysisCard data={income_analysis} />}
      {credit_assessment && <CreditAssessmentCard data={credit_assessment} />}
      {compliance && <ComplianceCard data={compliance} />}
      {risk_synthesis && <RiskSynthesisCard data={risk_synthesis} />}
    </div>
  );
}
