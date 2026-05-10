// va.ts
// HTTP routes wrapping the VA Review Layer Phase 2 services
// (claim/release, review submission, queue, pools, admin toggle).
//
// Auth model: internal staff only — userId comes from the auth middleware via
// `x-user-id` (already resolved into the tenant context). BPO portal endpoints
// land in /bpo/* (Tasks 13-15) and are intentionally NOT here.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { VAReviewSchema, type Store } from "@twin/core";
import { getTenantContext, getTenantId } from "../tenant-context.js";
import { withTenantTx } from "../db/pool.js";
import { claimLoan, releaseLoan } from "../services/va-pool.js";
import { submitVAReview } from "../services/va-review-writer.js";
import { applyToggleFlip } from "../services/va-toggle.js";
import { receiveVADocResponse } from "../services/va-doc-return.js";

// Body shape for POST /loans/:id/va/review.
// We do shape-only validation here; the full structural invariants
// (verdict↔docRequest, six distinct specialists, etc.) are enforced by
// `VAReviewSchema.parse(compose)` after we layer in tenantId/vaId/etc.
const SubmitBody = z.object({
  verdict: z.enum(["concur", "request_docs"]),
  specialistSignoffs: z.array(z.unknown()).length(6),
  conditionActions: z.array(z.unknown()),
  overallRationale: z.string().min(20),
  docRequest: z.unknown().nullable(),
  agentRecommendationId: z.string().uuid(),
  kbVersion: z.string().min(1),
  chatbotConsultationIds: z.array(z.string().uuid()).default([]),
});

const ToggleBody = z.object({ required: z.boolean() });

// Body shape for POST /loans/:id/va/docs-returned. Shared with the BPO route
// (bpo.ts defines its own copy to keep import surfaces simple).
const DocsReturnedBody = z.object({
  documents: z
    .array(
      z.object({
        name: z.string().min(1),
        docType: z.string().min(1),
      }),
    )
    .min(1),
});

