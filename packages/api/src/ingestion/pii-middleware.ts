import type { FastifyRequest, FastifyReply } from "fastify";

const SSN_DASHED = /^\d{3}-\d{2}-(\d{4})$/;
const SSN_RAW = /^\d{9}$/;
const SSN_DASHED_INLINE = /\b\d{3}-\d{2}-(\d{4})\b/g;
const SSN_RAW_INLINE = /\b\d{9}\b/g;

function maskValue(s: string): string {
  let m = s.match(SSN_DASHED);
  if (m) return `xxx-xx-${m[1]}`;
  m = s.match(SSN_RAW);
  if (m) return `xxx-xx-${s.slice(-4)}`;
  // Inline match (embedded in a longer string).
  let out = s.replace(SSN_DASHED_INLINE, (_, last4) => `xxx-xx-${last4}`);
  out = out.replace(SSN_RAW_INLINE, (match) => `xxx-xx-${match.slice(-4)}`);
  return out;
}

function walk(node: unknown): unknown {
  if (node === null || typeof node !== "object") {
    return typeof node === "string" ? maskValue(node) : node;
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

/** Deep-clones + redacts SSN-shaped strings. Non-mutating. */
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
