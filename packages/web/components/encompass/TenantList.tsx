"use client";

interface Tenant { id: string; name: string; slug: string; status: string; created_at: string; }

export function TenantList({ tenants }: { tenants: Tenant[] }) {
  const statusColors: Record<string, string> = {
    onboarding: "bg-[#fef3c7] text-[#92400e]",
    active: "bg-[#d1fae5] text-[#065f46]",
    suspended: "bg-[#fee2e2] text-[#991b1b]",
    offboarding: "bg-[#e5e7eb] text-[#374151]",
  };

  return (
    <table className="w-full text-[11px] border-collapse">
      <thead>
        <tr className="bg-[#e8ecf0] text-[#404040]">
          <th className="text-left px-3 py-2 font-semibold">Name</th>
          <th className="text-left px-3 py-2 font-semibold">Slug</th>
          <th className="text-left px-3 py-2 font-semibold">Status</th>
          <th className="text-left px-3 py-2 font-semibold">Created</th>
        </tr>
      </thead>
      <tbody>
        {tenants.map((t) => (
          <tr key={t.id} className="border-b border-[#e0dfdb] hover:bg-[#f5f5f0] cursor-pointer">
            <td className="px-3 py-2 font-semibold text-[#1a2b4a]">{t.name}</td>
            <td className="px-3 py-2 font-mono text-[#6b7a8f]">{t.slug}</td>
            <td className="px-3 py-2">
              <span className={`px-2 py-[2px] text-[9px] font-bold rounded ${statusColors[t.status] ?? ""}`}>
                {t.status.toUpperCase()}
              </span>
            </td>
            <td className="px-3 py-2 text-[#6b7a8f]">{new Date(t.created_at).toLocaleDateString()}</td>
          </tr>
        ))}
        {tenants.length === 0 && (
          <tr><td colSpan={4} className="px-3 py-4 text-center text-[#8899aa]">No tenants yet</td></tr>
        )}
      </tbody>
    </table>
  );
}
