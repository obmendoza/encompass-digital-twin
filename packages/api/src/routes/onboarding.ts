import type { FastifyInstance } from "fastify";
import { withDb } from "../db/pool.js";
import { getTenantContext } from "../tenant-context.js";
import { CreateOnboardingSchema, UpdateOnboardingSchema, RESERVED_SLUGS, DEFAULT_SLA_CONFIG } from "@twin/core";
import { randomUUID } from "node:crypto";
import {
  createOnboardingSession,
  getOnboardingSession,
  updateOnboardingSession,
  completeOnboardingSession,
} from "../onboarding/session-manager.js";
import { getProcessor } from "../onboarding/document-processor.js";

// Side-effect imports: register processors at load time
import "../onboarding/claude-vision-processor.js";
import "../onboarding/manual-entry-processor.js";

export function registerOnboardingRoutes(app: FastifyInstance): void {
  // Create tenant + onboarding session (super_admin only)
  app.post("/onboarding", async (req, reply) => {
    const ctx = getTenantContext();
    if (!ctx.isSuperAdmin) return reply.code(403).send({ error: "super_admin required" });

    const parsed = CreateOnboardingSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { tenantName, slug, contactEmail, phone, lenderType, programs } = parsed.data;
    if (RESERVED_SLUGS.has(slug)) return reply.code(400).send({ error: `Slug "${slug}" is reserved` });

    const tenantId = randomUUID();
    const tenantSettings = {
      sla: DEFAULT_SLA_CONFIG,
      agentBehavior: { riskTolerance: "moderate" as const, autoApproveThreshold: 0.85, escalationTriggers: [] },
      webhooks: [],
      contact: { email: contactEmail, phone },
      lenderType,
      programs,
    };

    return withDb(async (client) => {
      try {
        await client.query("BEGIN");
        // Create tenant with status 'onboarding'
        const { rows } = await client.query(
          `INSERT INTO tenants (id, name, slug, status, type, settings)
           VALUES ($1, $2, $3, 'onboarding', 'production', $4)
           RETURNING id, name, slug, status, created_at`,
          [tenantId, tenantName, slug, JSON.stringify(tenantSettings)],
        );

        // Audit log
        await client.query(
          `INSERT INTO tenant_audit_log (actor_id, target_tenant_id, action, reason)
           VALUES ($1, $2, 'tenant_created', 'Onboarding initiated')`,
          [ctx.userId, tenantId],
        );
        await client.query("COMMIT");

        // Create onboarding session (uses its own transaction with RLS)
        const session = await createOnboardingSession(tenantId, ctx.userId);

        return reply.code(201).send({
          tenant: rows[0],
          sessionId: session.id,
          version: session.version,
        });
      } catch (e: unknown) {
        await client.query("ROLLBACK");
        if ((e as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: `Slug "${slug}" already exists` });
        }
        throw e;
      }
    });
  });

  // Get onboarding session state (super_admin only)
  app.get<{ Params: { tenantId: string } }>("/onboarding/:tenantId", async (req, reply) => {
    const ctx = getTenantContext();
    if (!ctx.isSuperAdmin) return reply.code(403).send({ error: "super_admin required" });

    const { tenantId } = req.params;
    const session = await getOnboardingSession(tenantId);
    if (!session) return reply.code(404).send({ error: "No active onboarding session found" });
    return session;
  });

  // Update onboarding session with optimistic concurrency (super_admin only)
  app.patch<{ Params: { tenantId: string } }>("/onboarding/:tenantId", async (req, reply) => {
    const ctx = getTenantContext();
    if (!ctx.isSuperAdmin) return reply.code(403).send({ error: "super_admin required" });

    const parsed = UpdateOnboardingSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const { tenantId } = req.params;
    const ifMatch = req.headers["if-match"];
    if (!ifMatch) return reply.code(428).send({ error: "If-Match header required for optimistic concurrency" });

    const expectedVersion = parseInt(String(ifMatch), 10);
    if (isNaN(expectedVersion)) return reply.code(400).send({ error: "If-Match must be a numeric version" });

    const newVersion = await updateOnboardingSession(tenantId, expectedVersion, parsed.data);
    if (newVersion === null) {
      return reply.code(409).send({ error: "Version conflict — session was modified by another request" });
    }

    return { version: newVersion };
  });

  // Run go-live checklist (super_admin only)
  app.post<{ Params: { tenantId: string } }>("/onboarding/:tenantId/run-checklist", async (req, reply) => {
    const ctx = getTenantContext();
    if (!ctx.isSuperAdmin) return reply.code(403).send({ error: "super_admin required" });

    const { tenantId } = req.params;
    const checks: Record<string, { pass: boolean; detail: string }> = {};

    // Check 1: Guidelines exist
    const guidelinesExist = await withDb(async (client) => {
      const { rows } = await client.query(
        "SELECT COUNT(*) as cnt FROM tenant_guidelines WHERE tenant_id = $1",
        [tenantId],
      );
      return parseInt(rows[0].cnt, 10) > 0;
    });
    checks.guidelines = {
      pass: guidelinesExist,
      detail: guidelinesExist ? "At least one guideline configured" : "No guidelines found — upload and configure guidelines first",
    };

    // Check 2: Tenant has settings (SLA configured)
    const slaConfirmed = await withDb(async (client) => {
      const { rows } = await client.query(
        "SELECT settings FROM tenants WHERE id = $1 AND deleted_at IS NULL",
        [tenantId],
      );
      if (rows.length === 0) return false;
      const settings = typeof rows[0].settings === "string" ? JSON.parse(rows[0].settings) : rows[0].settings;
      return !!settings?.sla;
    });
    checks.sla = {
      pass: slaConfirmed,
      detail: slaConfirmed ? "SLA configuration confirmed" : "SLA not configured",
    };

    // Check 3: Tenant exists and is in onboarding status
    const tenantReady = await withDb(async (client) => {
      const { rows } = await client.query(
        "SELECT status FROM tenants WHERE id = $1 AND deleted_at IS NULL",
        [tenantId],
      );
      return rows.length > 0 && rows[0].status === "onboarding";
    });
    checks.tenantStatus = {
      pass: tenantReady,
      detail: tenantReady ? "Tenant is in onboarding status" : "Tenant not found or not in onboarding status",
    };

    const allPassed = Object.values(checks).every((c) => c.pass);

    // Store checklist results in session
    try {
      const session = await getOnboardingSession(tenantId);
      if (session) {
        await updateOnboardingSession(tenantId, session.version, {
          checklistResults: checks,
        });
      }
    } catch {
      // Non-fatal: checklist results are returned in response regardless
    }

    return { passed: allPassed, checks };
  });

  // Activate tenant — validate checklist, set active, complete session (super_admin only)
  app.post<{ Params: { tenantId: string } }>("/onboarding/:tenantId/activate", async (req, reply) => {
    const ctx = getTenantContext();
    if (!ctx.isSuperAdmin) return reply.code(403).send({ error: "super_admin required" });

    const { tenantId } = req.params;

    // Run checklist inline
    const guidelinesExist = await withDb(async (client) => {
      const { rows } = await client.query(
        "SELECT COUNT(*) as cnt FROM tenant_guidelines WHERE tenant_id = $1",
        [tenantId],
      );
      return parseInt(rows[0].cnt, 10) > 0;
    });

    if (!guidelinesExist) {
      return reply.code(400).send({ error: "Cannot activate: no guidelines configured" });
    }

    // Activate tenant
    await withDb(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          "UPDATE tenants SET status = 'active' WHERE id = $1 AND deleted_at IS NULL",
          [tenantId],
        );
        await client.query(
          `INSERT INTO tenant_audit_log (actor_id, target_tenant_id, action, reason)
           VALUES ($1, $2, 'activate', 'Onboarding completed — tenant activated')`,
          [ctx.userId, tenantId],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    });

    // Complete the onboarding session
    await completeOnboardingSession(tenantId);

    return { status: "active", tenantId };
  });

  // Extract guideline rules from a document using Claude Vision (super_admin only)
  app.post<{ Params: { tenantId: string } }>("/onboarding/:tenantId/extract", async (req, reply) => {
    const ctx = getTenantContext();
    if (!ctx.isSuperAdmin) return reply.code(403).send({ error: "super_admin required" });

    const { tenantId } = req.params;
    const body = req.body as {
      documentUrl?: string;
      documentBase64?: string;
      mimeType: string;
      category: string;
      program?: string;
      fileName?: string;
    };

    if (!body.mimeType || !body.category) {
      return reply.code(400).send({ error: "mimeType and category are required" });
    }

    if (!body.documentUrl && !body.documentBase64) {
      return reply.code(400).send({ error: "Either documentUrl or documentBase64 is required" });
    }

    const processor = getProcessor("claude-vision");
    if (!processor) {
      return reply.code(500).send({ error: "Claude Vision processor not available" });
    }

    // Build fileUrl: use provided URL or construct a data URL from base64
    const fileUrl = body.documentUrl
      ? body.documentUrl
      : `data:${body.mimeType};base64,${body.documentBase64}`;

    const result = await processor.process({
      fileUrl,
      fileName: body.fileName ?? "upload.pdf",
      mimeType: body.mimeType,
      category: body.category,
      program: body.program,
      tenantId,
    });

    return reply.code(result.success ? 200 : 422).send(result);
  });
}
