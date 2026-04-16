"use client";

import { useState, useTransition } from "react";
import type { PendingRecommendation, AgentStep } from "@twin/core";
import {
  actionAcceptRecommendation,
  actionClearRecommendation,
  actionRunAgent,
  actionAddCondition,
} from "@/app/loan/[loanId]/actions";

// ─── Decision Badge + Confidence Meter ───────────────────────────────────────

function DecisionBadge({ decision, confidence }: { decision: string; confidence: number }) {
  const pct = Math.round(confidence * 100);
  const colors: Record<string, { bg: string; bar: string; text: string }> = {
    approved: { bg: "bg-[#1b5e20]", bar: "bg-[#4caf50]", text: "text-white" },
    denied: { bg: "bg-[#8a0000]", bar: "bg-[#e53935]", text: "text-white" },
    suspended: { bg: "bg-[#8a4b00]", bar: "bg-[#ff9800]", text: "text-white" },
    counter: { bg: "bg-[#0d47a1]", bar: "bg-[#42a5f5]", text: "text-white" },
  };
  const c = colors[decision] ?? colors.suspended!;
  return (
    <div className="flex items-center gap-4">
      <div className={`${c.bg} ${c.text} px-5 py-2 text-[14px] font-bold uppercase tracking-wider`}>
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

// ─── Markdown Parser Utilities ────────────────────────────────────────────────

interface Finding {
  item: string;
  status: "pass" | "fail" | "warning" | "info";
  detail: string;
  guideline?: string;
  actual?: string;
}

interface RiskFlag {
  severity: "warning" | "blocker";
  title: string;
  detail: string;
}

function parseFindings(text: string): Finding[] {
  const findings: Finding[] = [];

  // Match markdown table rows with status indicators
  // Pattern: | number | item | status | detail |
  const tableRowRegex =
    /\|\s*\d+\s*\|\s*\*?\*?(.+?)\*?\*?\s*\|\s*(✅|❌|⚠️|ℹ️)?\s*(Pass|Fail|HARD BLOCK|Warning|Info|N\/A)?\s*\|\s*(.+?)\s*\|/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRowRegex.exec(text)) !== null) {
    const item = match[1]!.replace(/\*\*/g, "").trim();
    const statusText = (match[3] ?? "").toLowerCase();
    let status: Finding["status"] = "info";
    if (statusText.includes("pass")) status = "pass";
    else if (statusText.includes("fail") || statusText.includes("block")) status = "fail";
    else if (statusText.includes("warn")) status = "warning";
    findings.push({ item, status, detail: match[4]!.replace(/\*\*/g, "").trim() });
  }

  // Also match simpler 2-column check tables: | Check | Result |
  const simpleCheckRegex =
    /\|\s*\*?\*?(.+?)\*?\*?\s*\|\s*\*?\*?(\d+\.?\d*%?)\s*(?:vs\.?\s*)?(?:≤|≥|max|min)?\s*(\d+\.?\d*%?)\s*.*?\*?\*?\s*\|\s*(✅|❌|⚠️)?\s*(Pass|Fail)?\s*(?:—|–|-)?\s*(.*?)\s*\|/gi;
  let match2: RegExpExecArray | null;
  while ((match2 = simpleCheckRegex.exec(text)) !== null) {
    const item = (match2[1] ?? "").replace(/\*\*/g, "").trim();
    if (!findings.some((f) => f.item === item)) {
      findings.push({
        item,
        status: (match2[5] ?? "").toLowerCase().includes("fail") ? "fail" : "pass",
        guideline: match2[3],
        actual: match2[2],
        detail: match2[6] ?? "",
      });
    }
  }

  // Second pass — 3-column format: | Item | ✅ value | Detail |
  const threeColRegex = /\|\s*\*?\*?(.+?)\*?\*?\s*\|\s*(✅|❌|⚠️)\s+(.+?)\s*\|\s*(.+?)\s*\|/g;
  let match3: RegExpExecArray | null;
  while ((match3 = threeColRegex.exec(text)) !== null) {
    const item = match3[1]!.replace(/\*\*/g, "").trim();
    // Skip if already found, skip separator/header rows
    if (
      findings.some((f) => f.item === item) ||
      /^[-=]+$/.test(item) ||
      item.toLowerCase() === "test" ||
      item.toLowerCase() === "item"
    )
      continue;

    const emoji = match3[2]!;
    const status: Finding["status"] =
      emoji === "✅" ? "pass" : emoji === "❌" ? "fail" : "warning";

    // Parse value string: "80% ≤ 85% max" → actual=80%, guideline=≤85%
    const valueStr = match3[3]!.trim();
    const numbers = valueStr.match(/(\d+\.?\d*%?)/g);
    const actual = numbers?.[0];
    const guideline = numbers && numbers.length > 1 ? `≤ ${numbers[1]}` : undefined;

    findings.push({
      item,
      status,
      actual: actual ?? valueStr.slice(0, 30),
      guideline,
      detail: match3[4]!.replace(/\*\*/g, "").trim(),
    });
  }

  return findings;
}

