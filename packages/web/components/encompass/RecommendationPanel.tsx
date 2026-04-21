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

// ─── ReasoningTrace helpers ───────────────────────────────────────────────────

const TOOL_LABELS: Record<string, { label: string; icon: string; desc: string }> = {
  matrix_lookup: { label: "Program Eligibility Matrix", icon: "📊", desc: "Checked max LTV from the investor's rate sheet matrix" },
  check_geo_overlay: { label: "Geographic Overlay Check", icon: "🌍", desc: "Verified state/county eligibility and restrictions" },
  compute_reserves: { label: "Reserves Calculation", icon: "💰", desc: "Computed required reserve months for this program" },
  compute_dscr: { label: "DSCR Calculation", icon: "📈", desc: "Calculated debt service coverage ratio" },
  retrieve_guideline: { label: "Guideline Lookup", icon: "📖", desc: "Retrieved relevant program guideline section" },
  request_human_approval: { label: "Escalation to Senior UW", icon: "🚨", desc: "Requested human review for exception" },
  condo_overlay: { label: "Condo/PUD Overlay", icon: "🏢", desc: "Checked condominium project eligibility" },
};

function parseToolCall(content: string): { name: string; args: Record<string, unknown> } {
  const match = content.match(/^(\w+)\((.+)\)$/s);
  if (!match) return { name: content.slice(0, 30), args: {} };
  try {
    return { name: match[1]!, args: JSON.parse(match[2]!) };
  } catch {
    return { name: match[1]!, args: {} };
  }
}

function parseToolResult(content: string): Record<string, unknown> {
  try { return JSON.parse(content); }
  catch { return {}; }
}

function formatToolArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "matrix_lookup":
      return `Program: ${args.program}, FICO: ${args.fico}, Amount: $${Number(args.loan_amount || 0).toLocaleString()}, ${args.occupancy}, ${args.purpose}`;
    case "check_geo_overlay":
      return `State: ${args.state}${args.county ? `, County: ${args.county}` : ""}${args.zip_code ? `, ZIP: ${args.zip_code}` : ""}`;
    case "compute_reserves":
      return `Program: ${args.program}, Loan: $${Number(args.loan_amount || 0).toLocaleString()}`;
    case "compute_dscr":
      return `Rent: $${Number(args.monthly_rent || 0).toLocaleString()}, PITIA: $${Number(args.monthly_pitia || 0).toLocaleString()}`;
    case "retrieve_guideline":
      return `"${String(args.query || "").slice(0, 80)}"`;
    case "request_human_approval":
      return String(args.reason || "").slice(0, 100);
    default:
      return Object.entries(args).map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(", ").slice(0, 120);
  }
}

function formatToolResult(name: string, result: Record<string, unknown>): string {
  switch (name) {
    case "matrix_lookup":
      return result.max_ltv ? `Max LTV: ${result.max_ltv}%` : "No eligible tier found";
    case "check_geo_overlay": {
      const blocks = result.blocks as unknown[];
      return blocks && blocks.length > 0 ? `⚠️ Blocks: ${blocks.join(", ")}` : `✅ ${result.checked} — No restrictions`;
    }
    case "compute_reserves":
      return `${result.required_months} months required`;
    case "compute_dscr":
      return `DSCR: ${result.dscr}, Tier: ${result.tier}`;
    case "retrieve_guideline": {
      const hits = result.hits as Array<Record<string, unknown>> | undefined;
      if (!hits || hits.length === 0) return "No relevant sections found";
      return `Found: "${String(hits[0]?.section || "").slice(0, 80)}"`;
    }
    case "request_human_approval":
      return `Ticket: ${result.ticket_id} (${result.status})`;
    default:
      return JSON.stringify(result).slice(0, 120);
  }
}

