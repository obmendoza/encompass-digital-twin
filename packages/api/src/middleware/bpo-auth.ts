import type { FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { withDb } from "../db/pool.js";

export interface BpoAuthOk {
  ok: true;
  tenantId: string;
  smeId: string;
  partnerId: string;
  smeName: string;
}

export type BpoAuthResult = BpoAuthOk | { ok: false };

/**
 * Verify a BPO bearer token. Returns auth context on success, or sends a 401
 * and returns { ok: false } on failure (so the caller can short-circuit).
 *
 * On success, also touches `bpo_api_keys.last_used_at` asynchronously (fire-
 * and-forget; failure is logged but doesn't block the request).
 */
export async function verifyBpoToken(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<BpoAuthResult> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    reply.status(401).send({ error: "missing_bearer_token" });
    return { ok: false };
  }
  const token = auth.slice("Bearer ".length).trim();
  if (!token) {
    reply.status(401).send({ error: "missing_bearer_token" });
    return { ok: false };
  }
  const hash = createHash("sha256").update(token).digest();

  const row = await withDb(async (c) => {
    const { rows } = await c.query<{
      tenant_id: string;
      sme_id: string;
      partner_id: string;
      sme_name: string;
    }>(
      `SELECT k.tenant_id, k.sme_id, s.bpo_partner_id AS partner_id, s.name AS sme_name
         FROM bpo_api_keys k
         JOIN bpo_smes s ON s.id = k.sme_id
        WHERE k.key_hash = $1
          AND k.revoked_at IS NULL
          AND s.active = true
        LIMIT 1`,
      [hash],
    );
    return rows[0];
  });
  if (!row) {
    reply.status(401).send({ error: "invalid_or_revoked_token" });
    return { ok: false };
  }

  // Fire-and-forget last_used_at touch. Don't block the request on this.
  void withDb(async (c) =>
    c.query("UPDATE bpo_api_keys SET last_used_at = now() WHERE key_hash = $1", [hash]),
  ).catch((e) => {
    req.log?.warn({ err: e }, "[bpo-auth] last_used_at update failed");
  });

  return {
    ok: true,
    tenantId: row.tenant_id,
    smeId: row.sme_id,
    partnerId: row.partner_id,
    smeName: row.sme_name,
  };
}
