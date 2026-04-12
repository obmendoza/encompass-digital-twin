"use client";

import { useState } from "react";
import type { LoggedAction, Action } from "@twin/core";

type ActorFilter = "All" | "Human" | "Agent";
type CategoryFilter = "All" | "Conditions" | "Decisions" | "Documents" | "Other";

const CONDITION_TYPES = new Set([
  "AddCondition", "UpdateCondition", "ClearCondition", "WaiveCondition", "RemoveCondition",
]);
const DECISION_TYPES = new Set(["SetDecision", "AdvanceMilestone"]);
const DOCUMENT_TYPES = new Set(["AddDocument", "LinkDocument", "UpdateDocumentStatus"]);

function getCategory(type: Action["type"]): CategoryFilter {
  if (CONDITION_TYPES.has(type)) return "Conditions";
  if (DECISION_TYPES.has(type)) return "Decisions";
  if (DOCUMENT_TYPES.has(type)) return "Documents";
  return "Other";
}

function formatActionType(type: Action["type"]): string {
  switch (type) {
    case "LoadScenario": return "Load Scenario";
    case "ResetWorld": return "Reset World";
    case "OpenLoan": return "Open Loan";
    case "SetDecision": return "Set Decision";
    case "AdvanceMilestone": return "Advance Milestone";
    case "RecalculateQualifyingIncome": return "Recalculate Income";
    case "AddCondition": return "Add Condition";
    case "UpdateCondition": return "Update Condition";
    case "ClearCondition": return "Clear Condition";
    case "WaiveCondition": return "Waive Condition";
    case "RemoveCondition": return "Remove Condition";
    case "AddDocument": return "Add Document";
    case "LinkDocument": return "Link Document";
    case "UpdateDocumentStatus": return "Update Doc Status";
    default: return type;
  }
}

function formatDetail(action: Action): string {
  switch (action.type) {
    case "LoadScenario":
      return `Loaded scenario: ${action.scenarioId}`;
    case "ResetWorld":
      return "Reset world state";
    case "OpenLoan":
      return `Opened loan ${action.loanId}`;
    case "SetDecision":
      return `Decision: ${action.decision} — ${action.rationale}`;
    case "AdvanceMilestone":
      return `Milestone: ${action.milestone}`;
    case "RecalculateQualifyingIncome":
      return `Recalculated income: $${action.worksheet.derivedMonthlyIncome.toLocaleString()}`;
    case "AddCondition":
      return `Added condition: ${action.condition.description}`;
    case "UpdateCondition":
      return `Updated condition ${action.conditionId}`;
    case "ClearCondition":
      return `Cleared condition ${action.conditionId}${action.notes ? " — " + action.notes : ""}`;
    case "WaiveCondition":
      return `Waived condition ${action.conditionId}: ${action.rationale}`;
    case "RemoveCondition":
      return `Removed condition ${action.conditionId}`;
    case "AddDocument":
      return `Added document: ${action.doc.name}`;
    case "LinkDocument":
      return `Linked document ${action.documentId} → condition ${action.conditionId}`;
    case "UpdateDocumentStatus":
      return `Document ${action.documentId} status → ${action.status}`;
    default:
      return "";
  }
}

function formatTimestamp(at: string): string {
  try {
    return new Date(at).toLocaleString();
  } catch {
    return at;
  }
}

export function ConversationLog({ entries }: { entries: LoggedAction[] }) {
  const [actorFilter, setActorFilter] = useState<ActorFilter>("All");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("All");

  const filtered = entries.filter((entry) => {
    const actor = "actor" in entry.action ? entry.action.actor : null;

    if (actorFilter === "Human" && actor?.kind !== "human") return false;
    if (actorFilter === "Agent" && actor?.kind !== "agent") return false;

    if (categoryFilter !== "All") {
      const cat = getCategory(entry.action.type);
      if (cat !== categoryFilter) return false;
    }

    return true;
  });

  return (
    <div className="text-[11px]">
      {/* Filters */}
      <div className="flex gap-4 mb-2 p-2 bg-[#f0f0f0] border border-[#6b7a8f] items-center">
        <div className="flex items-center gap-1">
          <label className="font-semibold text-[#1a2b4a]">Actor:</label>
          {(["All", "Human", "Agent"] as ActorFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => setActorFilter(v)}
              className={
                "px-2 py-[1px] border border-[#6b7a8f] cursor-pointer " +
                (actorFilter === v
                  ? "bg-[#1a2b4a] text-white"
                  : "bg-white text-[#1a2b4a] hover:bg-[#e2ddc7]")
              }
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <label className="font-semibold text-[#1a2b4a]">Category:</label>
          {(["All", "Conditions", "Decisions", "Documents", "Other"] as CategoryFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => setCategoryFilter(v)}
              className={
                "px-2 py-[1px] border border-[#6b7a8f] cursor-pointer " +
                (categoryFilter === v
                  ? "bg-[#1a2b4a] text-white"
                  : "bg-white text-[#1a2b4a] hover:bg-[#e2ddc7]")
              }
            >
              {v}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[#6b7a8f]">{filtered.length} of {entries.length} events</span>
      </div>

      {/* Table */}
      <table className="w-full border-collapse border border-[#6b7a8f]">
        <thead>
          <tr className="bg-[#1a2b4a] text-white">
            <th className="px-2 py-[3px] text-left border border-[#6b7a8f] w-8">#</th>
            <th className="px-2 py-[3px] text-left border border-[#6b7a8f] w-36">Timestamp</th>
            <th className="px-2 py-[3px] text-left border border-[#6b7a8f] w-28">Actor</th>
            <th className="px-2 py-[3px] text-left border border-[#6b7a8f] w-32">Action Type</th>
            <th className="px-2 py-[3px] text-left border border-[#6b7a8f]">Details</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-2 py-3 text-center text-[#6b7a8f] border border-[#6b7a8f]">
                No events match the selected filters.
              </td>
            </tr>
          ) : (
            filtered.map((entry, idx) => {
              const actor = "actor" in entry.action ? entry.action.actor : null;
              const isAgent = actor?.kind === "agent";
              const rowBg = isAgent
                ? "bg-[#e8f0fe]"
                : idx % 2 === 0
                ? "bg-white"
                : "bg-[#f7f6f1]";

              return (
                <tr key={entry.seq} className={rowBg}>
                  <td className="px-2 py-[2px] border border-[#dcd7c0] tabular-nums">{entry.seq}</td>
                  <td className="px-2 py-[2px] border border-[#dcd7c0] tabular-nums whitespace-nowrap">
                    {formatTimestamp(entry.at)}
                  </td>
                  <td className="px-2 py-[2px] border border-[#dcd7c0]">
                    {actor ? (
                      <span>
                        <span className="font-semibold capitalize">{actor.kind}</span>
                        <span className="text-[#6b7a8f]"> · {actor.id}</span>
                      </span>
                    ) : (
                      <span className="text-[#6b7a8f] italic">system</span>
                    )}
                  </td>
                  <td className="px-2 py-[2px] border border-[#dcd7c0] whitespace-nowrap">
                    {formatActionType(entry.action.type)}
                  </td>
                  <td className="px-2 py-[2px] border border-[#dcd7c0]">
                    {formatDetail(entry.action)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
