import type { FastifyInstance } from "fastify";
import { ActionError, type Store } from "@twin/core";
import * as fs from "../file-store.js";

export function registerUploadRoutes(app: FastifyInstance, store: Store) {
  // Serve stored files
  app.get<{ Params: { fileKey: string } }>("/uploads/:fileKey", async (req, reply) => {
    const file = fs.getFile(req.params.fileKey);
    if (!file) {
      reply.status(404).send({ error: "File not found" });
      return;
    }
    reply
      .header("Content-Type", file.mimeType)
      .header("Content-Disposition", `inline; filename="${file.originalName}"`)
      .send(file.buffer);
  });

  // Upload a file to a document
  app.post<{ Params: { loanId: string; docId: string } }>(
    "/loans/:loanId/documents/:docId/upload",
    async (req, reply) => {
      const data = await req.file();
      if (!data) {
        reply.status(400).send({ error: "No file uploaded" });
        return;
      }

      const buffer = await data.toBuffer();
      const fileKey = fs.generateKey();
      const mimeType = data.mimetype || "application/octet-stream";
      const originalName = data.filename || "document";

      fs.saveFile(fileKey, buffer, mimeType, originalName);

      const fileUrl = `/uploads/${fileKey}`;

      store.dispatch({
        type: "AttachFile",
        loanId: req.params.loanId,
        documentId: req.params.docId,
        fileKey,
        fileUrl,
        fileSize: buffer.length,
        mimeType,
        actor: { kind: "human", id: "uploader" },
      });

      const loan = store.getLoan(req.params.loanId);
      if (!loan) throw new ActionError("LOAN_NOT_FOUND", "loan not found", { loanId: req.params.loanId });

      reply.send({
        ok: true,
        fileKey,
        fileUrl,
        fileSize: buffer.length,
        mimeType,
        document: loan.documents.find((d) => d.id === req.params.docId),
      });
    },
  );
}
