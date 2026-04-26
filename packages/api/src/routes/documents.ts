import type { FastifyInstance } from "fastify";
import type { Store } from "@twin/core";
import { NewDocumentSchema, UpdateDocumentSchema, LinkDocumentSchema } from "../schemas.js";
import { requireLoanForTenant } from "./_helpers.js";

export function registerDocumentRoutes(app: FastifyInstance, store: Store) {
  app.get<{ Params: { loanId: string } }>("/loans/:loanId/documents", async (req) =>
    requireLoanForTenant(store, req.params.loanId).documents);

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/documents", async (req, reply) => {
    const body = NewDocumentSchema.parse(req.body);
    store.dispatch({ type: "AddDocument", loanId: req.params.loanId, doc: body.doc, actor: body.actor });
    reply.send(requireLoanForTenant(store, req.params.loanId));
  });

  app.patch<{ Params: { loanId: string; docId: string } }>(
    "/loans/:loanId/documents/:docId",
    async (req, reply) => {
      const body = UpdateDocumentSchema.parse(req.body);
      if (body.status) {
        store.dispatch({ type: "UpdateDocumentStatus", loanId: req.params.loanId,
          documentId: req.params.docId, status: body.status, notes: body.notes, actor: body.actor });
      }
      if (body.linkedConditionId) {
        store.dispatch({ type: "LinkDocument", loanId: req.params.loanId,
          documentId: req.params.docId, conditionId: body.linkedConditionId, actor: body.actor });
      }
      reply.send(requireLoanForTenant(store, req.params.loanId));
    });

  app.post<{ Params: { loanId: string; docId: string } }>(
    "/loans/:loanId/documents/:docId/link",
    async (req, reply) => {
      const body = LinkDocumentSchema.parse(req.body);
      store.dispatch({ type: "LinkDocument", loanId: req.params.loanId,
        documentId: req.params.docId, conditionId: body.conditionId, actor: body.actor });
      reply.send(requireLoanForTenant(store, req.params.loanId));
    });

  app.post<{ Params: { loanId: string; docId: string } }>(
    "/loans/:loanId/documents/:docId/extract",
    async (req, reply) => {
      const body = req.body as { extractedData: Record<string, unknown>; actor: { kind: string; id: string } };
      store.dispatch({
        type: "SetExtractedData",
        loanId: req.params.loanId,
        documentId: req.params.docId,
        extractedData: body.extractedData,
        actor: body.actor as { kind: "human" | "agent"; id: string },
      });
      reply.send(requireLoanForTenant(store, req.params.loanId));
    });
}
