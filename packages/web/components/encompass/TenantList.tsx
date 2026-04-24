"use client";

import Link from "next/link";

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  onboarding: "bg-[#fef3c7] text-[#92400e] border border-[#f59e0b]",
  active: "bg-[#d1fae5] text-[#065f46] border border-[#10b981]",
  suspended: "bg-[#fee2e2] text-[#991b1b] border border-[#ef4444]",
  offboarding: "bg-[#e5e7eb] text-[#374151] border border-[#9ca3af]",
};

export function TenantList({ tenants }: { tenants: Tenant[] }) {
  return (
    <div className="border border-[#6b7a8f] rounded-sm overflow-hidden">
      <table className="w-full text-[11px] border-collapse">
        <thead>
          <tr className="bg-[#1f4478] text-white">
            <th className="text-left px-3 py-[6px] font-semibold">Tenant Name</th>
            <th className="text-left px-3 py-[6px] font-semibold">Slug</th>
            <th className="text-left px-3 py-[6px] font-semibold">Status</th>
            <th className="text-left px-3 py-[6px] font-semibold">Tenant ID</th>
            <th className="text-left px-3 py-[6px] font-semibold">Created</th>
            <th className="text-left px-3 py-[6px] font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t, i) => (
            <tr key={t.id} className={`border-b border-[#e0dfdb] hover:bg-[#eef3f8] ${i % 2 === 1 ? "bg-[#fafaf5]" : "bg-white"}`}>
              <td className="px-3 py-[5px]">
                <Link href={`/t/${t.slug}/admin/settings`} className="font-bold text-[#1a2b4a] hover:underline">
                  {t.name}
                </Link>
              </td>
              <td className="px-3 py-[5px] font-mono text-[#6b7a8f]">{t.slug}</td>
              <td className="px-3 py-[5px]">
                <span className={`inline-block px-2 py-[1px] text-[9px] font-bold rounded-sm ${STATUS_STYLES[t.status] ?? "bg-[#e5e7eb] text-[#374151]"}`}>
                  {t.status.toUpperCase()}
                </span>
              </td>
              <td className="px-3 py-[5px] font-mono text-[10px] text-[#8899aa]">{t.id.slice(0, 8)}...</td>
              <td className="px-3 py-[5px] text-[#6b7a8f]">{new Date(t.created_at).toLocaleDateString()}</td>
              <td className="px-3 py-[5px]">
                <Link href={`/t/${t.slug}/admin/settings`} className="enc-btn text-[9px] px-2 py-[2px]">
                  Settings
                </Link>
              </td>
            </tr>
          ))}
          {tenants.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-8 text-center text-[#8899aa]">
                <div className="text-[12px] font-semibold mb-1">No tenants yet</div>
                <div className="text-[10px]">Click &quot;Create Tenant&quot; to onboard your first lender</div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
