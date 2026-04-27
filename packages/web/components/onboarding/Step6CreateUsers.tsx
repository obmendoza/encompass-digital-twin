"use client";

import { useState, useCallback } from "react";

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "uw", label: "Underwriter" },
  { value: "va", label: "Virtual Assistant" },
  { value: "compliance_officer", label: "Compliance Officer" },
] as const;

interface UserRow {
  id: string;
  email: string;
  role: string;
  displayName: string;
}

export interface Step6Data {
  users: UserRow[];
}

interface Step6Props {
  contactEmail?: string;
  onNext: (data: Step6Data) => void;
  onBack: () => void;
}

function createEmptyUser(email = "", role = "uw"): UserRow {
  return {
    id: crypto.randomUUID(),
    email,
    role,
    displayName: "",
  };
}

export function Step6CreateUsers({ contactEmail, onNext, onBack }: Step6Props) {
  const [users, setUsers] = useState<UserRow[]>(() => {
    if (contactEmail) {
      return [createEmptyUser(contactEmail, "admin")];
    }
    return [];
  });

  const addUser = useCallback(() => {
    setUsers((prev) => [...prev, createEmptyUser()]);
  }, []);

  const removeUser = useCallback((id: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }, []);

  const updateUser = useCallback((id: string, field: keyof UserRow, value: string) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === id ? { ...u, [field]: value } : u)),
    );
  }, []);

  const hasAdmin = users.some((u) => u.role === "admin" && u.email.includes("@"));
  const validationError = !hasAdmin ? "At least 1 admin with a valid email is required to proceed." : "";

  const handleSubmit = () => {
    if (!hasAdmin) return;
    onNext({ users });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">User Management</h2>
      <p className="text-sm text-gray-500 mb-8">
        Add the lender&apos;s team members who will use the platform.
      </p>

      {/* User table */}
      {users.length === 0 ? (
        <div className="p-6 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-center mb-6">
          <p className="text-sm text-gray-400">No users added yet.</p>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Role
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Display Name
                </th>
                <th className="px-4 py-3 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <input
                      type="email"
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="user@company.com"
                      value={user.email}
                      onChange={(e) => updateUser(user.id, "email", e.target.value)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="border border-gray-300 rounded-md px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      value={user.role}
                      onChange={(e) => updateUser(user.id, "role", e.target.value)}
                    >
                      {ROLES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder="Jane Smith"
                      value={user.displayName}
                      onChange={(e) => updateUser(user.id, "displayName", e.target.value)}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50"
                      title="Remove user"
                      onClick={() => removeUser(user.id)}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add User button */}
      <button
        className="px-4 py-2 rounded-md text-sm font-medium border border-dashed border-gray-300 text-gray-600 hover:border-gray-400 hover:bg-gray-50 transition-colors w-full mb-2"
        onClick={addUser}
      >
        + Add User
      </button>

      {/* User count summary */}
      {users.length > 0 && (
        <p className="text-xs text-gray-500 mt-2 mb-4">
          {users.length} user{users.length !== 1 ? "s" : ""} configured
          {" "}&mdash;{" "}
          {users.filter((u) => u.role === "admin").length} admin,{" "}
          {users.filter((u) => u.role === "uw").length} UW,{" "}
          {users.filter((u) => u.role === "va").length} VA,{" "}
          {users.filter((u) => u.role === "compliance_officer").length} compliance
        </p>
      )}

      {/* Validation error */}
      {validationError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 mb-6">
          {validationError}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-6">
        <button
          className="px-5 py-2.5 rounded-md text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          onClick={onBack}
        >
          &larr; Back
        </button>
        <button
          className={`
            px-5 py-2.5 rounded-md text-sm font-medium transition-colors
            ${hasAdmin
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }
          `}
          disabled={!hasAdmin}
          onClick={handleSubmit}
        >
          Next: Go-Live Checklist &rarr;
        </button>
      </div>
    </div>
  );
}
