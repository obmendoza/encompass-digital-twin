// bpo.ts
// HTTP routes for the BPO SME portal. Auth is the BPO bearer-token middleware
// (Task 13's verifyBpoToken); the SME context is published via runWithBpoContext
// while a parallel tenant context (with userId = smeId) is set so downstream
// services that read getTenantId/getTenantContext keep working.
//
// Differences vs internal /loans/:id/va/* routes:
//   - actor.kind is "bpo" (poolKind on submitted reviews)
//   - cross-pool access returns 404, not 403, to avoid leaking loan-id existence
//   - docs-returned + signed-url are stubs in this task (Tasks 16, 18)

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { VAReviewSchema, type Store } from "@twin/core";
import { verifyBpoToken } from "../middleware/bpo-auth.js";
import {
  runWithBpoContext,
  getBpoContext,
  type BpoContext,
} from "../bpo-context.js";
import { runInTenantContext } from "../tenant-context.js";
import { withTenantTx } from "../db/pool.js";
import { claimLoan } from "../services/va-pool.js";
import { submitVAReview } from "../services/va-review-writer.js";
import { getLoanForTenant } from "./_helpers.js";

// Body shape for POST /bpo/loans/:id/review. Mirrors va.ts SubmitBody — the
// full structural invariants (verdict↔docRequest, six distinct specialists,
// etc.) are enforced by `VAReviewSchema.parse(compose)` after we layer in
// tenantId/vaId/etc.
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

/**
 * Auth + dual-context wrapper. Verifies the BPO bearer token, then runs the
 * handler inside both:
 *   - tenant context (so withTenantTx / getTenantId work; userId = smeId)
 *   - BPO context (so handlers can read partnerId / smeId / smeName)
 *
 * On auth failure verifyBpoToken has already sent a 401 — we return undefined
 * so Fastify treats the reply as already-handled.
 */
async function bpoGuarded<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<T>,
): Promise<T | undefined> {
  const auth = await verifyBpoToken(req, reply);
  if (!auth.ok) return undefined;
  const tenantCtx = {
    tenantId: auth.tenantId,
    userId: auth.smeId,
    isSuperAdmin: false,
  };
  const bpoCtx: BpoContext = {
    tenantId: auth.tenantId,
    partnerId: auth.partnerId,
    smeId: auth.smeId,
    smeName: auth.smeName,
  };
  return runInTenantContext(tenantCtx, () =>
    runWithBpoContext(bpoCtx, handler),
  );
}

