"use client";

import { useState, useTransition } from "react";
import type { PendingRecommendation, AgentStep, Condition } from "@twin/core";
import {
  actionAcceptRecommendation,
  actionClearRecommendation,
  actionRunAgent,
  actionAddCondition,
} from "@/app/loan/[loanId]/actions";

// ─── Text Utilities ───────────────────────────────────────────────────────────

function cleanMarkdown(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

// ─── Section Parser ───────────────────────────────────────────────────────────

function parseSections(rationale: string): Record<string, string> {
  const sections: Record<string, string> = {};
  try {
    const parts = rationale.split(/\n(?=#{2,3}\s)/);
    for (const part of parts) {
      const headingMatch = part.match(/^#{2,3}\s+(.+)/);
      if (headingMatch) {
        const raw = headingMatch[1] ?? "";
        const key = raw.toLowerCase().replace(/[—–\-].*/u, "").trim();
        sections[key] = part.replace(/^#{2,3}\s+.+\n/, "").trim();
      }
    }
    const preamble = rationale.split(/\n#{2,3}\s/)[0]?.trim() ?? "";
    sections["preamble"] = preamble;
  } catch {
    sections["preamble"] = rationale;
  }
  return sections;
}

// ─── Executive Summary ────────────────────────────────────────────────────────

function extractExecutiveSummary(sections: Record<string, string>): string {
  // Prefer ### Rationale section — cleanest prose
  const rationaleKey = Object.keys(sections).find((k) => k.includes("rationale"));
  if (rationaleKey && sections[rationaleKey]) {
    const text = sections[rationaleKey]!;
    // Take the first substantive paragraph
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const para = lines.find((l) => l.length > 30 && !l.startsWith("|") && !l.startsWith("#"));
    if (para) return cleanMarkdown(para);
  }
  // Fall back to preamble — first non-heading, non-empty paragraph
  const preamble = sections["preamble"] ?? "";
  const lines = preamble.split("\n").map((l) => l.trim()).filter(Boolean);
  const para = lines.find((l) => l.length > 30 && !l.startsWith("|") && !l.startsWith("#"));
  if (para) return cleanMarkdown(para);
  return "";
}

// ─── Key Metrics Parser ───────────────────────────────────────────────────────

interface Metric {
  label: string;
  value: string;
  status: "pass" | "fail" | "neutral";
}

function parseKeyMetrics(sections: Record<string, string>): Metric[] {
  const metrics: Metric[] = [];
  // Find the ## Final Underwriting Decision section (or similar)
  const decisionKey = Object.keys(sections).find(
    (k) => k.includes("final") || k.includes("underwriting") || k.includes("decision"),
  );
  const text = decisionKey ? (sections[decisionKey] ?? "") : (sections["preamble"] ?? "");

  // Parse the 2-col | Field | Detail | table
  const lines = text.split("\n");
  const WANT = new Set(["decision", "program", "ltv", "dti", "reserves", "dscr", "fico", "rate"]);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (/^\|[\s\-|]+\|$/.test(trimmed)) continue;
    const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const label = cleanMarkdown(cells[0] ?? "");
    const value = cleanMarkdown(cells[1] ?? "");
    if (!label || !value) continue;
    // Skip header rows
    if (/^(field|detail|check|item)$/i.test(label)) continue;
    const labelLower = label.toLowerCase();
    const relevant = [...WANT].some((k) => labelLower.includes(k));
    if (!relevant) continue;

    let status: Metric["status"] = "neutral";
    if (/✅/.test(cells[1] ?? "")) status = "pass";
    if (/❌/.test(cells[1] ?? "")) status = "fail";

    metrics.push({ label, value, status });
  }

  return metrics;
}

// ─── Findings Parser ──────────────────────────────────────────────────────────

interface Finding {
  num: number;
  item: string;
  statusText: string;
  status: "pass" | "fail" | "warning" | "info";
}

function parseFindings(sections: Record<string, string>): Finding[] {
  const findings: Finding[] = [];
  const findingsKey = Object.keys(sections).find((k) => k.includes("finding"));
  if (!findingsKey || !sections[findingsKey]) return findings;

  const lines = sections[findingsKey]!.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (/^\|[\s\-|]+\|$/.test(trimmed)) continue;
    const cells = trimmed.split("|").map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    // Expect: | # | Item | Status |
    const numRaw = cells[0] ?? "";
    const numMatch = numRaw.match(/^(\d+)$/);
    if (!numMatch) continue; // skip header rows like "# | Item | Status"

    const num = parseInt(numMatch[1]!, 10);
    const item = cleanMarkdown(cells[1] ?? "");
    const statusCell = cells[2] ?? cells[1] ?? "";
    const statusText = cleanMarkdown(statusCell);

    let status: Finding["status"] = "info";
    if (/✅/.test(statusCell)) status = "pass";
    else if (/❌/.test(statusCell)) status = "fail";
    else if (/⚠️/.test(statusCell)) status = "warning";

    if (item) findings.push({ num, item, statusText, status });
  }

  return findings;
}

// ─── Blockers Parser ──────────────────────────────────────────────────────────

interface Blocker {
  title: string;
  detail: string;
}

function parseBlockers(sections: Record<string, string>): Blocker[] {
  const blockers: Blocker[] = [];
  const blockKey = Object.keys(sections).find(
    (k) => k.includes("block") || k.includes("hard stop"),
  );
  if (!blockKey || !sections[blockKey]) return blockers;

  const text = sections[blockKey]!;
  // Numbered list items: "1. **Title:** detail..."
  const itemRegex = /^\d+\.\s+(.+)/gm;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(text)) !== null) {
    const raw = match[1] ?? "";
    const cleaned = cleanMarkdown(raw);
    // Split on first colon or em-dash for title vs detail
    const colonIdx = cleaned.search(/[:—–]/);
    const title = colonIdx > 0 ? cleaned.slice(0, colonIdx).trim() : cleaned.slice(0, 80).trim();
    const detail = colonIdx > 0 ? cleaned.slice(colonIdx + 1).trim() : "";
    blockers.push({ title, detail });
  }

  return blockers;
}

// ─── Conditions Parser ────────────────────────────────────────────────────────

function parseConditionsFromSections(sections: Record<string, string>): string[] {
  const condKey = Object.keys(sections).find((k) => k.includes("condition"));
  if (!condKey || !sections[condKey]) return [];

  const lines = sections[condKey]!.split("\n");
  const conditions: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Match "- C1: ..." or "- ..." list items
    const m = trimmed.match(/^-\s+(?:C\d+:\s*)?(.+)/);
    if (m && m[1] && m[1].length > 3) {
      conditions.push(cleanMarkdown(m[1]));
    }
  }
  return conditions;
}

// ─── DecisionBadge ────────────────────────────────────────────────────────────

function DecisionBadge({ decision, confidence }: { decision: string; confidence: number }) {
  const pct = Math.round(confidence * 100);
  const colors: Record<string, { bg: string; bar: string; text: string }> = {
    approved: { bg: "bg-[#1b5e20]", bar: "bg-[#4caf50]", text: "text-white" },
    denied: { bg: "bg-[#8a0000]", bar: "bg-[#e53935]", text: "text-white" },
    suspended: { bg: "bg-[#8a4b00]", bar: "bg-[#ff9800]", text: "text-white" },
    counter: { bg: "bg-[#0d47a1]", bar: "bg-[#42a5f5]", text: "text-white" },
  };
  const c = colors[decision.toLowerCase()] ?? colors["suspended"]!;
  return (
    <div className="flex items-center gap-4">
      <div
        className={`${c.bg} ${c.text} px-5 py-2 text-[14px] font-bold uppercase tracking-wider min-w-[110px] text-center`}
      >
        {decision}
      </div>
      <div className="flex-1">
        <div className="text-[10px] text-[#404040] mb-1">Confidence: {pct}%</div>
        <div className="h-[8px] bg-[#e0dfdb] w-full rounded-sm overflow-hidden">
          <div className={`h-full ${c.bar} rounded-sm transition-all`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}

// ─── KeyMetricsGrid ───────────────────────────────────────────────────────────

function KeyMetricsGrid({ metrics }: { metrics: Metric[] }) {
  if (metrics.length === 0) return null;

  const STATUS_ICON: Record<Metric["status"], string> = {
    pass: "✅",
    fail: "❌",
    neutral: "",
  };

  return (
    <div className="enc-sec mb-3">
      <h4>Key Metrics</h4>
      <div className="p-2 grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
        {metrics.map((m, i) => (
          <div
            key={i}
            className={`enc-field flex flex-col justify-between min-h-[40px] ${
              m.status === "fail"
                ? "bg-[#fde8e8] border-[#c00]"
                : m.status === "pass"
                  ? "bg-[#f0fdf4]"
                  : "bg-white"
            }`}
          >
            <div className="text-[8px] font-bold text-[#404040] uppercase tracking-wide leading-tight">
              {m.label}
            </div>
            <div className="text-[11px] font-bold text-[#1f2d40] leading-snug mt-[2px]">
              {STATUS_ICON[m.status] ? `${STATUS_ICON[m.status]} ` : ""}
              {m.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── BlockersSection ──────────────────────────────────────────────────────────

function BlockersSection({ blockers }: { blockers: Blocker[] }) {
  if (blockers.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="text-[10px] font-bold text-[#8a0000] uppercase tracking-wide mb-1">
        Blocking Issues
      </div>
      {blockers.map((b, i) => (
        <div
          key={i}
          className="p-2 mb-1 border-l-4 border-[#c00] bg-[#fde8e8] text-[10px]"
        >
          <div className="font-bold text-[#8a0000]">🚫 {b.title}</div>
          {b.detail && <div className="text-[#404040] mt-[3px]">{b.detail}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── FindingsTable ────────────────────────────────────────────────────────────

function FindingsTable({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;

  const STATUS = {
    pass: { icon: "✅", cls: "text-[#1b5e20]", label: "Pass" },
    fail: { icon: "❌", cls: "text-[#8a0000] font-bold", label: "Fail" },
    warning: { icon: "⚠️", cls: "text-[#8a4b00]", label: "Warning" },
    info: { icon: "ℹ️", cls: "text-[#0d47a1]", label: "Info" },
  };

  return (
    <div className="enc-sec mb-3">
      <h4>Findings</h4>
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr className="bg-[#d4d0c8]">
            <th className="text-left px-2 py-[3px] border-r border-[#b7c2d3] w-[28px]">#</th>
            <th className="text-left px-2 py-[3px] border-r border-[#b7c2d3]">Check</th>
            <th className="text-left px-2 py-[3px] w-[70px]">Result</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f, i) => {
            const s = STATUS[f.status];
            return (
              <tr
                key={i}
                className={`${
                  f.status === "fail"
                    ? "bg-[#fde8e8]"
                    : i % 2
                      ? "bg-[#f5f3e8]"
                      : ""
                }`}
              >
                <td className="px-2 py-[2px] border-b border-[#c8c4b5] text-center">{f.num}</td>
                <td className="px-2 py-[2px] border-b border-[#c8c4b5]">{f.item}</td>
                <td className={`px-2 py-[2px] border-b border-[#c8c4b5] ${s.cls} whitespace-nowrap`}>
                  {s.icon} {f.statusText || s.label}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── ConditionsList ───────────────────────────────────────────────────────────

function isSimilarCondition(suggested: string, existing: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 40);
  const a = normalize(suggested);
  const b = normalize(existing);
  if (a === b) return true;
  // Check if one contains a significant substring of the other
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  return shorter.length > 10 && longer.includes(shorter.slice(0, 20));
}

function ConditionsList({
  loanId,
  conditions,
  existingConditions,
  pending,
}: {
  loanId: string;
  conditions: string[];
  existingConditions: Condition[];
  pending: boolean;
}) {
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [, startTransition] = useTransition();

  const existingDescs = existingConditions.map((c) => c.description);
  const duplicateSet = new Set<number>();
  conditions.forEach((c, i) => {
    if (existingDescs.some((e) => isSimilarCondition(c, e))) duplicateSet.add(i);
  });

  const addableCount = conditions.filter((_, i) => !duplicateSet.has(i) && !added.has(i)).length;

  const addOne = (idx: number, desc: string) => {
    startTransition(async () => {
      await actionAddCondition(loanId, {
        category: "PTD" as const,
        source: "UW" as const,
        description: desc,
      });
      setAdded((prev) => new Set(prev).add(idx));
    });
  };

  const addAll = () => {
    startTransition(async () => {
      for (let i = 0; i < conditions.length; i++) {
        const desc = conditions[i];
        if (!added.has(i) && !duplicateSet.has(i) && desc !== undefined) {
          await actionAddCondition(loanId, {
            category: "PTD" as const,
            source: "UW" as const,
            description: desc,
          });
        }
      }
      setAdded(new Set(conditions.map((_, i) => i)));
    });
  };

  if (conditions.length === 0) return null;

  return (
    <div className="enc-sec mb-3">
      <h4>Suggested Conditions</h4>
      <div className="p-2">
        {addableCount > 0 && (
          <div className="flex items-center gap-2 mb-2">
            <button
              className="enc-btn enc-btn--primary text-[10px]"
              disabled={pending || addableCount === 0}
              onClick={addAll}
            >
              Add All New to Loan ({addableCount} remaining)
            </button>
          </div>
        )}
        {conditions.map((c, i) => {
          const isDuplicate = duplicateSet.has(i);
          const isAdded = added.has(i);
          return (
            <div
              key={i}
              className={`flex items-center gap-2 py-1 border-b border-[#e0dfdb] text-[10px] ${isDuplicate || isAdded ? "opacity-50" : ""}`}
            >
              <span className="font-bold w-[20px] shrink-0">{i + 1}.</span>
              <span className="flex-1">{c}</span>
              {isDuplicate ? (
                <span className="text-[#0a52a0] text-[9px] whitespace-nowrap">Already on loan</span>
              ) : isAdded ? (
                <span className="text-[#1b5e20] text-[9px]">✓ Added</span>
              ) : (
                <button
                  className="enc-btn text-[9px] shrink-0"
                  disabled={pending}
                  onClick={() => addOne(i, c)}
                >
                  + Add
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ReasoningTrace ───────────────────────────────────────────────────────────

function ReasoningTrace({ trace }: { trace: AgentStep[] }) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  type GroupKey = "tool" | "analysis" | "validation" | "decision";
  const groups: Record<GroupKey, { icon: string; label: string; steps: AgentStep[] }> = {
    tool: { icon: "🔧", label: "Tool Calls", steps: [] },
    analysis: { icon: "💭", label: "Analysis", steps: [] },
    validation: { icon: "🔍", label: "Data Quality Checks", steps: [] },
    decision: { icon: "📋", label: "Decision Synthesis", steps: [] },
  };

  for (const step of trace) {
    if (step.phase === "tool_call" || step.phase === "tool_result") {
      groups.tool.steps.push(step);
    } else if (step.phase === "thinking" || step.phase === "message") {
      groups.analysis.steps.push(step);
    } else if (step.phase === "validation") {
      groups.validation.steps.push(step);
    } else {
      groups.decision.steps.push(step);
    }
  }

  const toggle = (key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <div className="enc-sec mb-3">
      <h4>Reasoning Trace — {trace.length} steps</h4>
      <div className="p-2">
        {Object.entries(groups)
          .filter(([, g]) => g.steps.length > 0)
          .map(([key, group]) => (
            <div key={key} className="mb-1">
              <button
                className="w-full text-left px-2 py-1 bg-[#f6f8fb] border border-[#c8c4b5] text-[10px] font-bold hover:bg-[#e8f0fe]"
                onClick={() => toggle(key)}
              >
                {openGroups.has(key) ? "▼" : "▶"} {group.icon} {group.label} ({group.steps.length})
              </button>
              {openGroups.has(key) && (
                <div className="border border-t-0 border-[#c8c4b5] max-h-[250px] overflow-auto">
                  {group.steps.map((step, i) => (
                    <div
                      key={i}
                      className={`p-2 border-b border-[#e0dfdb] text-[10px] ${
                        step.phase === "tool_call"
                          ? "bg-[#f0f5ff]"
                          : step.phase === "tool_result"
                            ? "bg-[#f5f0ff]"
                            : ""
                      }`}
                    >
                      <div className="font-bold text-[9px] text-[#404040] uppercase">
                        {step.phase}
                      </div>
                      <div className="whitespace-pre-wrap break-words mt-1">
                        {step.content.slice(0, 500)}
                        {step.content.length > 500 && "…"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

// ─── Main RecommendationPanel ─────────────────────────────────────────────────

export function RecommendationPanel({
  loanId,
  rec,
  existingConditions = [],
}: {
  loanId: string;
  rec: PendingRecommendation;
  existingConditions?: Condition[];
}) {
  const [pending, startTransition] = useTransition();

  const accept = () =>
    startTransition(() => {
      actionAcceptRecommendation(loanId);
    });

  const acceptWithConditions = () => {
    startTransition(async () => {
      for (const c of rec.conditions) {
        await actionAddCondition(loanId, {
          category: "PTD" as const,
          source: "UW" as const,
          description: c,
        });
      }
      await actionAcceptRecommendation(loanId);
    });
  };

  const reject = () =>
    startTransition(() => {
      actionClearRecommendation(loanId);
    });

  const rerun = () =>
    startTransition(() => {
      actionRunAgent(loanId);
    });

  // Parse rationale into structured sections
  const sections = parseSections(rec.rationale);
  const summary = extractExecutiveSummary(sections);
  const metrics = parseKeyMetrics(sections);
  const findings = parseFindings(sections);
  const blockers = parseBlockers(sections);

  // Merge conditions: rec.conditions first, then any from rationale not already present
  const rationaleConditions = parseConditionsFromSections(sections);
  const allConditions = [
    ...rec.conditions,
    ...rationaleConditions.filter(
      (rc) => !rec.conditions.some((c) => c.toLowerCase().slice(0, 30) === rc.toLowerCase().slice(0, 30)),
    ),
  ];

  return (
    <div className="enc-sec mt-2 border-2 border-[#0a52a0]">
      <h4 className="!bg-gradient-to-b from-[#d79a1f] to-[#8a6110]">
        AI Underwriting Report — mlb-uw-agent
      </h4>
      <div className="p-3 bg-[#fffdf5]">

        {/* 1. Header — Decision + Confidence + Summary */}
        <div className="mb-3 p-3 bg-white border border-[#c8c4b5]">
          <div className="mb-3">
            <DecisionBadge decision={rec.recommendation} confidence={rec.confidence} />
          </div>
          {summary && (
            <div className="text-[11px] text-[#1f2d40] leading-relaxed mb-2">{summary}</div>
          )}
          <div className="text-[9px] text-[#707070]">
            Analyzed {new Date(rec.stagedAt).toLocaleString()} &middot; {rec.stagedBy}
          </div>
        </div>

        {/* 2. Blockers — first thing a UW reads on a denied loan */}
        <BlockersSection blockers={blockers} />

        {/* 3. Key Metrics Grid */}
        <KeyMetricsGrid metrics={metrics} />

        {/* 4. Findings Table */}
        <FindingsTable findings={findings} />

        {/* 5. Suggested Conditions */}
        <ConditionsList loanId={loanId} conditions={allConditions} existingConditions={existingConditions} pending={pending} />

        {/* 6. Reasoning Trace — collapsed by default */}
        <ReasoningTrace trace={rec.trace} />

        {/* 7. Sticky Action Bar */}
        <div className="sticky bottom-0 flex items-center gap-2 p-3 bg-[#ece9d8] border-t-2 border-[#6b7a8f] -mx-3 -mb-3">
          <button className="enc-btn enc-btn--primary" disabled={pending} onClick={accept}>
            ✓ Accept
          </button>
          {allConditions.length > 0 && (
            <button
              className="enc-btn enc-btn--primary"
              disabled={pending}
              onClick={acceptWithConditions}
            >
              ✓ Accept + Conditions
            </button>
          )}
          <button className="enc-btn" disabled={pending} onClick={reject}>
            ✗ Reject
          </button>
          <button className="enc-btn" disabled={pending} onClick={rerun}>
            ↻ Re-run
          </button>
          <span className="text-[9px] text-[#404040] ml-auto">
            Accept converts to {rec.recommendation.toUpperCase()} decision
          </span>
        </div>
      </div>
    </div>
  );
}
