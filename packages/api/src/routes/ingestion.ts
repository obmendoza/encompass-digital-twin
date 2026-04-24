import type { FastifyInstance } from "fastify";
import { withTenantTx } from "../db/pool.js";
import { apiKeyAuthHook } from "../middleware/api-key-auth.js";
import { runInTenantContext } from "../tenant-context.js";
import { getTransformer, registerTransformer } from "../ingestion/transformer.js";
import { GenericJsonTransformer } from "../ingestion/generic-json.js";
import { IngestLoanRequestSchema } from "@twin/core";
import { randomUUID } from "node:crypto";

registerTransformer(new GenericJsonTransformer());

export function registerIngestionRoutes(app: FastifyInstance): void {
  app.post<{ Params: { tenantSlug: string } }>(
    "/api/ingest/:tenantSlug/loans",
    { preHandler: apiKeyAuthHook },
    async (req, reply) => {
      const tenantId = (req as unknown as Record<string, string>).tenantId;
      const parsed = IngestLoanRequestSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const { source, externalId, loanData } = parsed.data;

      return runInTenantContext(
        { tenantId, userId: "api-ingest", isSuperAdmin: false },
        async () => {
          // Idempotency check
          const existing = await withTenantTx(tenantId, async (client) => {
            const { rows } = await client.query(
              "SELECT loan_id, status FROM ingested_loans WHERE external_id = $1", [externalId]
            );
            return rows[0] ?? null;
          });
          if (existing) {
            return reply.code(200).send({ loanId: existing.loan_id, tenantId, status: existing.status, duplicate: true });
          }

          // Load mapping + transform
          const mapping = await withTenantTx(tenantId, async (client) => {
            const { rows } = await client.query(
              "SELECT transformer_type, field_map FROM ingestion_mappings WHERE source_name = $1 AND active = true LIMIT 1", [source]
            );
            return rows[0] ?? null;
          });

          const transformer = getTransformer(mapping?.transformer_type ?? "generic-json");
          if (!transformer) return reply.code(400).send({ error: `Unknown transformer: ${mapping?.transformer_type}` });

          const fieldMap = (mapping?.field_map as Record<string, string>) ?? {};
          // If no field mapping configured, pass raw data through as-is (assume canonical format)
          const partialLoan = Object.keys(fieldMap).length > 0
            ? transformer.transform(loanData, fieldMap)
            : (loanData as Partial<import("@twin/core").Loan>);
          const validation = transformer.validate(partialLoan);
          if (!validation.valid) return reply.code(400).send({ error: "Validation failed", details: validation.errors });

          const loanId = `INGEST-${Date.now()}-${randomUUID().slice(0, 8)}`;

          await withTenantTx(tenantId, async (client) => {
            await client.query(
              "INSERT INTO ingested_loans (tenant_id, external_id, loan_id, status) VALUES ($1, $2, $3, 'queued')",
              [tenantId, externalId, loanId]
            );
          });

          return reply.code(201).send({ loanId, tenantId, status: "queued", estimatedProcessingMinutes: 15 });
        }
      );
    }
  );
}
