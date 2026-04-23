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

  // Read-only views (compliance_officer shares UW read access)
  "loan.view": ["va", "uw", "compliance_officer", "admin"],
  "transmittal.view": ["va", "uw", "compliance_officer", "admin"],
  "conditions.view": ["va", "uw", "compliance_officer", "admin"],
  "documents.view": ["va", "uw", "compliance_officer", "admin"],
  "metrics.view": ["uw", "compliance_officer", "admin"],

  // Learning engine — suggestions
  "suggestion.view": ["uw", "compliance_officer", "admin"],
  "suggestion.view_compliance_only": ["compliance_officer", "admin"],
  "suggestion.approve_guideline_change": ["compliance_officer", "admin"],
  "suggestion.approve_threshold_update": ["compliance_officer", "admin"],
  "suggestion.apply": ["admin"],
  "suggestion.dismiss": ["uw", "compliance_officer", "admin"],
};

export function hasPermission(role: UserRole | null | undefined, permission: string): boolean {
  if (!role) return false;
  const allowed = PERMISSIONS[permission];
  if (!allowed) return false;
  return allowed.includes(role);
}
