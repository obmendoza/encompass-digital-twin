"use client";
import { useState } from "react";

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function CreateTenantWizard({ onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const autoSlug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 31);

  const handleNameChange = (v: string) => { setName(v); setSlug(autoSlug(v)); };

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
      const res = await fetch(`${apiUrl}/tenants`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-super-admin": "true",
          "x-user-id": "admin",
        },
        body: JSON.stringify({ name, slug }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.fieldErrors?.slug?.[0] ?? data.error ?? "Failed to create tenant");
      }
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create tenant");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white border border-[#6b7a8f] shadow-lg w-[420px]">
        <div className="bg-[#1f4478] text-white px-3 py-2 text-[12px] font-bold flex justify-between">
          <span>Create Tenant</span>
          <button onClick={onClose} className="hover:text-[#ccc]">&times;</button>
        </div>
        <div className="p-4 text-[11px] space-y-3">
          <p className="text-[10px] text-[#6b7a8f] border-b border-[#e0dfdb] pb-2 mb-1">
            Register a new lender on the platform. Each tenant gets isolated data, guidelines, and API keys.
          </p>
          <div>
            <label className="block text-[#6b7a8f] mb-1">Tenant Name <span className="text-[#c00]">*</span></label>
            <input className={`enc-input w-full ${error && !name ? "border-[#c00]" : ""}`} value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Acme Lending" />
            <div className="text-[9px] text-[#8899aa] mt-[2px]">The display name for this lender organization</div>
          </div>
          <div>
            <label className="block text-[#6b7a8f] mb-1">Slug <span className="text-[#c00]">*</span></label>
            <input className={`enc-input w-full font-mono ${error && !slug ? "border-[#c00]" : ""}`} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme-lending" />
            {slug && (
              <div className="text-[9px] text-[#1f4478] mt-[2px] font-mono">
                /t/{slug}/
              </div>
            )}
          </div>
          <div>
            <label className="block text-[#6b7a8f] mb-1">Admin Email <span className="text-[#c00]">*</span></label>
            <input className={`enc-input w-full ${error && !adminEmail ? "border-[#c00]" : ""}`} type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@acme.com" />
            <div className="text-[9px] text-[#8899aa] mt-[2px]">Primary administrator for this tenant</div>
          </div>
          {error && (
            <div className="text-[10px] text-[#c00] bg-[#fee2e2] border border-[#ef4444] rounded-sm px-3 py-2">
              {error}
            </div>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <button className="enc-btn" onClick={onClose}>Cancel</button>
            <button className="enc-btn enc-btn--primary" disabled={loading || !name || !slug || !adminEmail} onClick={handleSubmit}>
              {loading ? "Creating..." : "Create Tenant"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
