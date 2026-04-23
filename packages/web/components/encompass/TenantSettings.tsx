"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

const TABS = ["General", "Guidelines", "SLA", "Ingestion", "API Keys", "Users"] as const;
type Tab = typeof TABS[number];

interface Props {
  tenantSlug: string;
  tenant: { id?: string; name: string; status: string; settings: Record<string, unknown> };
}

export function TenantSettings({ tenantSlug, tenant }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("General");
  const [currentStatus, setCurrentStatus] = useState(tenant.status);
  const [statusLoading, setStatusLoading] = useState(false);
  const router = useRouter();

  const updateStatus = async (newStatus: string) => {
    setStatusLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
      const res = await fetch(`${apiUrl}/tenants/${tenantSlug}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-super-admin": "true",
          "x-user-id": "admin",
        },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to update status");
      }
      setCurrentStatus(newStatus);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setStatusLoading(false);
    }
  };

  // --- API Keys state ---
  const [apiKeys, setApiKeys] = useState<Array<{ id: string; name: string; key_prefix: string; rate_limit: number; status: string; created_at: string }>>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
      const res = await fetch(`${apiUrl}/tenants/${tenantSlug}/api-keys`, {
        headers: { "x-super-admin": "true", "x-user-id": "admin" },
      });
      if (res.ok) setApiKeys(await res.json());
    } catch (e) {
      console.error("Failed to fetch API keys:", e);
    } finally {
      setKeysLoading(false);
    }
  }, [tenantSlug]);

  const generateKey = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
      const res = await fetch(`${apiUrl}/tenants/${tenantSlug}/api-keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-super-admin": "true",
          "x-user-id": "admin",
        },
        body: JSON.stringify({ name: newKeyName || "default" }),
      });
      if (!res.ok) throw new Error("Failed to generate key");
      const data = await res.json();
      setGeneratedKey(data.plaintext ?? data.key ?? data.apiKey);
      setNewKeyName("");
      fetchKeys();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to generate key");
    }
  };

  const revokeKey = async (keyId: string) => {
    if (!confirm("Revoke this API key?")) return;
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
      const res = await fetch(`${apiUrl}/tenants/${tenantSlug}/api-keys/${keyId}`, {
        method: "DELETE",
        headers: { "x-super-admin": "true", "x-user-id": "admin" },
      });
      if (!res.ok) throw new Error("Failed to revoke key");
      fetchKeys();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to revoke key");
    }
  };

  // --- Guidelines state ---
  const [guidelines, setGuidelines] = useState<Array<{ program: string; version: number; created_at: string; rules: unknown }>>([]);
  const [guidelinesLoading, setGuidelinesLoading] = useState(false);
  const [expandedProgram, setExpandedProgram] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadProgram, setUploadProgram] = useState("BankStatement12");
  const [uploadRules, setUploadRules] = useState('{\n  "minFico": 620,\n  "maxLtv": 80,\n  "maxDti": 50\n}');
  const [uploadLoading, setUploadLoading] = useState(false);

  const PROGRAMS = [
    "BankStatement12", "BankStatement24", "DSCR", "AssetDepletion",
    "1099Only", "PnL", "ForeignNational", "ITIN", "FullDocNonQM",
  ];

  const fetchGuidelines = useCallback(async () => {
    if (!tenant.id) return;
    setGuidelinesLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
      const res = await fetch(`${apiUrl}/guidelines`, {
        headers: { "x-tenant-id": tenant.id, "x-user-id": "admin" },
      });
      if (res.ok) setGuidelines(await res.json());
    } catch (e) {
      console.error("Failed to fetch guidelines:", e);
    } finally {
      setGuidelinesLoading(false);
    }
  }, [tenant.id]);

  const uploadGuideline = async () => {
    if (!tenant.id) return alert("Tenant ID not available");
    setUploadLoading(true);
    try {
      let rules: unknown;
      try { rules = JSON.parse(uploadRules); } catch { throw new Error("Invalid JSON in rules"); }
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
      const res = await fetch(`${apiUrl}/guidelines/${uploadProgram}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-tenant-id": tenant.id,
          "x-user-id": "admin",
        },
        body: JSON.stringify({ rules }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to upload guideline");
      }
      setShowUploadModal(false);
      fetchGuidelines();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to upload guideline");
    } finally {
      setUploadLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "API Keys") fetchKeys();
    if (activeTab === "Guidelines") fetchGuidelines();
  }, [activeTab, fetchKeys, fetchGuidelines]);

  return (
    <div>
      <div className="flex border-b border-[#c8c4b5] mb-4">
        {TABS.map((tab) => (
          <button key={tab}
            className={`px-4 py-2 text-[11px] font-semibold ${
              activeTab === tab ? "border-b-2 border-[#1f4478] text-[#1f4478]" : "text-[#6b7a8f]"
            }`}
            onClick={() => setActiveTab(tab)}
          >{tab}</button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === "General" && (
        <div className="enc-panel p-4">
          <h3 className="text-[12px] font-bold text-[#1a2b4a] mb-3">General Settings</h3>
          <div className="text-[11px] space-y-2 mb-4">
            <div><span className="text-[#6b7a8f]">Name:</span> {tenant.name}</div>
            <div><span className="text-[#6b7a8f]">Slug:</span> {tenantSlug}</div>
            <div><span className="text-[#6b7a8f]">Status:</span> <span className="font-bold">{currentStatus.toUpperCase()}</span></div>
          </div>
          <div className="flex gap-2">
            {currentStatus === "onboarding" && (
              <button className="enc-btn enc-btn--primary text-[10px]" disabled={statusLoading} onClick={() => updateStatus("active")}>
                {statusLoading ? "..." : "Activate"}
              </button>
            )}
            {currentStatus === "active" && (
              <button className="enc-btn text-[10px]" style={{ background: "#c00", color: "white" }} disabled={statusLoading} onClick={() => updateStatus("suspended")}>
                {statusLoading ? "..." : "Suspend"}
              </button>
            )}
            {currentStatus === "suspended" && (
              <button className="enc-btn enc-btn--primary text-[10px]" disabled={statusLoading} onClick={() => updateStatus("active")}>
                {statusLoading ? "..." : "Resume"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* API Keys Tab */}
      {activeTab === "API Keys" && (
        <div className="enc-panel p-4">
          <h3 className="text-[12px] font-bold text-[#1a2b4a] mb-3">API Keys</h3>
          <div className="flex gap-2 mb-3">
            <input className="enc-input text-[11px]" placeholder="Key name" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} />
            <button className="enc-btn enc-btn--primary text-[10px]" onClick={generateKey}>Generate Key</button>
          </div>

          {generatedKey && (
            <div className="mb-3 p-3 bg-[#fef3c7] border border-[#f59e0b] text-[11px]">
              <div className="font-bold text-[#92400e] mb-1">This key will only be shown once. Save it now.</div>
              <div className="font-mono bg-white p-2 border break-all">{generatedKey}</div>
              <button className="enc-btn text-[10px] mt-2" onClick={() => { navigator.clipboard.writeText(generatedKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                {copied ? "Copied!" : "Copy to Clipboard"}
              </button>
            </div>
          )}

          {keysLoading ? (
            <p className="text-[10px] text-[#6b7a8f]">Loading...</p>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="bg-[#e8ecf0] text-[#404040]">
                  <th className="text-left px-3 py-2 font-semibold">Name</th>
                  <th className="text-left px-3 py-2 font-semibold">Prefix</th>
                  <th className="text-left px-3 py-2 font-semibold">Rate Limit</th>
                  <th className="text-left px-3 py-2 font-semibold">Status</th>
                  <th className="text-left px-3 py-2 font-semibold">Created</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((k) => (
                  <tr key={k.id} className="border-b border-[#e0dfdb]">
                    <td className="px-3 py-2">{k.name}</td>
                    <td className="px-3 py-2 font-mono">{k.key_prefix}...</td>
                    <td className="px-3 py-2">{k.rate_limit}/min</td>
                    <td className="px-3 py-2">
                      <span className={`px-2 py-[2px] text-[9px] font-bold rounded ${k.status === "active" ? "bg-[#d1fae5] text-[#065f46]" : "bg-[#fee2e2] text-[#991b1b]"}`}>
                        {k.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[#6b7a8f]">{new Date(k.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-2">
                      <button className="text-[10px] text-[#c00] hover:underline" onClick={() => revokeKey(k.id)}>Revoke</button>
                    </td>
                  </tr>
                ))}
                {apiKeys.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-4 text-center text-[#8899aa]">No API keys</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Guidelines Tab */}
      {activeTab === "Guidelines" && (
        <div className="enc-panel p-4">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-[12px] font-bold text-[#1a2b4a]">Guidelines</h3>
            <button className="enc-btn enc-btn--primary text-[10px]" onClick={() => setShowUploadModal(true)}>Upload Guidelines</button>
          </div>

          {!tenant.id && (
            <p className="text-[10px] text-[#c00] mb-2">Tenant ID not available. Guidelines cannot be loaded.</p>
          )}

          {guidelinesLoading ? (
            <p className="text-[10px] text-[#6b7a8f]">Loading...</p>
          ) : guidelines.length === 0 ? (
            <p className="text-[10px] text-[#8899aa]">No guidelines uploaded yet</p>
          ) : (
            <div className="space-y-2">
              {guidelines.map((g) => (
                <div key={g.program} className="border border-[#e0dfdb]">
                  <div className="flex justify-between items-center px-3 py-2 bg-[#f5f5f0] cursor-pointer" onClick={() => setExpandedProgram(expandedProgram === g.program ? null : g.program)}>
                    <div className="text-[11px]">
                      <span className="font-semibold text-[#1a2b4a]">{g.program}</span>
                      <span className="text-[#6b7a8f] ml-3">v{g.version}</span>
                      <span className="text-[#6b7a8f] ml-3">{new Date(g.created_at).toLocaleDateString()}</span>
                    </div>
                    <span className="text-[10px] text-[#6b7a8f]">{expandedProgram === g.program ? "[-]" : "[+]"}</span>
                  </div>
                  {expandedProgram === g.program && (
                    <div className="px-3 py-2 bg-white">
                      <pre className="text-[10px] font-mono bg-[#f8f8f8] p-2 border overflow-auto max-h-[300px]">{JSON.stringify(g.rules, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Upload Modal */}
          {showUploadModal && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white border border-[#6b7a8f] shadow-lg w-[500px]">
                <div className="bg-[#1f4478] text-white px-3 py-2 text-[12px] font-bold flex justify-between">
                  <span>Upload Guidelines</span>
                  <button onClick={() => setShowUploadModal(false)} className="hover:text-[#ccc]">&times;</button>
                </div>
                <div className="p-4 text-[11px] space-y-3">
                  <div>
                    <label className="block text-[#6b7a8f] mb-1">Program</label>
                    <select className="enc-input w-full" value={uploadProgram} onChange={(e) => setUploadProgram(e.target.value)}>
                      {PROGRAMS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[#6b7a8f] mb-1">Rules (JSON)</label>
                    <textarea className="enc-input w-full font-mono h-[200px]" value={uploadRules} onChange={(e) => setUploadRules(e.target.value)} />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button className="enc-btn" onClick={() => setShowUploadModal(false)}>Cancel</button>
                    <button className="enc-btn enc-btn--primary" disabled={uploadLoading} onClick={uploadGuideline}>
                      {uploadLoading ? "Uploading..." : "Upload"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Placeholder tabs */}
      {(["SLA", "Ingestion", "Users"] as const).includes(activeTab as "SLA" | "Ingestion" | "Users") && (
        <div className="enc-panel p-4">
          <h3 className="text-[12px] font-bold text-[#1a2b4a] mb-3">{activeTab}</h3>
          <p className="text-[10px] text-[#6b7a8f]">{activeTab} configuration — coming soon</p>
        </div>
      )}
    </div>
  );
}
