"use client";

import { createClient } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import type { AuthUser } from "@/lib/auth";

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-[#8a0000] text-white",
  uw: "bg-[#1b5e20] text-white",
  va: "bg-[#0a52a0] text-white",
  demo: "bg-[#6b7a8f] text-white",
};

export function UserBadge({ user }: { user: AuthUser | null }) {
  const router = useRouter();

  if (!user) return null;

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className={`px-2 py-[1px] font-bold uppercase ${ROLE_COLORS[user.role] ?? ROLE_COLORS.demo}`}>
        {user.role}
      </span>
      <span className="text-[#404040]">{user.displayName ?? user.email}</span>
      <button
        onClick={handleLogout}
        className="text-[#6b7a8f] hover:text-[#0a52a0] underline"
      >
        Sign out
      </button>
    </div>
  );
}
