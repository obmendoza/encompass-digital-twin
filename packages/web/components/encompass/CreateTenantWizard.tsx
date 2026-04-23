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
      const res = await fetch("/api/system/health"); // placeholder — will wire to actual API
      if (!res.ok) throw new Error("API call failed");
      onCreated();
      onClose();
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
          <div>
            <label className="block text-[#6b7a8f] mb-1">Tenant Name <span className="text-[#c00]">*</span></label>
            <input className="enc-input w-full" value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Acme Lending" />
          </div>
          <div>
            <label className="block text-[#6b7a8f] mb-1">Slug <span className="text-[#c00]">*</span></label>
            <input className="enc-input w-full font-mono" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme-lending" />
          </div>
          <div>
            <label className="block text-[#6b7a8f] mb-1">Admin Email <span className="text-[#c00]">*</span></label>
            <input className="enc-input w-full" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@acme.com" />
          </div>
          {error && <div className="text-[10px] text-[#c00]">{error}</div>}
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
