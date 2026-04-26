"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TenantList } from "./TenantList";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
}

export function TenantListPage({ tenants }: { tenants: Tenant[] }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);

  // Inline form state for minimal fields needed by POST /onboarding
  const [tenantName, setTenantName] = useState("");
  const [slug, setSlug] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [lenderType, setLenderType] = useState("correspondent");

  const router = useRouter();

  const autoSlug = (n: string) =>
    n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 31);

  const handleNameChange = (v: string) => {
    setTenantName(v);
    setSlug(autoSlug(v));
  };

  const handleOnboard = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-super-admin": "true",
          "x-user-id": "admin",
        },
        body: JSON.stringify({
          tenantName,
          slug,
          contactEmail,
          lenderType,
          programs: ["BankStatement12"], // default; user picks more in wizard
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to create" }));
        const msg =
          typeof data.error === "string" ? data.error :
          data.error?.fieldErrors?.slug?.[0] ?? "Failed to create onboarding session";
        throw new Error(msg);
      }
      const data = await res.json();
      router.push(`/platform/onboarding/${data.tenant.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create onboarding session");
    } finally {
      setLoading(false);
    }
  };

  const formValid = tenantName.trim().length > 0 && slug.length >= 2 && contactEmail.includes("@");

  return (
    <div>
      <div className="flex justify-between items-center mb-3 border-b border-[#c8c4b5] pb-2">
        <div>
          <h2 className="text-[13px] font-bold text-[#1a2b4a]">Tenant Management</h2>
          <p className="text-[10px] text-[#6b7a8f]">{tenants.length} tenant{tenants.length !== 1 ? "s" : ""} registered</p>
        </div>
        <button
          className="enc-btn enc-btn--primary text-[10px]"
          onClick={() => setShowForm((v) => !v)}
        >
          + Onboard New Lender
        </button>
      </div>

      {showForm && (
        <div className="bg-gray-50 border border-gray-200 rounded-md p-4 mb-4">
          <h3 className="text-[12px] font-bold text-[#1a2b4a] mb-3">Start Onboarding</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
            <div>
              <label className="block text-[#6b7a8f] mb-1">Lender Name <span className="text-[#c00]">*</span></label>
              <input
                className="enc-input w-full"
                value={tenantName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Acme Lending"
              />
            </div>
            <div>
              <label className="block text-[#6b7a8f] mb-1">Slug</label>
              <input
                className="enc-input w-full font-mono"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="acme-lending"
              />
            </div>
            <div>
              <label className="block text-[#6b7a8f] mb-1">Contact Email <span className="text-[#c00]">*</span></label>
              <input
                className="enc-input w-full"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="admin@acme.com"
              />
            </div>
            <div>
              <label className="block text-[#6b7a8f] mb-1">Lender Type</label>
              <select
                className="enc-input w-full"
                value={lenderType}
                onChange={(e) => setLenderType(e.target.value)}
              >
                <option value="correspondent">Correspondent</option>
                <option value="wholesale">Wholesale</option>
                <option value="retail">Retail</option>
                <option value="direct">Direct</option>
              </select>
            </div>
          </div>
          {error && (
            <div className="text-[10px] text-[#c00] bg-[#fee2e2] border border-[#ef4444] rounded-sm px-3 py-2 mt-3">
              {error}
            </div>
          )}
          <div className="flex gap-2 justify-end mt-3">
            <button className="enc-btn" onClick={() => { setShowForm(false); setError(""); }}>
              Cancel
            </button>
            <button
              className="enc-btn enc-btn--primary"
              disabled={loading || !formValid}
              onClick={handleOnboard}
            >
              {loading ? "Creating..." : "Start Onboarding"}
            </button>
          </div>
        </div>
      )}

      <TenantList tenants={tenants} />
    </div>
  );
}
