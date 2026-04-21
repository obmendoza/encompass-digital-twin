import type { UserRole } from "./auth";

export const PERMISSIONS: Record<string, UserRole[]> = {
  // Decisions
  "decision.set": ["uw", "admin"],
  "decision.accept_recommendation": ["uw", "admin"],

  // Conditions
  "condition.add": ["va", "uw", "admin"],
  "condition.clear": ["va", "uw", "admin"],
  "condition.waive": ["uw", "admin"],
  "condition.remove": ["uw", "admin"],

  // Agent
  "agent.run": ["va", "uw", "admin"],
  "agent.generate_docs": ["va", "uw", "admin"],
  "agent.run_idp": ["va", "uw", "admin"],

  // Documents
  "doc.upload": ["va", "uw", "admin"],
  "doc.add": ["va", "uw", "admin"],

  // Workshop
  "workshop.generate": ["demo", "va", "uw", "admin"],
  "workshop.inject": ["va", "uw", "admin"],

  // Admin
  "admin.access": ["admin"],

  // Sandbox
  "sandbox.reset": ["uw", "admin"],
};

export function hasPermission(role: UserRole | null | undefined, permission: string): boolean {
  if (!role) return false;
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return allowed.includes(role);
}