export function registerVARoutes(app: FastifyInstance, store: Store) {
  // ── POST /loans/:id/va/claim ──
  app.post<{ Params: { id: string } }>("/loans/:id/va/claim", async (req, reply) => {
    const tenantId = getTenantId();
    const { userId } = getTenantContext();
    const result = await claimLoan(tenantId, req.params.id, userId);
    if (!result.claimed) return reply.status(409).send(result);
    return reply.send(result);
  });

  // ── POST /loans/:id/va/release ──
  app.post<{ Params: { id: string } }>("/loans/:id/va/release", async (req, reply) => {
    const tenantId = getTenantId();
    const { userId } = getTenantContext();
    const result = await releaseLoan(tenantId, req.params.id, userId);
    if (!result.released) return reply.status(409).send(result);
    return reply.send(result);
  });

  // ── POST /loans/:id/va/review ──
  app.post<{ Params: { id: string } }>("/loans/:id/va/review", async (req, reply) => {
    const tenantId = getTenantId();
    const { userId } = getTenantContext();
    const loanId = req.params.id;

    const body = SubmitBody.parse(req.body);

    // Look up the current claim metadata; bail if not currently claimed by this user.
    // pg returns timestamptz columns as Date instances; we coerce to ISO string
    // below so the writer + Zod schema (both expect string) work cleanly.
    const cur = await withTenantTx(tenantId, async (c) => {
      const { rows } = await c.query<{
        va_id: string | null;
        assigned_pool_id: string | null;
        claimed_at: Date | string | null;
        va_state: string;
      }>(
        `SELECT va_id, assigned_pool_id, claimed_at, va_state
           FROM va_loan_state
          WHERE tenant_id = $1 AND loan_id = $2`,
        [tenantId, loanId],
      );
      return rows[0];
    });

    if (!cur || cur.va_state !== "va_in_review" || cur.va_id !== userId) {
      return reply.status(409).send({
        error: "VA_NOT_CLAIMANT",
        details: {
          state: cur?.va_state,
          currentClaimant: cur?.va_id,
          requester: userId,
        },
      });
    }
    if (!cur.assigned_pool_id) {
      return reply.status(409).send({ error: "VA_NO_POOL_ASSIGNED" });
    }

    // Pool kind drives the va_reviews.pool_kind column.
    const pool = await withTenantTx(tenantId, async (c) => {
      const { rows } = await c.query<{ kind: "internal" | "bpo" }>(
        `SELECT kind FROM va_pools WHERE id = $1`,
        [cur.assigned_pool_id],
      );
      return rows[0];
    });
    if (!pool) {
      return reply.status(409).send({ error: "VA_POOL_NOT_FOUND" });
    }

    const claimedAtIso =
      cur.claimed_at instanceof Date
        ? cur.claimed_at.toISOString()
        : (cur.claimed_at as string);

    // Compose the full VAReview shape so VAReviewSchema can enforce
    // cross-field invariants (verdict↔docRequest, six distinct specialists).
    // The writer will assign the real id + submittedAt + reviewTimeSeconds; we
    // pass placeholder values here purely so the schema accepts the object.
    const compose = {
      id: "00000000-0000-0000-0000-000000000000",
      tenantId,
      loanId,
      vaId: userId,
      vaPoolId: cur.assigned_pool_id,
      poolKind: pool.kind,
      verdict: body.verdict,
      specialistSignoffs: body.specialistSignoffs,
      conditionActions: body.conditionActions,
      overallRationale: body.overallRationale,
      docRequest: body.docRequest ?? null,
      agentRecommendationId: body.agentRecommendationId,
      kbVersion: body.kbVersion,
      chatbotConsultationIds: body.chatbotConsultationIds,
      claimedAt: claimedAtIso,
      submittedAt: new Date().toISOString(),
      reviewTimeSeconds: 0,
    };
    const parsed = VAReviewSchema.safeParse(compose);
    if (!parsed.success) {
      return reply.status(422).send({
        error: "VA_REVIEW_INVALID",
        issues: parsed.error.issues,
      });
    }

    const result = await submitVAReview({
      tenantId,
      loanId,
      vaId: userId,
      vaPoolId: cur.assigned_pool_id,
      poolKind: pool.kind,
      verdict: body.verdict,
      specialistSignoffs: parsed.data.specialistSignoffs,
      conditionActions: parsed.data.conditionActions,
      overallRationale: body.overallRationale,
      docRequest: parsed.data.docRequest,
      agentRecommendationId: body.agentRecommendationId,
      kbVersion: body.kbVersion,
      chatbotConsultationIds: body.chatbotConsultationIds,
      claimedAt: claimedAtIso,
    });
    return reply.send(result);
  });

  // ── POST /loans/:id/va/docs-returned ──
  // Originator (or internal staff acting on their behalf) returns the docs the
  // VA requested in a `request_docs` verdict. Adds the docs to the loan, flips
  // va_state back to agent_review_pending, and pings the agent service to
  // re-run. Returns 409 LOAN_NOT_AWAITING_DOCS if the loan isn't currently in
  // va_doc_request_pending.
  app.post<{ Params: { id: string } }>(
    "/loans/:id/va/docs-returned",
    async (req, reply) => {
      const tenantId = getTenantId();
      const { userId } = getTenantContext();
      const loanId = req.params.id;
      const body = DocsReturnedBody.parse(req.body);
      try {
        const result = await receiveVADocResponse(
          store,
          { tenantId, loanId, documents: body.documents },
          { kind: "internal", id: userId },
        );
        return reply.send(result);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("LOAN_NOT_AWAITING_DOCS")) {
          return reply.status(409).send({ error: "LOAN_NOT_AWAITING_DOCS" });
        }
        throw e;
      }
    },
  );

  // ── GET /loans/:id/va/review-history ──
  app.get<{ Params: { id: string } }>("/loans/:id/va/review-history", async (req) => {
    const tenantId = getTenantId();
    const loanId = req.params.id;
    return withTenantTx(tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT id, va_id, va_pool_id, pool_kind, verdict,
                specialist_signoffs, condition_actions, overall_rationale,
                doc_request, kb_version, agent_recommendation_id,
                chatbot_consultation_ids, claimed_at, submitted_at,
                review_time_seconds
           FROM va_reviews
          WHERE tenant_id = $1 AND loan_id = $2
          ORDER BY submitted_at ASC`,
        [tenantId, loanId],
      );
      return { reviews: rows };
    });
  });

  // ── GET /va/queue ──
  app.get("/va/queue", async (req) => {
    const tenantId = getTenantId();
    const q = req.query as { pool?: string; limit?: string; cursor?: string };
    const limit = Math.min(parseInt(q.limit ?? "50", 10) || 50, 200);

    return withTenantTx(tenantId, async (c) => {
      const params: unknown[] = [tenantId];
      let where = "tenant_id = $1 AND va_state = 'va_review_pending'";
      if (q.pool) {
        params.push(q.pool);
        where += ` AND assigned_pool_id = $${params.length}`;
      }
      if (q.cursor) {
        params.push(q.cursor);
        where += ` AND loan_id > $${params.length}`;
      }
      params.push(limit);
      const { rows } = await c.query(
        `SELECT loan_id, assigned_pool_id, claimed_at, va_state, updated_at
           FROM va_loan_state
          WHERE ${where}
          ORDER BY loan_id ASC
          LIMIT $${params.length}`,
        params,
      );
      return {
        items: rows,
        nextCursor:
          rows.length === limit ? rows[rows.length - 1].loan_id : null,
      };
    });
  });

  // ── GET /va/pools ──
  app.get("/va/pools", async () => {
    const tenantId = getTenantId();
    const { userId } = getTenantContext();
    return withTenantTx(tenantId, async (c) => {
      const { rows } = await c.query(
        `SELECT p.id, p.name, p.kind
           FROM va_pools p
           JOIN va_pool_memberships m ON m.pool_id = p.id
          WHERE p.tenant_id = $1 AND p.active = true AND m.member_id = $2`,
        [tenantId, userId],
      );
      return { pools: rows };
    });
  });

  // ── POST /admin/va/toggle ──
  app.post("/admin/va/toggle", async (req, reply) => {
    const tenantId = getTenantId();
    const body = ToggleBody.parse(req.body);

    const settingsRow = await withTenantTx(tenantId, async (c) => {
      const { rows } = await c.query<{ settings: { va?: { required?: boolean; fallbackPoolId?: string } } | null }>(
        `SELECT settings FROM tenants WHERE id = $1`,
        [tenantId],
      );
      return rows[0];
    });

    const cur = settingsRow?.settings?.va;
    if (!cur) {
      return reply.status(409).send({ error: "TENANT_VA_UNCONFIGURED" });
    }
    if (body.required && !cur.fallbackPoolId) {
      return reply.status(422).send({ error: "FALLBACK_POOL_REQUIRED" });
    }

    const fromRequired = !!cur.required;
    const result = await applyToggleFlip(
      tenantId,
      fromRequired,
      body.required,
      cur.fallbackPoolId ?? "",
    );

    // Persist the new value back to tenants.settings.va.required.
    await withTenantTx(tenantId, async (c) => {
      await c.query(
        `UPDATE tenants
            SET settings = settings || jsonb_build_object(
                  'va', COALESCE(settings->'va', '{}'::jsonb)
                       || jsonb_build_object('required', $1::boolean)
                )
          WHERE id = $2`,
        [body.required, tenantId],
      );
    });

    return reply.send(result);
  });
}
