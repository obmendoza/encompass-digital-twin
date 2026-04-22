"use client";

import { useTransition, useState } from "react";
import Link from "next/link";
import type { Loan, Condition, ConditionCategory, ConditionSource } from "@twin/core";
import {
  actionAddCondition,
  actionAddConditionBatch,
  actionClearCondition,
  actionWaiveCondition,
  actionRemoveCondition,
} from "@/app/loan/[loanId]/actions";

// ---------------------------------------------------------------------------
// Template data
// ---------------------------------------------------------------------------

const TEMPLATE_SETS: Record<
  string,
  { label: string; templates: Array<{ category: string; source: string; description: string }> }
> = {
  "DSCR Standard": {
    label: "DSCR Standard",
    templates: [
      { category: "PTD", source: "UW", description: "Executed lease or market rent (1007)" },
      { category: "PTD", source: "UW", description: "Property insurance with rent loss coverage" },
      { category: "PTA", source: "UW", description: "Reserves — 6 months PITIA" },
      { category: "PTF", source: "Compliance", description: "Entity docs if titled in LLC" },
    ],
  },
  "Bank Statement": {
    label: "Bank Statement",
    templates: [
      { category: "PTD", source: "UW", description: "12 months personal bank statements (all pages)" },
      { category: "PTD", source: "UW", description: "Bank statement income analysis worksheet" },
      { category: "PTD", source: "UW", description: "Signed 4506-C" },
      { category: "PTF", source: "Compliance", description: "Final HOI with effective date ≥ closing" },
    ],
  },
  "Asset Depletion": {
    label: "Asset Depletion",
    templates: [
      { category: "PTD", source: "UW", description: "60 days asset statements (all pages)" },
      { category: "PTD", source: "UW", description: "Asset depletion calculation worksheet" },
      { category: "PTA", source: "UW", description: "Source of large deposits > 1% loan amount" },
    ],
  },
  ITIN: {
    label: "ITIN",
    templates: [
      { category: "PTD", source: "UW", description: "Valid ITIN letter from IRS" },
      { category: "PTD", source: "UW", description: "12 months alternative credit (rent, utilities)" },
      { category: "PTD", source: "UW", description: "Two forms of government-issued ID" },
    ],
  },
  "Foreign National": {
    label: "Foreign National",
    templates: [
      { category: "PTD", source: "UW", description: "Valid foreign passport + visa" },
      { category: "PTA", source: "UW", description: "12 months reserves in US bank" },
      { category: "PTD", source: "Compliance", description: "OFAC clearance" },
    ],
  },
  Compliance: {
    label: "Compliance",
    templates: [
      { category: "PTF", source: "Compliance", description: "Final HOI with effective date ≥ closing" },
      { category: "PTF", source: "Compliance", description: "Flood certification" },
      { category: "PTF", source: "Compliance", description: "Title commitment and title insurance" },
    ],
  },
  "BK Seasoning": {
    label: "BK Seasoning",
    templates: [
      { category: "PTD", source: "UW", description: "BK discharge / dismissal papers" },
      { category: "PTD", source: "UW", description: "Letter of explanation — cause + re-established credit" },
      { category: "PTD", source: "UW", description: "Evidence of re-established credit (3 tradelines, 12mo clean)" },
    ],
  },
};

