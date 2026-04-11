import type { FastifyInstance } from "fastify";
import { ActionError } from "@twin/core";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ActionError) {
      reply.status(400).send(err.toJSON());
      return;
    }
    if ((err as { validation?: unknown }).validation) {
      reply.status(400).send({
        code: "REQUIRED_FIELD_MISSING",
        message: err.message,
        details: (err as { validation?: unknown }).validation,
      });
      return;
    }
    const requestId = Math.random().toString(36).slice(2, 10);
    app.log.error({ requestId, err }, "unhandled");
    reply.status(500).send({ code: "INTERNAL", message: err.message, requestId });
  });
}
