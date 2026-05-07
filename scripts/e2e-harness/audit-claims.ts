// scripts/e2e-harness/audit-claims.ts
// The recent audit's claims, with the verdict to be determined by the harness.

import type { AuditClaim } from "./types.js";

export const AUDIT_CLAIMS: AuditClaim[] = [
  {
    id: "AC1",
    text: "Push-to-Loan reads but doesn't write — frontend never POSTs to /extract.",
    expectedVerdict: "contradicted", // direct code inspection already showed Push uses actionRecalcIncome
  },
];

export function getClaim(id: string): AuditClaim | undefined {
  return AUDIT_CLAIMS.find((c) => c.id === id);
}
