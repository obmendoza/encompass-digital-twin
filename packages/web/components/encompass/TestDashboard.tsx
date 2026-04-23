"use client";

import { useState, useEffect } from "react";

interface HealthResult { api: string; loans: number; auditLog: number; timestamp: string }
interface IntegrityResult { status: string; loansChecked: number; totalChecks: number; totalPassed: number; totalFailed: number; results: Array<{ loanId: string; checks: number; passed: number; failed: number; issues: string[] }>; timestamp: string }
interface BehavioralResult { status: string; testsRun: number; passed: number; failed: number; totalDurationMs: number; results: Array<{ name: string; status: string; detail: string; durationMs: number }>; timestamp: string }

export function TestDashboard() {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [behavioral, setBehavioral] = useState<BehavioralResult | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  // Auto-run health check on load
  useEffect(() => { runHealth(); }, []);

  async function runHealth() {
    setLoading("health");
    try {
      const res = await fetch(`/api/system/health`);
      setHealth(await res.json());
    } catch {
      setHealth({ api: "error", loans: 0, auditLog: 0, timestamp: new Date().toISOString() });
    }
    setLoading(null);
  }

  async function runIntegrity() {
    setLoading("integrity");
    try {
      const res = await fetch(`/api/system/integrity`);
      setIntegrity(await res.json());
    } catch {
      setIntegrity(null);
    }
    setLoading(null);
  }

  async function runBehavioral() {
    setLoading("behavioral");
    try {
      const res = await fetch(`/api/system/behavioral-test`, { method: "POST" });
      setBehavioral(await res.json());
    } catch {
      setBehavioral(null);
    }
    setLoading(null);
  }

  async function runAll() {
    await runHealth();
    await runIntegrity();
    await runBehavioral();
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <button className="enc-btn enc-btn--primary text-[11px]" disabled={!!loading} onClick={runAll}>
          {loading ? `Running ${loading}...` : "Run All System Checks"}
        </button>
        {health && (
          <span className="text-[10px] text-[#6b7a8f]">Last check: {new Date(health.timestamp).toLocaleTimeString()}</span>
        )}
      </div>

      {/* 1. System Health */}
      <div className="enc-sec mb-2">
        <h4>System Health</h4>
        <div className="p-2 flex items-center gap-4 text-[10px]">
          {health ? (
            <>
              <div className={`px-3 py-1 font-bold text-[12px] ${health.api === "ok" ? "bg-[#d7ecd0] text-[#1b5e20]" : "bg-[#f8d7d7] text-[#8a0000]"}`}>
                API: {health.api.toUpperCase()}
              </div>
              <div><b>{health.loans}</b> loans loaded</div>
              <div><b>{health.auditLog}</b> audit log entries</div>
              <button className="enc-btn text-[9px] ml-auto" disabled={loading === "health"} onClick={runHealth}>Refresh</button>
            </>
          ) : (
            <span className="text-[#6b7a8f]">
              {loading === "health" ? "Checking..." : "Click \"Run All\" to check"}
            </span>
          )}
        </div>
      </div>

      {/* 2. Data Integrity */}
      <div className="enc-sec mb-2">
        <h4>Data Integrity — {integrity ? `${integrity.totalPassed}/${integrity.totalChecks} passed` : "Not run"}</h4>
        <div className="p-2">
          {!integrity ? (
            <button className="enc-btn text-[10px]" disabled={!!loading} onClick={runIntegrity}>
              {loading === "integrity" ? "Running..." : "Run Integrity Check"}
            </button>
          ) : (
            <>
              <div className={`mb-2 px-3 py-1 text-[11px] font-bold inline-block ${integrity.status === "pass" ? "bg-[#d7ecd0] text-[#1b5e20]" : "bg-[#f8d7d7] text-[#8a0000]"}`}>
                {integrity.status === "pass" ? "ALL CHECKS PASSED" : `${integrity.totalFailed} FAILURES`}
              </div>
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="bg-[#d4d0c8]">
                    <th className="text-left px-2 py-[3px] border-b border-[#6b7a8f]">Loan</th>
                    <th className="text-center px-2 py-[3px] border-b border-[#6b7a8f] w-[60px]">Checks</th>
                    <th className="text-center px-2 py-[3px] border-b border-[#6b7a8f] w-[60px]">Passed</th>
                    <th className="text-center px-2 py-[3px] border-b border-[#6b7a8f] w-[60px]">Failed</th>
                    <th className="text-left px-2 py-[3px] border-b border-[#6b7a8f]">Issues</th>
                  </tr>
                </thead>
                <tbody>
                  {integrity.results.map((r, i) => (
                    <tr key={r.loanId} className={`${r.failed > 0 ? "bg-[#fef0f0]" : i % 2 ? "bg-[#f5f3e8]" : ""}`}>
                      <td className="px-2 py-[2px] border-b border-[#c8c4b5] font-mono">{r.loanId}</td>
                      <td className="px-2 py-[2px] border-b border-[#c8c4b5] text-center">{r.checks}</td>
                      <td className="px-2 py-[2px] border-b border-[#c8c4b5] text-center text-[#1b5e20]">{r.passed}</td>
                      <td className="px-2 py-[2px] border-b border-[#c8c4b5] text-center font-bold text-[#8a0000]">{r.failed || "\u2014"}</td>
                      <td className="px-2 py-[2px] border-b border-[#c8c4b5] text-[#8a0000]">{r.issues.join("; ") || "OK"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2">
                <button className="enc-btn text-[9px]" disabled={!!loading} onClick={runIntegrity}>Re-run</button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 3. Behavioral Tests */}
      <div className="enc-sec mb-2">
        <h4>Behavioral Tests — {behavioral ? `${behavioral.passed}/${behavioral.testsRun} passed (${behavioral.totalDurationMs}ms)` : "Not run"}</h4>
        <div className="p-2">
          {!behavioral ? (
            <button className="enc-btn text-[10px]" disabled={!!loading} onClick={runBehavioral}>
              {loading === "behavioral" ? "Running..." : "Run Behavioral Tests"}
            </button>
          ) : (
            <>
              <div className={`mb-2 px-3 py-1 text-[11px] font-bold inline-block ${behavioral.status === "pass" ? "bg-[#d7ecd0] text-[#1b5e20]" : "bg-[#f8d7d7] text-[#8a0000]"}`}>
                {behavioral.status === "pass" ? "ALL TESTS PASSED" : `${behavioral.failed} FAILURES`}
              </div>
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="bg-[#d4d0c8]">
                    <th className="text-left px-2 py-[3px] border-b border-[#6b7a8f]">#</th>
                    <th className="text-left px-2 py-[3px] border-b border-[#6b7a8f]">Test</th>
                    <th className="text-center px-2 py-[3px] border-b border-[#6b7a8f] w-[60px]">Result</th>
                    <th className="text-left px-2 py-[3px] border-b border-[#6b7a8f]">Detail</th>
                    <th className="text-right px-2 py-[3px] border-b border-[#6b7a8f] w-[60px]">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {behavioral.results.map((r, i) => (
                    <tr key={i} className={`${r.status === "fail" ? "bg-[#fef0f0]" : i % 2 ? "bg-[#f5f3e8]" : ""}`}>
                      <td className="px-2 py-[2px] border-b border-[#c8c4b5]">{i + 1}</td>
                      <td className="px-2 py-[2px] border-b border-[#c8c4b5] font-semibold">{r.name}</td>
                      <td className="px-2 py-[2px] border-b border-[#c8c4b5] text-center">
                        <span className={`px-1 py-[1px] text-[9px] font-bold ${r.status === "pass" ? "bg-[#d7ecd0] text-[#1b5e20]" : "bg-[#f8d7d7] text-[#8a0000]"}`}>
                          {r.status === "pass" ? "PASS" : "FAIL"}
                        </span>
                      </td>
                      <td className="px-2 py-[2px] border-b border-[#c8c4b5] text-[#404040]">{r.detail}</td>
                      <td className="px-2 py-[2px] border-b border-[#c8c4b5] text-right tabular-nums">{r.durationMs}ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2">
                <button className="enc-btn text-[9px]" disabled={!!loading} onClick={runBehavioral}>Re-run</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
