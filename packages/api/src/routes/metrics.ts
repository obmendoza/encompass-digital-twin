import type { FastifyInstance } from "fastify";
import type { Store } from "@twin/core";
import { getLoansForTenant } from "./_helpers.js";

export function registerMetricsRoutes(app: FastifyInstance, store: Store) {
  app.get("/metrics", async () => {
    const loans = getLoansForTenant(store);
    const log = store.getAuditLog();

    const decisions = { pending: 0, approved: 0, denied: 0, suspended: 0, counter: 0 };
    const assignments = { unassigned: 0, queued: 0, in_progress: 0, report_ready: 0, under_review: 0, decided: 0 };
    const programs: Record<string, number> = {};
    let totalConditions = 0, clearedConditions = 0, openConditions = 0;
    let totalDocs = 0, docsWithFiles = 0;
    let loansWithRec = 0;
    let overrides = 0;

    for (const loan of loans) {
      // Decision counts
      decisions[loan.decision as keyof typeof decisions] = (decisions[loan.decision as keyof typeof decisions] ?? 0) + 1;

      // Assignment counts
      if (loan.assignment) {
        assignments[loan.assignment.status as keyof typeof assignments] = (assignments[loan.assignment.status as keyof typeof assignments] ?? 0) + 1;
      } else {
        assignments.unassigned++;
      }

      // Program distribution
      programs[loan.nqmProgram] = (programs[loan.nqmProgram] ?? 0) + 1;

      // Conditions
      for (const c of loan.conditions) {
        totalConditions++;
        if (c.status === "Cleared") clearedConditions++;
        if (c.status === "Open") openConditions++;
      }

      // Documents
      totalDocs += loan.documents.length;
      docsWithFiles += loan.documents.filter(d => d.fileKey).length;

      // Recommendations
      if (loan.pendingRecommendation) loansWithRec++;
    }

    // Count overrides from audit log
    for (const entry of log) {
      if (entry.action.type === "OverrideDecision") overrides++;
    }

    return {
      totalLoans: loans.length,
      decisions,
      assignments,
      programs,
      conditions: { total: totalConditions, cleared: clearedConditions, open: openConditions },
      documents: { total: totalDocs, withFiles: docsWithFiles },
      pendingRecommendations: loansWithRec,
      overrides,
      auditLogEntries: log.length,
    };
  });
}
