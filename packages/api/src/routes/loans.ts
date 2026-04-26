import type { FastifyInstance } from "fastify";
import type { Store } from "@twin/core";
import { DecisionSchema, MilestoneSchema, QualifyingIncomeSchema } from "../schemas.js";
import { getLoansForTenant, requireLoanForTenant } from "./_helpers.js";

function pipelineRow(l: { id: string; borrower: { fullName: string };
  nqmProgram: string; transaction: { loanAmount: number; ltv: number };
  decision: string; conditions: { status: string }[] }) {
  return {
    id: l.id,
    borrower: l.borrower.fullName,
    program: l.nqmProgram,
    loanAmount: l.transaction.loanAmount,
    ltv: l.transaction.ltv,
    decision: l.decision,
    openConditions: l.conditions.filter((c) => c.status === "Open").length,
  };
}

export function registerLoanRoutes(app: FastifyInstance, store: Store) {
  app.get("/loans", async () =>
    getLoansForTenant(store).map(pipelineRow));

  app.get<{ Params: { loanId: string } }>("/loans/:loanId", async (req) =>
    requireLoanForTenant(store, req.params.loanId));

  app.get<{ Params: { loanId: string } }>("/loans/:loanId/audit", async () =>
    store.getAuditLog());

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/decision", async (req, reply) => {
    const body = DecisionSchema.parse(req.body);
    store.dispatch({ type: "SetDecision", loanId: req.params.loanId, ...body });
    reply.send(requireLoanForTenant(store, req.params.loanId));
  });

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/milestone", async (req, reply) => {
    const body = MilestoneSchema.parse(req.body);
    store.dispatch({ type: "AdvanceMilestone", loanId: req.params.loanId, ...body });
    reply.send(requireLoanForTenant(store, req.params.loanId));
  });

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/qualifying-income", async (req, reply) => {
    const body = QualifyingIncomeSchema.parse(req.body);
    store.dispatch({ type: "RecalculateQualifyingIncome", loanId: req.params.loanId,
      worksheet: body.worksheet, actor: body.actor });
    reply.send(requireLoanForTenant(store, req.params.loanId));
  });
}
