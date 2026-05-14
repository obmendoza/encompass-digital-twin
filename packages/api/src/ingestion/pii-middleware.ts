import type { FastifyRequest, FastifyReply } from "fastify";
import { redactText } from "../learning/pii-redactor.js";

function walk(node: unknown): unknown {
  if (node === null || typeof node !== "object") {
    return typeof node === "string" ? redactText(node).redacted : node;
  }
  if (Array.isArray(node)) {
    return node.map(walk);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    out[k] = walk(v);
  }
  return out;
}

/** Deep-clones + redacts PII strings (SSN, email, phone, address, DOB). Non-mutating. */
export function redactPayload(input: unknown): unknown {
  return walk(input);
}

/**
 * Fastify preHandler — applies redactPayload to req.body for /api/ingest/* paths.
 * Other routes pass through unchanged.
 */
export async function redactPayloadMiddleware(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!req.url.startsWith("/api/ingest/")) return;
  if (!req.body || typeof req.body !== "object") return;
  (req as unknown as { body: unknown }).body = redactPayload(req.body);
}
