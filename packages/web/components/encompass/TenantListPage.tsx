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
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-lg font-bold text-[#1a2b4a]">Platform Admin — Tenants</h1>
        <button className="enc-btn enc-btn--primary" onClick={() => setShowWizard(true)}>
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
