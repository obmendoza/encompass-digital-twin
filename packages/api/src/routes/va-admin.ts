// va-admin.ts
// Admin endpoints for the VA Review Layer:
//  - /admin/bpo/partners       — register a BPO partner (global table, cross-tenant)
//  - /admin/bpo/smes           — register a BPO SME under a partner (global table)
//  - /admin/bpo/api-keys       — issue a per-tenant API key for a BPO SME
//  - /admin/va/pools           — create a VA pool (internal or BPO)
//  - /admin/va/routing-rules   — create a routing rule for a tenant
//
// DPA gate: the va_pools BEFORE INSERT/UPDATE trigger (`va_pools_dpa_gate`,
// migration 013) raises a check_violation when a kind='bpo' pool references
// a partner whose dpa_on_file is false or whose dpa_reference is empty. We
// surface that as a clean 409 with `error: "DPA_GATE_VIOLATION"`.
//
// Audit: every successful create writes a row to `tenant_audit_log` capturing
// actor_id (x-user-id header), target_tenant_id (the acting admin's tenant —
// the column is NOT NULL per migration 001 so even global creates record
// "admin from tenant X did this"), action, reason, and metadata. Raw API key
// tokens are NEVER persisted in audit metadata — only the api_key_id and
// sme_id are recorded; the raw token is shown in the response body once.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PoolClient } from "pg";
import { randomBytes, createHash } from "node:crypto";
import { getTenantId } from "../tenant-context.js";
import { withDb, withTenantTx } from "../db/pool.js";

// ── Body schemas ─────────────────────────────────────────────────────────────

const PartnerCreate = z.object({
  name: z.string().min(1),
  contact_email: z.string().email(),
  dpa_on_file: z.boolean(),
  dpa_reference: z.string().min(1).nullable(),
});

const SmeCreate = z.object({
  bpo_partner_id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
});

const ApiKeyCreate = z.object({
  sme_id: z.string().uuid(),
  // tenant_id is implicit from getTenantId()
});

const PoolCreate = z.object({
  name: z.string().min(1),
  kind: z.enum(["internal", "bpo"]),
  bpo_partner_id: z.string().uuid().nullable(),
});