function getSuggestedTemplates(program: string): string[] {
  const map: Record<string, string[]> = {
    BankStatement12: ["Bank Statement", "Compliance"],
    BankStatement24: ["Bank Statement", "Compliance"],
    DSCR: ["DSCR Standard", "Compliance"],
    AssetDepletion: ["Asset Depletion", "Compliance"],
    "1099Only": ["Bank Statement", "Compliance"],
    PnL: ["Bank Statement", "Compliance"],
    ForeignNational: ["Foreign National", "DSCR Standard", "Compliance"],
    ITIN: ["ITIN", "Bank Statement", "Compliance"],
    FullDocNonQM: ["BK Seasoning", "Compliance"],
  };
  return map[program] ?? ["Compliance"];
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------

const STATUS_PILL: Record<Condition["status"], string> = {
  Open: "enc-pill enc-pill--open",
  Requested: "enc-pill enc-pill--reqd",
  Received: "enc-pill enc-pill--rcvd",
  Cleared: "enc-pill enc-pill--cleared",
  Waived: "enc-pill enc-pill--waived",
};

const CAT_PILL: Record<ConditionCategory, string> = {
  PTA: "inline-block px-[5px] py-[1px] text-[9px] font-bold border border-red-500 text-red-700 rounded-sm bg-red-50",
  PTD: "inline-block px-[5px] py-[1px] text-[9px] font-bold border border-yellow-600 text-yellow-800 rounded-sm bg-yellow-50",
  PTF: "inline-block px-[5px] py-[1px] text-[9px] font-bold border border-blue-500 text-blue-700 rounded-sm bg-blue-50",
  PTP: "inline-block px-[5px] py-[1px] text-[9px] font-bold border border-green-600 text-green-800 rounded-sm bg-green-50",
};

const INPUT_CLS = "border border-[#7f9db9] text-[10px] px-1";

// ---------------------------------------------------------------------------
// Role helpers
// ---------------------------------------------------------------------------

type UserRole = string | undefined;

function canClear(role: UserRole) {
  return role === "va" || role === "uw" || role === "admin";
}
function canWaiveRemove(role: UserRole) {
  return role === "uw" || role === "admin";
}
function canAdd(role: UserRole) {
  return role === "va" || role === "uw" || role === "admin";
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ConditionsManager({
  loan,
  userRole,
}: {
  loan: Loan;
  userRole?: string;
}) {
  const [pending, startTransition] = useTransition();

  const [addCat, setAddCat] = useState<ConditionCategory>("PTD");
  const [addSrc, setAddSrc] = useState<ConditionSource>("UW");
  const [addDesc, setAddDesc] = useState("");

  const conditions = loan.conditions ?? [];
  const documents = loan.documents ?? [];
  const loanId = loan.id;
  const suggested = getSuggestedTemplates(loan.nqmProgram);

  // Summary counts
  const byStat = (s: Condition["status"]) => conditions.filter((c) => c.status === s).length;
  const byCat = (cat: ConditionCategory) => conditions.filter((c) => c.category === cat).length;
  const receivedCount = byStat("Received");

  // Linked doc lookup
  function linkedDocInfo(conditionId: string): { filed: boolean } | null {
    const doc = documents.find((d) => d.linkedConditionId === conditionId);
    if (!doc) return null;
    return { filed: !!(doc.fileKey || doc.fileUrl) };
  }

  // Template add
  function handleTemplateAdd(setKey: string) {
    const set = TEMPLATE_SETS[setKey];
    if (!set) return;
    startTransition(async () => {
      await actionAddConditionBatch(loanId, set.templates);
    });
  }

  // Single condition add
  function handleAddCondition() {
    if (!addDesc.trim()) return;
    startTransition(async () => {
      await actionAddCondition(loanId, {
        category: addCat,
        source: addSrc,
        description: addDesc.trim(),
      });
      setAddDesc("");
    });
  }

  // Clear all Received
  function handleClearAllReceived() {
    const received = conditions.filter((c) => c.status === "Received");
    if (received.length === 0) return;
    startTransition(async () => {
      for (const c of received) {
        await actionClearCondition(loanId, c.id, "bulk clear");
      }
    });
  }

  return (
    <div className="text-[10px] flex flex-col gap-[4px]">

      {/* ------------------------------------------------------------------ */}
      {/* Summary bar                                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="enc-sec">
        <h4>Conditions Summary — {loan.nqmProgram}</h4>
        <div className="p-1 flex gap-6 flex-wrap">
          <div className="flex gap-3 items-center">
            <span className="font-bold text-[#555]">Status:</span>
            {(["Open", "Requested", "Received", "Cleared", "Waived"] as const).map((s) => (
              <span key={s} className="flex items-center gap-[3px]">
                <span className={STATUS_PILL[s]}>{s}</span>
                <span className="font-bold">{byStat(s)}</span>
              </span>
            ))}
          </div>
          <div className="flex gap-3 items-center">
            <span className="font-bold text-[#555]">Category:</span>
            {(["PTA", "PTD", "PTF", "PTP"] as const).map((cat) => (
              <span key={cat} className="flex items-center gap-[3px]">
                <span className={CAT_PILL[cat]}>{cat}</span>
                <span className="font-bold">{byCat(cat)}</span>
              </span>
            ))}
          </div>
          <span className="ml-auto font-bold text-[#333]">Total: {conditions.length}</span>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Template panel                                                      */}
      {/* ------------------------------------------------------------------ */}
      <div className="enc-sec">
        <h4>Condition Templates</h4>
        <div className="p-1 flex flex-wrap gap-1 items-center">
          <span className="text-[#666] mr-1">Add set:</span>
          {Object.keys(TEMPLATE_SETS).map((key) => {
            const isSuggested = suggested.includes(key);
            return (
              <button
                key={key}
                disabled={pending}
                onClick={() => handleTemplateAdd(key)}
                className={
                  isSuggested
                    ? "enc-btn enc-btn--primary"
                    : "enc-btn opacity-60 hover:opacity-100"
                }
                title={(TEMPLATE_SETS[key]?.templates ?? [])
                  .map((t) => `[${t.category}] ${t.description}`)
                  .join("\n")}
              >
                {key}
                {isSuggested && <span className="ml-1 text-[8px] opacity-80">&#9733;</span>}
              </button>
            );
          })}
          {pending && (
            <span className="text-[#777] ml-2 italic">saving&#8230;</span>
          )}
        </div>
        <div className="px-1 pb-1 text-[9px] text-[#888]">
          &#9733; = suggested for {loan.nqmProgram}. Duplicates are silently skipped.
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Bulk actions bar                                                    */}
      {/* ------------------------------------------------------------------ */}
      {conditions.length > 0 && (
        <div className="flex gap-2 items-center px-1">
          {canClear(userRole) && (
            <button
              className="enc-btn enc-btn--primary"
              disabled={pending || receivedCount === 0}
              onClick={handleClearAllReceived}
            >
              Clear All Received ({receivedCount})
            </button>
          )}
          <button
            className="enc-btn opacity-50 cursor-not-allowed"
            disabled
            title="Export not yet wired"
          >
            Export List
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Conditions table                                                    */}
      {/* ------------------------------------------------------------------ */}
      <div className="enc-sec">
        <h4>Conditions ({conditions.length})</h4>
        <div className="p-0">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-gradient-to-b from-[#0a52a0] to-[#08407d] text-white">
                <th className="text-left px-1 py-[2px] border-r border-[#08407d]">#</th>
                <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Category</th>
                <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Source</th>
                <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Description</th>
                <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Status</th>
                <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Linked Doc</th>
                <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Added</th>
                <th className="text-left px-1 py-[2px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {conditions.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-2 py-2 text-center text-[#888] italic"
                  >
                    No conditions. Use templates above or add one manually below.
                  </td>
                </tr>
              )}
              {conditions.map((c, i) => {
                const docInfo = linkedDocInfo(c.id);
                return (
                  <tr key={c.id} className={i % 2 ? "bg-[#f5f3e8]" : ""}>
                    <td className="px-1 py-[1px]">{i + 1}</td>
                    <td className="px-1 py-[1px]">
                      <span className={CAT_PILL[c.category]}>{c.category}</span>
                    </td>
                    <td className="px-1 py-[1px]">{c.source}</td>
                    <td className="px-1 py-[1px] max-w-[280px]">{c.description}</td>
                    <td className="px-1 py-[1px]">
                      <span className={STATUS_PILL[c.status]}>{c.status}</span>
                    </td>
                    <td className="px-1 py-[1px] whitespace-nowrap">
                      {docInfo === null ? (
                        <span className="text-[#bbb]">&#8212;</span>
                      ) : docInfo.filed ? (
                        <span className="text-green-700 font-bold">&#10003; Filed</span>
                      ) : (
                        <Link
                          href={`/loan/${loanId}/efolder`}
                          className="text-blue-600 underline hover:text-blue-800"
                        >
                          Upload
                        </Link>
                      )}
                    </td>
                    <td className="px-1 py-[1px] whitespace-nowrap">
                      {c.addedAt.slice(5, 10).replace("-", "/")}
                    </td>
                    <td className="px-1 py-[1px]">
                      <div className="flex gap-1">
                        {canClear(userRole) && (
                          <button
                            className="enc-btn"
                            disabled={
                              pending ||
                              c.status === "Cleared" ||
                              c.status === "Waived"
                            }
                            onClick={() =>
                              startTransition(() => {
                                actionClearCondition(loanId, c.id, "verified");
                              })
                            }
                          >
                            Clear
                          </button>
                        )}
                        {canWaiveRemove(userRole) && (
                          <button
                            className="enc-btn"
                            disabled={pending || c.status === "Waived"}
                            onClick={() => {
                              const r = prompt("Waive rationale?");
                              if (r)
                                startTransition(() => {
                                  actionWaiveCondition(loanId, c.id, r);
                                });
                            }}
                          >
                            Waive
                          </button>
                        )}
                        {canWaiveRemove(userRole) && (
                          <button
                            className="enc-btn"
                            disabled={pending}
                            onClick={() =>
                              startTransition(() => {
                                actionRemoveCondition(loanId, c.id);
                              })
                            }
                          >
                            &#215;
                          </button>
                        )}
                        <Link
                          href={`/loan/${loanId}/efolder`}
                          className="enc-btn text-center no-underline"
                          title="Open eFolder"
                        >
                          eFolder
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {/* -------------------------------------------------------- */}
              {/* Inline add-condition row                                  */}
              {/* -------------------------------------------------------- */}
              {canAdd(userRole) && (
                <tr className="bg-[#eef3fb] border-t-2 border-[#0a52a0]">
                  <td className="px-1 py-1 text-[#999]">+</td>
                  <td className="px-1 py-1">
                    <select
                      value={addCat}
                      onChange={(e) =>
                        setAddCat(e.target.value as ConditionCategory)
                      }
                      className={INPUT_CLS + " w-[52px]"}
                    >
                      <option>PTA</option>
                      <option>PTD</option>
                      <option>PTF</option>
                      <option>PTP</option>
                    </select>
                  </td>
                  <td className="px-1 py-1">
                    <select
                      value={addSrc}
                      onChange={(e) =>
                        setAddSrc(e.target.value as ConditionSource)
                      }
                      className={INPUT_CLS + " w-[80px]"}
                    >
                      <option>UW</option>
                      <option>AUS</option>
                      <option>Compliance</option>
                      <option>Investor</option>
                    </select>
                  </td>
                  <td className="px-1 py-1" colSpan={4}>
                    <input
                      type="text"
                      placeholder="Condition description&#8230;"
                      value={addDesc}
                      onChange={(e) => setAddDesc(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddCondition();
                      }}
                      className={INPUT_CLS + " w-full"}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <button
                      className="enc-btn enc-btn--primary"
                      disabled={pending || !addDesc.trim()}
                      onClick={handleAddCondition}
                    >
                      Add
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
