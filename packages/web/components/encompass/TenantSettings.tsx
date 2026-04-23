"use client";
import { useState } from "react";

const TABS = ["General", "Guidelines", "SLA", "Ingestion", "API Keys", "Users"] as const;
type Tab = typeof TABS[number];

interface Props {
  tenantSlug: string;
  tenant: { name: string; status: string; settings: Record<string, unknown> };
}

export function TenantSettings({ tenantSlug, tenant }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("General");

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

      {activeTab === "General" && (
        <div className="enc-panel p-4">
          <h3 className="text-[12px] font-bold text-[#1a2b4a] mb-3">General Settings</h3>
          <div className="text-[11px] space-y-2">
            <div><span className="text-[#6b7a8f]">Name:</span> {tenant.name}</div>
            <div><span className="text-[#6b7a8f]">Slug:</span> {tenantSlug}</div>
            <div><span className="text-[#6b7a8f]">Status:</span> <span className="font-bold">{tenant.status.toUpperCase()}</span></div>
          </div>
        </div>
      )}

      {(["Guidelines", "SLA", "Ingestion", "API Keys", "Users"] as const).includes(activeTab as Exclude<Tab, "General">) && (
        <div className="enc-panel p-4">
          <h3 className="text-[12px] font-bold text-[#1a2b4a] mb-3">{activeTab}</h3>
          <p className="text-[10px] text-[#6b7a8f]">{activeTab} configuration — coming soon</p>
        </div>
      )}
    </div>
  );
}