const RoutingRuleCreate = z.object({
  priority: z.number().int(),
  match: z.object({
    program: z.array(z.string()).optional(),
    loanAmountMin: z.number().optional(),
    loanAmountMax: z.number().optional(),
    occupancy: z.array(z.enum(["Primary", "Second", "Investment"])).optional(),
  }),
  target_pool_id: z.string().uuid(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function actorFromReq(req: { headers: Record<string, string | string[] | undefined> }): {
  userId: string;
} {
  return { userId: String(req.headers["x-user-id"] ?? "unknown") };
}

async function logAdminAudit(
  client: PoolClient,
  args: {
    actorId: string;
    targetTenantId: string;
    action: string;
    reason: string;
    metadata: unknown;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO tenant_audit_log (actor_id, target_tenant_id, action, reason, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [args.actorId, args.targetTenantId, args.action, args.reason, JSON.stringify(args.metadata)],
  );
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function registerVAAdminRoutes(app: FastifyInstance): void {
  // ── POST /admin/bpo/partners ──
  // bpo_partners is a global table; the audit row records the acting admin's
  // tenant (target_tenant_id is NOT NULL). The DPA gate is enforced at pool-
  // creation time, not partner-creation, so dpa_on_file=false is allowed here.
  app.post("/admin/bpo/partners", async (req, reply) => {
    const body = PartnerCreate.parse(req.body);
    const tenantId = getTenantId();
    const actor = actorFromReq(req);
    const id = await withDb(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO bpo_partners (name, contact_email, dpa_on_file, dpa_reference)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [body.name, body.contact_email, body.dpa_on_file, body.dpa_reference],
      );
      await logAdminAudit(c, {
        actorId: actor.userId,
        targetTenantId: tenantId,
        action: "bpo_partner_create",
        reason: `Created BPO partner: ${body.name}`,
        metadata: {
          partner_id: rows[0].id,
          name: body.name,
          dpa_on_file: body.dpa_on_file,
        },
      });
      return rows[0].id;
    });
    return reply.send({ id });
  });

  // ── POST /admin/bpo/smes ──
  app.post("/admin/bpo/smes", async (req, reply) => {
    const body = SmeCreate.parse(req.body);
    const tenantId = getTenantId();
    const actor = actorFromReq(req);
    const id = await withDb(async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO bpo_smes (bpo_partner_id, name, email)
         VALUES ($1, $2, $3) RETURNING id`,
        [body.bpo_partner_id, body.name, body.email],
      );
      await logAdminAudit(c, {
        actorId: actor.userId,
        targetTenantId: tenantId,
        action: "bpo_sme_create",
        reason: `Created BPO SME: ${body.name}`,
        metadata: {
          sme_id: rows[0].id,
          partner_id: body.bpo_partner_id,
          email: body.email,
        },
      });
      return rows[0].id;
    });
    return reply.send({ id });
  });

  // ── POST /admin/bpo/api-keys ──
  // Returns the raw token ONCE in the response body. Only the sha256 hash is
  // persisted in bpo_api_keys.key_hash. The raw token is NEVER written to the
  // audit row's metadata.
  app.post("/admin/bpo/api-keys", async (req, reply) => {
    const body = ApiKeyCreate.parse(req.body);
    const tenantId = getTenantId();
    const actor = actorFromReq(req);
    const raw = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(raw).digest();
    const id = await withTenantTx(tenantId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO bpo_api_keys (sme_id, tenant_id, key_hash)
         VALUES ($1, $2, $3) RETURNING id`,
        [body.sme_id, tenantId, hash],
      );
      await logAdminAudit(c, {
        actorId: actor.userId,
        targetTenantId: tenantId,
        action: "bpo_api_key_create",
        reason: `Issued BPO API key for SME ${body.sme_id}`,
        metadata: { api_key_id: rows[0].id, sme_id: body.sme_id }, // raw token NOT stored
      });
      return rows[0].id;
    });
    return reply.send({ id, token: raw }); // raw shown ONCE; never persisted
  });

  // ── POST /admin/va/pools ──
  // Catches the DPA gate trigger error (sqlstate 23514, message contains
  // 'dpa_gate_violation') and returns 409 with structured details. All other
  // errors propagate.
  app.post("/admin/va/pools", async (req, reply) => {
    const body = PoolCreate.parse(req.body);
    const tenantId = getTenantId();
    const actor = actorFromReq(req);
    if (body.kind === "bpo" && !body.bpo_partner_id) {
      return reply.status(422).send({ error: "BPO_PARTNER_ID_REQUIRED" });
    }
    if (body.kind === "internal" && body.bpo_partner_id !== null) {
      return reply.status(422).send({ error: "BPO_PARTNER_ID_NOT_ALLOWED" });
    }
    try {
      const id = await withTenantTx(tenantId, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO va_pools (tenant_id, name, kind, bpo_partner_id, active)
           VALUES ($1, $2, $3, $4, true) RETURNING id`,
          [tenantId, body.name, body.kind, body.bpo_partner_id],
        );
        const newId = rows[0]!.id;
        await logAdminAudit(c, {
          actorId: actor.userId,
          targetTenantId: tenantId,
          action: "va_pool_create",
          reason: `Created VA pool: ${body.name}`,
          metadata: {
            pool_id: newId,
            name: body.name,
            kind: body.kind,
            partner_id: body.bpo_partner_id,
          },
        });
        return newId;
      });
      return reply.send({ id });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("dpa_gate_violation")) {
        return reply.status(409).send({
          error: "DPA_GATE_VIOLATION",
          details:
            "BPO partner lacks dpa_on_file=true with non-empty dpa_reference; cannot create pool",
        });
      }
      throw e;
    }
  });

  // ── POST /admin/va/routing-rules ──
  app.post("/admin/va/routing-rules", async (req, reply) => {
    const body = RoutingRuleCreate.parse(req.body);
    const tenantId = getTenantId();
    const actor = actorFromReq(req);
    const id = await withTenantTx(tenantId, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO va_routing_rules (tenant_id, priority, match, target_pool_id)
         VALUES ($1, $2, $3::jsonb, $4) RETURNING id`,
        [tenantId, body.priority, JSON.stringify(body.match), body.target_pool_id],
      );
      const newId = rows[0]!.id;
      await logAdminAudit(c, {
        actorId: actor.userId,
        targetTenantId: tenantId,
        action: "va_routing_rule_create",
        reason: `Created VA routing rule for tenant ${tenantId}`,
        metadata: {
          rule_id: newId,
          priority: body.priority,
          match: body.match,
          target_pool_id: body.target_pool_id,
        },
      });
      return newId;
    });
    return reply.send({ id });
  });
}