function ToolActivityPanel({ steps }: { steps: AgentStep[] }) {
  const [showRaw, setShowRaw] = useState(false);

  // Pair tool_calls with their results
  const pairs: Array<{ call: AgentStep; result?: AgentStep }> = [];
  const resultQueue: AgentStep[] = [];

  for (const step of steps) {
    if (step.phase === "tool_call") pairs.push({ call: step });
    else if (step.phase === "tool_result") resultQueue.push(step);
  }
  // Match results to calls in order
  pairs.forEach((pair, i) => { if (resultQueue[i]) pair.result = resultQueue[i]; });

  // Group consecutive retrieve_guideline calls
  const grouped: Array<{ type: "single"; pair: typeof pairs[0] } | { type: "guideline_group"; pairs: typeof pairs }> = [];
  let guidelineBatch: typeof pairs = [];

  for (const pair of pairs) {
    const parsed = parseToolCall(pair.call.content);
    if (parsed.name === "retrieve_guideline") {
      guidelineBatch.push(pair);
    } else {
      if (guidelineBatch.length > 0) {
        grouped.push({ type: "guideline_group", pairs: [...guidelineBatch] });
        guidelineBatch = [];
      }
      grouped.push({ type: "single", pair });
    }
  }
  if (guidelineBatch.length > 0) {
    grouped.push({ type: "guideline_group", pairs: guidelineBatch });
  }

  return (
    <div className="border border-t-0 border-[#c8c4b5]">
      <div className="p-2 space-y-2">
        {grouped.map((item, i) => {
          if (item.type === "guideline_group") {
            return (
              <div key={i} className="bg-[#fafbfc] border border-[#e0dfdb] rounded p-2">
                <div className="flex items-center gap-2 text-[10px] font-bold text-[#1f4478]">
                  📖 Guideline Lookups ({item.pairs.length} queries)
                </div>
                <div className="mt-1 space-y-1">
                  {item.pairs.map((p, j) => {
                    const parsed = parseToolCall(p.call.content);
                    const result = p.result ? parseToolResult(p.result.content) : {};
                    return (
                      <div key={j} className="text-[10px] pl-4 border-l-2 border-[#c8c4b5]">
                        <div className="text-[#6b7a8f]">Query: {formatToolArgs("retrieve_guideline", parsed.args)}</div>
                        <div className="text-[#1a2b4a]">{formatToolResult("retrieve_guideline", result)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }

          const { pair } = item;
          const parsed = parseToolCall(pair.call.content);
          const toolInfo = TOOL_LABELS[parsed.name] ?? { label: parsed.name, icon: "🔧", desc: "" };
          const result = pair.result ? parseToolResult(pair.result.content) : null;

          return (
            <div key={i} className="bg-[#fafbfc] border border-[#e0dfdb] rounded p-2">
              <div className="flex items-center gap-2 text-[10px]">
                <span>{toolInfo.icon}</span>
                <span className="font-bold text-[#1f4478]">{toolInfo.label}</span>
                <span className="text-[#6b7a8f] ml-auto">{toolInfo.desc}</span>
              </div>
              <div className="mt-1 text-[10px] pl-5">
                <div className="text-[#404040]">Input: {formatToolArgs(parsed.name, parsed.args)}</div>
                {result && (
                  <div className="text-[#1a2b4a] font-semibold mt-[2px]">Result: {formatToolResult(parsed.name, result)}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-2 pb-2">
        <button className="text-[9px] text-[#6b7a8f] hover:text-[#1f4478]" onClick={() => setShowRaw(!showRaw)}>
          {showRaw ? "▼ Hide" : "▶ Show"} raw technical data
        </button>
        {showRaw && (
          <div className="mt-1 bg-[#0f1419] text-[#9ca3af] p-2 font-mono text-[9px] max-h-[200px] overflow-auto rounded">
            {steps.map((s, i) => (
              <div key={i} className="py-[1px]">[{s.phase}] {s.content.slice(0, 200)}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AnalysisPanel({ steps }: { steps: AgentStep[] }) {
  // Deduplicate: "thinking" and "message" often have the same content
  const unique: AgentStep[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    const key = step.content.slice(0, 50);
    if (!seen.has(key)) { seen.add(key); unique.push(step); }
  }

  return (
    <div className="border border-t-0 border-[#c8c4b5] p-2 space-y-2">
      {unique.map((step, i) => {
        const cleanContent = step.content
          .replace(/\*\*/g, "")
          .replace(/#{1,3}\s*/g, "")
          .replace(/\|[^|]+\|/g, "") // strip table rows
          .split("\n")
          .filter(l => l.trim().length > 5 && !l.trim().startsWith("---") && !l.trim().startsWith("|"))
          .slice(0, 5)
          .join(" ")
          .trim()
          .slice(0, 300);

        if (!cleanContent) return null;

        return (
          <div key={i} className="flex gap-2 text-[10px]">
            <div className="shrink-0 w-[22px] h-[22px] rounded-full bg-[#e8f0fe] text-[#1f4478] flex items-center justify-center font-bold text-[9px]">
              {i + 1}
            </div>
            <div className="text-[#1a2b4a] leading-relaxed">
              {cleanContent}{cleanContent.length >= 300 ? "…" : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ComplianceChecksPanel({ steps }: { steps: AgentStep[] }) {
  const checks = steps.map((step) => {
    const content = step.content;
    const isPass = content.startsWith("✅");
    const isFail = content.startsWith("❌");
    // Parse: "✅ Check Name: detail message"
    const cleaned = content.replace(/^[✅❌⚠️]\s*/, "");
    const parts = cleaned.split(/:\s*/, 2);
    const check = parts[0] ?? cleaned;
    const detail = parts[1] ?? "";

    return { check, detail, status: isFail ? "fail" as const : isPass ? "pass" as const : "info" as const };
  });

  return (
    <div className="border border-t-0 border-[#c8c4b5]">
      <table className="w-full text-[10px]">
        <thead>
          <tr className="bg-[#f0f2f5]">
            <th className="text-left px-3 py-[4px] font-bold text-[#1f4478] border-b border-[#c8c4b5]">Check</th>
            <th className="text-left px-3 py-[4px] font-bold text-[#1f4478] border-b border-[#c8c4b5] w-[70px]">Result</th>
            <th className="text-left px-3 py-[4px] font-bold text-[#1f4478] border-b border-[#c8c4b5]">Detail</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c, i) => (
            <tr key={i} className={c.status === "fail" ? "bg-[#fef0f0]" : i % 2 ? "bg-[#fafbfc]" : ""}>
              <td className="px-3 py-[3px] border-b border-[#e0dfdb] font-semibold">{c.check}</td>
              <td className="px-3 py-[3px] border-b border-[#e0dfdb]">
                <span className={`font-bold ${c.status === "pass" ? "text-[#1b5e20]" : c.status === "fail" ? "text-[#c00]" : "text-[#6b7a8f]"}`}>
                  {c.status === "pass" ? "✅ PASS" : c.status === "fail" ? "❌ FAIL" : "ℹ️ INFO"}
                </span>
              </td>
              <td className="px-3 py-[3px] border-b border-[#e0dfdb] text-[#404040]">{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── ReasoningTrace ───────────────────────────────────────────────────────────

function ReasoningTrace({ trace }: { trace: AgentStep[] }) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  type GroupKey = "tool" | "analysis" | "validation" | "decision";
  const groups: Record<GroupKey, { icon: string; label: string; steps: AgentStep[] }> = {
    tool: { icon: "🔧", label: "AI Tool Activity", steps: [] },
    analysis: { icon: "💭", label: "Agent Analysis", steps: [] },
    validation: { icon: "✅", label: "Automated Compliance Checks", steps: [] },
    decision: { icon: "📋", label: "Decision Synthesis", steps: [] },
  };

  for (const step of trace) {
    if (step.phase === "tool_call" || step.phase === "tool_result") groups.tool.steps.push(step);
    else if (step.phase === "thinking" || step.phase === "message") groups.analysis.steps.push(step);
    else if (step.phase === "validation") groups.validation.steps.push(step);
    else groups.decision.steps.push(step);
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
      <h4>How the AI Reached This Decision — {trace.length} steps</h4>
      <div className="p-2">
        {(Object.entries(groups) as [GroupKey, typeof groups[GroupKey]][])
          .filter(([, g]) => g.steps.length > 0)
          .map(([key, group]) => (
            <div key={key} className="mb-1">
              <button
                className="w-full text-left px-3 py-[6px] bg-[#f6f8fb] border border-[#c8c4b5] text-[10px] font-bold hover:bg-[#e8f0fe] flex items-center gap-2"
                onClick={() => toggle(key)}
              >
                <span>{openGroups.has(key) ? "▼" : "▶"}</span>
                <span>{group.icon} {group.label}</span>
                <span className="text-[#6b7a8f] font-normal ml-auto">
                  {key === "tool" ? `${Math.floor(group.steps.length / 2)} tools used` :
                   key === "validation" ? `${group.steps.filter(s => s.content.startsWith("✅")).length} passed, ${group.steps.filter(s => s.content.startsWith("❌")).length} failed` :
                   `${group.steps.length} steps`}
                </span>
              </button>
              {openGroups.has(key) && (
                key === "tool" ? <ToolActivityPanel steps={group.steps} /> :
                key === "analysis" ? <AnalysisPanel steps={group.steps} /> :
                key === "validation" ? <ComplianceChecksPanel steps={group.steps} /> :
                <div className="border border-t-0 border-[#c8c4b5] p-2">
                  {group.steps.map((step, i) => (
                    <div key={i} className="text-[10px] text-[#1a2b4a] py-1">
                      {step.content.replace(/\*\*/g, "").slice(0, 200)}
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
  userRole,
}: {
  loanId: string;
  rec: PendingRecommendation;
  existingConditions?: Condition[];
  userRole?: string;
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
          {(!userRole || ["uw", "admin"].includes(userRole)) ? (
            <>
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
            </>
          ) : (
            <span className="text-[10px] text-[#6b7a8f]">Review only — decision requires Underwriter role</span>
          )}
          <span className="text-[9px] text-[#404040] ml-auto">
            Accept converts to {rec.recommendation.toUpperCase()} decision
          </span>
        </div>
      </div>
    </div>
  );
}
