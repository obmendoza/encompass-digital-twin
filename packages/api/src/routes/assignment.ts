import type { FastifyInstance } from "fastify";
import type { Store } from "@twin/core";
import { z } from "zod";
import { getLoansForTenant, requireLoanForTenant } from "./_helpers.js";

const AssignSchema = z.object({
  assignedTo: z.string().min(1),
  priority: z.enum(["normal", "high", "urgent"]).default("normal"),
  actor: z.object({ kind: z.enum(["human", "agent"]), id: z.string() }),
});

const StatusSchema = z.object({
  status: z.enum(["queued", "in_progress", "report_ready", "under_review", "decided"]),
  actor: z.object({ kind: z.enum(["human", "agent"]), id: z.string() }),
});

const ActorSchema = z.object({
  actor: z.object({ kind: z.enum(["human", "agent"]), id: z.string() }),
});

export function registerAssignmentRoutes(app: FastifyInstance, store: Store) {
  app.post<{ Params: { loanId: string } }>("/loans/:loanId/assign", async (req, reply) => {
    const body = AssignSchema.parse(req.body);
    store.dispatch({ type: "AssignLoan", loanId: req.params.loanId, assignedTo: body.assignedTo, priority: body.priority, actor: body.actor });
    reply.send(requireLoanForTenant(store, req.params.loanId));
  });

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/assignment-status", async (req, reply) => {
    const body = StatusSchema.parse(req.body);
    store.dispatch({ type: "UpdateAssignmentStatus", loanId: req.params.loanId, status: body.status, actor: body.actor });
    reply.send(requireLoanForTenant(store, req.params.loanId));
  });

  app.delete<{ Params: { loanId: string } }>("/loans/:loanId/assign", async (req, reply) => {
    const body = ActorSchema.parse(req.body);
    store.dispatch({ type: "UnassignLoan", loanId: req.params.loanId, actor: body.actor });
    reply.send(requireLoanForTenant(store, req.params.loanId));
  });

  // Get all assigned loans for a specific user (filtered by tenant)
  app.get<{ Params: { userId: string } }>("/assignments/:userId", async (req) => {
    const loans = getLoansForTenant(store);
    return loans
      .filter((l) => l.assignment?.assignedTo === req.params.userId)
      .map((l) => ({
        id: l.id,
        borrower: l.borrower.fullName,
        program: l.nqmProgram,
        loanAmount: l.transaction.loanAmount,
        status: l.assignment!.status,
        priority: l.assignment!.priority,
        assignedAt: l.assignment!.assignedAt,
        decision: l.decision,
      }));
  });
}
