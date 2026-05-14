import type { FastifyRequest, FastifyReply } from "fastify";
import { redactText } from "../learning/pii-redactor.js";

/**
 * Path patterns that identify PII fields. Format:
 *   - "a.b.c"   — literal nested keys
 *   - "a.b[*].c" — array wildcard (one level; segment becomes "b[N]" in live path)
 *   - "ssn"     — bare key at root only
 *
 * Each entry pairs a pattern string with the redaction token to apply when
 * the path matches a leaf string value. We apply tokens directly for structured
 * fields (DOB, email, phone) where redactText would not fire (no label prefix).
 * For SSN paths we still call redactText so dashed/spaced formats are handled.
 */
const PII_PATHS: Array<{ pattern: string; type: "ssn" | "dob" | "email" | "phone" }> = [
  { pattern: "ssn",                                                                                                                                  type: "ssn" },
  { pattern: "borrower.ssn",                                                       type: "ssn" },
  { pattern: "borrower.dob",                                                       type: "dob" },
  { pattern: "borrower.ssnMasked",                                                 type: "ssn" },
  { pattern: "borrowers[*].ssn",                                                   type: "ssn" },
  { pattern: "borrowers[*].dob",                                                   type: "dob" },
  { pattern: "loanData.borrower.ssn",                                              type: "ssn" },
  { pattern: "loanData.borrower.dob",                                              type: "dob" },
  { pattern: "loanData.borrower.ssnMasked",                                        type: "ssn" },
  { pattern: "loanData.borrowers[*].ssn",                                          type: "ssn" },
  { pattern: "loanData.borrowers[*].dob",                                          type: "dob" },
  { pattern: "analysisOutput.scenario_summary.borrowers[*].ssn",                   type: "ssn" },
  { pattern: "analysisOutput.scenario_summary.borrowers[*].dob",                   type: "dob" },
  { pattern: "analysisOutput.scenario_summary.borrowers[*].email",                 type: "email" },
  { pattern: "analysisOutput.scenario_summary.borrowers[*].phone",                 type: "phone" },
];

/** Test if a live path matches a PII pattern. Supports "[*]" wildcard segments. */
function pathMatches(pattern: string, path: string): boolean {
  const patSegs = pattern.split(".");
  const pathSegs = path.split(".");
  if (patSegs.length !== pathSegs.length) return false;
  for (let i = 0; i < patSegs.length; i++) {
    const ps = patSegs[i]!;
    const xs = pathSegs[i]!;
    if (ps.endsWith("[*]")) {
      // Live segment looks like "borrowers[3]"; pattern segment is "borrowers[*]"
      const base = ps.slice(0, -3); // e.g. "borrowers"
      if (!xs.startsWith(base + "[")) return false;
      if (!xs.endsWith("]")) return false;
      continue;
    }
    if (ps !== xs) return false;
  }
  return true;
}

function matchPiiPath(path: string): "ssn" | "dob" | "email" | "phone" | null {
  for (const { pattern, type } of PII_PATHS) {
    if (pathMatches(pattern, path)) return type;
  }
  return null;
}

function applyRedaction(value: string, piiType: "ssn" | "dob" | "email" | "phone"): string {
  switch (piiType) {
    case "ssn":
      // Use redactText so dashed/spaced SSN formats are handled correctly
      return redactText(value).redacted;
    case "dob":
      return "[REDACTED_DOB]";
    case "email":
      return "[REDACTED_EMAIL]";
    case "phone":
      return "[REDACTED_PHONE]";
  }
}

function walk(node: unknown, path: string): unknown {
  if (node === null || typeof node !== "object") {
    if (typeof node === "string") {
      const piiType = matchPiiPath(path);
      if (piiType !== null) return applyRedaction(node, piiType);
    }
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item, i) => walk(item, `${path}[${i}]`));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const childPath = path === "" ? k : `${path}.${k}`;
    out[k] = walk(v, childPath);
  }
  return out;
}

/**
 * Deep-clones + redacts strings at known PII paths only. Non-mutating.
 *
 * Path-restricted: only enumerated SSN/DOB/email/phone surfaces are masked.
 * Non-PII values that happen to be 9-digit strings (externalId, loanNumber,
 * scenario_summary.loan_number, etc.) pass through unchanged.
 */
export function redactPayload(input: unknown): unknown {
  return walk(input, "");
}

/**
 * Fastify preHandler — applies redactPayload to req.body for /api/ingest/* paths.
 * Path-restricted: only known PII fields (see PII_PATHS) are masked. Non-PII
 * values matching SSN-shaped regex (e.g., 9-digit externalId, loan_number)
 * pass through unchanged.
 */
export async function redactPayloadMiddleware(
  req: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!req.url.startsWith("/api/ingest/")) return;
  if (!req.body || typeof req.body !== "object") return;
  (req as unknown as { body: unknown }).body = redactPayload(req.body);
}
