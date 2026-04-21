"use client";

import { useState, useTransition } from "react";
import { actionUpdateRole, actionUpdateDisplayName } from "@/app/admin/actions";

interface User {
  id: string;
  email: string;
  role: string;
  display_name: string | null;
  created_at: string;
}

const ROLES = ["demo", "va", "uw", "admin"];
const ROLE_COLORS: Record<string, string> = {
  admin: "bg-[#8a0000] text-white",
  uw: "bg-[#1b5e20] text-white",
  va: "bg-[#0a52a0] text-white",
  demo: "bg-[#6b7a8f] text-white",
};

export function AdminPanel({ users }: { users: User[] }) {
  const [pending, startTransition] = useTransition();
  const [editingName, setEditingName] = useState<string | null>(null);
  const [nameValue, setNameValue] = useState("");

  const changeRole = (userId: string, newRole: string) => {
    startTransition(async () => {
      await actionUpdateRole(userId, newRole);
    });
  };

  const saveName = (userId: string) => {
    startTransition(async () => {
      await actionUpdateDisplayName(userId, nameValue);
      setEditingName(null);
    });
  };

  return (
    <div>
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr className="bg-gradient-to-b from-[#0a52a0] to-[#08407d] text-white">
            <th className="text-left px-2 py-[4px] border-r border-[#08407d]">Email</th>
            <th className="text-left px-2 py-[4px] border-r border-[#08407d]">Display Name</th>
            <th className="text-left px-2 py-[4px] border-r border-[#08407d] w-[100px]">Role</th>
            <th className="text-left px-2 py-[4px] border-r border-[#08407d]">Registered</th>
            <th className="text-left px-2 py-[4px] w-[120px]">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => (
            <tr key={u.id} className={i % 2 ? "bg-[#f5f3e8]" : ""}>
              <td className="px-2 py-[3px] border-b border-[#c8c4b5]">{u.email}</td>
              <td className="px-2 py-[3px] border-b border-[#c8c4b5]">
                {editingName === u.id ? (
                  <div className="flex gap-1">
                    <input
                      className="border border-[#7f9db9] px-1 text-[10px] flex-1"
                      value={nameValue}
                      onChange={(e) => setNameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveName(u.id); }}
                    />
                    <button className="enc-btn text-[9px]" onClick={() => saveName(u.id)} disabled={pending}>✓</button>
                    <button className="enc-btn text-[9px]" onClick={() => setEditingName(null)}>✗</button>
                  </div>
                ) : (
                  <span
                    className="cursor-pointer hover:underline"
                    onClick={() => { setEditingName(u.id); setNameValue(u.display_name ?? ""); }}
                  >
                    {u.display_name ?? "—"}
                  </span>
                )}
              </td>
              <td className="px-2 py-[3px] border-b border-[#c8c4b5]">
                <select
                  className={`border-none px-1 py-[1px] text-[9px] font-bold cursor-pointer ${ROLE_COLORS[u.role] ?? ""}`}
                  value={u.role}
                  onChange={(e) => changeRole(u.id, e.target.value)}
                  disabled={pending}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r.toUpperCase()}</option>
                  ))}
                </select>
              </td>
              <td className="px-2 py-[3px] border-b border-[#c8c4b5]">
                {new Date(u.created_at).toLocaleDateString()}
              </td>
              <td className="px-2 py-[3px] border-b border-[#c8c4b5]">
                <span className={`px-1 py-[1px] text-[9px] font-bold ${ROLE_COLORS[u.role] ?? ""}`}>
                  {u.role.toUpperCase()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {users.length === 0 && (
        <div className="text-center text-[#6b7a8f] py-4 text-[11px]">
          No users registered yet.
        </div>
      )}
    </div>
  );
}