export function registerBpoRoutes(app: FastifyInstance, store: Store): void {
  // ── POST /bpo/auth ──
  // Sanity probe: echoes the resolved BPO context. Useful for clients to
  // verify their token + see who they're authenticated as.
  app.post("/bpo/auth", async (req, reply) =>
    bpoGuarded(req, reply, async () => {
      const ctx = getBpoContext();
      return {
        partnerId: ctx.partnerId,
        smeId: ctx.smeId,
        smeName: ctx.smeName,
        tenantId: ctx.tenantId,
      };
    }),
  );

  // ── GET /bpo/queue ──
  // Loans in `va_review_pending` whose `assigned_pool_id` includes this SME
  // as a BPO member. Limit 50 to keep responses bounded; pagination can be
  // added later if needed.
  app.get("/bpo/queue", async (req, reply) =>
    bpoGuarded(req, reply, async () => {
      const ctx = getBpoContext();
      return withTenantTx(ctx.tenantId, async (c) => {
        const { rows } = await c.query(
          `SELECT s.loan_id, s.assigned_pool_id, s.claimed_at, s.va_state, s.updated_at
             FROM va_loan_state s
             JOIN va_pool_memberships m ON m.pool_id = s.assigned_pool_id
            WHERE s.tenant_id = $1
              AND s.va_state = 'va_review_pending'
              AND m.member_id = $2
              AND m.member_kind = 'bpo'
            ORDER BY s.loan_id ASC
            LIMIT 50`,
          [ctx.tenantId, ctx.smeId],
        );
        return { items: rows };
      });
    }),
  );

  // ── GET /bpo/loans/:id ──
  // Full loan detail. Two-layer guard:
  //   1. The SME must be a BPO member of the loan's assigned pool (SQL EXISTS).
  //   2. The loan must exist in the in-memory store and belong to this tenant.
  // Either failure returns 404 (not 403) so we don't leak loan-id existence
  // to BPO actors who don't own the pool.
  app.get<{ Params: { id: string } }>("/bpo/loans/:id", async (req, reply) =>
    bpoGuarded(req, reply, async () => {
      const ctx = getBpoContext();
      const loanId = req.params.id;

      const member = await withTenantTx(ctx.tenantId, async (c) => {
        const { rows } = await c.query<{ ok: boolean }>(
          `SELECT EXISTS (
             SELECT 1 FROM va_loan_state s
              JOIN va_pool_memberships m ON m.pool_id = s.assigned_pool_id
             WHERE s.tenant_id = $1
               AND s.loan_id = $2
               AND m.member_id = $3
               AND m.member_kind = 'bpo'
           ) AS ok`,
          [ctx.tenantId, loanId, ctx.smeId],
        );
        return rows[0]?.ok ?? false;
      });
      if (!member) {
        return reply.status(404).send({ error: "loan_not_found" });
      }

      const loan = getLoanForTenant(store, loanId);
      if (!loan) return reply.status(404).send({ error: "loan_not_found" });
      return reply.send({ loan });
    }),
  );

  // ── POST /bpo/loans/:id/claim ──
  // Race-safe claim: claimLoan() filters by membership in the assigned pool.
  // 409 on any failure (not-found, wrong-state, not-a-member) — the diagnostic
  // `reason` from the service is included in the body.
  app.post<{ Params: { id: string } }>(
    "/bpo/loans/:id/claim",
    async (req, reply) =>
      bpoGuarded(req, reply, async () => {
        const ctx = getBpoContext();
        const result = await claimLoan(ctx.tenantId, req.params.id, ctx.smeId);
        if (!result.claimed) return reply.status(409).send(result);
        return reply.send(result);
      }),
  );

  // ── POST /bpo/loans/:id/review ──
  // Submit a VA review with poolKind='bpo'. Same shape & validation as the
  // internal /loans/:id/va/review endpoint, but actor is the SME and pool
  // kind is hard-coded to 'bpo' (we still verify the assigned pool's kind in
  // the DB to match what the writer persists).
  app.post<{ Params: { id: string } }>(
    "/bpo/loans/:id/review",
    async (req, reply) =>
      bpoGuarded(req, reply, async () => {
        const ctx = getBpoContext();
        const loanId = req.params.id;
        const body = SubmitBody.parse(req.body);

        const cur = await withTenantTx(ctx.tenantId, async (c) => {
          const { rows } = await c.query<{
            va_id: string | null;
            assigned_pool_id: string | null;
            claimed_at: Date | string | null;
            va_state: string;
          }>(
            `SELECT va_id, assigned_pool_id, claimed_at, va_state
               FROM va_loan_state
              WHERE tenant_id = $1 AND loan_id = $2`,
            [ctx.tenantId, loanId],
          );
          return rows[0];
        });

        if (!cur || cur.va_state !== "va_in_review" || cur.va_id !== ctx.smeId) {
          return reply.status(409).send({
            error: "VA_NOT_CLAIMANT",
            details: {
              state: cur?.va_state,
              currentClaimant: cur?.va_id,
              requester: ctx.smeId,
            },
          });
        }
        if (!cur.assigned_pool_id) {
          return reply.status(409).send({ error: "VA_NO_POOL_ASSIGNED" });
        }

        // Coerce timestamptz → ISO string per Task 11 implementer's note.
        const claimedAtIso =
          cur.claimed_at instanceof Date
            ? cur.claimed_at.toISOString()
            : (cur.claimed_at as string);

        // Compose the full VAReview shape so VAReviewSchema can enforce
        // cross-field invariants. Writer assigns the real id + submittedAt +
        // reviewTimeSeconds; placeholders here are only for schema acceptance.
        const compose = {
          id: "00000000-0000-0000-0000-000000000000",
          tenantId: ctx.tenantId,
          loanId,
          vaId: ctx.smeId,
          vaPoolId: cur.assigned_pool_id,
          poolKind: "bpo" as const,
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
          tenantId: ctx.tenantId,
          loanId,
          vaId: ctx.smeId,
          vaPoolId: cur.assigned_pool_id,
          poolKind: "bpo",
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
      }),
  );

  // ── POST /bpo/loans/:id/docs-returned (STUB) ──
  // Task 18 will wire receiveVADocResponse here.
  app.post<{ Params: { id: string } }>(
    "/bpo/loans/:id/docs-returned",
    async (req, reply) =>
      bpoGuarded(req, reply, async () =>
        reply.status(501).send({
          error: "NOT_IMPLEMENTED",
          details: "wired in Task 18",
        }),
      ),
  );

  // ── GET /bpo/loans/:id/documents/:docId/signed-url (STUB) ──
  // Task 16 will wire the signed-URL service here.
  app.get<{ Params: { id: string; docId: string } }>(
    "/bpo/loans/:id/documents/:docId/signed-url",
    async (req, reply) =>
      bpoGuarded(req, reply, async () =>
        reply.status(501).send({
          error: "NOT_IMPLEMENTED",
          details: "wired in Task 16",
        }),
      ),
  );
}
