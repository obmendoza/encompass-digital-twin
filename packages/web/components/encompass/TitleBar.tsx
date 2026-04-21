import type { AuthUser } from "@/lib/auth";
import { UserBadge } from "./UserBadge";

export function TitleBar({ scenarioId, user }: { scenarioId: string | null; user?: AuthUser | null }) {
  return (
    <div className="bg-gradient-to-b from-[#0a52a0] to-[#07305e] text-white px-2 py-1 text-[11px] font-bold flex justify-between border-b border-black">
      <span>Encompass360 — Underwriting (Digital Twin)</span>
      <div className="flex items-center gap-3">
        <span className="opacity-70">{scenarioId ?? "— no scenario —"}</span>
        {user && <UserBadge user={user} />}
      </div>
    </div>
  );
}
