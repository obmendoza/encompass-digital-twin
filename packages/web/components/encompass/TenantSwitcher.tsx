"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

interface Tenant { slug: string; name: string; status: string; }

export function TenantSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const [tenants, setTenants] = useState<Tenant[]>([]);

  const match = pathname.match(/^\/t\/([a-z0-9][a-z0-9-]*)\//);
  const currentSlug = match ? match[1] : "default";

  useEffect(() => {
    fetch("/api/tenants")
      .then((res) => res.ok ? res.json() : [])
      .then((data) => setTenants(data))
      .catch(() => {});
  }, []);

  if (tenants.length === 0) return null;

  return (
    <div className="flex items-center gap-1 ml-2 border-l border-[#c8c4b5] pl-2">
      <span className="text-[9px] text-[#6b7a8f]">Tenant:</span>
      <select
        className="text-[10px] bg-[#ece9d8] border border-[#c8c4b5] text-[#1a2b4a] font-semibold px-1 py-[1px] rounded-sm cursor-pointer"
        value={currentSlug}
        onChange={(e) => {
          const slug = e.target.value;
          if (slug === "default") {
            router.push("/");
          } else {
            router.push(`/t/${slug}/`);
          }
        }}
      >
        {tenants.map((t) => (
          <option key={t.slug} value={t.slug}>
            {t.name} {t.status !== "active" ? `(${t.status})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