function parseRiskFlags(text: string): RiskFlag[] {
  const flags: RiskFlag[] = [];

  // Look for sections about blocking issues, risk flags, exceptions, warnings
  const blockMatch = text.match(
    /(?:blocking issues?|risk flags?|exceptions?|⚠️.*?warning)[^\n]*\n([\s\S]*?)(?=\n##|\n---|\n\n\n|$)/gi,
  );
  if (blockMatch) {
    for (const block of blockMatch) {
      const lines = block
        .split("\n")
        .filter(
          (l) =>
            l.trim().startsWith("|") ||
            l.trim().startsWith("-") ||
            l.trim().startsWith("*"),
        );
      for (const line of lines) {
        const cleaned = line.replace(/[|*-]/g, " ").trim();
        if (
          cleaned.length > 10 &&
          !cleaned.startsWith("---") &&
          !cleaned.match(/^[\s-]+$/)
        ) {
          const isBlocker = /hard block|block|fail|critical|decline/i.test(cleaned);
          flags.push({
            severity: isBlocker ? "blocker" : "warning",
            title: (cleaned.split(/[.—–:]/, 2)[0] ?? cleaned).trim().slice(0, 80),
            detail: cleaned,
          });
        }
      }
    }
  }

  // Also catch inline ❌ flags from findings
  const inlineFlags = /❌\s*\*?\*?(?:HARD BLOCK|BLOCK|FAIL)\*?\*?\s*[|]?\s*(.+)/gi;
  let m: RegExpExecArray | null;
  while ((m = inlineFlags.exec(text)) !== null) {
    const captured = m[1] ?? "";
    if (!flags.some((f) => f.detail.includes(captured.slice(0, 30)))) {
      flags.push({
        severity: "blocker",
        title: captured.slice(0, 80).replace(/\|/g, "").trim(),
        detail: captured.replace(/\|/g, "").trim(),
      });
    }
  }

  return flags;
}

function extractExecutiveSummary(text: string, decision: string): string {
  const lines = text.split("\n");
  const summaryParts: string[] = [];
  let pastDecisionTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.includes("Decision") &&
      (trimmed.includes("APPROVE") ||
        trimmed.includes("DECLINE") ||
        trimmed.includes("CONDITIONAL"))
    ) {
      pastDecisionTable = true;
      continue;
    }
    if (
      pastDecisionTable &&
      trimmed &&
      !trimmed.startsWith("|") &&
      !trimmed.startsWith("#") &&
      !trimmed.startsWith("---") &&
      !trimmed.startsWith("*")
    ) {
      summaryParts.push(trimmed);
      if (summaryParts.length >= 3) break;
    }
  }

  if (summaryParts.length > 0) return summaryParts.join(" ");

  // Fallback: construct from decision
  return `Agent recommends ${decision.toUpperCase()} based on program guideline analysis.`;
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
            <th className="text-left px-2 py-[3px] border-r border-[#b7c2d3] w-[30px]">#</th>
            <th className="text-left px-2 py-[3px] border-r border-[#b7c2d3]">Check</th>
            <th className="text-left px-2 py-[3px] border-r border-[#b7c2d3]">Guideline</th>
            <th className="text-left px-2 py-[3px] border-r border-[#b7c2d3]">Submitted</th>
            <th className="text-left px-2 py-[3px] border-r border-[#b7c2d3] w-[60px]">Result</th>
            <th className="text-left px-2 py-[3px]">Detail</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f, i) => {
            const s = STATUS[f.status];
            return (
              <tr
                key={i}
                className={`${i % 2 ? "bg-[#f5f3e8]" : ""} ${f.status === "fail" ? "bg-[#fde8e8]" : ""}`}
              >
                <td className="px-2 py-[2px] border-b border-[#c8c4b5]">{i + 1}</td>
                <td className="px-2 py-[2px] border-b border-[#c8c4b5] font-bold">{f.item}</td>
                <td className="px-2 py-[2px] border-b border-[#c8c4b5]">{f.guideline ?? "—"}</td>
                <td className="px-2 py-[2px] border-b border-[#c8c4b5]">{f.actual ?? "—"}</td>
                <td className={`px-2 py-[2px] border-b border-[#c8c4b5] ${s.cls}`}>
                  {s.icon} {s.label}
                </td>
                <td className="px-2 py-[2px] border-b border-[#c8c4b5]">{f.detail}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── RiskFlags ────────────────────────────────────────────────────────────────

function RiskFlags({ flags }: { flags: RiskFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <div className="mb-3">
      {flags.map((f, i) => (
        <div
          key={i}
          className={`p-2 mb-1 border-l-4 text-[10px] ${
            f.severity === "blocker"
              ? "border-[#c00] bg-[#fde8e8]"
              : "border-[#ff9800] bg-[#fff8e1]"
          }`}
        >
          <div className="font-bold">
            {f.severity === "blocker" ? "🚫" : "⚠️"} {f.title}
          </div>
          <div className="text-[#404040] mt-1">{f.detail}</div>
        </div>
      ))}
    </div>
  );
}

// ─── ConditionsList ───────────────────────────────────────────────────────────

function ConditionsList({
  loanId,
  conditions,
  pending,
}: {
  loanId: string;
  conditions: string[];
  pending: boolean;
}) {
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [, startTransition] = useTransition();

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
        if (!added.has(i) && desc !== undefined) {
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
        <div className="flex items-center gap-2 mb-2">
          <button
            className="enc-btn enc-btn--primary text-[10px]"
            disabled={pending || added.size === conditions.length}
            onClick={addAll}
          >
            Add All to Loan ({conditions.length - added.size} remaining)
          </button>
        </div>
        {conditions.map((c, i) => (
          <div
            key={i}
            className={`flex items-center gap-2 py-1 border-b border-[#e0dfdb] text-[10px] ${added.has(i) ? "opacity-50" : ""}`}
          >
            <span className="font-bold w-[20px]">{i + 1}.</span>
            <span className="flex-1">{c}</span>
            {added.has(i) ? (
              <span className="text-[#1b5e20]">✓ Added</span>
            ) : (
              <button
                className="enc-btn text-[9px]"
                disabled={pending}
                onClick={() => addOne(i, c)}
              >
                + Add
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ReasoningTrace ───────────────────────────────────────────────────────────

function ReasoningTrace({ trace }: { trace: AgentStep[] }) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  type GroupKey = "tool" | "analysis" | "decision";
  const groups: Record<GroupKey, { icon: string; label: string; steps: AgentStep[] }> = {
    tool: { icon: "🔧", label: "Tool Calls", steps: [] },
    analysis: { icon: "💭", label: "Analysis", steps: [] },
    decision: { icon: "📋", label: "Decision Synthesis", steps: [] },
  };

  for (const step of trace) {
    if (step.phase === "tool_call" || step.phase === "tool_result") {
      groups.tool.steps.push(step);
    } else if (step.phase === "thinking" || step.phase === "message") {
      groups.analysis.steps.push(step);
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
}: {
  loanId: string;
  rec: PendingRecommendation;
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

  const findings = parseFindings(rec.rationale);
  const riskFlags = parseRiskFlags(rec.rationale);
  const summary = extractExecutiveSummary(rec.rationale, rec.recommendation);

  return (
    <div className="enc-sec mt-2 border-2 border-[#0a52a0]">
      <h4 className="!bg-gradient-to-b from-[#d79a1f] to-[#8a6110]">
        🤖 AI Underwriting Report — mlb-uw-agent
      </h4>
      <div className="p-3 bg-[#fffdf5]">
        {/* Decision Badge + Confidence */}
        <div className="mb-4">
          <DecisionBadge decision={rec.recommendation} confidence={rec.confidence} />
        </div>

        {/* Executive Summary */}
        <div className="mb-3 p-3 bg-white border border-[#c8c4b5] text-[11px]">
          <div className="font-bold text-[10px] text-[#1f4478] mb-1 uppercase">
            Executive Summary
          </div>
          {summary}
          <div className="text-[9px] text-[#404040] mt-2">
            Analyzed at {new Date(rec.stagedAt).toLocaleString()} by {rec.stagedBy}
          </div>
        </div>

        {/* Risk Flags */}
        <RiskFlags flags={riskFlags} />

        {/* Findings Table */}
        <FindingsTable findings={findings} />

        {/* Suggested Conditions */}
        <ConditionsList loanId={loanId} conditions={rec.conditions} pending={pending} />

        {/* Reasoning Trace */}
        <ReasoningTrace trace={rec.trace} />

        {/* Sticky Action Bar */}
        <div className="sticky bottom-0 flex items-center gap-2 p-3 bg-[#ece9d8] border-t-2 border-[#6b7a8f] -mx-3 -mb-3">
          <button className="enc-btn enc-btn--primary" disabled={pending} onClick={accept}>
            ✓ Accept as-is
          </button>
          {rec.conditions.length > 0 && (
            <button
              className="enc-btn enc-btn--primary"
              disabled={pending}
              onClick={acceptWithConditions}
            >
              ✓ Accept + Add Conditions
            </button>
          )}
          <button className="enc-btn" disabled={pending} onClick={reject}>
            ✗ Reject
          </button>
          <button className="enc-btn" disabled={pending} onClick={rerun}>
            ↻ Re-run Agent
          </button>
          <span className="text-[9px] text-[#404040] ml-auto">
            Accepting converts to {rec.recommendation.toUpperCase()} decision
          </span>
        </div>
      </div>
    </div>
  );
}
