"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TenantList } from "./TenantList";
import { CreateTenantWizard } from "./CreateTenantWizard";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
}

export function TenantListPage({ tenants }: { tenants: Tenant[] }) {
  const [showWizard, setShowWizard] = useState(false);
  const router = useRouter();

  return (
    <div>
      <div className="flex justify-between items-center mb-3 border-b border-[#c8c4b5] pb-2">
        <div>
          <h2 className="text-[13px] font-bold text-[#1a2b4a]">Tenant Management</h2>
          <p className="text-[10px] text-[#6b7a8f]">{tenants.length} tenant{tenants.length !== 1 ? "s" : ""} registered</p>
        </div>
        <button className="enc-btn enc-btn--primary text-[10px]" onClick={() => setShowWizard(true)}>
          + Create Tenant
        </button>
      </div>
      <TenantList tenants={tenants} />
      {showWizard && (
        <CreateTenantWizard
          onClose={() => setShowWizard(false)}
          onCreated={() => { setShowWizard(false); router.refresh(); }}
        />
      )}
    </div>
  );
}
